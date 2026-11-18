import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, Subject, catchError, expand, forkJoin, map, reduce, switchMap } from 'rxjs';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { initialPage, Pagination, type PageInfo, type PageRequest } from '../shared/pagination';

enum PaymentKind { Payment = 'payment', Refund = 'refund' }
enum PaymentMethod { Cash = 'cash', Transfer = 'transfer', Card = 'card', Other = 'other' }
const manualInvoicePrefix = 'invoice:';
interface Movement {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amountCents: number;
  reference: string | null;
  createdAt: string;
  createdBy: string;
  customerName: string | null;
  invoiceNumber: number;
}
type TaxBreakdown = Record<'withTax' | 'withoutTax' | 'pendingTax', { amountCents: number; count: number }>;
interface Dashboard {
  invoicedWithTaxCents: number;
  invoicedWithoutTaxCents: number;
  invoicesWithTax: number;
  invoicesWithoutTax: number;
  invoicesUnpaid: number;
  invoicesPartial: number;
  invoicesPaid: number;
  collectedMonthCents: number;
  collectedTodayCents: number;
  outstandingCents: number;
  outstandingByTax: TaxBreakdown;
  collectedTodayByTax: TaxBreakdown;
  hasPendingTax: boolean;
  movements: Movement[];
  pagination?: PageInfo;
}
interface Order {
  id: string;
  number: number;
  customerName: string;
  catalogName: string;
}
interface OrderResponse { orders: Order[] }
interface ManualInvoice { id: string; number: number; customerName: string }
interface Ledger {
  totalCents: number | null;
  paidCents: number;
  customerBalance: { outstandingCents: number; hasPendingTax: boolean };
}
interface MonthOption { value: string; label: string }

function monthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parsePaymentCents(value: string): number | null {
  const amount = value.trim().replace(/^RD\$\s*/i, '');
  const plain = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(amount);
  const grouped = plain ? null : /^([1-9]\d{0,2}(?:,\d{3}){1,2})(?:\.(\d{1,2}))?$/.exec(amount);
  const match = plain ?? grouped;
  if (!match) return null;
  const cents = Number(match[1].replaceAll(',', '')) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

@Component({
  selector: 'app-payments',
  imports: [ReactiveFormsModule, Shell, Pagination],
  templateUrl: './payments.html',
  styleUrl: './payments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Payments {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly canManage = this.workshop?.role === MembershipRole.Owner
    || this.workshop?.role === MembershipRole.Manager;
  protected readonly methods = PaymentMethod;
  protected readonly methodOptions = [
    { value: PaymentMethod.Cash, label: 'Efectivo' },
    { value: PaymentMethod.Transfer, label: 'Transferencia bancaria' },
    { value: PaymentMethod.Card, label: 'Tarjeta' },
    { value: PaymentMethod.Other, label: 'Otro' },
  ];
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly orders = signal<Order[]>([]);
  protected readonly manualInvoices = signal<ManualInvoice[]>([]);
  protected readonly ledger = signal<Ledger | null>(null);
  protected readonly ledgerLoading = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly lastReceipt = signal<string | null>(null);
  protected readonly selectedMonth = signal(monthValue(new Date()));
  protected readonly selectedMethod = signal('all');
  protected readonly searchTerm = signal('');
  protected readonly movementLoading = signal(false);
  protected readonly movementError = signal('');
  protected readonly exporting = signal(false);
  private readonly movementRequests = new Subject<PageRequest>();
  private movementRevision = 0;
  private pendingRequest: { fingerprint: string; id: string } | null = null;
  protected readonly uncertain = signal(false);
  private ledgerRequest = 0;
  private reloadRequested = false;
  private readonly formatter = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
  protected readonly months: MonthOption[] = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - index);
    return {
      value: monthValue(date),
      label: new Intl.DateTimeFormat('es-DO', { month: 'long', year: 'numeric', timeZone: 'America/Santo_Domingo' }).format(date),
    };
  });
  protected readonly form = new FormGroup({
    documentKey: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, (control) => parsePaymentCents(control.value) === null ? { paymentAmount: true } : null],
    }),
    method: new FormControl(PaymentMethod.Transfer, { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
  });
  protected readonly balanceCents = computed(() => {
    const ledger = this.ledger();
    return ledger?.totalCents === null || !ledger ? null : Math.max(0, ledger.totalCents - ledger.paidCents);
  });
  protected readonly movements = signal<Movement[]>([]);
  protected readonly movementPage = signal<PageInfo | null>(null);

  constructor() {
    this.movementRequests.pipe(
      switchMap((page) => {
        this.movementLoading.set(true);
        this.movementError.set('');
        return this.http.get<Dashboard>(`${this.base}/payments/dashboard`, {
          params: { ...this.movementFilters(), ...page },
        }).pipe(catchError(() => {
          this.movementLoading.set(false);
          this.movementError.set('No pudimos cargar los movimientos.');
          return EMPTY;
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((response) => this.applyMovements(response));
    if (this.workshop && this.canManage) this.load();
  }

  protected changeMovementPage(page: PageRequest): void {
    this.movementRevision++;
    this.movementRequests.next(page);
  }

  protected filterMovements(): void {
    this.changeMovementPage({ page: 1, pageSize: this.movementPage()?.pageSize ?? initialPage.pageSize });
  }

  private movementFilters() {
    return { month: this.selectedMonth(), method: this.selectedMethod(), search: this.searchTerm().trim() };
  }

  private applyMovements(response: Dashboard): void {
    this.movements.set(response.movements);
    this.movementPage.set(response.pagination ?? null);
    this.movementLoading.set(false);
  }

  protected load(): void {
    if (!this.workshop) return;
    if (this.loading()) {
      this.reloadRequested = true;
      return;
    }
    this.loading.set(true);
    this.error.set('');
    const revision = ++this.movementRevision;
    this.movementError.set('');
    const { page, pageSize } = this.movementPage() ?? initialPage;
    forkJoin({
      dashboard: this.http.get<Dashboard>(`${this.base}/payments/dashboard`, {
        params: { ...this.movementFilters(), page, pageSize },
      }),
      orders: this.http.get<OrderResponse>(`${this.base}/payments/order-receivables`),
      manual: this.http.get<{ invoices: ManualInvoice[] }>(`${this.base}/payments/manual-receivables`),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ dashboard, orders, manual }) => {
        this.dashboard.set(dashboard);
        if (revision === this.movementRevision) this.applyMovements(dashboard);
        this.orders.set(orders.orders);
        this.manualInvoices.set(manual.invoices);
        this.loading.set(false);
        if (this.reloadRequested) {
          this.reloadRequested = false;
          this.load();
          return;
        }
        const key = this.form.controls.documentKey.value;
        const available = key.startsWith(manualInvoicePrefix)
          ? manual.invoices.some((invoice) => this.manualKey(invoice.id) === key)
          : orders.orders.some((order) => order.id === key);
        if (this.uncertain()) return;
        if (key && !available) {
          this.selectDocument('');
        } else if (key) {
          this.loadLedger(key);
        }
      },
      error: () => {
        this.orders.set([]);
        this.manualInvoices.set([]);
        if (!this.uncertain()) this.selectDocument('');
        this.loading.set(false);
        this.error.set('No pudimos cargar los cobros de la sastrería. Inténtalo de nuevo.');
        if (this.reloadRequested) {
          this.reloadRequested = false;
          this.load();
        }
      },
    });
  }

  protected selectDocument(key: string): void {
    this.ledgerRequest++;
    this.form.controls.documentKey.setValue(key);
    this.ledger.set(null);
    this.ledgerLoading.set(false);
    this.pendingRequest = null;
    this.uncertain.set(false);
    if (key) this.loadLedger(key);
  }

  protected save(): void {
    if (!this.workshop || this.saving() || this.loading()) return;
    this.form.markAllAsTouched();
    const { documentKey, amount, method, reference } = this.form.getRawValue();
    if (!documentKey) {
      this.error.set('Selecciona la orden o factura que deseas abonar.');
      return;
    }
    const amountCents = parsePaymentCents(amount);
    if (amountCents === null) {
      this.error.set('Ingresa un monto mayor que cero, con hasta dos decimales. Por ejemplo: 4998.00 o RD$4,998.00.');
      return;
    }
    if (this.form.controls.reference.invalid) {
      this.error.set('La referencia bancaria no puede exceder los 120 caracteres.');
      return;
    }
    const balance = this.balanceCents();
    if (balance === null) {
      this.error.set('El saldo del documento no está disponible. Actualiza los datos antes de abonar.');
      return;
    }
    if (amountCents > balance) {
      const document = this.isManualSelected() ? 'esta factura' : 'esta orden';
      this.error.set(`Puedes abonar hasta ${this.money(balance)} a ${document}. Para pagar otro saldo del cliente, selecciona el documento correspondiente.`);
      return;
    }
    const payload = {
      kind: PaymentKind.Payment,
      method,
      amountCents,
      reference: reference.trim(),
    };
    const fingerprint = JSON.stringify({ documentKey, ...payload });
    if (this.uncertain() && this.pendingRequest?.fingerprint !== fingerprint) {
      this.error.set('El registro anterior tiene resultado incierto. Reintenta con los mismos datos antes de cambiar el movimiento.');
      return;
    }
    if (this.pendingRequest?.fingerprint !== fingerprint) {
      this.pendingRequest = { fingerprint, id: crypto.randomUUID() };
    }
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    this.lastReceipt.set(null);
    this.http.post<{ id: string }>(
      this.ledgerUrl(documentKey),
      { ...payload, requestId: this.pendingRequest.id },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ id }) => {
        this.pendingRequest = null;
        this.uncertain.set(false);
        this.saving.set(false);
        this.form.controls.amount.reset('');
        this.form.controls.reference.reset('');
        this.notice.set('Cobro registrado.');
        this.lastReceipt.set(id);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.uncertain.set(error.status === 0 || error.status >= 500);
        if (!this.uncertain()) this.pendingRequest = null;
        this.error.set(error.status === 409
          ? 'El saldo cambió o el monto ya no está disponible. Actualiza los datos.'
          : 'No pudimos confirmar el registro. Reintenta sin cambiar los datos para evitar duplicados.');
      },
    });
  }

  protected export(): void {
    const filters = this.movementFilters();
    this.exporting.set(true);
    const request = (page: number) => this.http.get<Dashboard>(`${this.base}/payments/dashboard`, {
      params: { ...filters, page, pageSize: 100 },
    });
    request(1).pipe(
      expand(({ pagination }) => pagination && pagination.page * pagination.pageSize < pagination.total
        ? request(pagination.page + 1) : EMPTY),
      map(({ movements }) => movements),
      reduce((all, movements) => all.concat(movements), [] as Movement[]),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (movements) => { this.downloadMovements(movements); this.exporting.set(false); },
      error: () => { this.movementError.set('No pudimos exportar los movimientos.'); this.exporting.set(false); },
    });
  }

  private downloadMovements(movements: Movement[]): void {
    const rows = [
      ['Fecha', 'Recibo', 'Cliente', 'Factura', 'Método', 'Monto'],
      ...movements.map((entry) => [
        this.date(entry.createdAt),
        entry.reference ?? entry.id.slice(-8),
        entry.customerName ?? '',
        this.invoiceNumber(entry.invoiceNumber),
        this.methodLabel(entry.method),
        this.money(entry.amountCents),
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => {
      const cell = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
      return `"${cell.replaceAll('"', '""')}"`;
    }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = 'movimientos.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  protected money(cents: number): string { return this.formatter.format(cents / 100); }
  protected orderNumber(number: number): string { return `OT-${String(number).padStart(4, '0')}`; }
  protected invoiceNumber(number: number): string { return `FA-${String(number).padStart(6, '0')}`; }
  protected receiptUrl(paymentId: string): string { return `${this.base}/payments/${paymentId}/ticket`; }
  protected manualKey(id: string): string { return `${manualInvoicePrefix}${id}`; }
  protected isManualSelected(): boolean { return this.form.controls.documentKey.value.startsWith(manualInvoicePrefix); }
  protected methodLabel(method: PaymentMethod): string {
    return this.methodOptions.find((option) => option.value === method)?.label ?? 'Otro';
  }
  protected date(value: string): string {
    return new Intl.DateTimeFormat('es-DO', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'America/Santo_Domingo',
    }).format(new Date(value));
  }
  protected movementReference(entry: Movement): string { return entry.reference ?? entry.id.slice(-8).toUpperCase(); }

  private ledgerUrl(key: string): string {
    return key.startsWith(manualInvoicePrefix)
      ? `${this.base}/invoices/${key.slice(manualInvoicePrefix.length)}/payments`
      : `${this.base}/orders/${key}/payments`;
  }

  private loadLedger(key: string): void {
    if (!this.workshop) return;
    const request = ++this.ledgerRequest;
    this.ledgerLoading.set(true);
    this.ledger.set(null);
    this.http.get<Ledger>(this.ledgerUrl(key), { params: { includeCustomerBalance: true } })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (ledger) => {
          if (request !== this.ledgerRequest || key !== this.form.controls.documentKey.value) return;
          this.ledgerLoading.set(false);
          this.ledger.set(ledger);
          this.error.set('');
        },
        error: () => {
          if (request !== this.ledgerRequest || key !== this.form.controls.documentKey.value) return;
          this.ledgerLoading.set(false);
          this.ledger.set(null);
          this.error.set('No pudimos cargar el saldo del documento seleccionado. Inténtalo de nuevo.');
        },
      });
  }

  private get base(): string { return `/api/workshops/${this.workshop!.id}`; }
}
