import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map, Observable, of, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';

enum InvitationKind { Creator = 'workshop_creator', Member = 'workshop_member', Customer = 'customer' }
enum CustomerChoice { New = 'new' }
interface PendingInvitation {
  kind: InvitationKind; workshopName: string | null; expiresAt: string;
  candidates?: { id: string; name: string }[]; hasMore?: boolean; accepted?: boolean; alreadyLinked?: boolean;
}

@Component({
  selector: 'app-invitation',
  imports: [RouterLink, ReactiveFormsModule],
  template: `
    <main class="page">
      <section class="card" aria-labelledby="title">
        <h1 id="title">Tu invitación</h1>
        @if (loading()) {
          <p role="status">Comprobando invitación…</p>
        } @else if (completed()) {
          <p class="success" role="status">Tu cuenta está vinculada con {{ pending()?.workshopName }}.</p>
          <p class="help">Ya puedes acceder al inicio del portal de clientes. Algunas funciones están en construcción.</p>
          <div class="actions"><a class="button" routerLink="/portal/inicio">Ir a mi portal</a><button type="button" class="secondary" (click)="logout()">Cerrar sesión</button></div>
        } @else if (error()) {
          <p class="message" role="alert">{{ error() }}</p>
          <p class="help">Si necesitas cambiar de cuenta, cierra la sesión y vuelve a abrir el enlace original.</p>
          <div class="actions">
            @if (auth.session()) { <button type="button" class="secondary" (click)="logout()">Cerrar sesión</button> }
            <a routerLink="/ayuda">Obtener ayuda</a>
          </div>
        } @else if (!auth.session()) {
          <p class="intro">Continúa con la cuenta de Google del correo al que enviaron la invitación.</p>
          <div class="actions"><a class="button" href="/api/auth/google">Continuar con Google</a></div>
        } @else if (pending(); as invitation) {
          @if (invitation.kind === kinds.Creator) {
            <p class="intro">Te han autorizado a crear tu propia sastrería.</p>
          } @else if (invitation.kind === kinds.Member) {
            <p class="intro">Te han invitado a administrar <strong>{{ invitation.workshopName }}</strong>.</p>
          } @else {
            <p class="intro">Te han invitado a vincularte con <strong>{{ invitation.workshopName }}</strong>.</p>
          }
          <p class="help">Sesión iniciada como {{ auth.session()?.user?.email }}. La invitación solo puede utilizarse con el correo indicado.</p>
          @if (invitation.kind === kinds.Customer && !invitation.accepted) {
            <form [formGroup]="customerForm" (ngSubmit)="accept()">
              <fieldset>
                <legend>Selecciona tu ficha</legend>
                @for (candidate of invitation.candidates; track candidate.id) {
                  <label class="choice"><input type="radio" formControlName="selection" [value]="candidate.id" /> {{ candidate.name }}</label>
                }
                <label class="choice"><input type="radio" formControlName="selection" [value]="newChoice" /> Crear una ficha nueva</label>
              </fieldset>
              @if (invitation.hasMore) { <p class="help">Hay más fichas con este correo. Contacta a la sastrería si no encuentras la tuya.</p> }
              @if (customerForm.controls.selection.value === newChoice) {
                <label for="customer-name">Nombre completo
                  <input id="customer-name" formControlName="name" autocomplete="name" maxlength="120" required />
                </label>
                <label for="customer-phone">Teléfono
                  <input id="customer-phone" type="tel" formControlName="phone" autocomplete="tel" maxlength="30" required />
                </label>
              }
              @if (formError()) { <p class="message" role="alert">{{ formError() }}</p> }
              <button type="submit" [disabled]="saving()">{{ saving() ? 'Aceptando…' : 'Aceptar y vincular' }}</button>
            </form>
          } @else {
            <div class="actions"><button type="button" [disabled]="saving()" (click)="accept()">{{ saving() ? 'Aceptando…' : 'Aceptar invitación' }}</button></div>
          }
        }
      </section>
    </main>
  `,
  styleUrl: './workshops.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Invitation {
  protected readonly auth = inject(AuthService);
  protected readonly kinds = InvitationKind;
  protected readonly newChoice = CustomerChoice.New;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  protected readonly completed = signal(false);
  protected readonly pending = signal<PendingInvitation | null>(null);
  protected readonly customerForm = new FormGroup({
    selection: new FormControl('', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^[0-9+().\s-]+$/)] }),
  });
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const token = inject(ActivatedRoute).snapshot.fragment;
    if (token) inject(Location).replaceState('/invitacion');
    const stage: Observable<unknown> = token ? this.http.post('/api/invitations/stage', { token }) : of(null);
    stage.pipe(
      switchMap(() => this.auth.restore()),
      switchMap((session) => session ? this.http.get<PendingInvitation>('/api/invitations/pending') : of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => {
        this.pending.set(result);
        if (result?.kind === InvitationKind.Customer && (result.accepted || result.alreadyLinked)) this.completed.set(true);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.error.set('La invitación no está disponible para esta cuenta o ha vencido.'); },
    });
  }

  protected accept(): void {
    if (this.saving()) return;
    const invitation = this.pending();
    let body: object = {};
    if (invitation?.kind === InvitationKind.Customer) {
      const { selection, name, phone } = this.customerForm.getRawValue();
      if (!selection || (selection === CustomerChoice.New &&
        (name.trim().length < 2 || phone.trim().length < 7 || this.customerForm.controls.phone.invalid))) {
        this.formError.set('Selecciona una ficha o completa un nombre y teléfono válidos.');
        return;
      }
      body = selection === CustomerChoice.New
        ? { choice: CustomerChoice.New, name: name.trim(), phone: phone.trim() }
        : { choice: 'existing', customerId: selection };
    }
    this.formError.set('');
    this.saving.set(true);
    this.http.post<{ kind: InvitationKind; workshopId: string | null }>('/api/invitations/accept', body)
      .pipe(switchMap((result) => this.auth.restore().pipe(map(() => result))), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (result.kind === InvitationKind.Customer) { this.completed.set(true); this.saving.set(false); return; }
          if (result.workshopId) this.auth.selectWorkshop(result.workshopId);
          void this.router.navigate([result.kind === InvitationKind.Creator ? '/crear-taller' : '/inicio']);
        },
        error: () => { this.saving.set(false); this.error.set('No pudimos confirmar el resultado. Revisa tus sastrerías o vuelve a abrir el enlace original.'); },
      });
  }

  protected logout(): void {
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => void this.router.navigate(['/']),
      error: () => this.error.set('No pudimos cerrar la sesión. Inténtalo nuevamente.'),
    });
  }
}
