import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormRecord, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { PortalHeader } from './portal-header';

interface DraftData {
  workshopName: string;
  garment: { id: string; label: string; fields: { key: string; label: string }[] };
  measurements: Record<string, number>;
  revision: number;
}

function centimetres(control: AbstractControl<number | null>): ValidationErrors | null {
  const value = control.value;
  return value === null || (Number.isFinite(value) && value > 0 && value <= 999.99 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8) ? null : { centimetres: true };
}

@Component({
  selector: 'app-measurement-draft',
  imports: [ReactiveFormsModule, PortalHeader, RouterLink],
  templateUrl: './measurement-draft.html',
  styleUrl: './measurement-draft.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeasurementDraft {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly workshopId = this.route.snapshot.paramMap.get('workshopId') ?? '';
  private readonly garment = this.route.snapshot.paramMap.get('garment') ?? '';
  protected readonly data = signal<DraftData | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly reviewing = signal(false);
  protected readonly submitting = signal(false);
  protected readonly conflict = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly loggingOut = signal(false);
  protected readonly form = new FormRecord<FormControl<number | null>>({});

  constructor() { this.load(); }

  private get url(): string {
    return `/api/client/workshops/${encodeURIComponent(this.workshopId)}/measurement-drafts/${encodeURIComponent(this.garment)}`;
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    this.http.get<DraftData>(this.url).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        for (const key of Object.keys(this.form.controls)) this.form.removeControl(key);
        for (const field of data.garment.fields) {
          this.form.addControl(field.key, new FormControl<number | null>(data.measurements[field.key] ?? null, centimetres));
        }
        this.form.markAsPristine();
        this.data.set(data);
        this.conflict.set(false);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.error.set('No pudimos cargar el borrador. Comprueba tu acceso e inténtalo nuevamente.'); },
    });
  }

  protected save(): void {
    const data = this.data();
    if (!data || this.saving() || this.reviewing() || this.submitting() || this.conflict()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('Revisa las medidas indicadas. Usa valores mayores que cero con hasta dos decimales.');
      return;
    }

    const measurements: Record<string, number> = {};
    for (const [key, value] of Object.entries(this.form.getRawValue())) {
      if (value !== null) measurements[key] = value;
    }
    this.error.set('');
    this.notice.set('');
    this.saving.set(true);
    this.http.put<{ revision: number }>(this.url, { measurements, revision: data.revision })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ revision }) => {
          this.data.set({ ...data, revision, measurements });
          this.form.markAsPristine();
          this.saving.set(false);
          this.notice.set('Borrador personal guardado. No se ha compartido con la sastrería.');
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.conflict.set(error.status === 409);
          this.error.set(error.status === 409
            ? 'El borrador cambió en otra sesión. Conserva tus valores antes de descartar y cargar la versión actual.'
            : 'No pudimos guardar el borrador. Comprueba tu acceso e inténtalo nuevamente.');
        },
      });
  }

  protected review(): void {
    const data = this.data();
    if (!data || this.saving() || this.submitting() || this.conflict()) return;
    if (this.form.dirty || data.revision === 0) {
      this.error.set('Guarda el borrador antes de revisarlo y enviarlo.');
      return;
    }
    if (this.form.invalid || Object.keys(data.measurements).length !== data.garment.fields.length) {
      this.error.set('Completa todas las medidas antes de enviar el borrador.');
      return;
    }
    this.error.set('');
    this.notice.set('');
    this.reviewing.set(true);
  }

  protected submit(): void {
    const data = this.data();
    if (!data || !this.reviewing() || this.submitting()) return;
    this.error.set('');
    this.submitting.set(true);
    this.http.post<{ id: string }>(`${this.url}/submit`, { revision: data.revision, confirmed: true })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ id }) => {
          this.submitting.set(false);
          void this.router.navigate(['/portal/medidas/envios', this.workshopId, id]);
        },
        error: (error: HttpErrorResponse) => {
          this.submitting.set(false);
          this.error.set(error.status === 409
            ? 'El borrador cambió o hay otro envío pendiente de revisión. Vuelve a mis medidas para consultar su estado.'
            : 'No pudimos confirmar el envío. Puedes intentarlo nuevamente sin duplicarlo.');
        },
      });
  }

  protected discard(): void {
    const data = this.data();
    if (!data || this.saving()) return;
    if (this.conflict()) {
      this.load();
      return;
    }
    this.form.reset(data.measurements);
    this.notice.set('Cambios descartados.');
    this.error.set('');
  }

  canLeave(): boolean {
    if (this.form.dirty || this.saving() || this.submitting()) {
      this.error.set('Guarda o descarta los cambios antes de salir.');
      return false;
    }
    return true;
  }

  protected unavailable(section: string): void {
    this.notice.set(`${section} todavía no está disponible.`);
  }

  protected logout(): void {
    if (this.loggingOut() || !this.canLeave()) return;
    this.loggingOut.set(true);
    this.auth.logout().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => void this.router.navigate(['/portal']),
      error: () => { this.loggingOut.set(false); this.notice.set('No pudimos cerrar la sesión. Inténtalo nuevamente.'); },
    });
  }
}
