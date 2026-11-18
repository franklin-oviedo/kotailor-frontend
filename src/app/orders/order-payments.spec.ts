import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OrderPayments } from './order-payments';

describe('OrderPayments', () => {
  const url = '/api/workshops/workshop/orders/order/payments';
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OrderPayments], providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('retries an uncertain payment using the same request ID', () => {
    const fixture = TestBed.createComponent(OrderPayments);
    fixture.componentRef.setInput('workshopId', 'workshop');
    fixture.componentRef.setInput('orderId', 'order');
    fixture.detectChanges();
    http.expectOne(url).flush({ totalCents: 500000, paidCents: 0, payments: [] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const amount = element.querySelector<HTMLInputElement>('#payment-amount')!;
    amount.value = '1500.50'; amount.dispatchEvent(new Event('input'));
    const method = element.querySelector<HTMLSelectElement>('#payment-method')!;
    method.value = 'transfer'; method.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const reference = element.querySelector<HTMLInputElement>('#payment-reference')!;
    reference.value = 'TRX-ORDER-024'; reference.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const first = http.expectOne(url);
    expect(first.request.body).toMatchObject({
      kind: 'payment', method: 'transfer', amountCents: 150050, reference: 'TRX-ORDER-024',
    });
    first.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element.textContent).toContain('No pudimos confirmar');
    amount.value = '1200'; amount.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    http.expectNone(url);
    fixture.detectChanges();
    expect(element.textContent).toContain('resultado incierto');
    amount.value = '1500.50'; amount.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const retry = http.expectOne(url);
    expect(retry.request.body.requestId).toBe(first.request.body.requestId);
    retry.flush({ id: 'payment' });
    http.expectOne(url).flush({ totalCents: 500000, paidCents: 150050, payments: [] });
    fixture.detectChanges();
    expect(element.textContent).toContain('Movimiento registrado');
    fixture.destroy();
  });

  it('requires an original payment and a reason for refunds', () => {
    const fixture = TestBed.createComponent(OrderPayments);
    fixture.componentRef.setInput('workshopId', 'workshop');
    fixture.componentRef.setInput('orderId', 'order');
    fixture.detectChanges();
    http.expectOne(url).flush({ totalCents: 500000, paidCents: 150050, payments: [] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const kind = element.querySelector<HTMLSelectElement>('#payment-kind')!;
    kind.value = 'refund'; kind.dispatchEvent(new Event('change'));
    const amount = element.querySelector<HTMLInputElement>('#payment-amount')!;
    amount.value = '10'; amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    http.expectNone(url);
    fixture.detectChanges();
    expect(element.textContent).toContain('cobro original y el motivo');
    fixture.destroy();
  });
});
