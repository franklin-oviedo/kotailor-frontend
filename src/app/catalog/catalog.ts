import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, combineLatest, debounceTime, startWith, switchMap, tap, catchError, EMPTY } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Shell } from '../shell/shell';

enum CatalogCategory {
  Tailoring = 'tailoring',
  Alteration = 'alteration',
}

enum TaxTreatment {
  Taxable = 'taxable',
  Exempt = 'exempt',
}

interface MeasurementTemplate {
  id: string;
  label: string;
  fields: { key: string; label: string }[];
}

interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  basePriceCents: number;
  taxTreatment: TaxTreatment;
  measurementGarments: string[];
  instructions: string;
  revision: number;
}

interface CatalogResponse {
  items: CatalogItem[];
  hasMore: boolean;
  measurementCatalog: MeasurementTemplate[];
}

@Component({
  selector: 'app-catalog',
  imports: [ReactiveFormsModule, Shell, Pagination],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Catalog {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly refresh = new Subject<void>();
  private readonly currency = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
  private readonly formHeading = viewChild<ElementRef<HTMLElement>>('formHeading');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly category = CatalogCategory;
  protected readonly taxTreatment = TaxTreatment;
  protected readonly items = signal<CatalogItem[]>([]);
  protected readonly templates = signal<MeasurementTemplate[]>([]);
  protected readonly selectedTemplates = signal<string[]>([]);
  protected readonly editing = signal<CatalogItem | null>(null);
  protected readonly configuringTemplates = signal(false);
  protected readonly stale = signal(false);
  protected readonly templateSummary = computed(() => {
    const selected = this.templates().filter((item) => this.selectedTemplates().includes(item.id));
    if (!selected.length) return 'Sin plantillas seleccionadas.';
    const fields = selected.reduce((total, item) => total + item.fields.length, 0);
    return `${selected.map((item) => item.label).join(' + ')} · ${fields} campos · Unidad: cm.`;
  });
  protected readonly pagination = signal<PageInfo | null>(null);
  private page = initialPage;
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly creating = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120), Validators.pattern(/.*\S.*/)] }),
    category: new FormControl<CatalogCategory | ''>('', { nonNullable: true, validators: [Validators.required] }),
    price: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{1,9}(\.\d{1,2})?$/)] }),
    taxTreatment: new FormControl<TaxTreatment | ''>('', { nonNullable: true, validators: [Validators.required] }),
    instructions: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
  });

  constructor() {
    if (!this.workshop) return;
    combineLatest([
      this.search.valueChanges.pipe(startWith(''), debounceTime(250), tap(() => { this.page = { ...this.page, page: 1 }; })),
      this.refresh.pipe(startWith(undefined)),
    ]).pipe(
      tap(() => { this.loading.set(true); this.error.set(''); }),
      switchMap(([search]) => this.http.get<CatalogResponse & { pagination?: PageInfo }>(this.url, { params: { search, ...this.page } }).pipe(
        catchError(() => {
          this.loading.set(false);
          this.error.set('No pudimos cargar las prendas y servicios. Inténtalo de nuevo.');
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((response) => {
      this.items.set(response.items);
      this.templates.set(response.measurementCatalog);
      this.pagination.set(response.pagination ?? null);
      if (response.pagination) this.page = { page: response.pagination.page, pageSize: response.pagination.pageSize };
      this.loading.set(false);
    });
  }

  private get url(): string {
    return `/api/workshops/${this.workshop!.id}/catalog`;
  }

  protected showForm(item?: CatalogItem): void {
    this.error.set('');
    this.success.set('');
    this.editing.set(item ?? null);
    this.configuringTemplates.set(false);
    this.stale.set(false);
    if (item) {
      this.form.setValue({
        name: item.name, category: item.category, price: (item.basePriceCents / 100).toFixed(2),
        taxTreatment: item.taxTreatment, instructions: item.instructions,
      });
      this.selectedTemplates.set([...item.measurementGarments]);
    }
    this.creating.set(true);
    afterNextRender(() => this.formHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    const reload = this.stale();
    this.creating.set(false);
    this.error.set('');
    this.form.reset();
    this.selectedTemplates.set([]);
    this.editing.set(null);
    this.configuringTemplates.set(false);
    this.stale.set(false);
    if (reload) this.reload();
    afterNextRender(() => this.listHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected toggleTemplate(id: string, checked: boolean): void {
    this.selectedTemplates.update((items) => checked ? [...items, id] : items.filter((item) => item !== id));
  }

  protected reload(): void {
    this.refresh.next();
  }
  protected changePage(page: PageRequest): void {
    this.page = page;
    this.reload();
  }

  protected formatPrice(cents: number): string {
    return this.currency.format(cents / 100);
  }

  protected save(): void {
    if (this.saving() || !this.workshop) return;
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    if (this.form.invalid || value.name.trim().length < 2) {
      this.error.set('Revisa el nombre, la categoría, el precio y el tratamiento de ITBIS.');
      return;
    }
    const [whole, fraction = ''] = value.price.split('.');
    const basePriceCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    this.error.set('');
    this.saving.set(true);
    const payload = {
      name: value.name.trim(), category: value.category, basePriceCents,
      taxTreatment: value.taxTreatment, measurementGarments: this.selectedTemplates(),
      instructions: value.instructions.trim(),
    };
    const editing = this.editing();
    const request = editing
      ? this.http.patch(`${this.url}/${editing.id}`, { ...payload, revision: editing.revision })
      : this.http.post(this.url, payload);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancel();
        this.success.set(editing ? 'Prenda o servicio actualizado.' : 'Prenda o servicio guardado.');
        this.reload();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.stale.set(error.status === 409);
        this.error.set(error.status === 409
          ? 'Esta prenda cambió en otra sesión. Cancela para actualizar la lista y vuelve a abrirla para revisar los cambios.'
          : 'No pudimos guardar la prenda o servicio. Verifica los datos e inténtalo de nuevo.');
      },
    });
  }
}
import { initialPage, PageInfo, PageRequest, Pagination } from '../shared/pagination';
