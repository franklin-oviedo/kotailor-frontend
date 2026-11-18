import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, type AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { CalendarSettings } from './calendar-settings';

describe('CalendarSettings', () => {
  let workshop: { id: string; name: string; role: MembershipRole };
  let http: HttpTestingController;
  const base = '/api/workshops/workshop-id/calendar';
  const session = signal<AuthenticatedSession | null>({
    user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
    platformAdministrator: false, canCreateWorkshop: false, workshops: [],
  });

  beforeEach(() => {
    workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Owner };
    TestBed.configureTestingModule({
      imports: [CalendarSettings],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { session, currentWorkshop: () => workshop } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('requires separate authorization and only accepts a Google authorization link', () => {
    const fixture = TestBed.createComponent(CalendarSettings);
    fixture.detectChanges();
    http.expectOne(base).flush({ connected: false, email: null });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('La autorización es independiente');
    element.querySelector<HTMLButtonElement>('.primary')!.click();
    http.expectOne(`${base}/authorization`).flush({ url: 'https://other.invalid/o/oauth2/v2/auth' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('No pudimos verificar');
    expect(element.querySelector('.link-button')).toBeNull();
    element.querySelector<HTMLButtonElement>('.primary')!.click();
    http.expectOne(`${base}/authorization`).flush({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' });
    fixture.detectChanges();
    expect(element.querySelector<HTMLAnchorElement>('.link-button')?.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=test');
  });

  it('selects one writable calendar and disconnects only after explicit confirmation', () => {
    const fixture = TestBed.createComponent(CalendarSettings);
    fixture.detectChanges();
    http.expectOne(base).flush({ connected: true, email: 'calendar@example.invalid' });
    http.expectOne(`${base}/selection`).flush({ selectedCalendarId: null, pendingCalendarId: null, version: 0 });
    http.expectOne(`${base}/calendars`).flush({
      calendars: [{ id: 'one', name: 'Calendario de prueba', primary: true }], nextPageToken: null,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector<HTMLSelectElement>('#calendar-choice')!;
    select.value = 'one';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Guardar calendario'))!.click();
    const request = http.expectOne(`${base}/selection`);
    expect(request.request.body).toEqual({ calendarId: 'one', expectedVersion: 0 });
    request.flush({ selectedCalendarId: 'one', pendingCalendarId: null, version: 1 });
    fixture.detectChanges();
    expect(element.textContent).toContain('Calendario de prueba');
    expect(element.textContent).toContain('La sincronización de citas aún no está activa');
    const disconnect = [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Desconectar calendario'))!;
    expect(disconnect.disabled).toBe(true);
    element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    fixture.detectChanges();
    expect(disconnect.disabled).toBe(false);
    disconnect.click();
    http.expectOne(`${base}/disconnect`).flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(base).flush({ connected: false, email: null });
    fixture.detectChanges();
    expect(element.textContent).toContain('Los eventos existentes permanecen en Google Calendar');
  });

  it('does not offer a calendar change while synchronization is disabled', () => {
    const fixture = TestBed.createComponent(CalendarSettings);
    fixture.detectChanges();
    http.expectOne(base).flush({ connected: true, email: 'calendar@example.invalid' });
    http.expectOne(`${base}/selection`).flush({ selectedCalendarId: 'one', pendingCalendarId: null, version: 1 });
    http.expectOne(`${base}/calendars`).flush({
      calendars: [{ id: 'one', name: 'Original', primary: true }, { id: 'two', name: 'Nuevo', primary: false }], nextPageToken: null,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('El cambio de calendario no está disponible');
    expect(element.querySelector('#calendar-choice')).toBeNull();
  });

  it('reports provider errors and permits retrying without showing an empty calendar list', () => {
    const fixture = TestBed.createComponent(CalendarSettings);
    fixture.detectChanges();
    http.expectOne(base).flush({ connected: true, email: 'calendar@example.invalid' });
    http.expectOne(`${base}/selection`).flush({ selectedCalendarId: null, pendingCalendarId: null, version: 0 });
    http.expectOne(`${base}/calendars`).flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('No pudimos consultar los calendarios');
    expect(element.textContent).not.toContain('No hay calendarios con permisos');
    element.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    http.expectOne(base).flush({ connected: false, email: null });
    fixture.detectChanges();
    expect(element.textContent).toContain('Conecta Google Calendar');
  });

  it('does not request calendar details for a staff member', () => {
    workshop = { ...workshop, role: MembershipRole.Staff };
    const fixture = TestBed.createComponent(CalendarSettings);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Solo el propietario o un encargado');
    http.expectNone(base);
  });
});
