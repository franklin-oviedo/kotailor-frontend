import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { RouterLink } from '@angular/router';
import { timer } from 'rxjs';
import { OrderStatus, orderDeliveryDate, orderNumber, orderStatusLabel } from '../orders/order-display';

interface Dashboard {
  activeOrders: number;
  dueToday: number;
  priorities: { number: number; customerName: string; catalogName: string; status: OrderStatus; deliveryLocal: string }[];
}
interface PaymentsSummary {
  collectedMonthCents: number;
  outstandingCents: number;
  hasPendingTax: boolean;
}
enum AppointmentKind { Fitting = 'fitting', Measurements = 'measurements', Delivery = 'delivery' }
enum AppointmentSyncStatus {
  NotConnected = 'not_connected', Moving = 'moving', Synced = 'synced',
  Pending = 'pending', Retrying = 'retrying', NeedsAttention = 'needs_attention',
}
interface Appointment {
  id: string;
  customerName: string;
  responsibleName: string;
  kind: AppointmentKind;
  startsAt: string;
  syncStatus: AppointmentSyncStatus;
}
interface AppointmentResponse { appointments: Appointment[] }

const nextDate = (date: string): string => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

@Component({
  selector: 'app-home',
  imports: [RouterLink, Shell],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly workshop = this.auth.currentWorkshop();
  protected readonly canManage = this.workshop?.role === MembershipRole.Owner
    || this.workshop?.role === MembershipRole.Manager;
  private readonly now = signal(new Date());
  protected readonly summary = signal<Dashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly paymentsSummary = signal<PaymentsSummary | null>(null);
  protected readonly paymentsLoading = signal(false);
  protected readonly paymentsError = signal(false);
  protected readonly appointments = signal<Appointment[]>([]);
  protected readonly appointmentsLoading = signal(false);
  protected readonly appointmentsError = signal(false);
  protected readonly orderNumber = orderNumber;
  protected readonly date = orderDeliveryDate;
  protected readonly status = orderStatusLabel;
  protected readonly syncStatuses = AppointmentSyncStatus;
  private reloadRequested = false;
  private paymentsRequest = 0;
  private appointmentsRequest = 0;
  private readonly currency = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
  protected readonly money = (cents: number): string => this.currency.format(cents / 100);
  protected readonly appointmentTime = (value: string): string => new Intl.DateTimeFormat('es-DO', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Santo_Domingo',
  }).format(new Date(value));
  protected readonly appointmentKindLabel = (kind: AppointmentKind): string => ({
    [AppointmentKind.Fitting]: 'Prueba',
    [AppointmentKind.Measurements]: 'Toma de medidas',
    [AppointmentKind.Delivery]: 'Entrega',
  })[kind];
  protected readonly syncLabel = (status: AppointmentSyncStatus): string => ({
    [AppointmentSyncStatus.NotConnected]: 'Sin Google Calendar',
    [AppointmentSyncStatus.Moving]: 'Traslado en curso',
    [AppointmentSyncStatus.Synced]: 'Sincronizada',
    [AppointmentSyncStatus.Pending]: 'Por sincronizar',
    [AppointmentSyncStatus.Retrying]: 'Reintentando',
    [AppointmentSyncStatus.NeedsAttention]: 'Requiere revisión',
  })[status];
  protected readonly today = computed(() => {
    const text = new Intl.DateTimeFormat('es-DO', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santo_Domingo',
    }).format(this.now());
    return text.charAt(0).toLocaleUpperCase('es-DO') + text.slice(1);
  });
  protected readonly greeting = computed(() => {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Santo_Domingo',
    }).format(this.now()));
    return hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
  });

  constructor() {
    timer(60000, 60000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const previousDay = this.today();
      this.now.set(new Date());
      if (this.today() !== previousDay) this.load();
    });
    if (this.workshop) this.load();
  }

  protected load(): void {
    if (!this.workshop) return;
    if (this.loading()) {
      this.reloadRequested = true;
      return;
    }
    this.loading.set(true);
    this.error.set(false);
    if (this.canManage) {
      this.loadPaymentsSummary();
      this.loadAppointments();
    }
    const requestedDay = this.today();
    this.http.get<Dashboard>(`/api/workshops/${this.workshop.id}/order-dashboard`)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (summary) => {
          this.summary.set(summary);
          this.loading.set(false);
          if (requestedDay !== this.today() || this.reloadRequested) {
            this.reloadRequested = false;
            this.load();
          }
        },
        error: () => {
          this.summary.set(null);
          this.loading.set(false);
          this.error.set(true);
          if (this.reloadRequested) {
            this.reloadRequested = false;
            this.load();
          }
        },
      });
  }

  private loadPaymentsSummary(): void {
    if (!this.workshop) return;
    const request = ++this.paymentsRequest;
    this.paymentsLoading.set(true);
    this.paymentsError.set(false);
    this.http.get<PaymentsSummary>(`/api/workshops/${this.workshop.id}/payments/dashboard`)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (summary) => {
          if (request !== this.paymentsRequest) return;
          this.paymentsSummary.set(summary);
          this.paymentsLoading.set(false);
        },
        error: () => {
          if (request !== this.paymentsRequest) return;
          this.paymentsSummary.set(null);
          this.paymentsLoading.set(false);
          this.paymentsError.set(true);
        },
      });
  }

  private loadAppointments(): void {
    if (!this.workshop) return;
    const request = ++this.appointmentsRequest;
    const today = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Santo_Domingo',
    }).format(this.now());
    this.appointmentsLoading.set(true);
    this.appointmentsError.set(false);
    this.http.get<AppointmentResponse>(`/api/workshops/${this.workshop.id}/appointments`, {
      params: { from: today, to: nextDate(today) },
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (request !== this.appointmentsRequest) return;
        this.appointments.set(response.appointments);
        this.appointmentsLoading.set(false);
      },
      error: () => {
        if (request !== this.appointmentsRequest) return;
        this.appointments.set([]);
        this.appointmentsLoading.set(false);
        this.appointmentsError.set(true);
      },
    });
  }
}
