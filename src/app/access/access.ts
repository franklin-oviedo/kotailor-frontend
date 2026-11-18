import { NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthenticationError, AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-access',
  imports: [NgOptimizedImage, RouterLink],
  templateUrl: './access.html',
  styleUrl: './access.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Access implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly notice = signal('');
  protected readonly loading = signal(true);
  protected readonly loggingOut = signal(false);

  ngOnInit(): void {
    const error = this.route.snapshot.queryParamMap.get('authError');
    switch (error) {
      case AuthenticationError.Cancelled:
        this.notice.set('Cancelaste el acceso con Google. Puedes intentarlo de nuevo.');
        break;
      case AuthenticationError.InvalidFlow:
        this.notice.set('La solicitud de acceso venció o no es válida. Inténtalo de nuevo.');
        break;
      case AuthenticationError.GoogleUnavailable:
        this.notice.set('No pudimos verificar tu cuenta de Google. Inténtalo de nuevo.');
        break;
      case AuthenticationError.ServerUnavailable:
        this.notice.set('No pudimos conectar con el servidor. Inténtalo de nuevo más tarde.');
        break;
    }
    this.auth.restore().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (session) => {
        this.loading.set(false);
        if (session) void this.router.navigate(['/inicio']);
      },
      error: () => {
        this.loading.set(false);
        this.notice.set('No pudimos conectar con el servidor. Inténtalo de nuevo más tarde.');
      },
    });
  }

  protected logout(): void {
    this.loggingOut.set(true);
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.loggingOut.set(false);
        this.notice.set('Cerraste tu sesión de forma segura.');
      },
      error: () => {
        this.loggingOut.set(false);
        this.notice.set('No pudimos cerrar la sesión. Inténtalo de nuevo.');
      },
    });
  }

  protected showNotice(message: string): void {
    this.notice.set(message);
  }
}
