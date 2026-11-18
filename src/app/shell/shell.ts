import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService, MembershipRole } from '../auth/auth.service';

@Component({
  selector: 'app-shell',
  imports: [NgOptimizedImage, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly roles = MembershipRole;
  protected readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly notice = signal('');
  protected readonly loggingOut = signal(false);
  protected readonly moreOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  protected unavailable(section: string): void {
    this.notice.set(section === 'Pagos y cobros'
      ? 'Los cobros y devoluciones se registran desde la ficha de cada orden.'
      : `${section} todavía no está disponible.`);
  }

  protected roleLabel(): string {
    if (this.auth.session()?.platformAdministrator) return 'Administradora';
    switch (this.auth.currentWorkshop()?.role) {
      case MembershipRole.Owner: return 'Propietario';
      case MembershipRole.Manager: return 'Encargado';
      case MembershipRole.Staff: return 'Personal';
      default: return 'Cuenta';
    }
  }

  protected toggleMore(): void {
    this.moreOpen.update((open) => !open);
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected logout(): void {
    this.loggingOut.set(true);
    this.userMenuOpen.set(false);
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => void this.router.navigate(['/']),
      error: () => {
        this.loggingOut.set(false);
        this.notice.set('No pudimos cerrar la sesión. Inténtalo de nuevo.');
      },
    });
  }
}
