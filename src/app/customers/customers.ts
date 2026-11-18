import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, combineLatest, debounceTime, startWith, switchMap, tap, catchError, EMPTY } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { CustomerDetail } from './customer-detail';

enum CustomerKind {
  Person = 'person',
  Company = 'company',
}

enum FiscalDocumentKind {
  Cedula = 'cedula',
  Rnc = 'rnc',
  Passport = 'passport',
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  kind: CustomerKind;
}

interface CustomerList {
  customers: Customer[];
  hasMore: boolean;
}

@Component({
  selector: 'app-customers',
  imports: [ReactiveFormsModule, RouterLink, Shell, CustomerDetail, Pagination],
  templateUrl: './customers.html',
  styleUrl: './customers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Customers {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly refresh = new Subject<void>();
  private readonly formHeading = viewChild<ElementRef<HTMLElement>>('formHeading');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  private readonly detail = viewChild(CustomerDetail);
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly customerKind = CustomerKind;
  protected readonly documentKind = FiscalDocumentKind;
  protected readonly customers = signal<Customer[]>([]);
  protected readonly selectedCustomerId = signal<string | null>(null);
  protected readonly blockedNavigation = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly pagination = signal<PageInfo | null>(null);
  private page = initialPage;
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly creating = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(120), Validators.pattern(/.*\S.*/)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(7), Validators.maxLength(30), Validators.pattern(/^[0-9+().\s-]+$/)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.email, Validators.maxLength(254)] }),
    address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    kind: new FormControl(CustomerKind.Person, { nonNullable: true }),
    documentKind: new FormControl<FiscalDocumentKind | ''>(''),
    documentNumber: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    contactAuthorized: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    if (!this.workshop) return;
    combineLatest([
      this.search.valueChanges.pipe(startWith(''), debounceTime(250), tap(() => { this.page = { ...this.page, page: 1 }; })),
      this.refresh.pipe(startWith(undefined)),
    ]).pipe(
      tap(() => { this.loading.set(true); this.error.set(''); }),
      switchMap(([search]) => this.http.get<CustomerList & { pagination?: PageInfo }>(this.url, { params: { search, ...this.page } }).pipe(
        catchError(() => {
          this.loading.set(false);
          this.error.set('No pudimos cargar los clientes. Inténtalo de nuevo.');
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((result) => {
      this.customers.set(result.customers);
      if (!this.selectedCustomerId() && result.customers.length) {
        this.selectedCustomerId.set(result.customers[0].id);
      }
      this.hasMore.set(result.hasMore);
      this.pagination.set(result.pagination ?? null);
      if (result.pagination) this.page = { page: result.pagination.page, pageSize: result.pagination.pageSize };
      this.loading.set(false);
    });
  }

  private get url(): string {
    return `/api/workshops/${this.workshop!.id}/customers`;
  }

  protected customerCountLabel(): string {
    if (this.pagination()) return `${this.pagination()!.total} clientes`;
    const count = this.customers().length;
    return this.hasMore() ? `${count}+ clientes` : `${count} clientes`;
  }

  protected showForm(): void {
    if (!this.canLeave()) return;
    this.error.set('');
    this.success.set('');
    this.creating.set(true);
    afterNextRender(() => this.formHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancel(): void {
    this.creating.set(false);
    this.error.set('');
    this.form.reset({ kind: CustomerKind.Person, documentKind: '', contactAuthorized: false });
    afterNextRender(() => this.listHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected reload(): void {
    this.refresh.next();
  }
  protected changePage(page: PageRequest): void {
    if (!this.canLeave()) return;
    this.page = page;
    this.reload();
  }

  protected selectCustomer(id: string): void {
    if (id === this.selectedCustomerId() || !this.canLeave()) return;
    this.blockedNavigation.set(false);
    this.selectedCustomerId.set(id);
  }

  canLeave(): boolean {
    if (this.saving() || (this.creating() && this.form.dirty)) {
      this.error.set('Guarda o descarta los cambios antes de salir.');
      return false;
    }
    if (this.detail() && !this.detail()!.canLeave()) {
      this.blockedNavigation.set(true);
      return false;
    }
    this.blockedNavigation.set(false);
    return true;
  }

  protected save(): void {
    if (this.saving() || !this.workshop) return;
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    const name = value.name.trim();
    const phone = value.phone.trim();
    const documentNumber = value.documentNumber.trim();
    if (this.form.invalid || name.length < 2 || phone.length < 7 ||
      Boolean(value.documentKind) !== Boolean(documentNumber)) {
      this.error.set('Revisa los campos obligatorios y proporciona el tipo y número de documento juntos.');
      return;
    }
    this.error.set('');
    this.saving.set(true);
    this.http.post<Customer>(this.url, {
      name, phone, email: value.email.trim() || null, kind: value.kind,
      ...(value.address.trim() ? { address: value.address.trim() } : {}),
      documentKind: value.documentKind || null, documentNumber: documentNumber || null,
      contactAuthorized: value.contactAuthorized,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancel();
        this.success.set('Cliente guardado.');
        this.reload();
      },
      error: () => {
        this.saving.set(false);
        this.error.set('No pudimos guardar el cliente. Verifica los datos e inténtalo de nuevo.');
      },
    });
  }
}
import { initialPage, PageInfo, PageRequest, Pagination } from '../shared/pagination';
