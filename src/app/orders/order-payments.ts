import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import { initialPage, Pagination, type PageRequest } from '../shared/pagination';
import type { InvoiceCollection } from '../shared/invoice-status';

enum Kind { Payment = 'payment', Refund = 'refund' }
enum Method { Cash = 'cash', Transfer = 'transfer', Card = 'card', Other = 'other' }
interface Entry {
  id: string; kind: Kind; method: Method; amountCents: number; reference: string | null; originalPaymentId: string | null;
  reason: string | null; createdAt: string; createdBy: string;
}
interface Ledger extends Partial<InvoiceCollection> { totalCents: number | null; paidCents: number; payments: Entry[] }

@Component({
  selector: 'app-order-payments',
  imports: [ReactiveFormsModule, Pagination],
  templateUrl: './order-payments.html',
  styleUrl: './order-payments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderPayments {
  readonly workshopId = input.required<string>();
  readonly orderId = input<string | null>(null);
  readonly invoiceId = input<string | null>(null);
  readonly invoiceCollectionLoaded = output<InvoiceCollection & { id: string }>();
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Subject<string>();
  private pendingRequest: { fingerprint: string; id: string } | null = null;
  private readonly moneyFormatter = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
  protected readonly kinds = Kind;
  protected readonly methods = Method;
  protected readonly ledger = signal<Ledger | null>(null);
  protected readonly historyRequest = signal<PageRequest>(initialPage);
  protected readonly historyPage = computed(() => {
    const entries = this.ledger()?.payments ?? [];
    const { page: requested, pageSize } = this.historyRequest();
    const page = Math.min(requested, Math.max(1, Math.ceil(entries.length / pageSize)));
    return { page, pageSize, total: entries.length, entries: entries.slice((page - 1) * pageSize, page * pageSize) };
  });
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly uncertain = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly form = new FormGroup({
    kind: new FormControl(Kind.Payment, { nonNullable: true }),
    amount: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{1,9}(\.\d{1,2})?$/)] }),
    method: new FormControl(Method.Cash, { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
    originalPaymentId: new FormControl('', { nonNullable: true }),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  constructor() {
    this.requests.pipe(
      tap(() => { this.loading.set(true); this.error.set(''); this.ledger.set(null); }),
      switchMap((url) => this.http.get<Ledger>(url).pipe(
        catchError(() => {
          this.loading.set(false); this.error.set('No pudimos cargar los cobros. Inténtalo de nuevo.');
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((ledger) => {
      this.ledger.set(ledger); this.loading.set(false);
      const id = this.invoiceId();
      const { displayStatus, paidCents, balanceCents } = ledger;
      if (id && displayStatus && balanceCents !== undefined) {
        this.invoiceCollectionLoaded.emit({ id, displayStatus, paidCents, balanceCents });
      }
    });
    effect(() => {
      const base = this.url();
      this.historyRequest.set(initialPage);
      this.pendingRequest = null;
      this.uncertain.set(false);
      this.requests.next(base);
    });
  }

  protected refresh(): void { this.requests.next(this.url()); }
  protected receiptUrl(paymentId: string): string {
    return `/api/workshops/${this.workshopId()}/payments/${paymentId}/ticket`;
  }

  protected save(): void {
    if (this.saving() || !this.ledger()) return;
    this.form.markAllAsTouched();
    const { kind, amount, method, reference, originalPaymentId, reason } = this.form.getRawValue();
    if (this.form.controls.amount.invalid || !/^\d{1,9}(\.\d{1,2})?$/.test(amount)) {
      this.error.set('Introduce un monto válido en pesos, con hasta dos decimales.'); return;
    }
    const [whole, fraction = ''] = amount.split('.');
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (amountCents <= 0 || (kind === Kind.Refund && (!originalPaymentId || !reason.trim() || this.form.controls.reason.invalid))) {
      this.error.set('Indica un monto mayor que cero y, para devoluciones, el cobro original y el motivo.'); return;
    }
    const payload = kind === Kind.Payment
      ? { kind, method, amountCents, reference: reference.trim() }
      : { kind, method, amountCents, reference: reference.trim(), originalPaymentId, reason: reason.trim() };
    const fingerprint = JSON.stringify(payload);
    if (this.uncertain() && this.pendingRequest?.fingerprint !== fingerprint) {
      this.error.set('El registro anterior tiene resultado incierto. Reintenta con los mismos datos antes de cambiar el movimiento.');
      return;
    }
    if (this.pendingRequest?.fingerprint !== fingerprint) this.pendingRequest = { fingerprint, id: crypto.randomUUID() };
    this.error.set(''); this.notice.set(''); this.saving.set(true);
    this.http.post(this.url(), { ...payload, requestId: this.pendingRequest.id })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.saving.set(false); this.pendingRequest = null; this.uncertain.set(false);
          this.form.reset({ kind: Kind.Payment, amount: '', method: Method.Cash, reference: '', originalPaymentId: '', reason: '' });
          this.notice.set('Movimiento registrado.'); this.refresh();
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.uncertain.set(error.status !== 409);
          this.error.set(error.status === 409
            ? 'El movimiento supera el saldo disponible o el total no está calculado. Actualiza los datos.'
            : 'No pudimos confirmar el registro. Reintenta sin cambiar los datos para evitar duplicados.');
        },
      });
  }

  protected money(cents: number): string { return this.moneyFormatter.format(cents / 100); }
  protected methodLabel(method: Method): string {
    const labels: Record<Method, string> = {
      [Method.Cash]: 'Efectivo', [Method.Transfer]: 'Transferencia', [Method.Card]: 'Tarjeta', [Method.Other]: 'Otro',
    };
    return labels[method];
  }
  protected date(value: string): string {
    return new Intl.DateTimeFormat('es-DO', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santo_Domingo',
    }).format(new Date(value));
  }
  private url(): string {
    const invoiceId = this.invoiceId();
    return invoiceId
      ? `/api/workshops/${this.workshopId()}/invoices/${invoiceId}/payments`
      : `/api/workshops/${this.workshopId()}/orders/${this.orderId()}/payments`;
  }
}
