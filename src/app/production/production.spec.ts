import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, AuthenticatedSession, MembershipRole } from '../auth/auth.service';
import { Production } from './production';

describe('Production', () => {
  const workshop = { id: 'workshop-id', name: 'Test', role: MembershipRole.Owner };
  const session = signal<AuthenticatedSession | null>({
    user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
    platformAdministrator: false, canCreateWorkshop: false, workshops: [workshop],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Production],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { session, currentWorkshop: () => workshop } }],
    });
  });

  it('displays real stages, totals and order links without inventing task progress', () => {
    const fixture = TestBed.createComponent(Production);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.url === '/api/workshops/workshop-id/production'
      && request.params.get('delivery') === 'all').flush({
      stages: [{ status: 'sewing', total: 21, pagination: { page: 1, pageSize: 10, total: 21 }, orders: [
        { id: 'order-id', number: 12, customerName: 'Cliente de prueba', catalogName: 'Camisa',
          deliveryLocal: '2026-11-18T15:00', responsibleName: null },
      ] }], responsibles: [], hasHistorical: false,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Página 1 de 3');
    expect(element.textContent).toContain('Sin responsable asignado');
    expect(element.textContent).not.toContain('tareas completadas');
    const link = element.querySelector<HTMLAnchorElement>('.stage a')!;
    expect(link.getAttribute('href')).toContain('buscar=OT-0012');
    const button = [...element.querySelectorAll<HTMLButtonElement>('.stage-selector button')]
      .find((entry) => entry.textContent?.includes('En confección'))!;
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelector('.stage.selected')?.textContent).toContain('Cliente de prueba');
    const last = [...element.querySelectorAll<HTMLButtonElement>('.stage.selected nav button')]
      .find((entry) => entry.getAttribute('aria-label') === 'Última página')!;
    last.click();
    http.expectOne((request) => request.params.get('stage') === 'sewing'
      && request.params.get('page') === '3' && request.params.get('pageSize') === '10')
      .flush({
        stages: [{ status: 'sewing', total: 21, orders: [], pagination: { page: 3, pageSize: 10, total: 21 } }],
        responsibles: [], hasHistorical: false,
      });
    fixture.detectChanges();
    expect(element.querySelector('.stage.selected')?.textContent).toContain('Página 3 de 3');
    http.verify();
  });

  it('reports load failures and retries without showing fabricated zero counts', () => {
    const fixture = TestBed.createComponent(Production);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.url === '/api/workshops/workshop-id/production')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
    expect(element.querySelector('.board')).toBeNull();
    element.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    http.expectOne((request) => request.url === '/api/workshops/workshop-id/production')
      .flush({ stages: [], responsibles: [], hasHistorical: false });
    fixture.detectChanges();
    expect(element.querySelector('.stage.selected')?.textContent).toContain('No hay órdenes');
    http.verify();
  });

  it('switches between board and list without losing filtered orders or requesting them again', () => {
    const fixture = TestBed.createComponent(Production);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((request) => request.url === '/api/workshops/workshop-id/production').flush({
      stages: [{ status: 'sewing', total: 21, pagination: { page: 1, pageSize: 10, total: 21 }, orders: [
        { id: 'one', number: 12, customerName: 'Cliente de prueba', catalogName: 'Camisa',
          deliveryLocal: '2026-11-18T15:00', responsibleName: null },
      ] }], responsibles: [], hasHistorical: false,
    });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const buttons = element.querySelectorAll<HTMLButtonElement>('.view-selector button');
    buttons[1].click();
    fixture.detectChanges();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(element.querySelector('.board.list-view')?.textContent).toContain('Cliente de prueba');
    expect(element.querySelector('.board.list-view')?.textContent).toContain('Página 1 de 3');
    expect(element.querySelector('.stage-selector')).toBeNull();
    http.expectNone((request) => request.url === '/api/workshops/workshop-id/production');
    buttons[0].click();
    fixture.detectChanges();
    expect(element.querySelector('.board.list-view')).toBeNull();
    expect(element.querySelector('.stage-selector')).not.toBeNull();
    http.verify();
  });

  it('filters on the server and cancels an older request when the selection changes', () => {
    const fixture = TestBed.createComponent(Production);
    const http = TestBed.inject(HttpTestingController);
    const first = http.expectOne((request) => request.params.get('delivery') === 'all');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector<HTMLSelectElement>('#delivery-filter')!;
    select.value = 'this_week';
    select.dispatchEvent(new Event('change'));
    expect(first.cancelled).toBe(true);
    const weekly = http.expectOne((request) => request.params.get('delivery') === 'this_week');
    weekly.flush({ stages: [{ status: 'sewing', total: 1, orders: [
      { id: 'one', number: 3, customerName: 'Cliente de prueba', catalogName: 'Camisa',
        deliveryLocal: '2026-11-18T15:00', responsibleName: null },
    ] }], responsibles: [], hasHistorical: false });
    fixture.detectChanges();
    expect(element.textContent).toContain('No incluye entregas vencidas de semanas anteriores');
    expect(element.querySelector('.board')?.textContent).toContain('Cliente de prueba');
    http.verify();
  });

  it('filters by responsible identity without conflating historical assignments', () => {
    const fixture = TestBed.createComponent(Production);
    const http = TestBed.inject(HttpTestingController);
    const members = [
      { id: 'first-id', name: 'Nombre repetido' }, { id: 'second-id', name: 'Nombre repetido' },
    ];
    http.expectOne((request) => request.params.get('responsible') === 'all')
      .flush({ stages: [], responsibles: members, hasHistorical: true });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector<HTMLSelectElement>('#responsible-filter')!;
    expect(select.textContent).toContain('Nombre repetido · first-id');
    expect(select.textContent).toContain('Nombre repetido · second-id');
    select.value = 'first-id';
    select.dispatchEvent(new Event('change'));
    http.expectOne((request) => request.params.get('responsible') === 'first-id'
      && request.params.get('delivery') === 'all')
      .flush({ stages: [], responsibles: members, hasHistorical: true });
    fixture.detectChanges();
    select.value = 'historical';
    select.dispatchEvent(new Event('change'));
    http.expectOne((request) => request.params.get('responsible') === 'historical')
      .flush({ stages: [], responsibles: members, hasHistorical: true });
    fixture.detectChanges();
    expect(element.textContent).toContain('no se conoce la cuenta asignada');
    http.verify();
  });
});
