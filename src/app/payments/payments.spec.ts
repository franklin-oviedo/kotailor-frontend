import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, type AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Payments } from './payments';

describe('Payments', () => {
  const base = '/api/workshops/workshop-id';
  const session = signal<AuthenticatedSession | null>({
    user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
    platformAdministrator: false, canCreateWorkshop: false, workshops: [],
  });
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Payments],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: {
          session, currentWorkshop: () => ({ id: 'workshop-id', name: 'Test', role: MembershipRole.Owner }),
        } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const balanceRequest = (orderId: string) => http.expectOne(
    `${base}/orders/${orderId}/payments?includeCustomerBalance=true`,
  );
  const manualRequest = () => http.expectOne(`${base}/payments/manual-receivables`);
  const orderRequest = () => http.expectOne(`${base}/payments/order-receivables`);

  function loadPage(orders: { id: string; number: number; customerName: string; catalogName: string; subtotalCents: number }[] = []): ReturnType<typeof TestBed.createComponent<Payments>> {
    const fixture = TestBed.createComponent(Payments);
    fixture.detectChanges();
    http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({
      collectedMonthCents: 10000, collectedTodayCents: 2500, outstandingCents: 1999800, hasPendingTax: true, movements: [],
    });
    orderRequest().flush({ orders });
    manualRequest().flush({ invoices: [] });
    fixture.detectChanges();
    return fixture;
  }

  it('loads real summary values and shows an empty movement state without fabricated entries', () => {
    const fixture = loadPage();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Cobrado este mes');
    expect(text).toContain('Pendiente de cobrar');
    expect(text).toContain('19,998.00');
    expect(text).toContain('Incluye importes con ITBIS pendiente.');
    expect(text).toContain('No hay movimientos para los filtros seleccionados.');
    expect(text).toContain('No hay documentos con saldo disponible para abonar.');
    fixture.destroy();
  });

  it('displays the invoice number for a movement linked to both an order and an invoice', () => {
    const fixture = TestBed.createComponent(Payments);
    fixture.detectChanges();
    http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({
      movements: [{
        id: 'movement-id', kind: 'payment', method: 'cash', amountCents: 5000,
        createdAt: '2026-11-18T14:00:00Z', customerName: 'Cliente',
        orderNumber: 123, invoiceNumber: 7,
      }],
    });
    orderRequest().flush({ orders: [] });
    manualRequest().flush({ invoices: [] });
    fixture.detectChanges();
    const movements = (fixture.nativeElement as HTMLElement).querySelector('.movement-table')?.textContent;
    expect(movements).toContain('FA-000007');
    expect(movements).not.toContain('OT-0123');
    fixture.destroy();
  });

  it('keeps monthly billing separate from outstanding balances and net collections today', () => {
    const fixture = TestBed.createComponent(Payments);
    fixture.detectChanges();
    http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({
      collectedMonthCents: 28000, invoicedWithTaxCents: 7078820, invoicedWithoutTaxCents: 2999800,
      invoicesWithTax: 4, invoicesWithoutTax: 2, outstandingCents: 12000, collectedTodayCents: 6500,
      hasPendingTax: true, movements: [],
      outstandingByTax: {
        withTax: { amountCents: 6000, count: 2 }, withoutTax: { amountCents: 5000, count: 1 },
        pendingTax: { amountCents: 1000, count: 1 },
      },
      collectedTodayByTax: {
        withTax: { amountCents: 6500, count: 1 }, withoutTax: { amountCents: 0, count: 0 },
        pendingTax: { amountCents: 0, count: 0 },
      },
    });
    orderRequest().flush({ orders: [] });
    manualRequest().flush({ invoices: [] });
    fixture.detectChanges();
    const [monthly, outstanding, today] = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.metrics article')];
    expect(monthly.textContent).toMatch(/Facturado con ITBIS:.*70,788\.20.*4 facturas/);
    expect(monthly.textContent).toMatch(/Facturado sin ITBIS:.*29,998\.00.*2 facturas/);
    expect(outstanding.textContent).toMatch(/Pendiente con ITBIS:.*60\.00.*2 documentos/);
    expect(outstanding.textContent).toMatch(/Pendiente sin ITBIS:.*50\.00.*1 documento/);
    expect(outstanding.textContent).toMatch(/Pendiente con ITBIS por calcular:.*10\.00.*1 documento/);
    expect(today.textContent).toMatch(/Cobrado con ITBIS:.*65\.00.*1 movimiento/);
    expect(today.textContent).toMatch(/Cobrado sin ITBIS:.*0\.00.*0 movimientos/);
    expect(today.textContent).not.toContain('por calcular');
  });

  it('registers a payment with its reference and removes only the settled order', () => {
    const fixture = TestBed.createComponent(Payments);
    fixture.detectChanges();
    http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({
      collectedMonthCents: 0, collectedTodayCents: 0, outstandingCents: 11800, movements: [],
    });

    const otherOrder = { id: 'other-order', number: 25, customerName: 'Cliente', catalogName: 'Camisa' };
    orderRequest().flush({
      orders: [{ id: 'order-id', number: 24, customerName: 'Cliente', catalogName: 'Traje' }, otherOrder],
    });
    manualRequest().flush({ invoices: [] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const order = element.querySelector<HTMLSelectElement>('#payment-order')!;
    order.value = 'order-id';
    order.dispatchEvent(new Event('change'));
    balanceRequest('order-id').flush({
      totalCents: 11800, paidCents: 6800, customerBalance: { outstandingCents: 11800, hasPendingTax: false },
    });
    fixture.detectChanges();
    element.querySelector<HTMLInputElement>('#payment-amount')!.value = '50.00';
    element.querySelector<HTMLInputElement>('#payment-amount')!.dispatchEvent(new Event('input'));
    element.querySelector<HTMLInputElement>('#payment-reference')!.value = 'TRX-024';
    element.querySelector<HTMLInputElement>('#payment-reference')!.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const request = http.expectOne(`${base}/orders/order-id/payments`);
    expect(request.request.body).toMatchObject({
      kind: 'payment', amountCents: 5000, reference: 'TRX-024', method: 'transfer',
    });
    request.flush({ id: 'payment-id' });
    http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({
      collectedMonthCents: 11800, collectedTodayCents: 5000, outstandingCents: 6800, movements: [],
    });
    orderRequest().flush({ orders: [otherOrder] });
    manualRequest().flush({ invoices: [] });
    fixture.detectChanges();
    expect(order.value).toBe('');
    expect([...order.options].map((option) => option.value)).toEqual(['', otherOrder.id]);
    expect(element.querySelector('.balance')).toBeNull();
    fixture.destroy();
  });

  it('registers a payment on a manual invoice without an order and shows the aggregate customer balance', () => {
    const fixture = TestBed.createComponent(Payments);
    fixture.detectChanges();
    const load = (invoices: { id: string; number: number; customerName: string }[]) => {
      http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({ movements: [] });
      orderRequest().flush({ orders: [] });
      manualRequest().flush({ invoices });
      fixture.detectChanges();
    };
    load([{ id: 'invoice-id', number: 7, customerName: 'Cliente sin orden' }]);
    const page = fixture.nativeElement as HTMLElement;
    const select = page.querySelector<HTMLSelectElement>('#payment-order')!;
    expect(select.options[1].textContent).toContain('Cliente sin orden · FA-000007');
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    const invoicePayments = `${base}/invoices/invoice-id/payments`;
    http.expectOne(`${invoicePayments}?includeCustomerBalance=true`).flush({
      totalCents: 50000, paidCents: 19020, customerBalance: { outstandingCents: 300980, hasPendingTax: false },
    });
    fixture.detectChanges();
    expect(page.querySelector('.balance')?.textContent).toMatch(/Saldo total del cliente.*3,009\.80/);
    expect(page.querySelector('.balance strong')?.textContent).toContain('309.80');
    expect(page.querySelector('.balance')?.textContent).toContain('Máximo para abonar a esta factura');
    const amount = page.querySelector<HTMLInputElement>('#payment-amount')!;
    const submit = (value: string) => {
      amount.value = value;
      amount.dispatchEvent(new Event('input'));
      page.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    submit('4,99.80');
    fixture.detectChanges();
    http.expectNone(invoicePayments);
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('hasta dos decimales');
    submit('3009,80');
    fixture.detectChanges();
    http.expectNone(invoicePayments);
    expect(page.querySelector('[role="alert"]')?.textContent).toMatch(/hasta.*309\.80.*a esta factura/);
    submit(' RD$\u00a0309.80 ');
    const payment = http.expectOne({ method: 'POST', url: invoicePayments });
    expect(payment.request.body).toMatchObject({ amountCents: 30980, kind: 'payment' });
    payment.flush({ id: 'payment-id' });
    load([]);
    expect(select.value).toBe('');
    expect(page.querySelector('.notice, .success')?.textContent).toContain('Cobro registrado');
  });

  it('displays the aggregate customer balance even when the selected order cannot receive a payment', () => {
    const fixture = loadPage([{ id: 'order-id', number: 1, customerName: 'Cliente', catalogName: 'Traje', subtotalCents: 1500000 }]);
    const element = fixture.nativeElement as HTMLElement;
    const order = element.querySelector<HTMLSelectElement>('#payment-order')!;
    const balance = () => element.querySelector('.balance');
    order.value = 'order-id';
    order.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(balance()?.textContent).toContain('Consultando saldo');
    balanceRequest('order-id').flush({
      totalCents: null, paidCents: 250000, customerBalance: { outstandingCents: 1750000, hasPendingTax: true },
    });
    fixture.detectChanges();
    expect(balance()?.textContent).toContain('Saldo total del cliente');
    expect(balance()?.textContent).toContain('17,500.00');
    expect(balance()?.textContent).not.toContain('Máximo para abonar');
    expect(balance()?.textContent).toContain('ITBIS pendiente');
    expect(element.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(true);
  });

  it('does not present a provisional balance when the ledger request fails', () => {
    const fixture = loadPage([{ id: 'order-id', number: 1, customerName: 'Cliente', catalogName: 'Traje', subtotalCents: 1500000 }]);
    const element = fixture.nativeElement as HTMLElement;
    const order = element.querySelector<HTMLSelectElement>('#payment-order')!;
    order.value = 'order-id';
    order.dispatchEvent(new Event('change'));
    balanceRequest('order-id').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element.querySelector('.balance')?.textContent).toContain('No se pudo consultar el saldo');
    expect(element.querySelector('.balance')?.textContent).not.toContain('15,000.00');
  });

  it('ignores a stale balance response after the selected order changes', () => {
    const fixture = TestBed.createComponent(Payments);
    fixture.detectChanges();
    http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({
      collectedMonthCents: 0, collectedTodayCents: 0, outstandingCents: 0, movements: [],
    });
    orderRequest().flush({
      orders: [
        { id: 'order-a', number: 24, customerName: 'Cliente A', catalogName: 'Traje', taxCents: 1800 },
        { id: 'order-b', number: 25, customerName: 'Cliente B', catalogName: 'Camisa', taxCents: 0 },
      ],
    });
    manualRequest().flush({ invoices: [] });
    fixture.detectChanges();
    const order = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('#payment-order')!;
    order.value = 'order-a';
    order.dispatchEvent(new Event('change'));
    const firstBalance = balanceRequest('order-a');
    order.value = 'order-b';
    order.dispatchEvent(new Event('change'));
    const secondBalance = balanceRequest('order-b');
    secondBalance.flush({ totalCents: 5000, paidCents: 0, customerBalance: { outstandingCents: 6500, hasPendingTax: false } });
    firstBalance.flush({ totalCents: 90000, paidCents: 0, customerBalance: { outstandingCents: 90000, hasPendingTax: false } });
    fixture.detectChanges();
    const text = ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('50.00');
    expect(text).toContain('65.00');
    expect(text).not.toContain('900.00');
    fixture.destroy();
  });

  it('does not present a failed dashboard request as zero balances', () => {
    const fixture = TestBed.createComponent(Payments);
    fixture.detectChanges();
    orderRequest();
    manualRequest();
    http.expectOne((request) => request.url === `${base}/payments/dashboard`).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('No pudimos cargar los cobros de la sastrería.');
    expect(element.textContent).not.toContain('RD$ 0.00');
    fixture.destroy();
  });
});
