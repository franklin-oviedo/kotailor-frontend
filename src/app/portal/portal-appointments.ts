import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { PortalHeader } from './portal-header';
import { initialPage, Pagination, type PageInfo, type PageRequest } from '../shared/pagination';

enum AppointmentKind {
  Fitting = 'fitting',
  Measurements = 'measurements',
  Delivery = 'delivery',
}

interface Workshop { id: string; name: string }
interface WorkshopResponse { workshops: Workshop[]; hasMore: boolean }
interface Customer { id: string; name: string }
interface Responsible { id: string; name: string }
interface AppointmentOptions { customers: Customer[]; responsibles: Responsible[] }
interface Appointment {
  id: string;
  customerId: string;
  customerName: string;
  responsibleId: string;
  responsibleName: string;
  kind: AppointmentKind;
  startsAt: string;
  endsAt: string;
  version: number;
}
interface AppointmentResponse { appointments: Appointment[]; pagination?: PageInfo }
interface AppointmentFormValue {
  customerId: string;
  responsibleId: string;
  kind: AppointmentKind;
  startsAt: string;
  endsAt: string;
}

@Component({
  selector: 'app-portal-appointments',
  imports: [PortalHeader, ReactiveFormsModule, RouterLink, Pagination],
  templateUrl: './portal-appointments.html',
  styleUrl: './portal-appointments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalAppointments {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private appointmentsRequest?: Subscription;
  protected readonly workshops = signal<Workshop[]>([]);
  protected readonly selectedId = signal('');
  protected readonly hasMoreWorkshops = signal(false);
  protected readonly appointments = signal<Appointment[]>([]);
  protected readonly appointmentsPage = signal<PageInfo | null>(null);
  protected readonly customers = signal<Customer[]>([]);
  protected readonly responsibles = signal<Responsible[]>([]);
  protected readonly weekStart = signal(this.startOfWeek(this.today()));
  protected readonly weekEnd = computed(() => this.addDays(this.weekStart(), 7));
  protected readonly weekLabel = computed(() => {
    const format = (value: string) => new Intl.DateTimeFormat('es-DO', {
      day: 'numeric', month: 'short', timeZone: 'America/Santo_Domingo',
    }).format(new Date(`${value}T12:00:00Z`));
    return `${format(this.weekStart())} – ${format(this.addDays(this.weekEnd(), -1))}`;
  });
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Appointment | null>(null);
  protected readonly confirmingCancel = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly uncertain = signal(false);
  protected readonly kinds = AppointmentKind;
  protected readonly kindOptions = [
    { value: AppointmentKind.Fitting, label: 'Prueba de prenda' },
    { value: AppointmentKind.Measurements, label: 'Toma de medidas' },
    { value: AppointmentKind.Delivery, label: 'Entrega' },
  ];
  protected readonly form = new FormGroup({
    customerId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    responsibleId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    kind: new FormControl(AppointmentKind.Fitting, { nonNullable: true, validators: [Validators.required] }),
    startsAt: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    endsAt: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  private pendingRequest: { fingerprint: string; id: string } | null = null;
  private readonly kindLabels: Record<AppointmentKind, string> = {
    [AppointmentKind.Fitting]: 'Prueba de prenda',
    [AppointmentKind.Measurements]: 'Toma de medidas',
    [AppointmentKind.Delivery]: 'Entrega',
  };

  constructor() {
    this.loadWorkshops();
    this.destroyRef.onDestroy(() => this.appointmentsRequest?.unsubscribe());
  }

  protected selectWorkshop(event: Event): void {
    if (this.formOpen() || this.uncertain()) return;
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.appointmentsRequest?.unsubscribe();
    this.selectedId.set(target.value);
    this.appointments.set([]);
    this.customers.set([]);
    this.responsibles.set([]);
    this.error.set('');
    this.notice.set('');
    if (this.workshops().some((workshop) => workshop.id === target.value)) this.loadData();
  }

  protected changeWeek(offset: number): void {
    if (this.formOpen()) return;
    this.weekStart.set(this.addDays(this.weekStart(), offset * 7));
    this.loadData();
  }

  protected showCreate(): void {
    this.editing.set(null);
    this.resetForm();
    this.formOpen.set(true);
    this.error.set('');
    this.notice.set('');
  }

  protected editAppointment(appointment: Appointment): void {
    this.form.enable();
    this.editing.set(appointment);
    this.form.reset({
      customerId: appointment.customerId,
      responsibleId: appointment.responsibleId,
      kind: appointment.kind,
      startsAt: this.toLocalDateTime(appointment.startsAt),
      endsAt: this.toLocalDateTime(appointment.endsAt),
    });
    this.form.controls.kind.disable();
    this.formOpen.set(true);
    this.error.set('');
    this.notice.set('');
  }

  protected closeForm(): void {
    if (this.uncertain()) {
      this.error.set('No se puede cerrar: confirma el resultado reintentando con los mismos datos.');
      return;
    }
    this.formOpen.set(false);
    this.editing.set(null);
    this.error.set('');
  }

  protected save(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid && !this.uncertain()) {
      this.error.set('Completa los campos obligatorios.');
      return;
    }
    const values = this.form.getRawValue();
    const startsAt = this.toUtc(values.startsAt);
    const endsAt = this.toUtc(values.endsAt);
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt) || Date.parse(startsAt) <= Date.now()) {
      this.error.set('Selecciona un horario futuro y asegúrate de que la hora de fin sea posterior al inicio.');
      return;
    }
    const appointment = this.editing();
    if (appointment) {
      this.reschedule(appointment, values, startsAt, endsAt);
      return;
    }
    const workshopId = this.selectedId();
    const customerId = values.customerId;
    if (!workshopId || !this.customers().some((customer) => customer.id === customerId)) return;
    const payload = {
      customerId,
      orderId: null,
      responsibleId: values.responsibleId,
      kind: values.kind,
      startsAt,
      endsAt,
    };
    const fingerprint = JSON.stringify(payload);
    if (this.uncertain() && this.pendingRequest?.fingerprint !== fingerprint) {
      this.error.set('El resultado de la reserva es incierto. Reintenta con los mismos datos para evitar duplicados.');
      return;
    }
    if (!this.pendingRequest || this.pendingRequest.fingerprint !== fingerprint) {
      this.pendingRequest = { fingerprint, id: crypto.randomUUID() };
    }
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    this.http.post<{ id: string }>(`/api/client/workshops/${encodeURIComponent(workshopId)}/appointments`, {
      ...payload, requestId: this.pendingRequest.id,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.pendingRequest = null;
        this.uncertain.set(false);
        this.saving.set(false);
        this.formOpen.set(false);
        this.notice.set('Cita agendada.');
        this.loadData();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.uncertain.set(error.status !== 409);
        if (error.status === 409) this.pendingRequest = null;
        this.error.set(error.status === 409
          ? 'Ese horario ya no está disponible o la cita cambió. Actualiza la lista y elige otro horario.'
          : 'No pudimos confirmar la reserva. Reintenta con los mismos datos para evitar duplicados.');
        if (this.uncertain()) this.form.disable();
      },
    });
  }

  protected requestCancel(appointment: Appointment): void {
    this.confirmingCancel.set(appointment.id);
    this.error.set('');
  }

  protected stopCancel(): void { this.confirmingCancel.set(null); }

  protected cancel(appointment: Appointment): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.http.post(
      `/api/client/workshops/${encodeURIComponent(this.selectedId())}/appointments/${encodeURIComponent(appointment.id)}/cancel`,
      { expectedVersion: appointment.version },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.confirmingCancel.set(null);
        this.notice.set('Cita cancelada.');
        this.loadData();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(error.status === 409
          ? 'La cita cambió en otra sesión. Actualiza la lista antes de cancelar.'
          : 'No pudimos cancelar la cita. Inténtalo nuevamente.');
      },
    });
  }

  protected appointmentKind(kind: AppointmentKind): string { return this.kindLabels[kind]; }
  protected dateTime(value: string): string {
    return new Intl.DateTimeFormat('es-DO', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santo_Domingo',
    }).format(new Date(value));
  }

  protected unavailable(section: string): void { this.notice.set(`${section} todavía no está disponible.`); }

  protected logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => void this.router.navigate(['/portal']),
      error: () => {
        this.loggingOut.set(false);
        this.notice.set('No pudimos cerrar la sesión. Inténtalo nuevamente.');
      },
    });
  }

  protected loadWorkshops(): void {
    this.loading.set(true);
    this.error.set('');
    this.http.get<WorkshopResponse>('/api/client/workshops').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.workshops.set(result.workshops);
        this.hasMoreWorkshops.set(result.hasMore);
        const requested = this.route.snapshot.queryParamMap.get('taller');
        const selected = result.workshops.find((workshop) => workshop.id === requested)?.id ??
          (result.workshops.length === 1 ? result.workshops[0].id : '');
        this.selectedId.set(selected);
        if (selected) this.loadData();
        else this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No pudimos cargar tus sastrerías. Inténtalo nuevamente.');
      },
    });
  }

  protected loadData(page: PageRequest = initialPage): void {
    const workshopId = this.selectedId();
    if (!this.workshops().some((workshop) => workshop.id === workshopId)) return;
    this.appointmentsRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    this.appointmentsRequest = forkJoin({
      options: this.http.get<AppointmentOptions>(
        `/api/client/workshops/${encodeURIComponent(workshopId)}/appointments/options`,
      ),
      appointments: this.http.get<AppointmentResponse>(
        `/api/client/workshops/${encodeURIComponent(workshopId)}/appointments`,
        { params: { from: this.weekStart(), to: this.weekEnd(), ...page } },
      ),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ options, appointments }) => {
        this.customers.set(options.customers);
        this.responsibles.set(options.responsibles);
        this.appointments.set(appointments.appointments);
        this.appointmentsPage.set(appointments.pagination ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No pudimos cargar tus citas. Comprueba tu acceso e inténtalo nuevamente.');
      },
    });
  }

  private reschedule(appointment: Appointment, values: AppointmentFormValue, startsAt: string, endsAt: string): void {
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    this.http.put(
      `/api/client/workshops/${encodeURIComponent(this.selectedId())}/appointments/${encodeURIComponent(appointment.id)}`,
      { expectedVersion: appointment.version, responsibleId: values.responsibleId, startsAt, endsAt },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.editing.set(null);
        this.notice.set('Cita reprogramada.');
        this.loadData();
      },
      error: (error: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(error.status === 409
          ? 'Ese horario ya no está disponible o la cita cambió. Actualiza la lista e inténtalo otra vez.'
          : 'No pudimos reprogramar la cita. Inténtalo nuevamente.');
      },
    });
  }

  private resetForm(): void {
    this.form.enable();
    this.form.reset({
      customerId: this.customers().length === 1 ? this.customers()[0].id : '',
      responsibleId: this.responsibles().length === 1 ? this.responsibles()[0].id : '',
      kind: AppointmentKind.Fitting,
      startsAt: '',
      endsAt: '',
    });
    this.pendingRequest = null;
    this.uncertain.set(false);
  }

  private today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
  }

  private startOfWeek(value: string): string {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  }

  private addDays(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private toUtc(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const date = new Date(`${value}:00-04:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private toLocalDateTime(value: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  }
}
