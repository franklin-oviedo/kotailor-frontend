import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService, AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Orders } from './orders';

describe('Orders', () => {
  const session = signal<AuthenticatedSession | null>({
    user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
    platformAdministrator: false,
    canCreateWorkshop: false,
    workshops: [{ id: 'workshop-id', name: 'Test', role: MembershipRole.Owner }],
  });
  const settings = { role: MembershipRole.Owner, itbisBasisPoints: null, members: [{ id: 'user-id', name: 'Test' }] };
  const customer = { id: 'customer-id', name: 'Cliente de prueba', phone: '8095550100' };
  const item = {
    id: 'item-id', name: 'Chaqueta', instructions: '', basePriceCents: 1600010,
    taxTreatment: 'taxable', measurementGarments: ['jackets'], revision: 1,
  };
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Orders],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: AuthService, useValue: { session, currentWorkshop: () => session()?.workshops[0] ?? null } }],
    });
  });
  afterEach(() => http.verify());

  it('keeps customer and order details available in each list button', async () => {
    const fixture = TestBed.createComponent(Orders);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush(settings);
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.url.endsWith('/orders')).flush({
      orders: [{ id: 'order-id', number: 12, customerName: customer.name, catalogName: item.name,
        status: 'received', subtotalCents: 1600010, taxCents: null, deliveryLocal: '2026-11-18T15:00' }],
      hasMore: false, counts: { all: 1, production: 1, ready: 0, delivered: 0 },
    });

    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.order')!;
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.textContent).toContain('OT-0012');
    expect(button.textContent).toContain(customer.name);
    expect(button.textContent).toContain('Impuesto pendiente');
  });

  it('searches for the order number passed from production', async () => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ buscar: 'OT-0012' }) } } });
    const fixture = TestBed.createComponent(Orders);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush(settings);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const search = http.expectOne((request) => request.url.endsWith('/orders'));
    expect(search.request.params.get('search')).toBe('OT-0012');
    search.flush({ orders: [], hasMore: false, counts: { all: 0, production: 0, ready: 0, delivered: 0 } });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#order-search')?.value).toBe('OT-0012');
  });

  it('hides status controls from staff', async () => {
    const staffSession = signal<AuthenticatedSession | null>({
      ...session()!, workshops: [{ id: 'workshop-id', name: 'Test', role: MembershipRole.Staff }],
    });
    TestBed.overrideProvider(AuthService, { useValue: { session: staffSession, currentWorkshop: () => staffSession()!.workshops[0] } });
    const fixture = TestBed.createComponent(Orders);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush({ ...settings, role: MembershipRole.Staff });
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.url.endsWith('/orders')).flush({
      orders: [{ id: 'order-id', number: 12, customerName: customer.name, catalogName: item.name, status: 'delivered',
        subtotalCents: 1600010, taxCents: null, deliveryLocal: '2026-11-18T15:00' }],
      hasMore: false, counts: { all: 1, production: 0, ready: 0, delivered: 1 },
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.order')!.click();
    http.expectOne((request) => request.url.endsWith('/orders/order-id')).flush({
      id: 'order-id', number: 12, customerName: customer.name, catalogName: item.name, status: 'delivered',
      subtotalCents: 1600010, taxCents: null, taxBasisPoints: null, instructions: '', taxTreatment: 'taxable',
      deliveryLocal: '2026-11-18T15:00', measurementSnapshots: [], responsibleName: null, createdBy: 'Test',
      createdAt: '2026-11-17T03:30:00Z', history: [], historyHasMore: false,
    });
    fixture.detectChanges();
    expect(element.querySelector('.status-actions')).toBeNull();
  });

  it('offers the previous stage for a delivered order', async () => {
    const fixture = TestBed.createComponent(Orders);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush(settings);
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.url.endsWith('/orders')).flush({
      orders: [{ id: 'order-id', number: 12, customerName: customer.name, catalogName: item.name, status: 'delivered',
        subtotalCents: 1600010, taxCents: null, deliveryLocal: '2026-11-18T15:00' }],
      hasMore: false, counts: { all: 1, production: 0, ready: 0, delivered: 1 },
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.order')!.click();
    http.expectOne((request) => request.url.endsWith('/orders/order-id')).flush({
      id: 'order-id', number: 12, customerName: customer.name, catalogName: item.name, status: 'delivered',
      subtotalCents: 1600010, taxCents: null, taxBasisPoints: null, instructions: '', taxTreatment: 'taxable',
      deliveryLocal: '2026-11-18T15:00', measurementSnapshots: [], responsibleName: null, createdBy: 'Test',
      createdAt: '2026-11-17T03:30:00Z', history: [], historyHasMore: false,
    });
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/orders/order-id/payments'))
      .flush({ totalCents: null, paidCents: 0, payments: [] });
    expect(element.querySelector('.status-actions .secondary')?.textContent).toContain('Lista para entregar');
    expect(element.querySelector('.status-actions .primary')).toBeNull();
  });

  it('warns and creates without calculating tax when no workshop rate exists', async () => {
    const fixture = TestBed.createComponent(Orders);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush(settings);
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.url.endsWith('/orders') && request.method === 'GET')
      .flush({ orders: [], hasMore: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.desktop-add')!.click();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush(settings);
    http.expectOne((request) => request.url.endsWith('/customers'))
      .flush({ customers: [customer], hasMore: false });
    http.expectOne((request) => request.url.endsWith('/catalog')).flush({
      items: [item], hasMore: false,
      measurementCatalog: [{ id: 'jackets', label: 'Chaquetas', fields: [{ key: 'waistWidth', label: 'Cintura' }] }],
    });
    fixture.detectChanges();
    const select = (selector: string, value: string) => {
      const input = element.querySelector<HTMLSelectElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    select('#order-customer', customer.id);
    select('#order-item', item.id);
    http.expectOne((request) => request.url.endsWith('/measurements')).flush({
      versions: [{ id: 'version-id', garment: 'jackets', version: 1, verifiedBy: 'Test' }], hasMore: false,
    });
    fixture.detectChanges();
    expect(element.textContent).toContain('se creará sin calcular ITBIS');
    expect(element.textContent).toContain('Total DOP');
    expect(element.textContent).toContain('Sin calcular');
    select('#measurement-jackets', 'version-id');
    const date = element.querySelector<HTMLInputElement>('#order-delivery')!;
    date.value = '2026-11-18T15:00';
    date.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const create = http.expectOne((request) => request.method === 'POST' && request.url.endsWith('/orders'));
    expect(create.request.body).toEqual({
      requestId: expect.any(String),
      customerId: customer.id, catalogId: item.id, catalogRevision: 1, subtotalCents: 1600010,
      expectedTaxBasisPoints: null, measurementIds: ['version-id'],
      deliveryLocal: '2026-11-18T15:00', responsibleId: null,
    });
    const requestId = create.request.body.requestId;
    create.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element.textContent).toContain('No pudimos crear la orden');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const retry = http.expectOne((request) => request.method === 'POST' && request.url.endsWith('/orders'));
    expect(retry.request.body.requestId).toBe(requestId);
    retry.flush({ id: 'order-id', number: 1 });
    http.expectOne((request) => request.url.endsWith('/orders/order-id')).flush({
      id: 'order-id', number: 1, customerName: customer.name, catalogName: item.name, status: 'received',
      subtotalCents: 1600010, taxCents: null, taxBasisPoints: null, instructions: '', taxTreatment: 'taxable',
      deliveryLocal: '2026-11-18T15:00', measurementSnapshots: [], responsibleName: null, createdBy: 'Test',
      createdAt: '2026-11-17T03:30:00Z', history: [], historyHasMore: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.method === 'GET' && request.url.endsWith('/orders')).flush({ orders: [], hasMore: false });
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/orders/order-id/payments'))
      .flush({ totalCents: null, paidCents: 0, payments: [] });
    fixture.detectChanges();
    expect(element.textContent).toContain('Orden #OT-0001');
    expect(element.textContent).toContain('Orden creada sin cálculo de ITBIS');
    expect(element.querySelector('app-order-production-status [aria-current="step"]')?.textContent).toContain('Recibida');
    expect(element.querySelectorAll('app-order-production-status [aria-current="step"]')).toHaveLength(1);
    expect(element.querySelector('.detail-garment h3')?.textContent).toContain('Chaqueta');
    expect(element.querySelector('.activity time')?.textContent).toContain('16 nov de 2026');
    expect(element.querySelector('.activity time')?.textContent).toContain('11:30');
    expect(element.querySelector('.activity')?.textContent).toContain('Orden creada por Test.');
    const advance = element.querySelector<HTMLButtonElement>('.status-actions .primary')!;
    expect(advance.textContent).toContain('En corte');
    advance.click();
    const statusRequest = http.expectOne((request) => request.method === 'PUT' && request.url.endsWith('/orders/order-id/status'));
    expect(statusRequest.request.body).toEqual({ expectedStatus: 'received', status: 'cutting' });
    statusRequest.flush({ status: 'cutting', event: { id: 'event-id', previousStatus: 'received', newStatus: 'cutting',
      changedBy: 'Test', changedAt: '2026-11-17T03:31:00Z' } });
    fixture.detectChanges();
    expect(element.querySelector('app-order-production-status [aria-current="step"]')?.textContent).toContain('En corte');
    expect(element.querySelector('.activity')?.textContent).toContain('Test cambió la etapa de Recibida a En corte.');
    element.querySelector<HTMLButtonElement>('.status-actions .primary')!.click();
    http.expectOne((request) => request.method === 'PUT' && request.url.endsWith('/status'))
      .flush({}, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('cambió en otra sesión');
    expect(element.querySelector<HTMLButtonElement>('.status-actions .primary')?.disabled).toBe(true);
    element.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    http.expectOne((request) => request.method === 'GET' && request.url.endsWith('/orders/order-id')).flush({
      id: 'order-id', number: 1, customerName: customer.name, catalogName: item.name, status: 'sewing',
      subtotalCents: 1600010, taxCents: null, taxBasisPoints: null, instructions: '', taxTreatment: 'taxable',
      deliveryLocal: '2026-11-18T15:00', measurementSnapshots: [], responsibleName: null, createdBy: 'Test',
      createdAt: '2026-11-17T03:30:00Z', history: [], historyHasMore: false,
    });
    fixture.detectChanges();
    expect(element.querySelector('app-order-production-status [aria-current="step"]')?.textContent).toContain('En confección');
    expect(element.querySelector<HTMLButtonElement>('.status-actions .primary')?.disabled).toBe(false);
  });

  it('requires an explicit workshop rate and keeps historical tax unconfigured', async () => {
    const fixture = TestBed.createComponent(Orders);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush(settings);
    await new Promise((resolve) => setTimeout(resolve, 300));
    http.expectOne((request) => request.url.endsWith('/orders')).flush({ orders: [], hasMore: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.desktop-add')!.click();
    http.expectOne((request) => request.url.endsWith('/order-settings')).flush(settings);
    http.expectOne((request) => request.url.endsWith('/customers')).flush({ customers: [], hasMore: false });
    http.expectOne((request) => request.url.endsWith('/catalog'))
      .flush({ items: [], hasMore: false, measurementCatalog: [] });
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.text-button')!.click();
    fixture.detectChanges();
    const rate = element.querySelector<HTMLInputElement>('#tax-rate')!;
    rate.value = '18.25';
    rate.dispatchEvent(new Event('input'));
    element.querySelector<HTMLButtonElement>('.tax-form .primary')!.click();
    const update = http.expectOne((request) => request.method === 'PUT');
    expect(update.request.body).toEqual({ itbisBasisPoints: 1825 });
    update.flush({ itbisBasisPoints: 1825 });
    fixture.detectChanges();
    expect(element.textContent).toContain('Configuración de ITBIS actualizada.');
  });
});
