import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { OrderPayments } from '../orders/order-payments';
import { orderNumber } from '../orders/order-display';
import { TAX_RATE_PATTERN } from '../orders/tax-rate';
import { InvoiceCollectionState, InvoiceStatus, invoiceStatusLabels, type InvoiceCollection, type InvoiceDisplayStatus } from '../shared/invoice-status';

enum TaxTreatment { Taxable = 'taxable', Exempt = 'exempt' }
type Source = 'manual' | 'order';
interface Customer { id: string; name: string; phone: string }
interface Order {
  id: string; number: number; customerName: string; catalogName: string; subtotalCents: number;
  taxCents: number | null; taxTreatment: TaxTreatment; taxBasisPoints: number | null;
}
interface Line {
  description: string; quantityMilli: number; unitPriceCents: number; discountCents: number; taxTreatment: TaxTreatment;
  subtotalCents: number; taxBasisPoints: number | null; taxCents: number | null;
}
interface Invoice extends InvoiceCollection {
  id: string; number: number; orderId: string | null; customerId: string; customer: Customer;
  orderNumber: number | null;
  status: InvoiceStatus; version: number; issueDate: string; dueDate: string | null;
  hasTax: boolean; taxBasisPoints: number | null;
  fiscalDataMissing?: string[];
  terms: string; notes: string; subtotalCents: number; taxCents: number | null; totalCents: number | null;
  lines: Line[]; voidReason: string | null;
  revisions: { revision: number; kind: string; changedAt: string; changedBy: string; changedByName: string;
    snapshot?: { hasTax?: boolean; taxBasisPoints: number | null } }[];
}
interface InvoiceRow extends InvoiceCollection {
  id: string; number: number; status: InvoiceStatus; issueDate: string; dueDate: string | null;
  orderNumber: number | null;
  customer: Customer; subtotalCents: number; taxCents: number | null; totalCents: number | null;
  hasTax: boolean; taxBasisPoints: number | null;
}
interface Settings { customers: Customer[]; orders: Order[] }
interface Profile {
  legalName: string | null; tradeName: string | null; rnc: string | null; fiscalAddress: string | null;
  phone: string | null; email: string | null; hasLogo: boolean; logoMimeType: string | null;
  logoDataUrl?: string | null; sealDataUrl?: string | null;
  workshopName: string; itbisBasisPoints: number | null; allowInvoicesWithoutTax: boolean;
}
interface ProfileFormValues {
  legalName: string; tradeName: string; rnc: string; fiscalAddress: string; phone: string; email: string;
}
type InvoiceLineForm = FormGroup<{
  description: FormControl<string>; quantity: FormControl<string>; unitPrice: FormControl<string>;
  discount: FormControl<string>;
}>;
enum InvoiceTaxMode { WithTax = 'with-tax', WithoutTax = 'without-tax' }

@Component({
  selector: 'app-invoices',
  imports: [ReactiveFormsModule, RouterLink, Shell, OrderPayments, Pagination],
  templateUrl: './invoices.html',
  styleUrl: './invoices.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Invoices {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly fiscalSettings = inject(ActivatedRoute).snapshot.data['fiscalSettings'] === true;
  protected readonly canConfigure = this.workshop?.role === MembershipRole.Owner;
  protected readonly statuses = InvoiceStatus;
  protected readonly orderNumber = orderNumber;
  protected readonly partialStatus = InvoiceCollectionState.Partial;
  protected readonly statusLabels = invoiceStatusLabels;
  protected readonly statusOptions: InvoiceDisplayStatus[] = [
    InvoiceStatus.Draft, InvoiceStatus.Issued, InvoiceCollectionState.Partial, InvoiceCollectionState.Paid, InvoiceStatus.Void,
  ];
  protected readonly taxModes = InvoiceTaxMode;
  protected readonly taxable = TaxTreatment.Taxable;
  protected readonly canManage = this.workshop?.role === MembershipRole.Owner || this.workshop?.role === MembershipRole.Manager;
  protected readonly view = signal<'list' | 'create' | 'detail' | 'profile'>(this.fiscalSettings ? 'profile' : 'list');
  protected readonly rows = signal<InvoiceRow[]>([]);
  protected readonly detail = signal<Invoice | null>(null);
  protected readonly profile = signal<Profile | null>(null);
  private readonly pendingImages = signal<Partial<Pick<Profile, 'logoDataUrl' | 'sealDataUrl'>>>({});
  protected readonly companyImages = computed(() => ({
    logoDataUrl: this.pendingImages().logoDataUrl ?? this.profile()?.logoDataUrl,
    sealDataUrl: this.pendingImages().sealDataUrl ?? this.profile()?.sealDataUrl,
  }));
  protected readonly customers = signal<Customer[]>([]);
  protected readonly orders = signal<Order[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly uncertain = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly statusFilter = new FormControl<InvoiceDisplayStatus | ''>('', { nonNullable: true });
  protected readonly source = new FormControl<Source>('manual', { nonNullable: true });
  protected readonly taxMode = new FormControl(InvoiceTaxMode.WithTax, { nonNullable: true });
  protected readonly allowWithoutTax = new FormControl(false, { nonNullable: true });
  protected readonly form = new FormGroup({
    customerId: new FormControl('', { nonNullable: true }),
    orderId: new FormControl('', { nonNullable: true }),
    issueDate: new FormControl(this.today(), { nonNullable: true, validators: [Validators.required] }),
    dueDate: new FormControl('', { nonNullable: true }),
    terms: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(2000)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(4000)] }),
  });
  protected readonly profileForm = new FormGroup({
    legalName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    tradeName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(200)] }),
    rnc: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^[0-9]{9,11}$/)] }),
    fiscalAddress: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30), (control) => {
      const phone = typeof control.value === 'string' ? control.value.trim() : '';
      return !phone || (/^\+?[\d ()-]+$/.test(phone) && /^\d{10,15}$/.test(phone.replace(/\D/g, '')))
        ? null : { phone: true };
    }] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email, Validators.maxLength(254)] }),
  });
  protected readonly lines = new FormArray<InvoiceLineForm>([]);
  protected readonly taxRate = new FormControl('', {
    nonNullable: true, validators: [Validators.pattern(TAX_RATE_PATTERN)],
  });
  protected readonly voidReason = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(1000)] });
  private pendingRequest: { fingerprint: string; id: string } | null = null;
  private readonly moneyFormatter = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });

  constructor() {
    this.source.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((source) => {
      const customer = this.form.controls.customerId;
      const order = this.form.controls.orderId;
      customer.setValidators(source === 'manual' ? [Validators.required] : []);
      order.setValidators(source === 'order' ? [Validators.required] : []);
      customer.updateValueAndValidity({ emitEvent: false });
      order.updateValueAndValidity({ emitEvent: false });
    });
    this.form.controls.customerId.setValidators([Validators.required]);
    if (this.fiscalSettings) {
      if (this.canConfigure) { this.loadProfile(); this.focusHeading(); }
    } else if (this.canManage) {
      this.loadList();
    }
  }

  protected readonly baseUrl: string = this.workshop ? `/api/workshops/${this.workshop.id}` : '';
  protected money(cents: number): string { return this.moneyFormatter.format(cents / 100); }
  protected manualPreview(): { subtotal: number; tax: number | null; total: number | null } {
    const rate = this.taxMode.value === InvoiceTaxMode.WithoutTax ? 0 : this.profile()?.itbisBasisPoints ?? null;
    let subtotal = 0;
    let tax = 0;
    for (const line of this.lines.controls) {
      const raw = line.getRawValue();
      const quantity = this.milli(raw.quantity);
      const price = this.cents(raw.unitPrice);
      const discount = this.cents(raw.discount || '0');
      if (quantity === null || price === null || discount === null) continue;
      const base = Math.max(0, Number((BigInt(quantity) * BigInt(price) + 500n) / 1000n) - discount);
      subtotal += base;
      if (rate !== null) tax += Number((BigInt(base) * BigInt(rate) + 5000n) / 10000n);
    }
    return { subtotal, tax: rate === null ? null : tax, total: rate === null ? null : subtotal + tax };
  }
  protected invoiceNumber(number: number): string { return `FA-${String(number).padStart(6, '0')}`; }
  protected date(value: string): string {
    const dateTime = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
    return new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeZone: 'America/Santo_Domingo' }).format(new Date(dateTime));
  }
  protected showList(): void { this.view.set('list'); this.detail.set(null); this.error.set(''); this.loadList(); }
  protected showCreate(): void {
    this.resetForm(); this.view.set('create'); this.loadLookups(); this.loadProfile(); this.focusHeading();
  }
  protected taxLabel(hasTax: boolean, rate: number | null): string {
    return hasTax ? `Factura con ITBIS${rate == null ? '' : ` (${rate / 100} %)`}` : 'Factura sin ITBIS';
  }
  protected hasFixedAmounts(invoice: Invoice | null): boolean {
    return !!invoice && (!!invoice.orderId ||
      (invoice.lines.some((line) => line.taxTreatment === TaxTreatment.Exempt) &&
        invoice.lines.some((line) => line.taxTreatment === TaxTreatment.Taxable)));
  }
  protected selectedOrder(): Order | undefined {
    return this.orders().find((order) => order.id === this.form.controls.orderId.value);
  }
  protected editDraft(invoice: Invoice): void {
    if (invoice.status !== InvoiceStatus.Draft) return;
    this.view.set('create'); this.error.set(''); this.detail.set(invoice);
    this.source.setValue('manual');
    this.taxMode.setValue(invoice.hasTax === false && !invoice.orderId ? InvoiceTaxMode.WithoutTax : InvoiceTaxMode.WithTax);
    if (!invoice.orderId) this.loadProfile();
    this.form.reset({
      customerId: invoice.customerId, orderId: invoice.orderId ?? '', issueDate: invoice.issueDate,
      dueDate: invoice.dueDate ?? '', terms: invoice.terms, notes: invoice.notes,
    });
    this.lines.clear();
    for (const line of invoice.lines) this.addLine(line);
    this.focusHeading();
  }
  protected openInvoice(id: string, page: PageRequest = initialPage): void {
    this.voidReason.reset('');
    this.loading.set(true); this.error.set(''); this.view.set('detail'); this.focusHeading();
    this.http.get<Invoice & { revisionsPagination?: PageInfo }>(`${this.baseUrl}/invoices/${id}`, {
      params: { ...page },
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (invoice) => { this.detail.set(invoice); this.revisionsPage.set(invoice.revisionsPagination ?? null); this.loading.set(false); },
      error: () => { this.loading.set(false); this.error.set('No pudimos cargar la factura. Inténtalo de nuevo.'); },
    });
  }
  protected readonly revisionsPage = signal<PageInfo | null>(null);
  protected updateInvoiceCollection({ id, ...collection }: InvoiceCollection & { id: string }): void {
    this.detail.update((invoice) => invoice?.id === id ? { ...invoice, ...collection } : invoice);
  }
  protected addLine(line?: Line): void {
    this.lines.push(new FormGroup({
      description: new FormControl(line?.description ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(500)] }),
      quantity: new FormControl(line ? (line.quantityMilli / 1000).toString() : '1', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{1,6}(\.\d{1,3})?$/)] }),
      unitPrice: new FormControl(line ? (line.unitPriceCents / 100).toFixed(2) : '', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{1,9}(\.\d{1,2})?$/)] }),
      discount: new FormControl(line ? (line.discountCents / 100).toFixed(2) : '0.00', { nonNullable: true, validators: [Validators.pattern(/^\d{1,9}(\.\d{1,2})?$/)] }),
    }));
  }
  protected removeLine(index: number): void { if (this.lines.length > 1) this.lines.removeAt(index); }
  protected createOrUpdate(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    this.lines.markAllAsTouched();
    const editableAmounts = this.source.value === 'manual' && !this.hasFixedAmounts(this.detail());
    if (this.form.invalid || (editableAmounts && (!this.lines.length || this.lines.invalid))) {
      this.error.set('Revisa los campos obligatorios y corrige los valores indicados.'); return;
    }
    const common = {
      issueDate: this.form.controls.issueDate.value,
      dueDate: this.form.controls.dueDate.value || null,
      terms: this.form.controls.terms.value.trim(),
      notes: this.form.controls.notes.value.trim(),
    };
    const hasTax = this.taxMode.value === InvoiceTaxMode.WithTax;
    if (editableAmounts && !hasTax && !this.profile()?.allowInvoicesWithoutTax) {
      this.error.set('La sastrería no permite emitir facturas manuales sin ITBIS. Selecciona «Factura con ITBIS».');
      return;
    }
    const payload = !editableAmounts ? {
      source: 'order' as const, orderId: this.form.controls.orderId.value, ...common,
    } : {
      source: 'manual' as const, customerId: this.form.controls.customerId.value, hasTax, ...common,
      lines: this.lines.controls.map((control) => {
        const line = control.getRawValue();
        return {
          description: line.description.trim(), quantityMilli: this.milli(line.quantity)!,
          unitPriceCents: this.cents(line.unitPrice)!, discountCents: this.cents(line.discount || '0')!,
        };
      }),
    };
    const fingerprint = JSON.stringify(payload);
    if (this.uncertain() && this.pendingRequest?.fingerprint !== fingerprint) {
      this.error.set('La creación anterior tiene resultado incierto. Reintenta con los mismos datos antes de cambiar la factura.');
      return;
    }
    if (!this.pendingRequest || this.pendingRequest.fingerprint !== fingerprint) {
      this.pendingRequest = { fingerprint, id: crypto.randomUUID() };
    }
    this.saving.set(true); this.error.set(''); this.notice.set('');
    if (this.detail()?.status === InvoiceStatus.Draft) {
      const current = this.detail()!;
      const update = {
        expectedVersion: current.version, dueDate: common.dueDate, terms: common.terms, notes: common.notes,
        ...(payload.source === 'manual' ? { lines: payload.lines, hasTax: payload.hasTax } : {}),
      };
      this.http.put<{ version: number }>(`${this.baseUrl}/invoices/${current.id}`, update)
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: () => { this.saving.set(false); this.notice.set('Borrador actualizado.'); this.openInvoice(current.id); },
          error: (error: HttpErrorResponse) => this.handleSaveError(error, 'No pudimos actualizar el borrador.'),
        });
      return;
    }
    this.http.post<{ id: string }>(`${this.baseUrl}/invoices`, { ...payload, requestId: this.pendingRequest.id })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ id }) => {
          this.pendingRequest = null; this.uncertain.set(false); this.saving.set(false);
          this.openInvoice(id); this.loadList();
        },
        error: (error: HttpErrorResponse) => {
          this.uncertain.set(error.status === 0 || error.status >= 500);
          if (!this.uncertain()) this.pendingRequest = null;
          this.handleSaveError(error, 'No pudimos crear la factura.');
        },
      });
  }
  protected issue(): void {
    const invoice = this.detail();
    if (!invoice || this.saving()) return;
    this.action(`${this.baseUrl}/invoices/${invoice.id}/issue`, { expectedVersion: invoice.version }, 'Factura emitida.');
  }
  protected voidInvoice(): void {
    const invoice = this.detail();
    this.voidReason.markAsTouched();
    if (!invoice || this.saving()) return;
    if (this.voidReason.invalid) {
      this.error.set('Escribe un motivo de anulación antes de continuar.');
      return;
    }
    this.action(`${this.baseUrl}/invoices/${invoice.id}/void`, {
      expectedVersion: invoice.version, reason: this.voidReason.value.trim(),
    }, 'Factura anulada.',
    'La factura cambió o mantiene cobros netos; actualízala y reembolsa los cobros antes de anularla.');
  }
  protected loadProfile(): void {
    if (this.fiscalSettings) this.error.set('');
    this.http.get<Profile>(`${this.baseUrl}/billing-profile`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.pendingImages.set({});
        this.allowWithoutTax.reset(profile.allowInvoicesWithoutTax);
        this.setTaxRate(profile.itbisBasisPoints);
        this.profileForm.setValue({
          legalName: profile.legalName ?? '', tradeName: profile.tradeName ?? profile.workshopName, rnc: profile.rnc ?? '',
          fiscalAddress: profile.fiscalAddress ?? '', phone: profile.phone ?? '', email: profile.email ?? '',
        });
      },
      error: () => this.error.set('No pudimos cargar el perfil de facturación.'),
    });
  }
  protected saveProfile(): void {
    const workshop = this.workshop;
    if (!workshop || !this.canConfigure || !this.profile() || this.saving()) return;
    this.notice.set('');
    this.profileForm.markAllAsTouched();
    if (this.profileForm.invalid) { this.error.set('Revisa los datos fiscales de la sastrería.'); return; }
    const data = this.profileForm.getRawValue();
    this.saving.set(true); this.error.set('');
    this.http.put<Profile>(`${this.baseUrl}/billing-profile`, {
      ...this.profilePayload(data), ...this.pendingImages(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.auth.updateWorkshopName(workshop.id, profile.workshopName);
        this.pendingImages.set({});
        this.profileForm.reset({
          legalName: profile.legalName ?? '', tradeName: profile.tradeName ?? profile.workshopName, rnc: profile.rnc ?? '',
          fiscalAddress: profile.fiscalAddress ?? '', phone: profile.phone ?? '', email: profile.email ?? '',
        });
        this.saving.set(false); this.notice.set('Datos fiscales, logo y sello guardados correctamente.');
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(error.status === 400
          ? 'Revisa el nombre comercial, el RNC (9 a 11 dígitos), el correo, el teléfono y las imágenes PNG/JPG/JPEG de hasta 60 KB.'
          : error.status === 413 ? 'Las imágenes superan el tamaño permitido. Cada archivo debe pesar como máximo 60 KB.'
          : 'No pudimos guardar el perfil de facturación. Tus cambios siguen disponibles; vuelve a intentarlo.');
      },
    });
  }
  protected saveTaxRate(): void {
    if (!this.canConfigure || !this.profile() || this.saving()) return;
    this.notice.set('');
    this.taxRate.markAsTouched();
    if (this.taxRate.invalid) {
      this.error.set('Indica un porcentaje entre 0 y 100, con hasta dos decimales.');
      return;
    }
    this.saving.set(true); this.error.set('');
    const itbisBasisPoints = this.taxRate.value === '' ? null : this.cents(this.taxRate.value);
    this.http.put<{ itbisBasisPoints: number | null }>(`${this.baseUrl}/order-settings`, { itbisBasisPoints })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => {
          this.profile.update((profile) => profile && { ...profile, itbisBasisPoints: result.itbisBasisPoints });
          this.setTaxRate(result.itbisBasisPoints);
          this.saving.set(false); this.notice.set('Tasa de ITBIS guardada.');
        },
        error: () => { this.saving.set(false); this.error.set('No pudimos guardar la tasa de ITBIS.'); },
      });
  }
  protected applyPendingOrderTax(): void {
    const rate = this.profile()?.itbisBasisPoints;
    if (!this.canConfigure || rate === null || rate === undefined || this.saving() || this.taxRate.dirty) return;
    this.saving.set(true); this.notice.set(''); this.error.set('');
    this.http.post<{ updatedOrders: number; updatedDrafts: number }>(`${this.baseUrl}/orders/apply-pending-itbis`, {
      itbisBasisPoints: rate,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ updatedOrders, updatedDrafts }) => {
        this.saving.set(false);
        this.notice.set(updatedOrders === 0 ? 'No hay órdenes pendientes que puedan actualizarse.'
          : `ITBIS aplicado a ${updatedOrders} ${updatedOrders === 1 ? 'orden' : 'órdenes'}. `
            + `Borradores de factura actualizados: ${updatedDrafts}.`);
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(error.status === 409
          ? 'No se aplicó el ITBIS. Verifica la tasa guardada y los borradores vinculados antes de reintentar.'
          : 'No pudimos confirmar el ajuste. Revisa las órdenes o reintenta con la misma tasa.');
      },
    });
  }
  protected saveInvoiceTaxSettings(): void {
    if (!this.canConfigure || !this.profile() || this.saving()) return;
    this.saving.set(true); this.notice.set(''); this.error.set('');
    this.http.put<{ allowInvoicesWithoutTax: boolean }>(`${this.baseUrl}/invoice-tax-settings`, {
      allowInvoicesWithoutTax: this.allowWithoutTax.value,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.profile.update((profile) => profile && { ...profile, ...result });
        this.allowWithoutTax.reset(result.allowInvoicesWithoutTax);
        this.saving.set(false); this.notice.set('Preferencia de facturación guardada.');
      },
      error: () => { this.saving.set(false); this.error.set('No pudimos guardar la preferencia de facturación.'); },
    });
  }
  private setTaxRate(rate: number | null): void {
    this.taxRate.reset(rate === null ? '' : (rate / 100).toFixed(2));
  }
  protected readonly unavailableLogo = signal('');
  protected readonly unavailableSeal = signal('');
  protected chooseCompanyImage(event: Event, field: 'logoDataUrl' | 'sealDataUrl'): void {
    if (!this.canConfigure || !this.profile() || this.saving()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const label = field === 'logoDataUrl' ? 'logo' : 'sello';
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 61440) {
      this.error.set(`El ${label} debe ser PNG, JPG o JPEG y no superar 60 KB.`);
      input.value = '';
      return;
    }
    const reader = new FileReader();
    this.saving.set(true); this.notice.set(''); this.error.set('');
    reader.onload = () => {
      if (this.destroyRef.destroyed) return;
      this.saving.set(false);
      if (typeof reader.result !== 'string') {
        this.error.set('No pudimos leer el archivo seleccionado.');
        return;
      }
      const value = reader.result;
      this.pendingImages.update((images) => ({ ...images, [field]: value }));
      this.notice.set(`Se seleccionó el ${label}. Pulsa «Guardar perfil» para guardar todos los datos.`);
      input.value = '';
    };
    reader.onerror = () => { this.saving.set(false); this.error.set('No pudimos leer el archivo seleccionado.'); };
    reader.readAsDataURL(file);
  }
  protected readonly pagination = signal<PageInfo | null>(null);
  private page = initialPage;
  private listRequest = 0;
  protected readonly appliedFilters = signal<{ search: string; status: InvoiceDisplayStatus | '' }>({ search: '', status: '' });
  protected searchInvoices(): void {
    this.appliedFilters.set({ search: this.search.value.trim(), status: this.statusFilter.value });
    this.page = { ...this.page, page: 1 };
    this.loadList();
  }
  protected changePage(page: PageRequest): void { this.page = page; this.loadList(); }
  protected pdfUrl(invoice: Invoice, preview = false): string {
    return `${this.baseUrl}/invoices/${invoice.id}/pdf${preview ? '?preview=true' : ''}`;
  }
  protected ticketUrl(invoice: Invoice): string {
    return `${this.baseUrl}/invoices/${invoice.id}/ticket`;
  }
  protected readonly trackLine = (index: number) => index;

  private loadList(): void {
    const request = ++this.listRequest;
    this.loading.set(true); this.error.set('');
    const { search, status } = this.appliedFilters();
    this.http.get<{ invoices: InvoiceRow[]; pagination?: PageInfo }>(`${this.baseUrl}/invoices`, { params: { search, ...this.page, ...(status ? { status } : {}) } })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          if (request !== this.listRequest) return;
          this.rows.set(response.invoices); this.loading.set(false);
          this.pagination.set(response.pagination ?? null);
          if (response.pagination) this.page = { page: response.pagination.page, pageSize: response.pagination.pageSize };
        },
        error: () => {
          if (request !== this.listRequest) return;
          this.loading.set(false); this.error.set('No pudimos cargar las facturas.');
        },
      });
  }
  private loadLookups(): void {
    this.loading.set(true); this.error.set('');
    forkJoin({
      customers: this.http.get<{ customers: Customer[] }>(`${this.baseUrl}/customers`),
      orders: this.http.get<{ orders: Order[] }>(`${this.baseUrl}/orders`),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ customers, orders }) => {
        this.customers.set(customers.customers); this.orders.set(orders.orders); this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.error.set('No pudimos cargar clientes y órdenes.'); },
    });
  }
  private action(url: string, body: unknown, success: string, conflictMessage?: string): void {
    const invoiceId = this.detail()?.id;
    if (!invoiceId) return;
    this.saving.set(true); this.error.set('');
    this.http.post(url, body).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.saving.set(false); this.notice.set(success); this.openInvoice(invoiceId); this.loadList(); },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(error.status === 409
          ? this.taxModeError(error) ?? conflictMessage ?? 'La factura cambió o no cumple las condiciones. Actualiza el detalle y vuelve a intentarlo.'
          : 'No pudimos completar la acción. Inténtalo de nuevo.');
      },
    });
  }
  private handleSaveError(error: HttpErrorResponse, fallback: string): void {
    this.saving.set(false);
    this.error.set(this.taxModeError(error) ?? (error.status === 409 ? 'El borrador cambió o el número de solicitud ya fue utilizado. Actualiza la factura.' : fallback));
  }
  private taxModeError(error: HttpErrorResponse): string | null {
    return error.status === 409 && error.error?.message === 'Workshop does not allow invoices without ITBIS'
      ? 'La sastrería ya no permite emitir facturas manuales sin ITBIS. Edita el borrador y selecciona «Factura con ITBIS».'
      : null;
  }
  private resetForm(): void {
    this.detail.set(null); this.error.set(''); this.notice.set(''); this.pendingRequest = null;
    this.uncertain.set(false);
    this.source.setValue('manual');
    this.taxMode.setValue(InvoiceTaxMode.WithTax);
    this.form.reset({ customerId: '', orderId: '', issueDate: this.today(), dueDate: '', terms: '', notes: '' });
    this.lines.clear(); this.addLine();
  }
  private profilePayload(data: ProfileFormValues) {
    return {
      legalName: data.legalName.trim() || null, tradeName: data.tradeName.trim() || null,
      rnc: data.rnc.trim() || null, fiscalAddress: data.fiscalAddress.trim() || null,
      phone: data.phone.trim() || null, email: data.email.trim() || null,
    };
  }
  private today(): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
    return parts;
  }
  private cents(value: string): number | null {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }
  private milli(value: string): number | null {
    if (!/^\d{1,6}(\.\d{1,3})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  }
  private focusHeading(): void { afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector }); }
}
import { initialPage, PageInfo, PageRequest, Pagination } from '../shared/pagination';
