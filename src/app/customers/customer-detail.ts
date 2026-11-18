import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnChanges, OnInit, SimpleChanges, afterNextRender, computed, inject, input, signal, viewChild, viewChildren } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, FormRecord, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { initialPage, Pagination, type PageInfo, type PageRequest } from '../shared/pagination';

enum MeasurementGarment {
  WomensTrousers = 'womens_trousers',
}

interface MeasurementField {
  key: string;
  label: string;
}

interface GarmentDefinition {
  id: string;
  label: string;
  fields: MeasurementField[];
}

interface CustomerDetailData {
  address?: string | null;
  id: string;
  name: string;
  phone: string;
  email: string | null;
  documentNumber: string | null;
  createdAt: string;
  measurementCatalog: GarmentDefinition[];
}

interface MeasurementVersion {
  id: string;
  version: number;
  measurements: Record<string, number>;
  verifiedAt: string;
  verifiedBy: string;
}

interface VersionList {
  versions: MeasurementVersion[];
  pagination?: PageInfo;
}
interface PendingSubmission {
  id: string;
  measurements: Record<string, number>;
  submittedAt: string;
  submittedBy: string;
}
interface SubmissionResponse { submission: PendingSubmission | null }

function centimetres(control: AbstractControl<number | null>): ValidationErrors | null {
  const value = control.value;
  return value === null || (Number.isFinite(value) && value > 0 && value <= 999.99 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8) ? null : { centimetres: true };
}

@Component({
  selector: 'app-customer-detail',
  imports: [DatePipe, NgTemplateOutlet, ReactiveFormsModule, RouterLink, Shell, Pagination],
  templateUrl: './customer-detail.html',
  styleUrl: './customer-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.embedded]': 'embedded()' },
})
export class CustomerDetail implements OnInit, OnChanges {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly garmentSelector = viewChild<ElementRef<HTMLSelectElement>>('garmentSelector');
  private readonly garmentButtons = viewChildren<ElementRef<HTMLButtonElement>>('garmentButton');
  private readonly customerChanged = new Subject<void>();
  readonly customerId = input<string | null>(null);
  readonly embedded = input(false);
  private resolvedCustomerId: string | null = null;
  private restoreGarmentFocus = false;
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly customer = signal<CustomerDetailData | null>(null);
  protected readonly selectedGarment = signal<string>(MeasurementGarment.WomensTrousers);
  protected readonly fields = computed(() =>
    this.customer()?.measurementCatalog.find((item) => item.id === this.selectedGarment())?.fields ?? []);
  protected readonly versions = signal<MeasurementVersion[]>([]);
  protected readonly pendingSubmission = signal<PendingSubmission | null>(null);
  protected readonly historyPage = signal<PageInfo | null>(null);
  private latestVersion: MeasurementVersion | undefined;
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly saving = signal(false);
  protected readonly requiresRefresh = signal(false);
  protected readonly loadError = signal('');
  protected readonly historyError = signal('');
  protected readonly saveError = signal('');
  protected readonly switchError = signal('');
  protected readonly success = signal('');
  protected readonly form = new FormGroup({
    measurements: new FormRecord<FormControl<number | null>>({}),
    confirmed: new FormControl(false, { nonNullable: true, validators: [Validators.requiredTrue] }),
  });

  ngOnInit(): void {
    if (this.embedded()) {
      this.openCustomer(this.customerId());
    } else {
      this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        this.openCustomer(params.get('customerId'));
      });
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.embedded() && changes['customerId'] && !changes['customerId'].firstChange) {
      this.openCustomer(this.customerId());
    }
  }

  private openCustomer(id: string | null): void {
    if (id === this.resolvedCustomerId) return;
    this.customerChanged.next();
    this.resolvedCustomerId = id;
    this.restoreGarmentFocus = false;
    this.customer.set(null);
    this.versions.set([]);
    this.pendingSubmission.set(null);
    this.selectedGarment.set(MeasurementGarment.WomensTrousers);
    this.historyPage.set(null);
    this.latestVersion = undefined;
    this.loadingMore.set(false);
    this.requiresRefresh.set(false);
    this.loadError.set('');
    this.historyError.set('');
    this.saveError.set('');
    this.switchError.set('');
    this.success.set('');
    this.form.reset();
    if (this.workshop && id) this.load();
  }

  private get url(): string {
    return `/api/workshops/${this.workshop!.id}/customers/${encodeURIComponent(this.resolvedCustomerId!)}`;
  }

  protected load(): void {
    if (!this.workshop || !this.resolvedCustomerId) return;
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      customer: this.http.get<CustomerDetailData>(this.url),
      history: this.fetchHistory(),
      pending: this.http.get<SubmissionResponse>(`${this.url}/measurement-submissions`, { params: { garment: this.selectedGarment() } }),
    }).pipe(takeUntil(this.customerChanged), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ customer, history, pending }) => {
        const definition = customer.measurementCatalog?.find((item) => item.id === this.selectedGarment());
        if (!definition || definition.fields.length === 0) {
          this.loading.set(false);
          this.loadError.set('No pudimos cargar los tipos de medidas. Inténtalo de nuevo.');
          return;
        }
        this.customer.set(customer);
        this.versions.set(history.versions);
        this.historyPage.set(history.pagination ?? null);
        this.latestVersion = history.versions[0];
        this.pendingSubmission.set(pending.submission);
        this.setFields(definition.fields);
        this.resetForm();
        this.loading.set(false);
        if (this.restoreGarmentFocus) {
          this.restoreGarmentFocus = false;
          afterNextRender(() => {
            const button = this.garmentButtons().find((item) =>
              item.nativeElement.dataset['garment'] === this.selectedGarment() &&
              item.nativeElement.getClientRects().length > 0);
            (button?.nativeElement ?? this.garmentSelector()?.nativeElement)?.focus();
          }, { injector: this.injector });
        }
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No pudimos cargar la ficha y las medidas. Comprueba el acceso e inténtalo de nuevo.');
      },
    });
  }

  private setFields(fields: MeasurementField[]): void {
    const controls = this.form.controls.measurements;
    for (const key of Object.keys(controls.controls)) controls.removeControl(key);
    for (const field of fields) {
      controls.addControl(field.key, new FormControl<number | null>(null, [Validators.required, centimetres]));
    }
  }

  private resetForm(): void {
    this.form.reset({ measurements: this.pendingSubmission()?.measurements ?? this.latestVersion?.measurements ?? {}, confirmed: false });
  }

  protected changeGarment(select: HTMLSelectElement): void {
    this.selectGarment(select.value);
    select.value = this.selectedGarment();
  }

  protected selectGarment(next: string): void {
    if (!this.customer()?.measurementCatalog.some((item) => item.id === next)) {
      this.switchError.set('El tipo de prenda seleccionado no está disponible.');
      return;
    }
    if (next === this.selectedGarment()) return;
    if (this.form.dirty || this.requiresRefresh() || this.saving() || this.loadingMore()) {
      this.switchError.set(this.requiresRefresh()
        ? 'Actualiza y revisa el historial antes de cambiar de prenda.'
        : 'Guarda o descarta los cambios antes de cambiar de prenda.');
      return;
    }
    this.switchError.set('');
    this.saveError.set('');
    this.success.set('');
    this.historyError.set('');
    this.selectedGarment.set(next);
    this.restoreGarmentFocus = true;
    this.load();
  }

  protected discardChanges(): void {
    if (this.requiresRefresh() || this.saving() || this.loadingMore()) return;
    this.resetForm();
    this.switchError.set('');
    this.saveError.set('');
    this.success.set('Cambios descartados.');
  }

  private fetchHistory(page: PageRequest = initialPage) {
    return this.http.get<VersionList>(`${this.url}/measurements`, { params: { garment: this.selectedGarment(), ...page } });
  }

  protected changeHistoryPage(page: PageRequest): void {
    if (this.loadingMore() || this.saving() || this.loading()) return;
    this.loadingMore.set(true);
    this.historyError.set('');
    this.fetchHistory(page)
      .pipe(takeUntil(this.customerChanged), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (history) => {
          this.versions.set(history.versions);
          this.historyPage.set(history.pagination ?? null);
          this.loadingMore.set(false);
        },
        error: () => {
          this.loadingMore.set(false);
          this.historyError.set('No pudimos cargar las versiones anteriores.');
        },
      });
  }

  protected save(): void {
    if (this.saving() || this.loading() || this.loadingMore() || this.requiresRefresh() || !this.customer()) return;
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const measurements: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw.measurements)) {
      if (value !== null) measurements[key] = value;
    }
    if (this.form.invalid || Object.keys(measurements).length !== this.fields().length) {
      this.saveError.set('Completa todas las medidas válidas y confirma que fueron verificadas.');
      return;
    }
    this.saving.set(true);
    this.success.set('');
    this.saveError.set('');
    const pending = this.pendingSubmission();
    const target = pending ? `${this.url}/measurement-submissions/${pending.id}/verify` : `${this.url}/measurements`;
    this.http.post(target, {
      garment: this.selectedGarment(), measurements, confirmed: raw.confirmed,
    }).pipe(takeUntil(this.customerChanged), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.switchError.set('');
        this.success.set('Versión verificada guardada.');
        this.restoreGarmentFocus = true;
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.requiresRefresh.set(true);
        this.saveError.set('No pudimos confirmar el guardado. Actualiza y revisa el historial antes de intentarlo de nuevo.');
      },
    });
  }

  protected refreshHistory(): void {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    forkJoin({
      history: this.fetchHistory(),
      pending: this.http.get<SubmissionResponse>(`${this.url}/measurement-submissions`, { params: { garment: this.selectedGarment() } }),
    })
      .pipe(takeUntil(this.customerChanged), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ history, pending }) => {
          this.versions.set(history.versions);
          this.historyPage.set(history.pagination ?? null);
          this.latestVersion = history.versions[0];
          this.pendingSubmission.set(pending.submission);
          this.loadingMore.set(false);
          this.requiresRefresh.set(false);
          this.saveError.set('');
          this.switchError.set('');
          this.success.set('Historial actualizado. Comprueba si la versión ya fue guardada.');
        },
        error: () => {
          this.loadingMore.set(false);
          this.saveError.set('No pudimos actualizar el historial. Inténtalo de nuevo antes de guardar.');
        },
      });
  }

  protected maskedDocument(customer: CustomerDetailData): string {
    if (!customer.documentNumber) return 'No registrada';
    return customer.documentNumber.length > 4 ? `••••${customer.documentNumber.slice(-4)}` : '••••';
  }

  canLeave(): boolean {
    if (this.form.dirty || this.saving() || this.requiresRefresh()) {
      this.saveError.set(this.requiresRefresh()
        ? 'Actualiza y revisa el historial antes de salir.'
        : 'Guarda o descarta los cambios antes de salir.');
      return false;
    }
    return true;
  }
}
