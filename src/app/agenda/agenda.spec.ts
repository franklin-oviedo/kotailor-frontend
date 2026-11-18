import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, type AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Agenda } from './agenda';

describe('Agenda', () => {
  const base = '/api/workshops/workshop-id';
  const session = signal<AuthenticatedSession | null>({
    user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
    platformAdministrator: false, canCreateWorkshop: false, workshops: [],
  });
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T14:00:00Z'));
    TestBed.configureTestingModule({
      imports: [Agenda],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: {
          session, currentWorkshop: () => ({ id: 'workshop-id', name: 'Test', role: MembershipRole.Owner }),
        } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  function flushSupplementalData(): void {
    http.expectOne(`${base}/order-dashboard`).flush({ dueToday: 0, priorities: [] });
    http.expectOne(`${base}/calendar`).flush({ connected: false, email: null });
  }

  it('creates an appointment in Dominican time and preserves its idempotency key on retry', () => {
    const fixture = TestBed.createComponent(Agenda);
    fixture.detectChanges();
    flushSupplementalData();
    const list = http.expectOne((request) => request.url === `${base}/appointments`);
    expect(list.request.params.get('from')).toBe('2026-11-16');
    expect(list.request.params.get('to')).toBe('2026-11-23');
    list.flush({ appointments: [], hasMore: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.week-actions .primary')!.click();
    http.expectOne((request) => request.url === `${base}/customers`).flush({
      customers: [{ id: 'customer', name: 'Cliente', phone: '8090000000' }], hasMore: false,
    });
    http.expectOne(`${base}/order-settings`).flush({ members: [{ id: 'member', name: 'Responsable' }] });
    fixture.detectChanges();
    const customer = element.querySelector<HTMLSelectElement>('#customer')!;
    customer.value = 'customer'; customer.dispatchEvent(new Event('change'));
    http.expectOne((request) => request.url === `${base}/orders`).flush({ orders: [], hasMore: false });
    const responsible = element.querySelector<HTMLSelectElement>('#responsible')!;
    responsible.value = 'member'; responsible.dispatchEvent(new Event('change'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const first = http.expectOne(`${base}/appointments`);
    expect(first.request.body).toMatchObject({
      customerId: 'customer', responsibleId: 'member', startsAt: '2026-11-17T14:00:00.000Z',
      endsAt: '2026-11-17T14:30:00.000Z',
    });
    first.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element.textContent).toContain('Reintenta sin cambiar los datos');
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const retry = http.expectOne(`${base}/appointments`);
    expect(retry.request.body.requestId).toBe(first.request.body.requestId);
    retry.flush({ id: 'appointment' });
    http.expectOne((request) => request.url === `${base}/appointments`).flush({ appointments: [], hasMore: false });
    fixture.detectChanges();
    expect(element.textContent).toContain('Cita creada');
    fixture.destroy();
  });

  it('requires confirmation and sends the current version when cancelling', () => {
    const fixture = TestBed.createComponent(Agenda);
    fixture.detectChanges();
    flushSupplementalData();
    http.expectOne((request) => request.url === `${base}/appointments`).flush({
      appointments: [{
        id: 'appointment', customerId: 'customer', customerName: 'Cliente', orderNumber: null,
        responsibleId: 'member', responsibleName: 'Responsable', kind: 'fitting',
        startsAt: '2026-11-17T14:00:00Z', endsAt: '2026-11-17T14:30:00Z', version: 3, syncStatus: 'pending',
      }], hasMore: false,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Cancelar cita'))!.click();
    http.expectNone(`${base}/appointments/appointment/cancel`);
    fixture.detectChanges();
    [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Confirmar cancelación'))!.click();
    const request = http.expectOne(`${base}/appointments/appointment/cancel`);
    expect(request.request.body).toEqual({ expectedVersion: 3 });
    request.flush({}, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(element.textContent).toContain('La cita cambió');
    fixture.destroy();
  });

  it('does not present a failed load as an empty agenda', () => {
    const fixture = TestBed.createComponent(Agenda);
    fixture.detectChanges();
    flushSupplementalData();
    http.expectOne((request) => request.url === `${base}/appointments`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('No pudimos cargar las citas');
    expect(element.textContent).not.toContain('No hay citas para este día');
    fixture.destroy();
  });

  it('renders the workweek grid and places appointments by Dominican date and hour', () => {
    const fixture = TestBed.createComponent(Agenda);
    fixture.detectChanges();
    flushSupplementalData();
    http.expectOne((request) => request.url === `${base}/appointments`).flush({
      appointments: [{
        id: 'appointment', customerId: 'customer', customerName: 'Cliente', orderNumber: null,
        responsibleId: 'member', responsibleName: 'Responsable', kind: 'fitting',
        startsAt: '2026-11-17T14:00:00Z', endsAt: '2026-11-17T14:30:00Z', version: 1, syncStatus: 'pending',
      }], hasMore: false,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.calendar-day')).toHaveLength(5);
    expect(element.querySelectorAll('.time-label')).toHaveLength(9);
    const appointment = element.querySelector<HTMLElement>('.calendar-appointment');
    expect(appointment?.textContent).toContain('Cliente');
    expect(appointment?.parentElement?.getAttribute('aria-label')).toContain('MAR 17');
    expect(appointment?.parentElement?.getAttribute('aria-label')).toContain('10 a. m.');
    fixture.destroy();
  });
});
