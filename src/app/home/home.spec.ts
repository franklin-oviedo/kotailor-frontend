import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService, AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Home } from './home';

const flushManagerDashboard = (http: HttpTestingController) => {
  http.expectOne('/api/workshops/workshop-id/payments/dashboard').flush({
    collectedMonthCents: 18450000, outstandingCents: 4280000,
  });
  const appointments = http.expectOne((request) => request.url === '/api/workshops/workshop-id/appointments');
  const from = appointments.request.params.get('from')!;
  const to = appointments.request.params.get('to')!;
  expect(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)).toBe(86400000);
  appointments.flush({ appointments: [{
    id: 'appointment-id', customerName: 'Cliente de prueba', responsibleName: 'Responsable',
    kind: 'fitting', startsAt: '2026-11-18T14:00:00.000Z', syncStatus: 'synced',
  }] });
};

describe('Home', () => {
  it('displays the real user and does not invent a workshop or business metrics', () => {
    const session = signal<AuthenticatedSession | null>({
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false,
      canCreateWorkshop: false,
      workshops: [],
    });
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { session, currentWorkshop: () => null } }],
    });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.mobile-title')?.textContent).toContain('Test');
    expect(element.querySelector('.workshop-notice')?.textContent).toContain('no tiene una sastrería');
    expect(element.querySelectorAll('.metrics strong')[0].textContent).toBe('—');
    expect(element.querySelector<HTMLAnchorElement>('.nav-item[href="/reportes"]')).toBeNull();
  });

  it('shows actual workshop financial metrics, appointments, and earliest pending deliveries', () => {
    const workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Owner };
    const session = signal<AuthenticatedSession | null>({
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false, canCreateWorkshop: false, workshops: [workshop],
    });
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { session, currentWorkshop: () => workshop } }],
    });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/workshops/workshop-id/order-dashboard').flush({
      activeOrders: 2, dueToday: 1,
      priorities: [{ number: 12, customerName: 'Cliente de prueba', catalogName: 'Camisa',
        status: 'ready', deliveryLocal: '2026-11-18T15:00' }],
    });
    flushManagerDashboard(http);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.metrics strong')[0].textContent).toBe('2');
    expect(element.querySelectorAll('.metrics strong')[1].textContent).toBe('1');
    expect(element.querySelectorAll('.metrics strong')[2].textContent).toContain('184,500');
    expect(element.querySelectorAll('.metrics strong')[3].textContent).toContain('42,800');
    expect(element.querySelector('.orders')?.textContent).toContain('OT-0012');
    expect(element.querySelector('.orders')?.textContent).toContain('Lista para entregar');
    expect(element.querySelector('.agenda')?.textContent).toContain('Cliente de prueba');
    expect(element.querySelector('.agenda')?.textContent).toContain('Sincronizada');
    http.verify();
  });

  it('does not request financial or workshop appointment data for staff', () => {
    const workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Staff };
    const session = signal<AuthenticatedSession | null>({
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false, canCreateWorkshop: false, workshops: [workshop],
    });
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { session, currentWorkshop: () => workshop } }],
    });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/workshops/workshop-id/order-dashboard').flush({
      activeOrders: 0, dueToday: 0, priorities: [],
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.metrics article')).toHaveLength(2);
    expect(element.querySelector('.agenda')?.textContent).toContain('disponible para propietarios y encargados');
    http.verify();
    fixture.destroy();
  });

  it('reports an unavailable summary and allows retrying without showing zero', () => {
    const workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Owner };
    const session = signal<AuthenticatedSession | null>({
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false, canCreateWorkshop: false, workshops: [workshop],
    });
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { session, currentWorkshop: () => workshop } }],
    });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    flushManagerDashboard(http);
    http.expectOne('/api/workshops/workshop-id/order-dashboard')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Los indicadores no se pudieron actualizar');
    expect(element.querySelector('.metrics strong')?.textContent).toBe('—');
    element.querySelector<HTMLButtonElement>('.summary-state button')!.click();
    http.expectOne('/api/workshops/workshop-id/order-dashboard').flush({ activeOrders: 0, dueToday: 0, priorities: [] });
    flushManagerDashboard(http);
    fixture.detectChanges();
    expect(element.querySelector('.metrics strong')?.textContent).toBe('0');
    expect(element.querySelector('.orders')?.textContent).toContain('No hay órdenes pendientes');
    http.verify();
  });

  it('refreshes a summary requested before midnight when it finishes on the next Dominican day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T03:59:30Z'));
    try {
      const workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Owner };
      const session = signal<AuthenticatedSession | null>({
        user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
        platformAdministrator: false, canCreateWorkshop: false, workshops: [workshop],
      });
      TestBed.configureTestingModule({
        imports: [Home],
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
          { provide: AuthService, useValue: { session, currentWorkshop: () => workshop } }],
      });
      const fixture = TestBed.createComponent(Home);
      fixture.detectChanges();
      const http = TestBed.inject(HttpTestingController);
      const first = http.expectOne('/api/workshops/workshop-id/order-dashboard');
      const firstPayments = http.expectOne('/api/workshops/workshop-id/payments/dashboard');
      const firstAppointments = http.expectOne((request) => request.url === '/api/workshops/workshop-id/appointments');
      vi.advanceTimersByTime(60000);
      firstPayments.flush({ collectedMonthCents: 0, outstandingCents: 0 });
      firstAppointments.flush({ appointments: [] });
      first.flush({ activeOrders: 1, dueToday: 1, priorities: [] });
      const next = http.expectOne('/api/workshops/workshop-id/order-dashboard');
      flushManagerDashboard(http);
      next.flush({ activeOrders: 1, dueToday: 0, priorities: [] });
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.metrics strong')[1].textContent).toBe('0');
      http.verify();
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
