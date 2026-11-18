import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, MembershipRole } from '../auth/auth.service';

enum Mode { Create = 'create_workshop', Authorize = 'authorize_creator', Member = 'member' }
interface IssuedInvitation { link: string; expiresAt: string }

@Component({
  selector: 'app-manage-invitations',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="page">
      <section class="card wide" aria-labelledby="title">
        <h1 id="title">Invitar administradores</h1>
        <p class="intro">Genera un enlace para la persona que administrará una sastrería.</p>
        @if (auth.session()?.platformAdministrator || auth.currentWorkshop()?.role === roles.Owner) {
          <form [formGroup]="form" (ngSubmit)="issue()">
            <fieldset>
              <legend>Tipo de invitación</legend>
              @if (auth.session()?.platformAdministrator) {
                <label class="choice"><input type="radio" formControlName="mode" [value]="modes.Create" /> Crear una sastrería e invitar a su primer administrador</label>
                <label class="choice"><input type="radio" formControlName="mode" [value]="modes.Authorize" /> Autorizar a la persona a crear su propia sastrería</label>
              }
              @if (auth.currentWorkshop()?.role === roles.Owner) {
                <label class="choice"><input type="radio" formControlName="mode" [value]="modes.Member" /> Invitar a otro administrador de {{ auth.currentWorkshop()?.name }}</label>
              }
            </fieldset>
            @if (form.controls.mode.value === modes.Create) {
              <label for="invite-workshop">Nombre comercial de la sastrería
                <input id="invite-workshop" formControlName="workshopName" maxlength="200" autocomplete="organization" />
              </label>
            }
            <label for="invite-email">Correo de Google de la persona invitada
              <input id="invite-email" type="email" formControlName="email" maxlength="254" autocomplete="email" required />
            </label>
            <p class="help">El enlace dura siete días y solo puede aceptarlo la cuenta de Google con este correo. Debes enviarlo por un medio seguro.</p>
            <button type="submit" [disabled]="saving()">{{ saving() ? 'Generando…' : 'Generar invitación' }}</button>
          </form>
          @if (invitation(); as issued) {
            <div class="stack">
              <p class="success" role="status">Invitación creada. Copia el enlace antes de salir de esta página.</p>
              <label for="invitation-link">Enlace de invitación</label>
              <textarea #inviteLink id="invitation-link" class="link-box" readonly rows="3" [value]="issued.link" (focus)="inviteLink.select()"></textarea>
              <p class="help">Compártelo solo con la persona invitada. No se envía automáticamente.</p>
            </div>
          }
        } @else {
          <p class="intro">No tienes permisos para generar invitaciones en la sastrería seleccionada.</p>
        }
        @if (error()) { <p class="message" role="alert">{{ error() }}</p> }
        <div class="actions"><a routerLink="/inicio">Volver al inicio</a></div>
      </section>
    </main>
  `,
  styleUrl: './workshops.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageInvitations {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly modes = Mode;
  protected readonly roles = MembershipRole;
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly invitation = signal<IssuedInvitation | null>(null);
  protected readonly form = new FormGroup({
    mode: new FormControl(this.auth.session()?.platformAdministrator ? Mode.Create : Mode.Member, { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(254)] }),
    workshopName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
  });

  protected issue(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    const { mode, email, workshopName } = this.form.getRawValue();
    if (this.form.invalid || (mode === Mode.Create && workshopName.trim().length < 2)) {
      this.error.set('Completa un correo válido y, si corresponde, un nombre de sastrería de al menos dos caracteres.');
      return;
    }
    const workshop = this.auth.currentWorkshop();
    if (mode === Mode.Member && (!workshop || workshop.role !== MembershipRole.Owner)) {
      this.error.set('Selecciona una sastrería que administres.');
      return;
    }
    const url = mode === Mode.Member ? `/api/workshops/${workshop!.id}/administrator-invitations` : '/api/admin/invitations';
    const body = mode === Mode.Create
      ? { kind: mode, email: email.trim(), workshopName: workshopName.trim() }
      : { kind: Mode.Authorize, email: email.trim() };
    this.error.set('');
    this.invitation.set(null);
    this.saving.set(true);
    this.http.post<IssuedInvitation>(url, body).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => { this.invitation.set(result); this.saving.set(false); },
      error: () => { this.saving.set(false); this.error.set('No pudimos generar la invitación. Verifica los datos y tus permisos.'); },
    });
  }
}
