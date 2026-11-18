import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-create-workshop',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="page">
      <section class="card" aria-labelledby="title">
        <h1 id="title">Crea tu sastrería</h1>
        @if (loading()) {
          <p role="status">Comprobando autorización…</p>
        } @else if (canCreate()) {
          <p class="intro">Indica el nombre comercial de tu sastrería para comenzar.</p>
          <form (submit)="create(); $event.preventDefault()" novalidate>
            <label for="workshop-name">Nombre comercial de la sastrería
              <input id="workshop-name" [formControl]="name" maxlength="200" autocomplete="organization" required />
            </label>
            @if (name.touched && name.invalid) { <p class="message" role="alert">Escribe un nombre comercial de entre 2 y 200 caracteres.</p> }
            <button type="submit" [disabled]="saving()">{{ saving() ? 'Creando…' : 'Crear sastrería' }}</button>
          </form>
        } @else {
          <p class="intro">No tienes una autorización disponible para crear una sastrería.</p>
        }
        @if (error()) { <p class="message" role="alert">{{ error() }}</p> }
        <div class="actions"><a routerLink="/inicio">Volver al inicio</a></div>
      </section>
    </main>
  `,
  styleUrl: './workshops.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateWorkshop {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly canCreate = signal(false);
  protected readonly error = signal('');
  protected readonly name = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(200), Validators.pattern(/.*\S.*/)] });

  constructor() {
    this.http.get<{ canCreate: boolean }>('/api/workshops/creation-permission')
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => { this.canCreate.set(result.canCreate); this.loading.set(false); },
        error: () => { this.loading.set(false); this.error.set('No pudimos comprobar tu autorización. Inténtalo más tarde.'); },
      });
  }

  protected create(): void {
    this.name.markAsTouched();
    if (this.name.value.trim().length < 2) this.name.setErrors({ trimmedLength: true });
    if (this.name.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.http.post<{ id: string }>('/api/workshops', { name: this.name.value.trim() }).pipe(
      switchMap((workshop) => this.auth.restore().pipe(switchMap(() => [workshop]))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (workshop) => { this.auth.selectWorkshop(workshop.id); void this.router.navigate(['/inicio']); },
      error: () => { this.saving.set(false); this.error.set('No pudimos confirmar el resultado. Revisa si la sastrería aparece en tu cuenta antes de volver a intentarlo.'); },
    });
  }
}
