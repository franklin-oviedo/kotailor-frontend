import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Customers } from './customers';

describe('Customers', () => {
  const session = signal<AuthenticatedSession | null>({
    user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
    platformAdministrator: false,
    canCreateWorkshop: false,
    workshops: [{ id: 'workshop-id', name: 'Test', role: MembershipRole.Owner }],
  });
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Customers],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: AuthService, useValue: { session, currentWorkshop: () => session()?.workshops[0] ?? null } }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('updates both the selector and rows when switching from 10 to 25 and back to 10', async () => {
    const fixture = TestBed.createComponent(Customers);
    const element = fixture.nativeElement as HTMLElement;
    const selector = () => element.querySelector<HTMLSelectElement>('app-pagination select')!;
    const listUrl = '/api/workshops/workshop-id/customers?search=&page=1&pageSize=';
    const renderPage = (pageSize: number) => {
      http.expectOne(`${listUrl}${pageSize}`).flush({
        customers: Array.from({ length: pageSize }, (_, index) => ({
          id: `customer-${index + 1}`, name: `Cliente #${index + 1}`, phone: '8095550100', kind: 'person',
        })),
        pagination: { page: 1, pageSize, total: 40 },
      });
      http.expectNone((request) => request.url === '/api/workshops/workshop-id/customers');
      fixture.detectChanges();
      expect(selector().value).toBe(String(pageSize));
      expect(element.textContent).toContain(`Cliente #${pageSize}`);
      expect(element.textContent).not.toContain(`Cliente #${pageSize + 1}`);
    };
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    renderPage(10);
    loadDetail('customer-1');
    fixture.detectChanges();
    for (const size of [25, 10]) {
      selector().value = String(size);
      selector().dispatchEvent(new Event('change', { bubbles: true }));
      renderPage(size);
    }
  });

  function loadDetail(id: string): void {
    const url = `/api/workshops/workshop-id/customers/${id}`;
    http.expectOne(url).flush({
      id, name: `Cliente ${id}`, phone: '8095550100', email: null, documentNumber: null,
      createdAt: '2026-01-01T00:00:00Z',
      measurementCatalog: [{ id: 'womens_trousers', label: 'Pantalón', fields: [{ key: 'waist', label: 'Cintura' }] }],
    });
    http.expectOne((request) => request.url === `${url}/measurements`).flush({ versions: [], hasMore: false });
    http.expectOne((request) => request.url === `${url}/measurement-submissions`).flush({ submission: null });
  }

  it('creates a customer and reloads the workshop list', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.url === '/api/workshops/workshop-id/customers')
      .flush({ customers: [], hasMore: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Todavía no hay clientes registrados.');
    element.querySelector<HTMLButtonElement>('.desktop-add')!.click();
    fixture.detectChanges();
    const name = element.querySelector<HTMLInputElement>('#customer-name')!;
    const phone = element.querySelector<HTMLInputElement>('#customer-phone')!;
    name.value = ' Cliente de prueba ';
    name.dispatchEvent(new Event('input'));
    phone.value = '8095550100';
    phone.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const create = http.expectOne((request) => request.method === 'POST');
    expect(create.request.body).toMatchObject({
      name: 'Cliente de prueba', phone: '8095550100', email: null,
      documentKind: null, documentNumber: null, contactAuthorized: false,
    });
    create.flush({ id: 'customer-id', name: 'Cliente de prueba', phone: '8095550100', kind: 'person' });
    http.expectOne((request) => request.method === 'GET').flush({
      customers: [{ id: 'customer-id', name: 'Cliente de prueba', phone: '8095550100', kind: 'person' }],
      hasMore: false,
    });
    fixture.detectChanges();
    loadDetail('customer-id');
    fixture.detectChanges();
    expect(element.textContent).toContain('Cliente guardado.');
    expect(element.textContent).toContain('Cliente de prueba');
  });

  it('shows a selected customer and protects unsaved measures when changing the selection', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne('/api/workshops/workshop-id/customers?search=&page=1&pageSize=10').flush({
      customers: [
        { id: 'first', name: 'Primero', phone: '8095550100', kind: 'person' },
        { id: 'second', name: 'Segundo', phone: '8095550101', kind: 'person' },
      ], hasMore: false,
    });
    fixture.detectChanges();
    loadDetail('first');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const buttons = element.querySelectorAll<HTMLButtonElement>('.desktop-customer');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    const waist = element.querySelector<HTMLInputElement>('#waist')!;
    waist.value = '72.5';
    waist.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttons[1].click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Hay cambios en la ficha');
    expect(element.querySelector<HTMLInputElement>('#waist')!.value).toBe('72.5');
    expect(fixture.componentInstance.canLeave()).toBe(false);
    http.expectNone('/api/workshops/workshop-id/customers/second');
    element.querySelector<HTMLButtonElement>('.discard')!.click();
    fixture.detectChanges();
    buttons[1].click();
    fixture.detectChanges();
    loadDetail('second');
    fixture.detectChanges();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(element.textContent).toContain('Cliente second');
    expect(fixture.componentInstance.canLeave()).toBe(true);
  });

  it('cancels the previous detail request when selecting another customer while loading', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne('/api/workshops/workshop-id/customers?search=&page=1&pageSize=10').flush({
      customers: [
        { id: 'first', name: 'Primero', phone: '8095550100', kind: 'person' },
        { id: 'second', name: 'Segundo', phone: '8095550101', kind: 'person' },
      ], hasMore: false,
    });
    fixture.detectChanges();
    const firstDetail = http.expectOne('/api/workshops/workshop-id/customers/first');
    const firstHistory = http.expectOne((request) => request.url.endsWith('/first/measurements'));
    const firstSubmission = http.expectOne((request) => request.url.endsWith('/first/measurement-submissions'));
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.desktop-customer')[1].click();
    fixture.detectChanges();
    expect(firstDetail.cancelled).toBe(true);
    expect(firstHistory.cancelled).toBe(true);
    expect(firstSubmission.cancelled).toBe(true);
    loadDetail('second');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Cliente second');
  });

  it('shows loading errors rather than an empty success state', async () => {
    const fixture = TestBed.createComponent(Customers);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.url === '/api/workshops/workshop-id/customers')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('No pudimos cargar los clientes');
    expect(element.textContent).not.toContain('Todavía no hay clientes registrados.');
  });
});
