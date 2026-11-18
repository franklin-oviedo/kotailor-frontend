import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, MembershipRole } from '../auth/auth.service';

interface IssuedInvitation { link: string; expiresAt: string }

@Component({
  selector: 'app-invite-customer',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="page">
      <section class="card" aria-labelledby="title">
        <h1 id="title">Invitar cliente</h1>
        @if (workshop && (workshop.role === roles.Owner || workshop.role === roles.Manager)) {
          <p class="intro">Invita a un cliente a vincularse con {{ workshop.name }}.</p>
          <form (submit)="issue(); $event.preventDefault()" novalidate>
            <label for="customer-email">Correo de Google del cliente
              <input id="customer-email" type="email" [formControl]="email" maxlength="254" autocomplete="email" required
                [attr.aria-invalid]="email.touched && email.invalid" />
            </label>
            @if (email.touched && email.invalid) { <p class="message" role="alert">Escribe un correo válido.</p> }
            <p class="help">El cliente elegirá una ficha existente con ese mismo correo o creará una nueva. El enlace vence a los siete días y debes compartirlo de forma segura.</p>
            <button type="submit" [disabled]="saving()">{{ saving() ? 'Generando…' : 'Generar invitación' }}</button>
          </form>
          @if (invitation(); as issued) {
            <div class="stack">
              <p class="success" role="status">Invitación creada. Copia el enlace antes de salir.</p>
              <label for="customer-link">Enlace de invitación</label>
              <textarea #link id="customer-link" class="link-box" readonly rows="3" [value]="issued.link" (focus)="link.select()"></textarea>
              <p class="help">Compártelo solo con la persona invitada. No se envía automáticamente.</p>
            </div>
          }
        } @else {
          <p class="intro">Necesitas administrar la sastrería seleccionada para invitar clientes.</p>
        }
        @if (error()) { <p class="message" role="alert">{{ error() }}</p> }
        <div class="actions"><a routerLink="/inicio">Volver al inicio</a></div>
      </section>
    </main>
  `,
  styleUrl: './workshops.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteCustomer {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly roles = MembershipRole;
  protected readonly email = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(254)] });
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly invitation = signal<IssuedInvitation | null>(null);

  protected issue(): void {
    this.email.markAsTouched();
    if (this.email.invalid || this.saving() || !this.workshop) return;
    this.saving.set(true);
    this.error.set('');
    this.invitation.set(null);
    this.http.post<IssuedInvitation>(`/api/workshops/${this.workshop.id}/customer-invitations`, { email: this.email.value.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => { this.invitation.set(result); this.saving.set(false); },
        error: () => { this.saving.set(false); this.error.set('No pudimos generar la invitación. Verifica los datos y tus permisos.'); },
      });
  }
}
