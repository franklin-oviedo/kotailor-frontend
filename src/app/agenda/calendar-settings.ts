import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { Shell } from '../shell/shell';

interface CalendarConnection {
  connected: boolean;
  email: string | null;
}

interface CalendarSelection {
  selectedCalendarId: string | null;
  pendingCalendarId: string | null;
  version: number;
}

interface CalendarPage {
  calendars: { id: string; name: string; primary: boolean }[];
  nextPageToken: string | null;
}

@Component({
  selector: 'app-calendar-settings',
  imports: [ReactiveFormsModule, RouterLink, Shell],
  templateUrl: './calendar-settings.html',
  styleUrl: './calendar-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarSettings implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly canManage = this.workshop?.role === MembershipRole.Owner || this.workshop?.role === MembershipRole.Manager;
  protected readonly connection = signal<CalendarConnection | null>(null);
  protected readonly selection = signal<CalendarSelection | null>(null);
  protected readonly calendars = signal<CalendarPage['calendars']>([]);
  protected readonly nextPageToken = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly authorizationUrl = signal<string | null>(null);
  protected readonly calendarId = new FormControl('', { nonNullable: true });
  protected readonly confirmDisconnect = new FormControl(false, { nonNullable: true });

  ngOnInit(): void {
    const result = this.route.snapshot.queryParamMap.get('calendar');
    if (result === 'connected') this.notice.set('Autorización completada. Comprueba la cuenta conectada de esta sastrería.');
    if (result === 'cancelled') this.notice.set('Cancelaste la autorización de Google Calendar.');
    if (result === 'error') this.notice.set('Google no pudo completar la autorización. Inténtalo de nuevo.');
    if (this.canManage) this.load();
  }

  protected load(): void {
    if (!this.workshop || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.connection.set(null);
    this.selection.set(null);
    this.calendars.set([]);
    this.nextPageToken.set(null);
    this.http.get<CalendarConnection>(this.url()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (connection) => {
        this.connection.set(connection);
        if (!connection.connected) {
          this.loading.set(false);
          return;
        }
        forkJoin({
          selection: this.http.get<CalendarSelection>(`${this.url()}/selection`),
          page: this.http.get<CalendarPage>(`${this.url()}/calendars`),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: ({ selection, page }) => {
            this.selection.set(selection);
            this.calendars.set(page.calendars);
            this.nextPageToken.set(page.nextPageToken);
            this.loading.set(false);
          },
          error: () => {
            this.error.set('No pudimos consultar los calendarios de Google. Comprueba la conexión e inténtalo de nuevo.');
            this.loading.set(false);
          },
        });
      },
      error: () => {
        this.error.set('No pudimos consultar la conexión de Google Calendar. Inténtalo de nuevo.');
        this.loading.set(false);
      },
    });
  }

  protected connect(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.authorizationUrl.set(null);
    this.http.post<{ url: string }>(`${this.url()}/authorization`, {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ url }) => {
        try {
          const target = new URL(url);
          if (target.protocol !== 'https:' || target.hostname !== 'accounts.google.com'
              || target.pathname !== '/o/oauth2/v2/auth' || target.username || target.password || target.port || target.hash) {
            throw new Error('Invalid authorization destination');
          }
          this.authorizationUrl.set(target.href);
          this.notice.set('Continúa con Google para conceder el permiso por separado.');
        } catch {
          this.error.set('No pudimos verificar el enlace de autorización. Inténtalo de nuevo.');
        }
        this.busy.set(false);
      },
      error: () => {
        this.error.set('No pudimos iniciar la autorización de Google Calendar. Inténtalo de nuevo.');
        this.busy.set(false);
      },
    });
  }

  protected more(): void {
    const pageToken = this.nextPageToken();
    if (!pageToken || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.http.get<CalendarPage>(`${this.url()}/calendars`, { params: { pageToken } })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (page) => {
          if (page.nextPageToken === pageToken) {
            this.error.set('Google devolvió una página inválida. Inténtalo de nuevo.');
          } else {
            const existing = new Set(this.calendars().map((calendar) => calendar.id));
            this.calendars.update((calendars) => [...calendars, ...page.calendars.filter((calendar) => !existing.has(calendar.id))]);
            this.nextPageToken.set(page.nextPageToken);
          }
          this.busy.set(false);
        },
        error: () => { this.error.set('No pudimos cargar más calendarios. Inténtalo de nuevo.'); this.busy.set(false); },
      });
  }

  protected select(): void {
    const selection = this.selection();
    if (!selection || selection.pendingCalendarId || selection.selectedCalendarId || !this.calendarId.value || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.http.post<CalendarSelection>(`${this.url()}/selection`, {
      calendarId: this.calendarId.value, expectedVersion: selection.version,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.selection.set(updated);
        this.calendarId.setValue('');
        this.notice.set('Calendario seleccionado. La sincronización de citas aún no está activa.');
        this.busy.set(false);
      },
      error: () => {
        this.error.set('No pudimos seleccionar el calendario. Actualiza la página y verifica sus permisos.');
        this.busy.set(false);
      },
    });
  }

  protected disconnect(): void {
    if (!this.confirmDisconnect.value || this.busy() || this.selection()?.pendingCalendarId) return;
    this.busy.set(true);
    this.error.set('');
    this.http.post<void>(`${this.url()}/disconnect`, {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmDisconnect.setValue(false);
        this.authorizationUrl.set(null);
        this.notice.set('Se eliminó la conexión. Los eventos existentes permanecen en Google Calendar.');
        this.load();
      },
      error: () => { this.error.set('No pudimos desconectar la cuenta. Inténtalo de nuevo.'); this.busy.set(false); },
    });
  }

  protected selectedName(): string {
    const id = this.selection()?.selectedCalendarId;
    return this.calendars().find((calendar) => calendar.id === id)?.name ?? id ?? '';
  }

  private url(): string {
    return `/api/workshops/${this.workshop?.id}/calendar`;
  }
}
