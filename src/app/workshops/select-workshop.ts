import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-select-workshop',
  imports: [RouterLink],
  template: `
    <main class="page">
      <section class="card" aria-labelledby="title">
        <h1 id="title">Selecciona una sastrería</h1>
        <p class="intro">Elige la sastrería con la que deseas trabajar. Podrás cambiarla cuando lo necesites.</p>
        <div class="stack">
          @for (workshop of auth.session()?.workshops; track workshop.id) {
            <button type="button" class="secondary workshop" (click)="select(workshop.id)">
              <span>{{ workshop.name }}</span><span aria-hidden="true">→</span>
            </button>
          } @empty {
            <p>No tienes sastrerías asociadas todavía.</p>
          }
        </div>
        @if (auth.currentWorkshop() || (auth.session()?.workshops?.length ?? 0) <= 1) {
          <div class="actions"><a routerLink="/inicio">Volver al inicio</a></div>
        }
        <div class="actions"><button type="button" class="secondary" [disabled]="loggingOut()" (click)="logout()">Cerrar sesión</button></div>
        @if (error()) { <p class="message" role="alert">{{ error() }}</p> }
      </section>
    </main>
  `,
  styleUrl: './workshops.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectWorkshop {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loggingOut = signal(false);
  protected readonly error = signal('');

  protected select(id: string): void {
    if (this.auth.selectWorkshop(id)) void this.router.navigate(['/inicio']);
  }

  protected logout(): void {
    this.loggingOut.set(true);
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => void this.router.navigate(['/']),
      error: () => { this.loggingOut.set(false); this.error.set('No pudimos cerrar la sesión. Inténtalo nuevamente.'); },
    });
  }
}
