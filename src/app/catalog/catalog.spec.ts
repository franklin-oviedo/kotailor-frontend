import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, of } from 'rxjs';
import { routes } from '../app.routes';
import { AuthService, AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { Catalog } from './catalog';

describe('Catalog navigation', () => {
  it('opens the guarded Prendas route from the desktop sidebar and loads the selected workshop catalog', async () => {
    const workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Staff };
    const session: AuthenticatedSession = {
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false, canCreateWorkshop: false, workshops: [workshop],
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        provideRouter([{ path: '', component: Shell }, ...routes.filter((route) => route.path === 'prendas')]),
        { provide: AuthService, useValue: { session: signal(session), currentWorkshop: () => workshop, restore: () => of(session) } },
      ],
    });
    const harness = await RouterTestingHarness.create('/');
    const sidebar = () => harness.routeNativeElement?.querySelector<HTMLAnchorElement>('.sidebar a[href="/prendas"]');
    const opened = firstValueFrom(TestBed.inject(Router).events.pipe(filter((event) => event instanceof NavigationEnd)));
    expect(sidebar()?.textContent?.trim()).toBe('Prendas');
    sidebar()!.click();
    await opened;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/workshops/workshop-id/catalog')
      .flush({ items: [], hasMore: false, measurementCatalog: [] });
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Prendas');
    expect(sidebar()?.getAttribute('aria-current')).toBe('page');
    http.verify();
  });
});

describe('Catalog', () => {
  const session = signal<AuthenticatedSession | null>({
    user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
    platformAdministrator: false,
    canCreateWorkshop: false,
    workshops: [{ id: 'workshop-id', name: 'Test', role: MembershipRole.Owner }],
  });
  let http: HttpTestingController;
  const response = {
    items: [], hasMore: false,
    measurementCatalog: [{ id: 'shirts', label: 'Camisas', fields: [{ key: 'neck', label: 'Cuello' }] }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Catalog],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: AuthService, useValue: { session, currentWorkshop: () => session()?.workshops[0] ?? null } }],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('saves exact cents and selected measurement templates', async () => {
    const fixture = TestBed.createComponent(Catalog);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.method === 'GET').flush(response);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.desktop-add')!.click();
    fixture.detectChanges();
    const setValue = (selector: string, value: string) => {
      const input = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
    };
    setValue('#catalog-name', ' Camisa ');
    setValue('#catalog-category', 'tailoring');
    setValue('#catalog-price', '16000.10');
    setValue('#catalog-tax', 'taxable');
    element.querySelector<HTMLButtonElement>('.configure')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLInputElement>('.checkbox input')!.click();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const create = http.expectOne((request) => request.method === 'POST');
    expect(create.request.body).toEqual({
      name: 'Camisa', category: 'tailoring', basePriceCents: 1600010,
      taxTreatment: 'taxable', measurementGarments: ['shirts'], instructions: '',
    });
    create.flush({ id: 'item-id' });
    http.expectOne((request) => request.method === 'GET').flush({
      ...response,
      items: [{ id: 'item-id', ...create.request.body, revision: 1 }],
    });
    fixture.detectChanges();
    expect(element.textContent).toContain('Prenda o servicio guardado.');
    expect(element.textContent).toContain('Camisa');
  });

  it('preserves edits on a conflict and refreshes the list when canceled', async () => {
    const item = {
      id: 'item-id', name: 'Camisa', category: 'tailoring', basePriceCents: 1600010,
      taxTreatment: 'taxable', measurementGarments: ['shirts'], instructions: 'Detalle', revision: 1,
    };
    const fixture = TestBed.createComponent(Catalog);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.method === 'GET').flush({ ...response, items: [item] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.item')!.click();
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('#catalog-price')!.value).toBe('16000.10');
    expect(element.textContent).toContain('Camisas · 1 campos');
    const name = element.querySelector<HTMLInputElement>('#catalog-name')!;
    name.value = 'Camisa modificada';
    name.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const update = http.expectOne((request) => request.method === 'PATCH');
    expect(update.request.body).toMatchObject({ name: 'Camisa modificada', revision: 1, basePriceCents: 1600010 });
    update.flush({}, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(element.textContent).toContain('cambió en otra sesión');
    expect(name.value).toBe('Camisa modificada');
    element.querySelector<HTMLButtonElement>('.secondary')!.click();
    http.expectOne((request) => request.method === 'GET').flush({ ...response, items: [{ ...item, revision: 2 }] });
    fixture.detectChanges();
    expect(element.textContent).toContain('Camisa');
  });

  it('updates an existing item and reloads the catalog', async () => {
    const item = {
      id: 'item-id', name: 'Camisa', category: 'tailoring', basePriceCents: 1600010,
      taxTreatment: 'taxable', measurementGarments: ['shirts'], instructions: '', revision: 1,
    };
    const fixture = TestBed.createComponent(Catalog);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.method === 'GET').flush({ ...response, items: [item] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.item')!.click();
    fixture.detectChanges();
    const price = element.querySelector<HTMLInputElement>('#catalog-price')!;
    price.value = '4.09';
    price.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const update = http.expectOne((request) => request.method === 'PATCH');
    expect(update.request.url).toBe('/api/workshops/workshop-id/catalog/item-id');
    expect(update.request.body).toMatchObject({ basePriceCents: 409, revision: 1 });
    update.flush({ id: item.id });
    http.expectOne((request) => request.method === 'GET')
      .flush({ ...response, items: [{ ...item, basePriceCents: 409, revision: 2 }] });
    fixture.detectChanges();
    expect(element.textContent).toContain('Prenda o servicio actualizado.');
  });

  it('shows loading errors and prevents creating with an unavailable catalog', async () => {
    const fixture = TestBed.createComponent(Catalog);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.method === 'GET')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('No pudimos cargar');
    expect(element.querySelector<HTMLButtonElement>('.desktop-add')!.disabled).toBe(true);
  });
});
