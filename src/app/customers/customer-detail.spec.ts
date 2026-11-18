import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService, AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { CustomerDetail } from './customer-detail';

describe('CustomerDetail', () => {
  const url = '/api/workshops/workshop-id/customers/customer-id';
  const measurements = { waist: 72.5, hip: 98, totalLength: 102, kneeWidth: 22, hemWidth: 20, rise: 29 };
  const customer = {
    id: 'customer-id', name: 'Cliente de prueba', phone: '8095550100',
    email: null, documentNumber: null, createdAt: '2026-01-01T00:00:00Z',
    measurementCatalog: [
      { id: 'womens_trousers', label: 'Pantalón',
        fields: Object.keys(measurements).map((key) => ({ key, label: key })) },
      { id: 'shirts', label: 'Camisas',
        fields: [{ key: 'backLength', label: 'Largo de espalda' }, { key: 'front', label: 'Delantera' }] },
    ],
  };
  let http: HttpTestingController;

  beforeEach(() => {
    const session = signal<AuthenticatedSession | null>({
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false,
      canCreateWorkshop: false,
      workshops: [{ id: 'workshop-id', name: 'Test', role: MembershipRole.Owner }],
    });
    TestBed.configureTestingModule({
      imports: [CustomerDetail],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: AuthService, useValue: { session, currentWorkshop: () => session()?.workshops[0] ?? null } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ customerId: 'customer-id' })) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function initialLoad(): void {
    http.expectOne(url).flush(customer);
    http.expectOne((entry) => entry.url === `${url}/measurements`).flush({ versions: [], hasMore: false });
    http.expectOne((entry) => entry.url === `${url}/measurement-submissions`).flush({ submission: null });
  }

  function fillForm(element: HTMLElement): void {
    for (const [key, value] of Object.entries(measurements)) {
      const input = element.querySelector<HTMLInputElement>(`#${key}`)!;
      input.value = String(value);
      input.dispatchEvent(new Event('input'));
    }
    const confirm = element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
  }

  it('requires all measurements and confirmation before creating a verified version', () => {
    const fixture = TestBed.createComponent(CustomerDetail);
    fixture.detectChanges();
    initialLoad();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Completa todas las medidas');
    http.expectNone((request) => request.method === 'POST');
    fillForm(element);
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const request = http.expectOne((entry) => entry.method === 'POST');
    expect(request.request.body).toEqual({ garment: 'womens_trousers', measurements, confirmed: true });
    request.flush({ id: 'version-id', version: 1 });
    http.expectOne(url).flush(customer);
    http.expectOne((entry) => entry.url === `${url}/measurements`).flush({
      versions: [{ id: 'version-id', version: 1, measurements, verifiedAt: '2026-01-02T00:00:00Z', verifiedBy: 'Test' }],
      hasMore: false,
    });
    http.expectOne((entry) => entry.url === `${url}/measurement-submissions`).flush({ submission: null });
    fixture.detectChanges();
    expect(element.textContent).toContain('Versión verificada guardada.');
    expect(element.textContent).toContain('v1');
  });

  it('requires refreshing history after an uncertain save without discarding the form', () => {
    const fixture = TestBed.createComponent(CustomerDetail);
    fixture.detectChanges();
    initialLoad();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    fillForm(element);
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne((entry) => entry.method === 'POST').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    element.querySelector<HTMLButtonElement>('.secondary')!.click();
    http.expectOne((entry) => entry.url === `${url}/measurements`).flush({ versions: [], hasMore: false });
    http.expectOne((entry) => entry.url === `${url}/measurement-submissions`).flush({ submission: null });
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#waist')!.value).toBe('72.5');
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(element.textContent).toContain('Comprueba si la versión ya fue guardada.');
  });

  it('prevents losing unsaved changes when switching garments and loads the selected history', () => {
    const fixture = TestBed.createComponent(CustomerDetail);
    fixture.detectChanges();
    initialLoad();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const waist = element.querySelector<HTMLInputElement>('#waist')!;
    waist.value = '72.5';
    waist.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const select = element.querySelector<HTMLSelectElement>('#garment')!;
    select.value = 'shirts';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(select.value).toBe('womens_trousers');
    expect(select.selectedOptions[0].textContent?.trim()).toBe('Pantalón');
    expect(element.textContent).toContain('Guarda o descarta los cambios');
    http.expectNone(url);
    element.querySelector<HTMLButtonElement>('.discard')!.click();
    select.value = 'shirts';
    select.dispatchEvent(new Event('change'));
    http.expectOne(url).flush(customer);
    const history = http.expectOne((entry) => entry.url === `${url}/measurements`);
    expect(history.request.params.get('garment')).toBe('shirts');
    history.flush({ versions: [], hasMore: false });
    http.expectOne((entry) => entry.url === `${url}/measurement-submissions`).flush({ submission: null });
    fixture.detectChanges();
    expect(element.querySelector('#backLength')).not.toBeNull();
    expect(element.querySelector('#waist')).toBeNull();
    expect(element.querySelector<HTMLSelectElement>('#garment')!.value).toBe('shirts');
  });

  it('switches garments with desktop buttons without losing unsaved changes', () => {
    const fixture = TestBed.createComponent(CustomerDetail);
    fixture.detectChanges();
    initialLoad();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const waist = element.querySelector<HTMLInputElement>('#waist')!;
    waist.value = '72.5';
    waist.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const shirts = element.querySelector<HTMLButtonElement>('[data-garment="shirts"]')!;
    shirts.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Guarda o descarta los cambios');
    expect(waist.value).toBe('72.5');
    expect(shirts.getAttribute('aria-pressed')).toBe('false');
    http.expectNone(url);
    element.querySelector<HTMLButtonElement>('.discard')!.click();
    shirts.click();
    http.expectOne(url).flush(customer);
    const history = http.expectOne((entry) => entry.url === `${url}/measurements`);
    expect(history.request.params.get('garment')).toBe('shirts');
    history.flush({ versions: [], hasMore: false });
    http.expectOne((entry) => entry.url === `${url}/measurement-submissions`).flush({ submission: null });
    fixture.detectChanges();
    expect(element.querySelector('[data-garment="shirts"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelector<HTMLSelectElement>('#garment')!.value).toBe('shirts');
    expect(element.querySelector('#backLength')).not.toBeNull();
  });

  it('shows an explicit error if the customer detail cannot be loaded', () => {
    const fixture = TestBed.createComponent(CustomerDetail);
    fixture.detectChanges();
    http.expectOne(url).flush({}, { status: 404, statusText: 'Not Found' });
    expect(http.expectOne((entry) => entry.url === `${url}/measurements`).cancelled).toBe(true);
    expect(http.expectOne((entry) => entry.url === `${url}/measurement-submissions`).cancelled).toBe(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No pudimos cargar la ficha');
  });

  it('loads customer-submitted measures for explicit workshop verification', () => {
    const fixture = TestBed.createComponent(CustomerDetail);
    fixture.detectChanges();
    http.expectOne(url).flush(customer);
    http.expectOne((entry) => entry.url === `${url}/measurements`).flush({ versions: [], hasMore: false });
    http.expectOne((entry) => entry.url === `${url}/measurement-submissions`).flush({
      submission: { id: 'submission-id', measurements, submittedAt: '2026-01-02T00:00:00Z', submittedBy: 'Cliente' },
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Medidas ingresadas por Cliente');
    expect(element.querySelector<HTMLInputElement>('#waist')!.value).toBe('72.5');
    const confirm = element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const review = http.expectOne(`${url}/measurement-submissions/submission-id/verify`);
    expect(review.request.body).toEqual({ garment: 'womens_trousers', measurements, confirmed: true });
    review.flush({ id: 'version-id', version: 1 });
    initialLoad();
  });
});
