import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthenticationError, AuthService } from '../auth/auth.service';
import { PortalHeader } from './portal-header';

@Component({
  selector: 'app-portal-access',
  imports: [PortalHeader, RouterLink],
  template: `
    <app-portal-header [access]="true" />
    <main>
      <section class="card" aria-labelledby="title">
        <p class="eyebrow">PORTAL DEL CLIENTE</p>
        <h1 id="title">Tu cita, tu orden,<br />tus medidas.</h1>
        <p class="description">Accede a tu espacio personal con tu cuenta de Google.<br />Solo verás la información vinculada a tu cuenta en cada sastrería.</p>
        @if (loading()) {
          <p role="status">Comprobando sesión…</p>
        } @else {
          <a class="google" href="/api/auth/google/client">Continuar con Google</a>
        }
        <p class="password">Sin contraseñas adicionales.</p>
        <div class="scope">
          <h2>Un espacio solo para ti</h2>
          <p>✓ Tus citas<br />✓ Tus órdenes de compra<br />✓ Tus medidas</p>
        </div>
        <p class="disclaimer">Sin acceso a otros clientes ni a la administración.<br />El equipo de la sastrería necesita autorización propia.</p>
        <p class="legal">Consulta los <a routerLink="/terminos">Términos</a> y la <a routerLink="/privacidad">Política de privacidad</a> antes de continuar.</p>
        <p class="pending">Puedes gestionar tus citas desde el portal. Las solicitudes de compra todavía no están disponibles.</p>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </section>
    </main>
  `,
  styleUrl: './portal-access.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalAccess {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const reason = params.get('authError');
    const denied = params.get('access') === 'denied';
    if (denied) this.error.set('Esta cuenta no está vinculada como cliente. Solicita una invitación a tu sastrería o ingresa con otra cuenta.');
    if (reason === AuthenticationError.Cancelled) this.error.set('Cancelaste el acceso con Google. Puedes intentarlo de nuevo.');
    else if (reason === AuthenticationError.InvalidFlow) this.error.set('La solicitud de acceso venció o no es válida. Inténtalo de nuevo.');
    else if (reason === AuthenticationError.GoogleUnavailable) this.error.set('No pudimos verificar tu cuenta de Google. Inténtalo de nuevo.');
    else if (reason === AuthenticationError.ServerUnavailable) this.error.set('No pudimos conectar con el servidor. Inténtalo más tarde.');
    this.auth.restore().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (session) => {
        this.loading.set(false);
        if (session && !denied && reason !== AuthenticationError.ServerUnavailable) void this.router.navigate(['/portal/inicio']);
      },
      error: () => { this.loading.set(false); this.error.set('No pudimos conectar con el servidor. Inténtalo más tarde.'); },
    });
  }
}
