import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, of } from 'rxjs';
import { routes } from '../app.routes';
import { AuthService, AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Shell } from '../shell/shell';
import { Invoices } from './invoices';

describe('Fiscal settings', () => {
  const baseUrl = '/api/workshops/workshop';
  const profile = {
    legalName: null, tradeName: null, rnc: null, fiscalAddress: null, phone: null, email: null,
    hasLogo: false, logoMimeType: null, workshopName: 'Test workshop', itbisBasisPoints: 1800, allowInvoicesWithoutTax: false,
  };
  function setup(role: MembershipRole) {
    const workshop = { id: 'workshop', name: 'Test workshop', role };
    const session: AuthenticatedSession = {
      user: { id: 'user', name: 'Test', email: 'test@example.invalid' },
      workshops: [workshop], platformAdministrator: false, canCreateWorkshop: false,
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        provideRouter([{ path: '', component: Shell }, ...routes.filter((route) => route.path === 'configuracion-fiscal')]),
        { provide: AuthService, useValue: {
          session: () => session, currentWorkshop: () => workshop, restore: () => of(session), updateWorkshopName: vi.fn(),
        } },
      ],
    });
  }

  it('opens the actual route from the sidebar and saves ITBIS without overwriting the profile', async () => {
    setup(MembershipRole.Owner);
    const harness = await RouterTestingHarness.create('/');
    const fiscalLink = '.sidebar a[href="/configuracion-fiscal"]';
    const opened = firstValueFrom(TestBed.inject(Router).events.pipe(filter((event) => event instanceof NavigationEnd)));
    harness.routeNativeElement!.querySelector<HTMLAnchorElement>(fiscalLink)!.click();
    await opened;
    await harness.fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne({ method: 'GET', url: `${baseUrl}/billing-profile` }).flush(profile);
    harness.detectChanges();
    const page = harness.routeNativeElement!;
    expect(page.querySelector(fiscalLink)?.getAttribute('aria-current')).toBe('page');
    page.querySelector<HTMLButtonElement>('.mobile-navigation button')!.click();
    harness.detectChanges();
    expect(page.querySelector('.mobile-more a[href="/configuracion-fiscal"]')?.textContent?.trim()).toBe('Configuración fiscal');
    const input = page.querySelector<HTMLInputElement>('#billing-tax-rate')!;
    expect(input.value).toBe('18.00');
    function submitRate(value: string) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
      harness.detectChanges();
    }
    submitRate('100.01');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    http.expectNone(`${baseUrl}/order-settings`);
    submitRate('16.25');
    const update = http.expectOne({ method: 'PUT', url: `${baseUrl}/order-settings` });
    expect(update.request.body).toEqual({ itbisBasisPoints: 1625 });
    update.flush({ itbisBasisPoints: 1625 });
    submitRate('');
    const clear = http.expectOne({ method: 'PUT', url: `${baseUrl}/order-settings` });
    expect(clear.request.body).toEqual({ itbisBasisPoints: null });
    clear.flush({ itbisBasisPoints: null });
    harness.detectChanges();
    expect(page.querySelector('.notice')?.textContent).toContain('Tasa de ITBIS guardada');
    const legalName = page.querySelector<HTMLInputElement>('#legal-name')!;
    legalName.value = 'Sastrería de prueba';
    legalName.dispatchEvent(new Event('input'));
    legalName.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    const saveProfile = http.expectOne({ method: 'PUT', url: `${baseUrl}/billing-profile` });
    expect(saveProfile.request.body.legalName).toBe('Sastrería de prueba');
    expect(saveProfile.request.body).not.toHaveProperty('itbisBasisPoints');
    saveProfile.flush(profile);
    const preference = page.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(preference.checked).toBe(false);
    preference.click();
    preference.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    const taxSettings = http.expectOne({ method: 'PUT', url: `${baseUrl}/invoice-tax-settings` });
    expect(taxSettings.request.body).toEqual({ allowInvoicesWithoutTax: true });
    taxSettings.flush({ allowInvoicesWithoutTax: true });
    http.verify();
  });

  it('applies the saved rate only after explicit batch confirmation', async () => {
    setup(MembershipRole.Owner);
    const harness = await RouterTestingHarness.create('/configuracion-fiscal');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${baseUrl}/billing-profile`).flush(profile);
    harness.detectChanges();
    const page = harness.routeNativeElement!;
    const batchUrl = `${baseUrl}/orders/apply-pending-itbis`;
    const disclosure = page.querySelector('details')!;
    expect(disclosure.open).toBe(false);
    disclosure.open = true;
    http.expectNone(batchUrl);
    expect(disclosure.textContent).toContain('18 %');
    disclosure.querySelector('button')!.click();
    const request = http.expectOne({ method: 'POST', url: batchUrl });
    expect(request.request.body).toEqual({ itbisBasisPoints: 1800 });
    request.flush({ updatedOrders: 2, updatedDrafts: 1 });
    harness.detectChanges();
    expect(page.querySelector('.notice')?.textContent).toContain('ITBIS aplicado a 2 órdenes');
    const rate = page.querySelector<HTMLInputElement>('#billing-tax-rate')!;
    rate.value = '10';
    rate.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(disclosure.querySelector('button')!.disabled).toBe(true);
    http.verify();
  });

  it('saves text, logo and seal together and restores them on returning to fiscal settings', async () => {
    setup(MembershipRole.Owner);
    const harness = await RouterTestingHarness.create('/configuracion-fiscal');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${baseUrl}/billing-profile`).flush(profile);
    harness.detectChanges();
    const page = harness.routeNativeElement!;
    const name = page.querySelector<HTMLInputElement>('#legal-name')!;
    const tradeName = page.querySelector<HTMLInputElement>('#trade-name')!;
    expect(tradeName.value).toBe('Test workshop');
    tradeName.value = 'Nombre comercial actualizado';
    tradeName.dispatchEvent(new Event('input'));
    name.value = 'Emisor actualizado';
    name.dispatchEvent(new Event('input'));
    for (const selector of ['#invoice-logo', '#invoice-seal']) {
      const input = page.querySelector<HTMLInputElement>(selector)!;
      Object.defineProperty(input, 'files', { value: [new File(['imagen'], 'empresa.png', { type: 'image/png' })] });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => {
        harness.detectChanges();
        expect(page.querySelector<HTMLButtonElement>('button[type="submit"].primary.full:last-child')?.disabled).toBe(false);
        expect(page.textContent).toContain('Pulsa «Guardar perfil»');
      });
    }
    http.expectNone({ method: 'PUT', url: `${baseUrl}/billing-profile` });
    name.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    const update = http.expectOne({ method: 'PUT', url: `${baseUrl}/billing-profile` });
    expect(update.request.body).toMatchObject({
      legalName: 'Emisor actualizado', logoDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      sealDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    });
    const stored = {
      ...profile, ...update.request.body, workshopName: 'Nombre comercial actualizado', hasLogo: true, logoMimeType: 'image/png',
    };
    update.flush({ message: 'Temporary failure' }, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    expect(name.value).toBe('Emisor actualizado');
    expect(page.querySelectorAll('img.company-image')).toHaveLength(2);
    expect(page.textContent).toContain('Tus cambios siguen disponibles');
    name.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    const retry = http.expectOne({ method: 'PUT', url: `${baseUrl}/billing-profile` });
    expect(retry.request.body).toEqual(update.request.body);
    retry.flush(stored);
    harness.detectChanges();
    expect(TestBed.inject(AuthService).updateWorkshopName).toHaveBeenCalledWith('workshop', 'Nombre comercial actualizado');
    expect(page.textContent).toContain('guardados correctamente');
    await harness.navigateByUrl('/');
    await harness.navigateByUrl('/configuracion-fiscal');
    http.expectOne(`${baseUrl}/billing-profile`).flush(stored);
    harness.detectChanges();
    expect(harness.routeNativeElement!.querySelector<HTMLInputElement>('#legal-name')!.value).toBe('Emisor actualizado');
    expect(harness.routeNativeElement!.querySelector<HTMLInputElement>('#trade-name')!.value).toBe('Nombre comercial actualizado');
    expect(harness.routeNativeElement!.querySelectorAll('img.company-image')).toHaveLength(2);
    http.verify();
  });

  it('explains invalid fiscal fields and rejects oversized company images before requesting a save', async () => {
    setup(MembershipRole.Owner);
    const harness = await RouterTestingHarness.create('/configuracion-fiscal');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${baseUrl}/billing-profile`).flush(profile);
    harness.detectChanges();
    const page = harness.routeNativeElement!;
    const tradeName = page.querySelector<HTMLInputElement>('#trade-name')!;
    tradeName.value = '   ';
    tradeName.dispatchEvent(new Event('input'));
    const rnc = page.querySelector<HTMLInputElement>('#rnc')!;
    rnc.value = '12345678';
    rnc.dispatchEvent(new Event('input'));
    const email = page.querySelector<HTMLInputElement>('#profile-email')!;
    email.value = 'correo-invalido';
    email.dispatchEvent(new Event('input'));
    rnc.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    harness.detectChanges();
    expect(page.textContent).toContain('Escribe el nombre comercial de la sastrería');
    expect(page.textContent).toContain('El RNC debe contener entre 9 y 11 dígitos');
    expect(page.textContent).toContain('Escribe un correo electrónico válido');
    const logo = page.querySelector<HTMLInputElement>('#invoice-logo')!;
    Object.defineProperty(logo, 'files', {
      value: [new File([new Uint8Array(61441)], 'grande.jpg', { type: 'image/jpeg' })],
    });
    logo.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(page.textContent).toContain('no superar 60 KB');
    http.expectNone({ method: 'PUT', url: `${baseUrl}/billing-profile` });
    http.verify();
  });

  it('does not request the profile on direct access by a non-owner', async () => {
    setup(MembershipRole.Manager);
    const harness = await RouterTestingHarness.create('/configuracion-fiscal');
    expect(harness.routeNativeElement?.textContent).toContain('Solo el propietario');
    expect(harness.routeNativeElement?.querySelector('a[href="/configuracion-fiscal"]')).toBeNull();
    TestBed.inject(HttpTestingController).verify();
  });
});

describe('Invoices', () => {
  const baseUrl = '/api/workshops/workshop';
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Invoices],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentWorkshop: () => ({ id: 'workshop', name: 'Test workshop', role: MembershipRole.Owner }),
            session: () => ({
              user: { id: 'owner', email: 'owner@example.invalid', name: 'Owner' },
              workshops: [{ id: 'workshop', name: 'Test workshop', role: MembershipRole.Owner }],
              platformAdministrator: false, canCreateWorkshop: false,
            }),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('retries an uncertain invoice creation with the same request ID and blocks changed data', () => {
    const fixture = TestBed.createComponent(Invoices);
    fixture.detectChanges();
    http.expectOne(`${baseUrl}/invoices?search=&page=1&pageSize=10`).flush({ invoices: [] });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const createButton = [...element.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Nueva factura'));
    createButton!.click();
    fixture.detectChanges();
    http.expectOne(`${baseUrl}/customers`).flush({ customers: [{ id: 'customer', name: 'Client', phone: '8095550100' }] });
    http.expectOne(`${baseUrl}/orders`).flush({ orders: [] });
    http.expectOne(`${baseUrl}/billing-profile`).flush({
      legalName: null, tradeName: null, rnc: null, fiscalAddress: null, phone: null, email: null,
      hasLogo: false, logoMimeType: null, workshopName: 'Test workshop', itbisBasisPoints: null, allowInvoicesWithoutTax: true,
    });
    fixture.detectChanges();

    const setValue = (selector: string, value: string): void => {
      const input = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    const save = (): void => {
      element.querySelector('.invoice-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();
    };
    setValue('#invoice-customer', 'customer');
    setValue('#line-description-0', 'Jacket');
    setValue('#line-price-0', '100.00');
    fixture.detectChanges();
    expect(element.querySelector('.warning')?.textContent).toContain('Falta configurar');
    setValue('#invoice-tax-mode', 'without-tax');
    save();
    expect(element.querySelector('[role="alert"]')?.textContent).toBeUndefined();
    expect(element.querySelector('.warning')).toBeNull();
    const first = http.expectOne(`${baseUrl}/invoices`);
    expect(first.request.body.hasTax).toBe(false);
    const requestId = first.request.body.requestId as string;
    first.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    setValue('#line-price-0', '110.00');
    save();
    http.expectNone(`${baseUrl}/invoices`);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('resultado incierto');

    setValue('#line-price-0', '100.00');
    save();
    const retry = http.expectOne(`${baseUrl}/invoices`);
    expect(retry.request.body.requestId).toBe(requestId);
    retry.flush({ id: 'invoice' });
    http.expectOne((request) => request.url === `${baseUrl}/invoices/invoice`).flush({
      id: 'invoice', number: 1, orderId: null, customerId: 'customer',
      customer: { id: 'customer', name: 'Client', phone: '8095550100' }, status: 'draft', version: 1,
      issueDate: '2026-11-17', dueDate: null, terms: '', notes: '', subtotalCents: 10000,
      taxCents: 0, totalCents: 10000, hasTax: false, taxBasisPoints: 0, lines: [], voidReason: null, paidCents: 0, revisions: [],
    });
    http.expectOne(`${baseUrl}/invoices?search=&page=1&pageSize=10`).flush({ invoices: [] });
    fixture.detectChanges();
    expect(element.textContent).toContain('Factura FA-000001');
    fixture.destroy();
  });

  it('requires an explanation before submitting invoice cancellation', () => {
    const fixture = TestBed.createComponent(Invoices);
    fixture.detectChanges();
    http.expectOne(`${baseUrl}/invoices?search=&page=1&pageSize=10`).flush({ invoices: [] });
    (fixture.componentInstance as unknown as { openInvoice: (id: string) => void }).openInvoice('invoice');
    http.expectOne((request) => request.url === `${baseUrl}/invoices/invoice`).flush({
      id: 'invoice', number: 1, orderId: null, customerId: 'customer',
      customer: { id: 'customer', name: 'Client', phone: '8095550100' }, status: 'draft', version: 1,
      issueDate: '2026-11-17', dueDate: null, terms: '', notes: '', subtotalCents: 10000,
      taxCents: 1800, totalCents: 11800, lines: [], voidReason: null, paidCents: 0, revisions: [],
    });
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { voidInvoice: () => void }).voidInvoice();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent)
      .toContain('motivo de anulación');
    http.expectNone(`${baseUrl}/invoices/invoice/void`);
    fixture.destroy();
  });

  it('shows collection states in the list and refreshes the detail once the ledger changes', () => {
    const fixture = TestBed.createComponent(Invoices);
    fixture.detectChanges();
    const invoice = {
      id: 'invoice', number: 1, orderId: 'order', orderNumber: 123, customer: { name: 'Cliente' }, status: 'issued',
      issueDate: '2026-11-17', hasTax: false, taxCents: 0, subtotalCents: 1_000_000,
      totalCents: 1_000_000, paidCents: 400_000, balanceCents: 600_000, displayStatus: 'partial',
      revisions: [], lines: [], fiscalDataMissing: ['Razón social', 'RNC'],
    };
    http.expectOne(`${baseUrl}/invoices?search=&page=1&pageSize=10`).flush({ invoices: [invoice] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.invoice-row .status')?.textContent).toBe('Pago parcial');
    expect(element.querySelector('.invoice-row')?.textContent).toContain('FA-000001');
    expect(element.querySelector('.invoice-row')?.textContent).toContain('Orden OT-0123');
    const search = element.querySelector<HTMLInputElement>('#invoice-search')!;
    search.value = 'OT-0123';
    search.dispatchEvent(new Event('input'));
    const status = element.querySelector<HTMLSelectElement>('#invoice-status')!;
    status.value = 'partial';
    status.dispatchEvent(new Event('change'));
    http.expectOne(`${baseUrl}/invoices?search=OT-0123&page=1&pageSize=10&status=partial`).flush({ invoices: [invoice] });
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.invoice-row')!.click();
    http.expectOne((request) => request.url === `${baseUrl}/invoices/invoice`).flush(invoice);
    fixture.detectChanges();
    expect(element.querySelector('.invoice-card .status')?.textContent).toBe('Pago parcial');
    expect(element.querySelector('.invoice-card .warning')?.textContent).toContain('Razón social, RNC');
    expect(element.querySelector('.invoice-card .warning')?.textContent).toContain('no modifica facturas ya emitidas');
    expect(element.querySelector('.invoice-meta')?.textContent).toContain('Orden asociadaOT-0123');
    expect(element.querySelector('.totals')?.textContent).toMatch(/Saldo pendiente.*6,000\.00/);
    http.expectOne(`${baseUrl}/invoices/invoice/payments`).flush({
      totalCents: 1_000_000, paidCents: 1_000_000, balanceCents: 0, displayStatus: 'paid', payments: [],
    });
    fixture.detectChanges();
    expect(element.querySelector('.invoice-card .status')?.textContent).toBe('Pagada');
    expect(element.querySelector('.totals')?.textContent).toMatch(/Saldo pendiente.*0\.00/);
    fixture.destroy();
  });

  it('explains that payments must be refunded before an invoice can be voided', () => {
    const fixture = TestBed.createComponent(Invoices);
    fixture.detectChanges();
    http.expectOne(`${baseUrl}/invoices?search=&page=1&pageSize=10`).flush({ invoices: [] });
    (fixture.componentInstance as unknown as { openInvoice: (id: string) => void }).openInvoice('invoice');
    http.expectOne((request) => request.url === `${baseUrl}/invoices/invoice`).flush({
      id: 'invoice', number: 1, orderId: 'order', customerId: 'customer',
      customer: { id: 'customer', name: 'Client', phone: '8095550100' }, status: 'issued', version: 2,
      issueDate: '2026-11-17', dueDate: null, terms: '', notes: '', subtotalCents: 10000,
      taxCents: 1800, totalCents: 11800, lines: [], voidReason: null, paidCents: 5000, revisions: [],
    });
    fixture.detectChanges();
    http.expectOne(`${baseUrl}/invoices/invoice/payments`).flush({ totalCents: 11800, paidCents: 5000, payments: [] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const reason = element.querySelector<HTMLTextAreaElement>('#void-reason')!;
    reason.value = 'Corrección de documento';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    (fixture.componentInstance as unknown as { voidInvoice: () => void }).voidInvoice();
    const request = http.expectOne(`${baseUrl}/invoices/invoice/void`);
    expect(request.request.body).toMatchObject({ expectedVersion: 2, reason: 'Corrección de documento' });
    request.flush({ message: 'Conflict' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent)
      .toContain('reembolsa los cobros antes de anularla');
    fixture.destroy();
  });
});
