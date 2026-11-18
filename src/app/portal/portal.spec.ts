import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { clientPortalGuard } from '../auth/auth.guard';
import { PortalAccess } from './portal-access';
import { PortalHome } from './portal-home';
import { PortalMeasurements } from './portal-measurements';
import { MeasurementDraft } from './measurement-draft';
import { MeasurementSubmission } from './measurement-submission';

describe('Portal del cliente', () => {
  const session = {
    user: { id: 'user-id', name: 'Usuario', email: 'test@example.invalid' },
    workshops: [{ id: 'admin-workshop', name: 'Sastrería', role: 'owner' }],
    platformAdministrator: false, canCreateWorkshop: false,
  };

  it('requires a customer link even when the account administers a workshop', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() => clientPortalGuard(router.routerState.snapshot.root, router.routerState.snapshot));
    if (!isObservable(result)) throw new Error('Expected an observable guard');
    const access = firstValueFrom(result);
    http.expectOne('/api/auth/me').flush(session);
    http.expectOne('/api/client/workshops').flush({}, { status: 403, statusText: 'Forbidden' });
    const destination = await access;
    expect(destination).toBeInstanceOf(UrlTree);
    if (!(destination instanceof UrlTree)) throw new Error('Expected a redirect');
    expect(router.serializeUrl(destination)).toBe('/portal?access=denied');
    http.verify();
  });

  it('allows an administrator linked as a customer to access their own portal', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() => clientPortalGuard(router.routerState.snapshot.root, router.routerState.snapshot));
    if (!isObservable(result)) throw new Error('Expected an observable guard');
    const access = firstValueFrom(result);
    http.expectOne('/api/auth/me').flush(session);
    http.expectOne('/api/client/workshops').flush({ workshops: [{ id: 'customer-workshop' }], hasMore: false });
    expect(await access).toBe(true);
    http.verify();
  });

  it('distinguishes a server error from an unlinked account', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() => clientPortalGuard(router.routerState.snapshot.root, router.routerState.snapshot));
    if (!isObservable(result)) throw new Error('Expected an observable guard');
    const access = firstValueFrom(result);
    http.expectOne('/api/auth/me').flush(session);
    http.expectOne('/api/client/workshops').flush({}, { status: 503, statusText: 'Unavailable' });
    const destination = await access;
    if (!(destination instanceof UrlTree)) throw new Error('Expected a redirect');
    expect(router.serializeUrl(destination)).toBe('/portal?authError=server_unavailable');
    http.verify();
  });

  it('explains denied customer access without redirecting in a loop', () => {
    TestBed.configureTestingModule({
      imports: [PortalAccess],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ access: 'denied' }) } } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(PortalAccess);
    fixture.detectChanges();
    http.expectOne('/api/auth/me').flush(session);
    fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('no está vinculada como cliente');
    expect(fixture.nativeElement.querySelector('.workshop-access')?.textContent).toContain('Acceso de la sastrería');
    http.verify();
  });

  it('offers Google access after restoring an unauthenticated session', () => {
    TestBed.configureTestingModule({
      imports: [PortalAccess],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PortalAccess);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Comprobando sesión');
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a.google')?.getAttribute('href')).toBe('/api/auth/google/client');
    http.verify();
  });

  it('shows loading, errors, retry and an empty workshop list', () => {
    TestBed.configureTestingModule({
      imports: [PortalHome],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PortalHome);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Cargando tus sastrerías');
    http.expectOne('/api/client/workshops').flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar');
    element.querySelector<HTMLButtonElement>('.text-button')!.click();
    http.expectOne('/api/client/workshops').flush({ workshops: [], hasMore: false });
    fixture.detectChanges();
    expect(element.textContent).toContain('Aún no tienes una sastrería vinculada');
    expect(element.querySelector('.actions')).toBeNull();
    http.verify();
  });

  it('requires workshop selection and explains unavailable actions', () => {
    TestBed.configureTestingModule({
      imports: [PortalHome],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PortalHome);
    fixture.detectChanges();
    http.expectOne('/api/client/workshops').flush({
      workshops: [{ id: 'one', name: 'Primera sastrería' }, { id: 'two', name: 'Segunda sastrería' }],
      hasMore: true,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('No se muestran todas tus sastrerías');
    expect(element.querySelector('.actions')).toBeNull();
    const select = element.querySelector<HTMLSelectElement>('#client-workshop')!;
    select.value = 'two';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(element.querySelector('.welcome')?.textContent).toContain('Segunda sastrería');
    expect(element.querySelector<HTMLAnchorElement>('a.action-card')?.getAttribute('href'))
      .toContain('/portal/citas?taller=two');
    element.querySelector<HTMLButtonElement>('button.action-card')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Crear orden de compra todavía no está disponible');
    http.verify();
  });

  it('selects a single workshop and handles logout failure and success', () => {
    TestBed.configureTestingModule({
      imports: [PortalHome],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(PortalHome);
    fixture.detectChanges();
    http.expectOne('/api/client/workshops').flush({ workshops: [{ id: 'one', name: 'Sastrería' }], hasMore: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.welcome')?.textContent).toContain('Sastrería');
    const button = element.querySelector<HTMLButtonElement>('.user button')!;
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    http.expectOne('/api/auth/logout').flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(element.textContent).toContain('No pudimos cerrar la sesión');
    expect(button.disabled).toBe(false);
    button.click();
    http.expectOne('/api/auth/logout').flush(null);
    expect(navigate).toHaveBeenCalledWith(['/portal']);
    http.verify();
  });

  it('only shows measurements for the selected workshop and handles retry', () => {
    TestBed.configureTestingModule({
      imports: [PortalMeasurements],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PortalMeasurements);
    fixture.detectChanges();
    http.expectOne('/api/client/workshops').flush({
      workshops: [{ id: 'one', name: 'Primera sastrería' }, { id: 'two', name: 'Segunda sastrería' }], hasMore: false,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Selecciona una sastrería');
    const select = element.querySelector<HTMLSelectElement>('#measurement-workshop')!;
    select.value = 'one';
    select.dispatchEvent(new Event('change'));
    const first = http.expectOne('/api/client/workshops/one/measurements');
    select.value = 'two';
    select.dispatchEvent(new Event('change'));
    expect(first.cancelled).toBe(true);
    http.expectOne('/api/client/workshops/two/measurements').flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar tus medidas');
    element.querySelector<HTMLButtonElement>('.text-button')!.click();
    http.expectOne('/api/client/workshops/two/measurements').flush({
      catalog: [
        { id: 'trousers', label: 'Pantalón', fields: [{ key: 'waist', label: 'Cintura' }] },
        { id: 'shirts', label: 'Camisas', fields: [{ key: 'neck', label: 'Cuello' }] },
      ],
      versions: [{ garment: 'trousers', version: 2, measurements: { waist: 75 }, verifiedAt: '2026-01-02T15:00:00Z' }],
      drafts: [{ garment: 'trousers', updatedAt: '2026-01-02T15:00:00Z' }],
      submissions: [],
    });
    fixture.detectChanges();
    expect(element.textContent).toContain('Versión 2 · Verificada por la sastrería');
    expect(element.textContent).toContain('75 cm');
    expect(element.textContent).toContain('Sin medidas verificadas');
    expect(element.textContent).toContain('Borrador personal · No verificado');
    expect(element.textContent).toContain('02/01/2026 11:00');
    http.verify();
  });

  it('saves incomplete personal drafts and blocks navigation with unsaved edits', () => {
    TestBed.configureTestingModule({
      imports: [MeasurementDraft],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ workshopId: 'one', garment: 'trousers' }) } } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MeasurementDraft);
    fixture.detectChanges();
    const url = '/api/client/workshops/one/measurement-drafts/trousers';
    http.expectOne(url).flush({
      workshopName: 'Sastrería', garment: { id: 'trousers', label: 'Pantalón', fields: [
        { key: 'waist', label: 'Cintura' }, { key: 'hip', label: 'Bacinete' },
      ] }, revision: 0, measurements: {},
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('#waist')!;
    input.value = '72.5';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.canLeave()).toBe(false);
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const save = http.expectOne(url);
    expect(save.request.body).toEqual({ revision: 0, measurements: { waist: 72.5 } });
    save.flush({ revision: 1 });
    fixture.detectChanges();
    expect(fixture.componentInstance.canLeave()).toBe(true);
    expect(element.textContent).toContain('No se ha compartido con la sastrería');
    element.querySelector<HTMLButtonElement>('aside .primary')!.click();
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Completa todas las medidas');
    http.expectNone(`${url}/submit`);
    input.value = '80';
    input.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne(url).flush({}, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('cambió en otra sesión');
    expect(input.value).toBe('80');
    expect(fixture.componentInstance.canLeave()).toBe(false);
    http.verify();
  });

  it('reviews a complete saved draft before explicitly submitting it', () => {
    TestBed.configureTestingModule({
      imports: [MeasurementDraft],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ workshopId: 'one', garment: 'trousers' }) } } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(MeasurementDraft);
    fixture.detectChanges();
    const url = '/api/client/workshops/one/measurement-drafts/trousers';
    http.expectOne(url).flush({
      workshopName: 'Sastrería', garment: { id: 'trousers', label: 'Pantalón', fields: [{ key: 'waist', label: 'Cintura' }] },
      revision: 2, measurements: { waist: 72.5 },
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('aside .primary')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.review')?.textContent).toContain('72.5 cm');
    http.expectNone(`${url}/submit`);
    element.querySelector<HTMLButtonElement>('.review .primary')!.click();
    const sent = http.expectOne(`${url}/submit`);
    expect(sent.request.body).toEqual({ revision: 2, confirmed: true });
    sent.flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('intentarlo nuevamente');
    element.querySelector<HTMLButtonElement>('.review .primary')!.click();
    const retry = http.expectOne(`${url}/submit`);
    expect(retry.request.body).toEqual({ revision: 2, confirmed: true });
    retry.flush({ id: 'sent-id' });
    expect(navigate).toHaveBeenCalledWith(['/portal/medidas/envios', 'one', 'sent-id']);
    http.verify();
  });

  it('shows the receipt and distinguishes a pending submission from a verified one', () => {
    TestBed.configureTestingModule({
      imports: [MeasurementSubmission],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ workshopId: 'one', submissionId: 'sent-id' }) } } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MeasurementSubmission);
    fixture.detectChanges();
    http.expectOne('/api/client/workshops/one/measurement-submissions/sent-id').flush({
      workshopName: 'Sastrería', garment: 'trousers', measurements: { waist: 72.5 },
      submittedAt: '2026-01-02T15:00:00Z', verified: false,
      catalog: [{ id: 'trousers', label: 'Pantalón', fields: [{ key: 'waist', label: 'Cintura' }] }],
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Pendiente de revisión');
    expect(element.querySelector('details dl')?.textContent).toContain('72.5 cm');
    expect(element.textContent).not.toContain('Revisadas por la sastrería');
    element.querySelector<HTMLButtonElement>('.actions .secondary')!.click();
    fixture.detectChanges();
    expect(element.querySelector('[role="status"]')?.textContent).toContain('todavía no está disponible');
    http.verify();
  });
});
