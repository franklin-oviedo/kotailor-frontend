import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PortalHeader } from './portal-header';

interface ClientWorkshop { id: string; name: string }
interface WorkshopResponse { workshops: ClientWorkshop[]; hasMore: boolean }

@Component({
  selector: 'app-portal-home',
  imports: [PortalHeader, RouterLink],
  template: `
    <app-portal-header [userName]="auth.session()?.user?.name || ''" [loggingOut]="loggingOut()"
      (signOut)="logout()" (unavailable)="unavailable($event)" />
    <main>
      <h1>Inicio cliente</h1>
      <p class="subtitle">Hola, {{ auth.session()?.user?.name }}. Tu próxima prenda empieza aquí.</p>
      @if (loading()) {
        <p role="status">Cargando tus sastrerías…</p>
      } @else if (error()) {
        <p class="error" role="alert">{{ error() }} <button type="button" class="text-button" (click)="load()">Reintentar</button></p>
      } @else if (workshops().length === 0) {
        <section class="empty">
          <h2>Aún no tienes una sastrería vinculada</h2>
          <p>Solicita una invitación a la sastrería y ábrela con la cuenta de Google indicada.</p>
          <a routerLink="/ayuda">Centro de ayuda →</a>
        </section>
      } @else {
        @if (workshops().length > 1) {
          <label class="workshop-picker" for="client-workshop">Sastrería
            <select id="client-workshop" [value]="selectedId()" (change)="selectWorkshop($event)">
              <option value="">Selecciona una sastrería</option>
              @for (workshop of workshops(); track workshop.id) { <option [value]="workshop.id">{{ workshop.name }}</option> }
            </select>
          </label>
        }
        @if (hasMore()) { <p class="notice" role="status">No se muestran todas tus sastrerías. Contacta al soporte para acceder a las restantes.</p> }
        @if (selectedWorkshop(); as workshop) {
          <section class="welcome">
            <h2>Tu sastrería, más cerca de ti.</h2>
            <p>{{ workshop.name }} · <span class="desktop-copy">Un espacio privado para tus próximos encargos.</span><span class="mobile-copy">Tu espacio privado</span></p>
          </section>
          <div class="actions">
            <a class="action-card" routerLink="/portal/citas" [queryParams]="{ taller: selectedId() }">
              <strong>Agendar una cita</strong><span>Elige servicio, fecha y hora con tu sastrería.</span>
              <span class="action-link">Agendar cita <span aria-hidden="true">→</span></span>
              <span class="mobile-arrow" aria-hidden="true">→</span>
            </a>
            @for (action of actions; track action.title) {
              <button type="button" class="action-card" (click)="unavailable(action.title)">
                <strong>{{ action.title }}</strong><span>{{ action.description }}</span>
                <span class="action-link">{{ action.link }} <span aria-hidden="true">→</span></span>
                <span class="mobile-arrow" aria-hidden="true">→</span>
              </button>
            }
            <a class="action-card" routerLink="/portal/medidas" [queryParams]="{ taller: selectedId() }">
              <strong>Consultar mis medidas</strong><span>Consulta las fichas verificadas por tu sastrería.</span>
              <span class="action-link">Ir a mis medidas <span aria-hidden="true">→</span></span>
              <span class="mobile-arrow" aria-hidden="true">→</span>
            </a>
          </div>
          <div class="panels">
            <section class="panel appointment">
              <h2>Tu agenda</h2><p>Consulta, agenda o reprograma tus citas con la sastrería.</p>
              <a routerLink="/portal/citas" [queryParams]="{ taller: selectedId() }">Ver mis citas →</a>
            </section>
            <section class="panel request"><h2>Tu orden de compra más reciente</h2><p>Las solicitudes aún no están disponibles.</p></section>
          </div>
          <section class="measurements">
            <h2>Tus medidas están en buenas manos.</h2>
            <p>Puedes consultar las versiones verificadas y enviar tus medidas a la sastrería para revisión.</p>
          </section>
        } @else {
          <p class="notice" role="status">Selecciona una sastrería para continuar.</p>
        }
      }
      @if (notice()) { <p class="notice" role="status" aria-live="polite">{{ notice() }}</p> }
    </main>
  `,
  styleUrl: './portal-home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHome {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly workshops = signal<ClientWorkshop[]>([]);
  protected readonly selectedId = signal('');
  protected readonly selectedWorkshop = computed(() =>
    this.workshops().find((workshop) => workshop.id === this.selectedId()));
  protected readonly hasMore = signal(false);
  protected readonly loading = signal(true);
  protected readonly loggingOut = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly actions = [
    { title: 'Crear orden de compra', description: 'Describe lo que quieres confeccionar.', link: 'Nueva solicitud' },
  ];

  constructor() { this.load(); }

  protected selectWorkshop(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.selectedId.set(target.value);
    this.notice.set('');
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.http.get<WorkshopResponse>('/api/client/workshops').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.workshops.set(result.workshops);
        this.hasMore.set(result.hasMore);
        this.selectedId.set(result.workshops.length === 1 ? result.workshops[0].id : '');
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.error.set('No pudimos cargar tus sastrerías.'); },
    });
  }

  protected unavailable(section: string): void {
    this.notice.set(`${section} todavía no está disponible.`);
  }

  protected logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => void this.router.navigate(['/portal']),
      error: () => { this.loggingOut.set(false); this.notice.set('No pudimos cerrar la sesión. Inténtalo nuevamente.'); },
    });
  }
}
