import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService, type AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Reports } from './reports';

describe('Reports', () => {
  const base = '/api/workshops/workshop-id';
  const workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Owner };
  const report = {
    summary: {
      salesCents: 16000, collectedCents: 8000, outstandingCents: 8000,
      invoicedCents: 16000, invoiceOutstandingCents: 8000, invoicesIssued: 1, invoicesPaid: 0, invoicesUnpaid: 0, invoicesPartial: 1,
      invoicedWithTaxCents: 16000, invoicedWithoutTaxCents: 0, invoicesWithTax: 1, invoicesWithoutTax: 0,
      activeOrders: 1, productionOrders: 1, completedOrders: 0, totalCustomers: 1, newCustomers: 1,
      frequentCustomers: 0, annualIncomeCents: 8000,
    },
    monthly: [{
      month: '2026-11', salesCents: 16000, invoicedCents: 16000,
      collectedCents: 8000, newCustomers: 1,
    }],
    ordersByStatus: [{ status: 'sewing', count: 1 }],
    topCustomers: [{ customerId: 'customer-id', name: 'Cliente de prueba', orders: 1, salesCents: 16000 }],
    topProducts: [{ name: 'Camisa', orders: 1, salesCents: 16000 }],
    inventoryCritical: null,
  };
  let http: HttpTestingController;

  beforeEach(() => {
    const session = signal<AuthenticatedSession | null>({
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false, canCreateWorkshop: false, workshops: [workshop],
    });
    TestBed.configureTestingModule({
      imports: [Reports],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { session, currentWorkshop: () => workshop } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('renders actual report values and exposes inventory absence instead of inventing a value', () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    const request = http.expectOne((item) => item.url === `${base}/reports/executive`);
    request.flush(report);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Resumen general');
    expect(text).toContain('RD$160.00');
    expect(text).toContain('Clientes frecuentes');
    expect(text).toContain('Camisa');
    expect(text).toContain('El sistema no registra existencias ni niveles mínimos');
    expect(text).not.toContain('Inventario crítico0');
    fixture.destroy();
  });

  it('sends date, customer, and order-status filters to the real report endpoint', () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    http.expectOne((item) => item.url === `${base}/reports/executive`).flush(report);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      filters: {
        controls: {
          from: { setValue(value: string): void };
          to: { setValue(value: string): void };
          customerId: { setValue(value: string): void };
          status: { setValue(value: string): void };
        };
      };
      applyFilters(): void;
    };
    component.filters.controls.from.setValue('2026-11-01');
    component.filters.controls.to.setValue('2026-11-17');
    component.filters.controls.customerId.setValue('customer-id');
    component.filters.controls.status.setValue('sewing');
    component.applyFilters();
    const request = http.expectOne((item) => item.url === `${base}/reports/executive`);
    expect(request.request.params.get('from')).toBe('2026-11-01');
    expect(request.request.params.get('to')).toBe('2026-11-17');
    expect(request.request.params.get('customerId')).toBe('customer-id');
    expect(request.request.params.get('status')).toBe('sewing');
    request.flush(report);
    fixture.destroy();
  });

  it('lets a ranked customer filter the report and keeps the selected customer visible', () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    http.expectOne((item) => item.url === `${base}/reports/executive`).flush(report);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.rank-row')!.click();
    const request = http.expectOne((item) => item.url === `${base}/reports/executive`);
    expect(request.request.params.get('customerId')).toBe('customer-id');
    request.flush(report);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('#report-customer')?.value)
      .toBe('customer-id');
    fixture.destroy();
  });

  it('does not turn a failed request into zero financial metrics', () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    http.expectOne((item) => item.url === `${base}/reports/executive`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar el resumen ejecutivo');
    expect(element.textContent).not.toContain('RD$ 0.00');
    fixture.destroy();
  });

  it('refreshes real indicators every minute without changing the selected filters', () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();
      http.expectOne((item) => item.url === `${base}/reports/executive`).flush(report);
      fixture.detectChanges();
      vi.advanceTimersByTime(60_000);
      const refresh = http.expectOne((item) => item.url === `${base}/reports/executive`);
      refresh.flush(report);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
