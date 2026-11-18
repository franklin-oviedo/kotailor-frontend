import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, finalize, of, switchMap, tap, timer } from 'rxjs';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { OrderStatus, orderStatusLabel } from '../orders/order-display';
import { Shell } from '../shell/shell';
import { initialPage, Pagination, type PageRequest } from '../shared/pagination';
import { REPORTS_DEMO, ReportScenario } from './reports-demo.token';

interface CustomerOption { id: string; name: string }
export interface CustomerResponse { customers: CustomerOption[]; hasMore: boolean }
interface ExecutiveSummary {
  salesCents: number;
  collectedCents: number;
  outstandingCents: number;
  invoicedCents: number;
  invoiceOutstandingCents: number | null;
  invoicesIssued: number;
  invoicedWithTaxCents: number;
  invoicedWithoutTaxCents: number;
  invoicesWithTax: number;
  invoicesWithoutTax: number;
  invoicesPaid: number;
  invoicesUnpaid: number;
  invoicesPartial: number;
  activeOrders: number;
  productionOrders: number;
  completedOrders: number;
  totalCustomers: number;
  newCustomers: number;
  frequentCustomers: number;
  annualIncomeCents: number;
}
interface MonthlyReport {
  month: string;
  salesCents: number;
  invoicedCents: number;
  collectedCents: number;
  newCustomers: number;
}
interface StatusReport { status: OrderStatus; count: number }
interface CustomerReport { customerId: string; name: string; orders: number; salesCents: number }
interface ProductReport { name: string; orders: number; salesCents: number }
export interface ExecutiveReport {
  summary: ExecutiveSummary;
  monthly: MonthlyReport[];
  ordersByStatus: StatusReport[];
  topCustomers: CustomerReport[];
  topProducts: ProductReport[];
  inventoryCritical: null;
  operationsByDay?: { date: string; orders: number }[];
}
export interface ReportFilters { from: string; to: string; customerId: string; status: string }

function localDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Santo_Domingo',
  }).format(new Date());
}

@Component({
  selector: 'app-reports',
  imports: [ReactiveFormsModule, RouterLink, Shell, NgTemplateOutlet, Pagination],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reports {
  protected readonly demo = inject(REPORTS_DEMO, { optional: true });
  private readonly auth = this.demo ? null : inject(AuthService);
  private readonly http = this.demo ? null : inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly customerSearch$ = new Subject<string>();
  protected readonly workshop = this.auth?.currentWorkshop();
  protected readonly canManage = !!this.demo || this.workshop?.role === MembershipRole.Owner
    || this.workshop?.role === MembershipRole.Manager;
  protected readonly orderStatuses = OrderStatus;
  protected readonly statusLabel = orderStatusLabel;
  protected readonly report = signal<ExecutiveReport | null>(null);
  protected readonly operationsRequest = signal<PageRequest>(initialPage);
  protected readonly operationsPage = computed(() => {
    const days = this.report()?.operationsByDay ?? [];
    const { page: requested, pageSize } = this.operationsRequest();
    const page = Math.min(requested, Math.max(1, Math.ceil(days.length / pageSize)));
    return { page, pageSize, total: days.length, days: days.slice((page - 1) * pageSize, page * pageSize) };
  });
  protected readonly customers = signal<CustomerOption[]>([]);
  protected readonly customerHasMore = signal(false);
  protected readonly customerSearchLoading = signal(false);
  protected readonly customerSearchError = signal(false);
  protected readonly customerSearchCompleted = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly customerSearch = signal('');
  protected readonly scenario = signal(ReportScenario.Complete);
  protected readonly scenarios = [
    { value: ReportScenario.Complete, label: 'Datos completos' },
    { value: ReportScenario.Minimal, label: 'Datos mínimos' },
    { value: ReportScenario.Empty, label: 'Sin registros' },
    { value: ReportScenario.HighVolume, label: 'Volumen alto' },
  ];
  private readonly currency = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
  protected readonly money = (cents: number | null): string => cents === null ? '—' : this.currency.format(cents / 100);
  private readonly percent = new Intl.NumberFormat('es-DO', { style: 'percent', maximumFractionDigits: 1 });
  protected paidShare(paid: number, issued: number): string {
    return issued > 0 ? this.percent.format(paid / issued) : '—';
  }
  protected readonly filters = new FormGroup({
    from: new FormControl(this.demo?.from ?? `${localDate().slice(0, 4)}-01-01`, { nonNullable: true, validators: [Validators.required] }),
    to: new FormControl(this.demo?.to ?? localDate(), { nonNullable: true, validators: [Validators.required] }),
    customerId: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
  });
  protected readonly monthlySalesMax = computed(() =>
    Math.max(1, ...(this.report()?.monthly.map((month) => month.salesCents) ?? [])));
  protected readonly monthlyBillingMax = computed(() =>
    Math.max(1, ...(this.report()?.monthly.map((month) => month.invoicedCents) ?? [])));
  protected readonly monthlyPaymentsMax = computed(() =>
    Math.max(1, ...(this.report()?.monthly.map((month) => Math.abs(month.collectedCents)) ?? [])));
  protected readonly newCustomersMax = computed(() =>
    Math.max(1, ...(this.report()?.monthly.map((month) => month.newCustomers) ?? [])));
  protected readonly topCustomerMax = computed(() =>
    Math.max(1, ...(this.report()?.topCustomers.map((customer) => customer.salesCents) ?? [])));
  protected readonly topProductMax = computed(() =>
    Math.max(1, ...(this.report()?.topProducts.map((product) => product.orders) ?? [])));
  protected readonly orderCountMax = computed(() =>
    Math.max(1, ...(this.report()?.ordersByStatus.map((status) => status.count) ?? [])));
  private appliedFilters: ReportFilters = this.filters.getRawValue();
  private reloadRequested = false;

  constructor() {
    this.customerSearch$.pipe(
      switchMap((search) => {
        const term = search.trim();
        this.customers.set([]);
        this.customerHasMore.set(false);
        this.customerSearchError.set(false);
        this.customerSearchCompleted.set(false);
        if (term.length < 2) {
          this.customerSearchLoading.set(false);
          this.customerSearchError.set(false);
          this.customers.set([]);
          this.customerHasMore.set(false);
          return EMPTY;
        }
        this.customerSearchLoading.set(true);
        return timer(250).pipe(
          switchMap(() => this.demo ? of(this.demo.search(this.scenario(), term))
            : this.http!.get<CustomerResponse>(`/api/workshops/${this.workshop!.id}/customers`, { params: { search: term } })),
          tap((response) => {
            this.customers.set(response.customers);
            this.customerHasMore.set(response.hasMore);
            this.customerSearchCompleted.set(true);
          }),
          catchError(() => {
            this.customerSearchError.set(true);
            this.customers.set([]);
            this.customerHasMore.set(false);
            return EMPTY;
          }),
          finalize(() => this.customerSearchLoading.set(false)),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    if (this.canManage) {
      this.load();
      timer(60_000, 60_000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
    }
  }

  protected searchCustomers(value: string): void {
    if (value !== this.customerSearch()) this.filters.controls.customerId.setValue('');
    this.customerSearch.set(value);
    this.customerSearch$.next(value);
  }

  protected onCustomerSearch(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.searchCustomers(event.target.value);
  }

  protected selectScenario(value: string): void {
    const scenario = this.scenarios.find((option) => option.value === value);
    if (!this.demo || !scenario) return;
    this.scenario.set(scenario.value);
    this.searchCustomers('');
    this.filters.reset({ from: this.demo.from, to: this.demo.to, customerId: '', status: '' });
    this.applyFilters();
  }

  protected applyFilters(): void {
    this.filters.markAllAsTouched();
    if (this.filters.invalid) return;
    this.appliedFilters = this.filters.getRawValue();
    this.operationsRequest.update((page) => ({ ...page, page: 1 }));
    this.load();
  }

  protected load(): void {
    if (!this.canManage) return;
    if (this.loading()) {
      this.reloadRequested = true;
      return;
    }
    const { from, to, customerId, status } = this.appliedFilters;
    const daySpan = from && to
      ? (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
      : Number.NaN;
    if (!from || !to || !Number.isFinite(daySpan) || daySpan < 0 || daySpan > 365) {
      this.error.set('Selecciona un rango de fechas válido.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    if (this.demo) {
      this.report.set(this.demo.report(this.scenario(), this.appliedFilters));
      this.loading.set(false);
      return;
    }
    let params = new HttpParams().set('from', from).set('to', to);
    if (customerId) params = params.set('customerId', customerId);
    if (status) params = params.set('status', status);
    this.http!.get<ExecutiveReport>(
      `/api/workshops/${this.workshop!.id}/reports/executive`, { params },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
        if (this.reloadRequested) {
          this.reloadRequested = false;
          this.load();
        }
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);
        this.report.set(null);
        this.error.set(response.status === 400
          ? 'El rango solicitado no es válido.'
          : 'No pudimos cargar el resumen ejecutivo. Inténtalo de nuevo.');
        if (this.reloadRequested) {
          this.reloadRequested = false;
          this.load();
        }
      },
    });
  }

  protected setStatus(status: OrderStatus): void {
    this.filters.controls.status.setValue(
      this.filters.controls.status.value === status ? '' : status,
    );
    this.applyFilters();
  }

  protected setCustomer(customerId: string): void {
    this.customerSearch$.next('');
    this.filters.controls.customerId.setValue(customerId);
    const customer = this.report()?.topCustomers.find((item) => item.customerId === customerId);
    if (customer) {
      this.customerSearch.set(customer.name);
      this.customers.set([{ id: customer.customerId, name: customer.name }]);
    }
    this.applyFilters();
  }

  protected barWidth(value: number, max: number): string {
    return `${Math.min(100, Math.abs(value) / Math.max(1, max) * 100)}%`;
  }

  protected monthLabel(value: string): string {
    return new Intl.DateTimeFormat('es-DO', { month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${value}-01T12:00:00Z`));
  }
}
