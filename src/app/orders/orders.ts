import { KeyValuePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, combineLatest, debounceTime, forkJoin, of, startWith, switchMap, tap } from 'rxjs';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { OrderProductionStatus } from './order-production-status';
import { OrderPayments } from './order-payments';
import { TAX_RATE_PATTERN } from './tax-rate';
import { OrderStatus, orderDeliveryDate, orderNumber, orderStatusLabel } from './order-display';

enum View {
  List = 'list',
  Create = 'create',
  Detail = 'detail',
  Tax = 'tax',
}
enum TaxTreatment { Taxable = 'taxable', Exempt = 'exempt' }
enum OrderFilter { All = 'all', Production = 'production', Ready = 'ready', Delivered = 'delivered' }
interface Customer { id: string; name: string; phone: string }
interface Template { id: string; label: string; fields: { key: string; label: string }[] }
interface CatalogItem { id: string; name: string; instructions: string; basePriceCents: number; taxTreatment: TaxTreatment; measurementGarments: string[]; revision: number }
interface Member { id: string; name: string }
interface Settings { itbisBasisPoints: number | null; role: MembershipRole; members: Member[] }
interface Version { id: string; garment: string; version: number; verifiedAt: string; verifiedBy: string }
interface GarmentVersions { garment: string; versions: Version[]; hasMore: boolean }
interface Snapshot extends Version { label: string; fields: { key: string; label: string }[]; measurements: Record<string, number> }
interface Order {
  id: string; number: number; customerName: string; catalogName: string; status: OrderStatus;
  subtotalCents: number; taxCents: number | null; deliveryLocal: string;
}
interface StatusEvent {
  id: string; previousStatus: OrderStatus; newStatus: OrderStatus; changedBy: string; changedAt: string;
}
interface OrderDetail extends Order {
  taxBasisPoints: number | null; taxTreatment: TaxTreatment; instructions: string;
  responsibleName: string | null; createdAt: string; createdBy: string; measurementSnapshots: Snapshot[];
  history: StatusEvent[]; historyHasMore: boolean;
  historyPagination?: PageInfo;
}
interface CustomerResponse { customers: Customer[]; hasMore: boolean }
interface CatalogResponse { items: CatalogItem[]; hasMore: boolean; measurementCatalog: Template[] }
interface OrderResponse { orders: Order[]; hasMore: boolean; counts: Record<OrderFilter, number> }
interface VersionResponse { versions: Version[]; hasMore: boolean }

@Component({
  selector: 'app-orders',
  imports: [KeyValuePipe, ReactiveFormsModule, RouterLink, Shell, OrderProductionStatus, OrderPayments, Pagination],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Orders {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly measurementRequests = new Subject<{ customer: string; item: CatalogItem | null }>();
  private readonly filterChanges = new Subject<OrderFilter>();
  private readonly refreshPage = new Subject<void>();
  private page = initialPage;
  private pendingRequest: { fingerprint: string; id: string } | null = null;
  private readonly formatter = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly view = signal(View.List);
  protected readonly views = View;
  protected readonly roles = MembershipRole;
  protected readonly settings = signal<Settings | null>(null);
  protected readonly customers = signal<Customer[]>([]);
  protected readonly items = signal<CatalogItem[]>([]);
  protected readonly templates = signal<Template[]>([]);
  protected readonly customerHasMore = signal(false);
  protected readonly itemHasMore = signal(false);
  protected readonly selectedItem = signal<CatalogItem | null>(null);
  protected readonly versions = signal<GarmentVersions[]>([]);
  protected readonly selectedVersions = signal<Record<string, string>>({});
  protected readonly measurementLoading = signal(false);
  protected readonly orders = signal<Order[]>([]);
  protected readonly filters = [
    { value: OrderFilter.All, label: 'Todas' }, { value: OrderFilter.Production, label: 'En producción' },
    { value: OrderFilter.Ready, label: 'Listas' }, { value: OrderFilter.Delivered, label: 'Completadas' },
  ];
  protected readonly stages = [
    OrderStatus.Received, OrderStatus.Cutting, OrderStatus.Sewing,
    OrderStatus.Fitting, OrderStatus.Ready, OrderStatus.Delivered,
  ].map((value) => ({ value, label: orderStatusLabel(value) }));
  protected readonly filter = signal(OrderFilter.All);
  protected readonly counts = signal<Record<OrderFilter, number> | null>(null);
  protected readonly pagination = signal<PageInfo | null>(null);
  protected readonly detail = signal<OrderDetail | null>(null);
  protected readonly previousStage = computed(() => {
    const index = this.stages.findIndex((stage) => stage.value === this.detail()?.status);
    return index > 0 ? this.stages[index - 1] : null;
  });
  protected readonly nextStage = computed(() => {
    const index = this.stages.findIndex((stage) => stage.value === this.detail()?.status);
    return index >= 0 && index < this.stages.length - 1 ? this.stages[index + 1] : null;
  });
  protected readonly statusUncertain = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly lookupLoading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly search = new FormControl((this.route.snapshot.queryParamMap.get('buscar') ?? '').slice(0, 120), { nonNullable: true });
  protected readonly customerSearch = new FormControl('', { nonNullable: true });
  protected readonly itemSearch = new FormControl('', { nonNullable: true });
  protected readonly taxRate = new FormControl('', { nonNullable: true, validators: [Validators.pattern(TAX_RATE_PATTERN)] });
  protected readonly form = new FormGroup({
    customerId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    catalogId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    price: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{1,9}(\.\d{1,2})?$/)] }),
    deliveryLocal: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    responsibleId: new FormControl('', { nonNullable: true }),
  });
  protected readonly price = signal('');
  protected readonly subtotal = computed(() => this.parseCents(this.price()));
  protected readonly tax = computed(() => {
    const item = this.selectedItem();
    const subtotal = this.subtotal();
    if (!item || subtotal === null || !this.settings()) return null;
    const rate = item.taxTreatment === TaxTreatment.Exempt ? 0 : this.settings()!.itbisBasisPoints;
    return rate === null ? null : Math.floor((subtotal * rate + 5000) / 10000);
  });
  protected readonly taxMissing = computed(() =>
    this.selectedItem()?.taxTreatment === TaxTreatment.Taxable && this.settings()?.itbisBasisPoints === null);

  constructor() {
    if (!this.workshop) return;
    combineLatest([
      this.search.valueChanges.pipe(startWith(this.search.value), debounceTime(250), tap(() => { this.page = { ...this.page, page: 1 }; })),
      this.filterChanges.pipe(startWith(OrderFilter.All), tap(() => { this.page = { ...this.page, page: 1 }; })),
      this.refreshPage.pipe(startWith(undefined)),
    ]).pipe(
      tap(() => { this.loading.set(true); this.error.set(''); }),
      switchMap(([search, filter]) => this.http.get<OrderResponse & { pagination?: PageInfo }>(`${this.base}/orders`, { params: { search, filter, ...this.page } }).pipe(
        catchError(() => { this.loading.set(false); this.error.set('No pudimos cargar las órdenes.'); return EMPTY; }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((response) => {
      this.orders.set(response.orders); this.pagination.set(response.pagination ?? null); this.counts.set(response.counts); this.loading.set(false);
      if (response.pagination) this.page = { page: response.pagination.page, pageSize: response.pagination.pageSize };
    });
    this.form.controls.price.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.price.set(value));
    this.measurementRequests.pipe(
      tap(() => { this.versions.set([]); this.selectedVersions.set({}); this.measurementLoading.set(true); }),
      switchMap(({ customer, item }) => {
        if (!customer || !item || item.measurementGarments.length === 0) return of([]);
        return forkJoin(item.measurementGarments.map((garment) =>
          this.http.get<VersionResponse>(`${this.base}/customers/${customer}/measurements`, { params: { garment } })
            .pipe(switchMap((response) => of({ garment, ...response }))),
        )).pipe(catchError(() => {
          this.measurementLoading.set(false);
          this.error.set('No pudimos cargar las medidas del cliente. Vuelve a seleccionar el cliente o la prenda.');
          return EMPTY;
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((versions) => { this.versions.set(versions); this.measurementLoading.set(false); });
    if (this.route.snapshot.queryParamMap.get('crear') === '1') this.showCreate();
    else this.loadSettings();
  }

  private get base(): string { return `/api/workshops/${this.workshop!.id}`; }
  private focusHeading(): void { afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector }); }
  private parseCents(value: string): number | null {
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }
  protected money(cents: number): string { return this.formatter.format(cents / 100); }
  protected readonly orderNumber = orderNumber;
  protected readonly date = orderDeliveryDate;
  protected readonly status = orderStatusLabel;
  protected createdDate(value: string): string {
    return new Intl.DateTimeFormat('es-DO', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'America/Santo_Domingo',
    }).format(new Date(value));
  }
  protected templateLabel(garment: string): string {
    return this.templates().find((template) => template.id === garment)?.label ?? garment;
  }
  protected fieldLabel(snapshot: Snapshot, key: string): string {
    return snapshot.fields.find((field) => field.key === key)?.label ?? key;
  }
  protected loadSettings(): void {
    this.http.get<Settings>(`${this.base}/order-settings`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (settings) => this.settings.set(settings),
      error: () => this.error.set('No pudimos cargar la configuración de la sastrería.'),
    });
  }
  protected loadLookups(): void {
    this.lookupLoading.set(true);
    this.error.set('');
    forkJoin({
      customers: this.http.get<CustomerResponse>(`${this.base}/customers`, { params: { search: this.customerSearch.value } }),
      catalog: this.http.get<CatalogResponse>(`${this.base}/catalog`, { params: { search: this.itemSearch.value } }),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ customers, catalog }) => {
        this.customers.set(customers.customers); this.customerHasMore.set(customers.hasMore);
        this.items.set(catalog.items); this.itemHasMore.set(catalog.hasMore);
        this.templates.set(catalog.measurementCatalog); this.lookupLoading.set(false);
      },
      error: () => { this.lookupLoading.set(false); this.error.set('No pudimos cargar los clientes y prendas. Inténtalo de nuevo.'); },
    });
  }
  protected showCreate(): void {
    this.error.set(''); this.success.set(''); this.view.set(View.Create);
    this.loadSettings(); this.loadLookups(); this.focusHeading();
  }
  protected chooseCustomer(id: string): void {
    this.form.controls.customerId.setValue(id); this.error.set('');
    this.measurementRequests.next({ customer: id, item: this.selectedItem() });
  }
  protected chooseItem(id: string): void {
    this.form.controls.catalogId.setValue(id);
    const item = this.items().find((entry) => entry.id === id) ?? null;
    this.selectedItem.set(item); this.error.set('');
    this.form.controls.price.setValue(item ? (item.basePriceCents / 100).toFixed(2) : '');
    this.measurementRequests.next({ customer: this.form.controls.customerId.value, item });
  }
  protected selectVersion(garment: string, id: string): void {
    this.selectedVersions.update((versions) => ({ ...versions, [garment]: id }));
  }
  protected selectFilter(value: OrderFilter): void {
    this.filter.set(value); this.filterChanges.next(value);
  }
  protected changePage(page: PageRequest): void {
    this.page = page;
    this.refreshPage.next();
  }
  protected searchChoices(): void {
    this.chooseCustomer(''); this.chooseItem(''); this.loadLookups();
  }
  protected back(): void {
    this.pendingRequest = null;
    this.form.reset(); this.price.set(''); this.selectedItem.set(null); this.selectedVersions.set({});
    this.measurementRequests.next({ customer: '', item: null });
    this.customerSearch.reset(); this.itemSearch.reset(); this.error.set('');
    this.view.set(View.List); this.search.setValue(this.search.value); this.focusHeading();
  }
  protected openDetail(id: string, page: PageRequest = initialPage): void {
    this.error.set(''); this.loading.set(true);
    this.http.get<OrderDetail>(`${this.base}/orders/${id}`, { params: { ...page } }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => { this.detail.set(detail); this.statusUncertain.set(false); this.loading.set(false); this.view.set(View.Detail); this.focusHeading(); },
      error: () => { this.loading.set(false); this.error.set('No pudimos cargar el detalle de la orden.'); },
    });
  }
  protected changeStatus(status: OrderStatus): void {
    const order = this.detail();
    if (!order || this.saving() || this.statusUncertain()) return;
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    this.http.put<{ status: OrderStatus; event: StatusEvent }>(`${this.base}/orders/${order.id}/status`, {
      expectedStatus: order.status, status,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.detail.update((current) => current && current.id === order.id ? {
          ...current, status: result.status,
          history: current.historyPagination && current.historyPagination.page > 1
            ? current.history : [result.event, ...current.history].slice(0, current.historyPagination?.pageSize ?? 100),
          historyPagination: current.historyPagination && { ...current.historyPagination, total: current.historyPagination.total + 1 },
        } : current);
        this.saving.set(false);
        this.success.set(`Etapa actualizada a ${this.status(result.status)}.`);
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.statusUncertain.set(true);
        this.error.set(error.status === 409
          ? 'La etapa cambió en otra sesión. Actualiza la orden antes de continuar.'
          : error.status === 403
            ? 'No tienes permiso para cambiar la etapa. Actualiza la orden antes de continuar.'
            : 'No se pudo confirmar el cambio. Actualiza la orden antes de continuar.');
      },
    });
  }
  protected showTaxSettings(): void {
    const rate = this.settings()?.itbisBasisPoints;
    this.taxRate.setValue(rate === null || rate === undefined ? '' : (rate / 100).toFixed(2));
    this.error.set(''); this.view.set(View.Tax); this.focusHeading();
  }
  protected focusAfterTax(): void { this.focusHeading(); }
  protected saveTax(): void {
    if (this.saving() || !this.settings() || this.settings()!.role !== MembershipRole.Owner) return;
    this.taxRate.markAsTouched();
    if (this.taxRate.invalid) { this.error.set('Indica un porcentaje entre 0 y 100, con hasta dos decimales.'); return; }
    const rate = this.taxRate.value === '' ? null : this.parseCents(this.taxRate.value);
    this.saving.set(true); this.error.set('');
    this.http.put<{ itbisBasisPoints: number | null }>(`${this.base}/order-settings`, { itbisBasisPoints: rate })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => {
          this.settings.update((settings) => settings ? { ...settings, itbisBasisPoints: result.itbisBasisPoints } : null);
          this.saving.set(false); this.view.set(View.Create); this.success.set('Configuración de ITBIS actualizada.'); this.focusHeading();
        },
        error: () => { this.saving.set(false); this.error.set('No pudimos guardar la configuración fiscal.'); },
      });
  }
  protected save(): void {
    if (this.saving() || this.lookupLoading() || this.measurementLoading()) return;
    this.form.markAllAsTouched();
    const item = this.selectedItem();
    const settings = this.settings();
    const value = this.form.getRawValue();
    const subtotalCents = this.parseCents(value.price);
    if (this.form.invalid || !item || !settings || subtotalCents === null ||
        item.measurementGarments.some((garment) => !this.selectedVersions()[garment])) {
      this.error.set('Completa los campos obligatorios y selecciona una versión de cada medida requerida.');
      return;
    }
    this.saving.set(true); this.error.set('');
    const payload = {
      customerId: value.customerId, catalogId: item.id, catalogRevision: item.revision, subtotalCents,
      expectedTaxBasisPoints: item.taxTreatment === TaxTreatment.Exempt ? 0 : settings.itbisBasisPoints,
      measurementIds: item.measurementGarments.map((garment) => this.selectedVersions()[garment]),
      deliveryLocal: value.deliveryLocal, responsibleId: value.responsibleId || null,
    };
    const fingerprint = JSON.stringify(payload);
    if (this.pendingRequest?.fingerprint !== fingerprint) {
      this.pendingRequest = { fingerprint, id: crypto.randomUUID() };
    }
    this.http.post<{ id: string; number: number }>(`${this.base}/orders`, {
      ...payload, requestId: this.pendingRequest.id,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (order) => {
        this.saving.set(false); this.back(); this.success.set(`Orden ${this.orderNumber(order.number)} creada.`);
        this.openDetail(order.id);
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(error.status === 409
          ? 'La prenda o la tasa cambiaron. Vuelve a buscar la prenda y revisa la configuración antes de crear la orden.'
          : 'No pudimos crear la orden. Verifica los datos e inténtalo de nuevo.');
        if (error.status === 409) this.loadSettings();
      },
    });
  }
}
import { initialPage, PageInfo, PageRequest, Pagination } from '../shared/pagination';
