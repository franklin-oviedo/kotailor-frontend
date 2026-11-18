import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { PortalHeader } from './portal-header';

interface Workshop { id: string; name: string }
interface WorkshopList { workshops: Workshop[]; hasMore: boolean }
interface MeasurementField { key: string; label: string }
interface Garment { id: string; label: string; fields: MeasurementField[] }
interface MeasurementVersion {
  garment: string;
  version: number;
  measurements: Record<string, number>;
  verifiedAt: string;
}
interface MeasurementResponse {
  catalog: Garment[];
  versions: MeasurementVersion[];
  drafts: { garment: string; updatedAt: string }[];
  submissions: { id: string; garment: string; submittedAt: string; verified: boolean }[];
}

@Component({
  selector: 'app-portal-measurements',
  imports: [DatePipe, PortalHeader, RouterLink],
  templateUrl: './portal-measurements.html',
  styleUrl: './portal-measurements.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalMeasurements {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private measurementsRequest?: Subscription;
  protected readonly workshops = signal<Workshop[]>([]);
  protected readonly selectedId = signal('');
  protected readonly hasMore = signal(false);
  protected readonly data = signal<MeasurementResponse | null>(null);
  protected readonly loadingWorkshops = signal(true);
  protected readonly loadingMeasurements = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly loggingOut = signal(false);

  constructor() {
    this.loadWorkshops();
    this.destroyRef.onDestroy(() => this.measurementsRequest?.unsubscribe());
  }

  protected loadWorkshops(): void {
    this.loadingWorkshops.set(true);
    this.error.set('');
    this.http.get<WorkshopList>('/api/client/workshops').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.workshops.set(result.workshops);
        this.hasMore.set(result.hasMore);
        const requested = this.route.snapshot.queryParamMap.get('taller');
        const id = result.workshops.find((workshop) => workshop.id === requested)?.id ??
          (result.workshops.length === 1 ? result.workshops[0].id : '');
        this.selectedId.set(id);
        this.loadingWorkshops.set(false);
        if (id) this.loadMeasurements();
      },
      error: () => {
        this.loadingWorkshops.set(false);
        this.error.set('No pudimos cargar tus sastrerías. Inténtalo nuevamente.');
      },
    });
  }

  protected selectWorkshop(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.measurementsRequest?.unsubscribe();
    this.selectedId.set(target.value);
    this.data.set(null);
    this.error.set('');
    this.loadingMeasurements.set(false);
    if (this.workshops().some((workshop) => workshop.id === target.value)) this.loadMeasurements();
  }

  protected loadMeasurements(): void {
    const id = this.selectedId();
    if (!this.workshops().some((workshop) => workshop.id === id)) return;
    this.measurementsRequest?.unsubscribe();
    this.data.set(null);
    this.error.set('');
    this.loadingMeasurements.set(true);
    this.measurementsRequest = this.http.get<MeasurementResponse>(
      `/api/client/workshops/${encodeURIComponent(id)}/measurements`,
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.data.set(data); this.loadingMeasurements.set(false); },
      error: () => {
        this.loadingMeasurements.set(false);
        this.error.set('No pudimos cargar tus medidas. Comprueba tu acceso e inténtalo nuevamente.');
      },
    });
  }

  protected version(garment: string): MeasurementVersion | undefined {
    return this.data()?.versions.find((item) => item.garment === garment);
  }

  protected hasDraft(garment: string): boolean {
    return this.data()?.drafts.some((item) => item.garment === garment) ?? false;
  }

  protected submission(garment: string) {
    return this.data()?.submissions.find((item) => item.garment === garment);
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
