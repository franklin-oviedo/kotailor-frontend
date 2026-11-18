import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, forkJoin, switchMap, tap } from 'rxjs';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { OrderStatus, orderNumber, orderStatusLabel } from '../orders/order-display';
import { Shell } from '../shell/shell';

enum AppointmentKind { Fitting = 'fitting', Measurements = 'measurements', Delivery = 'delivery' }
enum SyncStatus {
  NotConnected = 'not_connected', Moving = 'moving', Synced = 'synced',
  Pending = 'pending', Retrying = 'retrying', NeedsAttention = 'needs_attention',
}
interface Appointment {
  id: string; customerId: string; customerName: string; orderNumber: number | null;
  responsibleId: string; responsibleName: string; kind: AppointmentKind;
  startsAt: string; endsAt: string; version: number; syncStatus: SyncStatus;
}
interface Customer { id: string; name: string; phone: string }
interface Member { id: string; name: string }
interface Order { id: string; customerId: string; number: number }
interface AppointmentList { appointments: Appointment[]; hasMore: boolean }
interface CustomerList { customers: Customer[]; hasMore: boolean }
interface OrderList { orders: Order[]; hasMore: boolean }
interface DashboardOrder {
  number: number; customerName: string; catalogName: string; status: OrderStatus; deliveryLocal: string;
}
interface OrderDashboard { dueToday: number; priorities: DashboardOrder[] }
interface CalendarConnection { connected: boolean; email: string | null }
interface CalendarSelection { selectedCalendarId: string | null; pendingCalendarId: string | null }
interface CalendarPage { calendars: { id: string; name: string }[] }

const timeZone = 'America/Santo_Domingo';
const localParts = (value: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-CA', { ...options, timeZone }).formatToParts(value);
const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  parts.find((value) => value.type === type)?.value ?? '';
const localDate = (value: Date) => {
  const parts = localParts(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
};
const localTime = (value: Date) => {
  const parts = localParts(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${part(parts, 'hour')}:${part(parts, 'minute')}`;
};
const addDays = (date: string, count: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};
const weekStart = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
};
const localInstant = (date: string, time: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const probe = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(probe.getTime())) return null;
  const zone = part(localParts(probe, { timeZoneName: 'longOffset' }), 'timeZoneName');
  if (!/^GMT(?:[+-]\d{2}:\d{2})?$/.test(zone)) return null;
  const result = new Date(`${date}T${time}:00${zone.slice(3) || '+00:00'}`);
  return Number.isNaN(result.getTime()) || localDate(result) !== date || localTime(result) !== time ? null : result;
};

@Component({
  selector: 'app-agenda',
  imports: [ReactiveFormsModule, RouterLink, Shell],
  templateUrl: './agenda.html',
  styleUrl: './agenda.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Agenda {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly requests = new Subject<{ from: string; to: string }>();
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private pendingRequest: { fingerprint: string; id: string } | null = null;
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly canManage = this.workshop?.role === MembershipRole.Owner || this.workshop?.role === MembershipRole.Manager;
  protected readonly selectedDate = signal(localDate(new Date()));
  protected readonly todayDate = localDate(new Date());
  protected readonly days = computed(() => {
    const monday = weekStart(this.selectedDate());
    return Array.from({ length: 5 }, (_, index) => addDays(monday, index));
  });
  protected readonly weekdays = computed(() => this.days());
  protected readonly calendarHours = Array.from({ length: 9 }, (_, index) => index + 9);
  protected readonly appointments = signal<Appointment[]>([]);
  protected readonly visibleAppointments = computed(() => {
    const start = localInstant(this.selectedDate(), '00:00');
    const end = localInstant(addDays(this.selectedDate(), 1), '00:00');
    return start && end ? this.appointments().filter((item) =>
      Date.parse(item.startsAt) < end.getTime() && Date.parse(item.endsAt) > start.getTime()) : [];
  });
  protected readonly calendarRows = computed(() => this.calendarHours.map((hour) => ({
    hour,
    cells: this.weekdays().map((date) => ({
      date,
      appointments: this.appointments().filter((item) => this.appointmentInCell(item, date, hour)),
    })),
  })));
  protected readonly selectedAppointmentId = signal<string | null>(null);
  protected readonly selectedAppointment = computed(() => {
    const appointments = this.appointments();
    return appointments.find((item) => item.id === this.selectedAppointmentId()) ??
      this.visibleAppointments()[0] ?? null;
  });
  protected readonly dashboard = signal<OrderDashboard | null>(null);
  protected readonly dashboardLoading = signal(false);
  protected readonly dashboardError = signal(false);
  protected readonly todayDeliveries = computed(() => (this.dashboard()?.priorities ?? [])
    .filter((order) => order.deliveryLocal.slice(0, 10) === this.todayDate).slice(0, 3));
  protected readonly calendarConnection = signal<CalendarConnection | null>(null);
  protected readonly calendarSelection = signal<CalendarSelection | null>(null);
  protected readonly calendarName = signal('');
  protected readonly calendarLoading = signal(false);
  protected readonly calendarError = signal(false);
  protected readonly appointmentKinds = AppointmentKind;
  protected readonly orderNumber = orderNumber;
  protected readonly orderStatus = orderStatusLabel;
  protected readonly customers = signal<Customer[]>([]);
  protected readonly customerHasMore = signal(false);
  protected readonly members = signal<Member[]>([]);
  protected readonly orders = signal<Order[]>([]);
  protected readonly orderHasMore = signal(false);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly lookupLoading = signal(false);
  protected readonly saving = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly editing = signal<Appointment | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly cancelId = signal<string | null>(null);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly kinds = [
    { value: AppointmentKind.Fitting, label: 'Prueba de prenda' },
    { value: AppointmentKind.Measurements, label: 'Medidas' },
    { value: AppointmentKind.Delivery, label: 'Entrega' },
  ];
  protected readonly form = new FormGroup({
    customerId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    orderId: new FormControl('', { nonNullable: true }),
    kind: new FormControl(AppointmentKind.Fitting, { nonNullable: true, validators: [Validators.required] }),
    date: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    time: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    duration: new FormControl(30, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(1440)] }),
    responsibleId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    if (!this.workshop || !this.canManage) return;
    this.requests.pipe(
      tap(() => { this.loading.set(true); this.loaded.set(false); this.error.set(''); }),
      switchMap(({ from, to }) => this.http.get<AppointmentList>(`${this.base}/appointments`, { params: { from, to } }).pipe(
        catchError(() => { this.loading.set(false); this.error.set('No pudimos cargar las citas. Inténtalo de nuevo.'); return EMPTY; }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((response) => {
      this.appointments.set(response.appointments); this.hasMore.set(response.hasMore); this.loading.set(false); this.loaded.set(true);
    });
    this.reload();
    this.loadDashboard();
    this.loadCalendar();
  }

  private get base(): string { return `/api/workshops/${this.workshop!.id}`; }
  private focusHeading(): void { afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector }); }
  private appointmentInCell(item: Appointment, date: string, hour: number): boolean {
    const instant = new Date(item.startsAt);
    return localDate(instant) === date && Number(localTime(instant).slice(0, 2)) === hour;
  }
  protected reload(): void {
    this.selectedAppointmentId.set(null);
    this.requests.next({ from: this.days()[0], to: addDays(this.days()[0], 7) });
  }
  protected shiftWeek(count: number): void { this.selectedDate.set(addDays(this.selectedDate(), count * 7)); this.reload(); }
  protected today(): void { this.selectedDate.set(localDate(new Date())); this.reload(); }
  protected selectDate(date: string): void { this.selectedDate.set(date); this.selectedAppointmentId.set(null); }
  protected selectAppointment(item: Appointment): void {
    this.selectedDate.set(localDate(new Date(item.startsAt)));
    this.selectedAppointmentId.set(item.id);
  }
  protected weekLabel(): string {
    const start = new Date(`${this.weekdays()[0]}T12:00:00Z`);
    const end = new Date(`${this.weekdays()[4]}T12:00:00Z`);
    const month = (date: Date) => new Intl.DateTimeFormat('es-DO', { month: 'long', timeZone: 'UTC' }).format(date);
    const year = (date: Date) => new Intl.DateTimeFormat('es-DO', { year: 'numeric', timeZone: 'UTC' }).format(date);
    if (month(start) === month(end) && year(start) === year(end)) {
      return `${start.getUTCDate()} – ${end.getUTCDate()} ${month(end)} de ${year(end)}`;
    }
    return `${new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(start)} – ${new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(end)}`;
  }
  protected calendarDayLabel(date: string): string {
    const value = new Date(`${date}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat('es-DO', { weekday: 'short', timeZone: 'UTC' })
      .format(value).replace('.', '').toLocaleUpperCase('es-DO');
    return `${weekday} ${value.getUTCDate()}`;
  }
  protected hourLabel(hour: number): string {
    return `${hour > 12 ? hour - 12 : hour} ${hour < 12 ? 'a. m.' : 'p. m.'}`;
  }
  protected dateLabel(value: string): string {
    const [date, time] = value.split('T');
    const dateValue = new Date(`${date}T12:00:00Z`);
    const dayMonth = new Intl.DateTimeFormat('es-DO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(dateValue);
    return `${dayMonth} · ${time}`;
  }
  protected timeLabel(value: string): string {
    return new Intl.DateTimeFormat('es-DO', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value));
  }
  protected kindLabel(kind: AppointmentKind): string { return this.kinds.find((item) => item.value === kind)?.label ?? kind; }
  protected loadDashboard(): void {
    if (!this.workshop || this.dashboardLoading()) return;
    this.dashboardLoading.set(true);
    this.dashboardError.set(false);
    this.http.get<OrderDashboard>(`${this.base}/order-dashboard`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (dashboard) => { this.dashboard.set(dashboard); this.dashboardLoading.set(false); },
      error: () => { this.dashboard.set(null); this.dashboardLoading.set(false); this.dashboardError.set(true); },
    });
  }
  protected loadCalendar(): void {
    if (!this.workshop || this.calendarLoading()) return;
    this.calendarLoading.set(true);
    this.calendarError.set(false);
    this.http.get<CalendarConnection>(`${this.base}/calendar`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (connection) => {
        this.calendarConnection.set(connection);
        if (!connection.connected) { this.calendarLoading.set(false); return; }
        forkJoin({
          selection: this.http.get<CalendarSelection>(`${this.base}/calendar/selection`),
          page: this.http.get<CalendarPage>(`${this.base}/calendar/calendars`),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: ({ selection, page }) => {
            this.calendarSelection.set(selection);
            this.calendarName.set(page.calendars.find((calendar) => calendar.id === selection.selectedCalendarId)?.name
              ?? selection.selectedCalendarId ?? '');
            this.calendarLoading.set(false);
          },
          error: () => { this.calendarLoading.set(false); this.calendarError.set(true); },
        });
      },
      error: () => { this.calendarLoading.set(false); this.calendarError.set(true); },
    });
  }
  protected syncLabel(status: SyncStatus): string {
    const labels: Record<SyncStatus, string> = {
      [SyncStatus.NotConnected]: 'Sin calendario conectado', [SyncStatus.Moving]: 'Trasladando calendario',
      [SyncStatus.Synced]: 'Sincronizada', [SyncStatus.Pending]: 'Sincronización pendiente',
      [SyncStatus.Retrying]: 'Reintentando sincronización', [SyncStatus.NeedsAttention]: 'Requiere revisión de Calendar',
    };
    return labels[status];
  }

  protected openCreate(): void {
    this.error.set(''); this.notice.set(''); this.editing.set(null); this.formOpen.set(true); this.cancelId.set(null);
    this.pendingRequest = null;
    this.form.reset({ customerId: '', orderId: '', kind: AppointmentKind.Fitting, date: this.selectedDate(), time: '10:00', duration: 30, responsibleId: '' });
    this.loadLookups(); this.focusHeading();
  }

  protected openEdit(item: Appointment): void {
    this.error.set(''); this.notice.set(''); this.editing.set(item); this.formOpen.set(true); this.cancelId.set(null);
    this.form.reset({
      customerId: item.customerId, orderId: '', kind: item.kind, date: localDate(new Date(item.startsAt)),
      time: localTime(new Date(item.startsAt)), duration: (Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60000,
      responsibleId: item.responsibleId,
    });
    this.loadLookups(); this.focusHeading();
  }

  protected loadLookups(): void {
    if (this.lookupLoading()) return;
    this.lookupLoading.set(true); this.error.set('');
    forkJoin({
      customers: this.http.get<CustomerList>(`${this.base}/customers`, { params: { search: this.search.value } }),
      settings: this.http.get<{ members: Member[] }>(`${this.base}/order-settings`),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ customers, settings }) => {
        this.customers.set(customers.customers); this.customerHasMore.set(customers.hasMore);
        this.members.set(settings.members); this.lookupLoading.set(false);
      },
      error: () => { this.lookupLoading.set(false); this.error.set('No pudimos cargar clientes y responsables. Inténtalo de nuevo.'); },
    });
  }

  protected customerChanged(): void {
    this.form.controls.orderId.setValue('');
    this.orders.set([]); this.orderHasMore.set(false);
    const customer = this.customers().find((item) => item.id === this.form.controls.customerId.value);
    if (!customer) return;
    this.http.get<OrderList>(`${this.base}/orders`, { params: { search: customer.name, filter: 'all' } })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          if (this.form.controls.customerId.value !== customer.id) return;
          this.orders.set(response.orders.filter((order) => order.customerId === customer.id));
          this.orderHasMore.set(response.hasMore);
        },
        error: () => this.error.set('No pudimos cargar las órdenes del cliente. Inténtalo de nuevo.'),
      });
  }

  protected closeForm(): void {
    if (this.saving()) return;
    this.formOpen.set(false); this.editing.set(null); this.error.set(''); this.form.markAsPristine(); this.focusHeading();
  }
  canLeave(): boolean {
    if (this.saving() || (this.formOpen() && this.form.dirty)) {
      this.error.set('Guarda o descarta los cambios antes de salir.');
      return false;
    }
    return true;
  }

  protected save(): void {
    if (this.saving() || this.lookupLoading()) return;
    this.form.markAllAsTouched();
    const value = this.form.getRawValue();
    const start = localInstant(value.date, value.time);
    if (this.form.invalid || !start || !Number.isInteger(value.duration) || !this.members().some((member) => member.id === value.responsibleId)
        || (!this.editing() && !this.customers().some((customer) => customer.id === value.customerId))) {
      this.error.set('Revisa los campos obligatorios, la fecha y el responsable.'); return;
    }
    const interval = {
      responsibleId: value.responsibleId, startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + value.duration * 60000).toISOString(),
    };
    const edit = this.editing();
    this.saving.set(true); this.error.set('');
    if (edit) {
      this.http.put(`${this.base}/appointments/${edit.id}`, { ...interval, expectedVersion: edit.version })
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: () => this.saved('Cita reprogramada.', value.date),
          error: (error: HttpErrorResponse) => this.saveError(error),
        });
      return;
    }
    const payload = { customerId: value.customerId, orderId: value.orderId || null, kind: value.kind, ...interval };
    const fingerprint = JSON.stringify(payload);
    if (this.pendingRequest?.fingerprint !== fingerprint) this.pendingRequest = { fingerprint, id: crypto.randomUUID() };
    this.http.post(`${this.base}/appointments`, { ...payload, requestId: this.pendingRequest.id })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.saved('Cita creada.', value.date),
        error: (error: HttpErrorResponse) => this.saveError(error),
      });
  }
  private saved(message: string, date: string): void {
    this.saving.set(false); this.form.markAsPristine(); this.formOpen.set(false); this.editing.set(null);
    this.selectedDate.set(date); this.notice.set(message); this.reload(); this.focusHeading();
  }
  private saveError(error: HttpErrorResponse): void {
    this.saving.set(false);
    this.error.set(error.status === 409
      ? 'El horario no está disponible, la cita cambió o el calendario se está trasladando. Revisa los datos e inténtalo de nuevo.'
      : 'No pudimos confirmar el guardado. Reintenta sin cambiar los datos para evitar duplicados.');
  }
  protected cancel(item: Appointment): void {
    if (this.saving() || this.cancelId() !== item.id) return;
    this.saving.set(true); this.error.set('');
    this.http.post(`${this.base}/appointments/${item.id}/cancel`, { expectedVersion: item.version })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving.set(false); this.cancelId.set(null); this.notice.set('Cita cancelada.'); this.reload(); },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false); this.cancelId.set(null);
          this.error.set(error.status === 409 ? 'La cita cambió o el calendario se está trasladando. Actualiza la agenda.' : 'No pudimos cancelar la cita. Inténtalo de nuevo.');
        },
      });
  }
}
