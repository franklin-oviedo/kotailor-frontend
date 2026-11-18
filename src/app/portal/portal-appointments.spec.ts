import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { PortalAppointments } from './portal-appointments';

describe('PortalAppointments', () => {
  const baseUrl = '/api/client/workshops/workshop/appointments';
  const options = {
    customers: [{ id: 'customer', name: 'Client' }],
    responsibles: [{ id: 'responsible', name: 'Staff' }],
  };
  const appointment = {
    id: 'appointment', customerId: 'customer', customerName: 'Client',
    responsibleId: 'responsible', responsibleName: 'Staff', kind: 'fitting',
    startsAt: '2035-02-01T14:00:00.000Z', endsAt: '2035-02-01T14:30:00.000Z', version: 2,
  };

  function createFixture(workshops = [{ id: 'workshop', name: 'Tailor shop' }], selectedId = 'workshop') {
    TestBed.configureTestingModule({
      imports: [PortalAppointments],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ taller: selectedId }) } } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PortalAppointments);
    fixture.detectChanges();
    http.expectOne('/api/client/workshops').flush({ workshops, hasMore: false });
    const optionRequest = http.expectOne(`${baseUrl}/options`);
    const listRequest = http.expectOne((request) =>
      request.url === baseUrl && request.params.has('from') && request.params.has('to'));
    return { fixture, http, optionRequest, listRequest };
  }

  function reload(http: HttpTestingController, appointments: typeof appointment[] = []) {
    http.expectOne(`${baseUrl}/options`).flush(options);
    http.expectOne((request) =>
      request.url === baseUrl && request.params.has('from') && request.params.has('to'))
      .flush({ appointments, hasMore: false });
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('books with Dominican time and retries an uncertain request using the same ID', () => {
    const { fixture, http, optionRequest, listRequest } = createFixture();
    optionRequest.flush(options);
    listRequest.flush({ appointments: [], hasMore: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.page-actions .primary')!.click();
    fixture.detectChanges();
    const setValue = (selector: string, value: string): void => {
      const input = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    setValue('#appointment-start', '2035-02-01T10:00');
    setValue('#appointment-end', '2035-02-01T10:30');
    const save = () => {
      (fixture.componentInstance as unknown as { save: () => void }).save();
      fixture.detectChanges();
    };

    save();
    const first = http.expectOne({ method: 'POST', url: baseUrl });
    const requestId = first.request.body.requestId as string;
    expect(first.request.body).toMatchObject({
      customerId: 'customer', orderId: null, responsibleId: 'responsible', kind: 'fitting',
      startsAt: '2035-02-01T14:00:00.000Z', endsAt: '2035-02-01T14:30:00.000Z',
    });
    first.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Reintenta con los mismos datos');

    save();
    const retry = http.expectOne({ method: 'POST', url: baseUrl });
    expect(retry.request.body.requestId).toBe(requestId);
    retry.flush({ id: 'appointment' });
    reload(http);
    fixture.detectChanges();
    expect(element.textContent).toContain('Cita agendada.');
    fixture.destroy();
  });

  it('reschedules with optimistic versioning and requires confirmation to cancel', () => {
    const { fixture, http, optionRequest, listRequest } = createFixture();
    optionRequest.flush(options);
    listRequest.flush({ appointments: [appointment], hasMore: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.card-actions .secondary')!.click();
    fixture.detectChanges();
    const start = element.querySelector<HTMLInputElement>('#appointment-start')!;
    const end = element.querySelector<HTMLInputElement>('#appointment-end')!;
    start.value = '2035-02-01T11:00';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    end.value = '2035-02-01T11:45';
    end.dispatchEvent(new Event('input', { bubbles: true }));
    (fixture.componentInstance as unknown as { save: () => void }).save();
    const update = http.expectOne({ method: 'PUT', url: `${baseUrl}/appointment` });
    expect(update.request.body).toEqual({
      expectedVersion: 2, responsibleId: 'responsible',
      startsAt: '2035-02-01T15:00:00.000Z', endsAt: '2035-02-01T15:45:00.000Z',
    });
    update.flush({ version: 3 });
    reload(http, [{ ...appointment, version: 3, startsAt: '2035-02-01T15:00:00.000Z', endsAt: '2035-02-01T15:45:00.000Z' }]);
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.card-actions .danger-outline')!.click();
    fixture.detectChanges();
    expect(element.textContent).toContain('¿Quieres cancelar esta cita?');
    element.querySelector<HTMLButtonElement>('.cancel-confirm .danger')!.click();
    const cancel = http.expectOne({ method: 'POST', url: `${baseUrl}/appointment/cancel` });
    expect(cancel.request.body).toEqual({ expectedVersion: 3 });
    cancel.flush({ version: 4 });
    reload(http);
    fixture.detectChanges();
    expect(element.textContent).toContain('Cita cancelada.');
    fixture.destroy();
  });

  it('uses the requested workshop when the customer belongs to more than one', () => {
    const { fixture, http, optionRequest, listRequest } = createFixture([
      { id: 'first', name: 'First shop' }, { id: 'workshop', name: 'Tailor shop' },
    ]);
    expect((fixture.componentInstance as unknown as { selectedId: () => string }).selectedId()).toBe('workshop');
    optionRequest.flush(options);
    listRequest.flush({ appointments: [], hasMore: false });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('#appointment-workshop')?.value)
      .toBe('workshop');
    http.verify();
    fixture.destroy();
  });
});
