import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PortalHeader } from './portal-header';

interface Submission {
  garment: string;
  measurements: Record<string, number>;
  submittedAt: string;
  verified: boolean;
  workshopName: string;
  catalog: { id: string; label: string; fields: { key: string; label: string }[] }[];
}

@Component({
  selector: 'app-measurement-submission',
  imports: [DatePipe, PortalHeader, RouterLink],
  templateUrl: './measurement-submission.html',
  styleUrl: './measurement-submission.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeasurementSubmission {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly workshopId = this.route.snapshot.paramMap.get('workshopId') ?? '';
  private readonly submissionId = this.route.snapshot.paramMap.get('submissionId') ?? '';
  protected readonly data = signal<Submission | null>(null);
  protected readonly garment = computed(() => this.data()?.catalog.find((item) => item.id === this.data()?.garment));
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly loggingOut = signal(false);

  constructor() { this.load(); }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.http.get<Submission>(`/api/client/workshops/${encodeURIComponent(this.workshopId)}/measurement-submissions/${encodeURIComponent(this.submissionId)}`)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (data) => { this.data.set(data); this.loading.set(false); },
        error: () => { this.loading.set(false); this.error.set('No pudimos cargar el envío. Comprueba tu acceso e inténtalo nuevamente.'); },
      });
  }

  protected unavailable(section: string): void { this.notice.set(`${section} todavía no está disponible.`); }

  protected logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => void this.router.navigate(['/portal']),
      error: () => { this.loggingOut.set(false); this.notice.set('No pudimos cerrar la sesión. Inténtalo nuevamente.'); },
    });
  }
}
