import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router, UrlTree } from '@angular/router';
import { isObservable } from 'rxjs';
import { workshopSelectionGuard } from '../auth/auth.guard';
import { AuthService, MembershipRole } from '../auth/auth.service';
import { Invitation } from './invitation';
import { ManageInvitations } from './manage-invitations';
import { InviteCustomer } from './invite-customer';
import { CreateWorkshop } from './create-workshop';

const user = { id: 'user-id', name: 'Test', email: 'test@example.invalid' };
const first = { id: 'first', name: 'Primera sastrería', role: MembershipRole.Owner };
const second = { id: 'second', name: 'Segunda sastrería', role: MembershipRole.Staff };

describe('Workshop selection', () => {
  it('submits an authorized workshop creation form', () => {
    TestBed.configureTestingModule({
      imports: [CreateWorkshop],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CreateWorkshop);
    fixture.detectChanges();
    http.expectOne('/api/workshops/creation-permission').flush({ canCreate: true });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const name = element.querySelector<HTMLInputElement>('#workshop-name')!;
    name.value = 'Sastrería nueva';
    name.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const created = http.expectOne('/api/workshops');
    expect(created.request.body).toEqual({ name: 'Sastrería nueva' });
    created.flush({ id: 'first' });
    http.expectOne('/api/auth/me').flush({ user, workshops: [first], platformAdministrator: false });
    http.verify();
  });

  it('restores the session before redirecting a multi-workshop user to selection', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() => workshopSelectionGuard(null!, null!));
    if (!isObservable(result)) throw new Error('Expected asynchronous guard');
    let destination: boolean | UrlTree | undefined;
    result.subscribe((value) => { if (typeof value === 'boolean' || value instanceof UrlTree) destination = value; });
    http.expectOne('/api/auth/me').flush({ user, workshops: [first, second], platformAdministrator: false });
    expect(destination).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(destination as UrlTree)).toBe('/seleccionar-taller');
    http.verify();
  });

  it('only selects current memberships and clears a revoked selection', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpTestingController);
    auth.restore().subscribe();
    http.expectOne('/api/auth/me').flush({ user, workshops: [first, second], platformAdministrator: false });
    expect(auth.currentWorkshop()).toBeNull();
    expect(auth.selectWorkshop('foreign')).toBe(false);
    expect(auth.selectWorkshop('second')).toBe(true);
    expect(auth.currentWorkshop()).toEqual(second);
    auth.restore().subscribe();
    http.expectOne('/api/auth/me').flush({ user, workshops: [first], platformAdministrator: false });
    expect(auth.currentWorkshop()).toEqual(first);
    http.verify();
  });
});

describe('Invitation', () => {
  it('removes the token from the address, stages it, and requests Google authentication', () => {
    TestBed.configureTestingModule({
      imports: [Invitation],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { fragment: 'test-token' } } },
      ],
    });

    const http = TestBed.inject(HttpTestingController);
    const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
    const fixture = TestBed.createComponent(Invitation);
    fixture.detectChanges();
    expect(replace).toHaveBeenCalledWith('/invitacion');
    const staged = http.expectOne('/api/invitations/stage');
    expect(staged.request.body).toEqual({ token: 'test-token' });
    staged.flush({ staged: true });
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a.button')?.getAttribute('href')).toBe('/api/auth/google');
    http.verify();
  });

  it('accepts a pending membership and selects the invited workshop', () => {
    TestBed.configureTestingModule({
      imports: [Invitation],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { fragment: null } } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Invitation);
    fixture.detectChanges();
    http.expectOne('/api/auth/me').flush({ user, workshops: [first], platformAdministrator: false });
    http.expectOne('/api/invitations/pending')
      .flush({ kind: 'workshop_member', workshopName: second.name, expiresAt: '2027-01-01T00:00:00Z' });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    http.expectOne('/api/invitations/accept').flush({ kind: 'workshop_member', workshopId: second.id });
    http.expectOne('/api/auth/me').flush({ user, workshops: [first, second], platformAdministrator: false });
    expect(TestBed.inject(AuthService).currentWorkshop()).toEqual(second);
    expect(navigate).toHaveBeenCalledWith(['/inicio']);
    http.verify();
  });

  it('does not present acceptance when the invitation belongs to another account', () => {
    TestBed.configureTestingModule({
      imports: [Invitation],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { fragment: null } } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Invitation);
    fixture.detectChanges();
    http.expectOne('/api/auth/me').flush({ user, workshops: [], platformAdministrator: false });
    http.expectOne('/api/invitations/pending').flush({}, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('no está disponible');
    expect(fixture.nativeElement.textContent).not.toContain('Aceptar invitación');
    http.verify();
  });
});

describe('Manage invitations', () => {
  it('creates a platform invitation and displays the link for manual sharing', () => {
    const session = signal({ user, workshops: [first], platformAdministrator: true, canCreateWorkshop: false });
    TestBed.configureTestingModule({
      imports: [ManageInvitations],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: AuthService, useValue: { session, currentWorkshop: () => first } },
      ],
    });

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ManageInvitations);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const name = element.querySelector<HTMLInputElement>('#invite-workshop')!;
    const email = element.querySelector<HTMLInputElement>('#invite-email')!;
    name.value = 'Sastrería nueva';
    name.dispatchEvent(new Event('input'));
    email.value = 'recipient@example.invalid';
    email.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const request = http.expectOne('/api/admin/invitations');
    expect(request.request.body).toEqual({ kind: 'create_workshop', email: email.value, workshopName: name.value });
    request.flush({ link: 'http://localhost:4200/invitacion#token', expiresAt: '2027-01-01T00:00:00Z' });
    fixture.detectChanges();
    expect(element.querySelector<HTMLTextAreaElement>('#invitation-link')?.value).toContain('#token');
    expect(element.textContent).toContain('No se envía automáticamente');
    http.verify();
  });
});

describe('Customer invitations', () => {
      it('lets a manager generate an invitation for the selected workshop', () => {
        const manager = { ...first, role: MembershipRole.Manager };
        TestBed.configureTestingModule({
          imports: [InviteCustomer],
          providers: [
            provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
            { provide: AuthService, useValue: { currentWorkshop: () => manager } },
          ],
        });
        const http = TestBed.inject(HttpTestingController);
        const fixture = TestBed.createComponent(InviteCustomer);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        const email = element.querySelector<HTMLInputElement>('#customer-email')!;
        email.value = 'recipient@example.invalid';
        email.dispatchEvent(new Event('input'));
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        const request = http.expectOne('/api/workshops/first/customer-invitations');
        expect(request.request.body).toEqual({ email: email.value });
        request.flush({ link: 'http://localhost:4200/invitacion#token', expiresAt: '2027-01-01T00:00:00Z' });
        fixture.detectChanges();
        expect(element.querySelector<HTMLTextAreaElement>('#customer-link')?.value).toContain('#token');
        http.verify();
      });

      it('requires an explicit customer choice and sends the selected matching record', () => {
        TestBed.configureTestingModule({
          imports: [Invitation],
          providers: [
            provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
            { provide: ActivatedRoute, useValue: { snapshot: { fragment: null } } },
          ],
        });
        const http = TestBed.inject(HttpTestingController);
        const fixture = TestBed.createComponent(Invitation);
        fixture.detectChanges();
        http.expectOne('/api/auth/me').flush({ user, workshops: [], platformAdministrator: false });
        http.expectOne('/api/invitations/pending').flush({
          kind: 'customer', workshopName: 'Sastrería', candidates: [{ id: 'existing-id', name: 'Cliente' }],
          hasMore: false, accepted: false,
        });
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        fixture.detectChanges();
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('Selecciona una ficha');
        http.expectNone('/api/invitations/accept');
        const radio = element.querySelector<HTMLInputElement>('input[type="radio"]')!;
        radio.click();
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        const request = http.expectOne('/api/invitations/accept');
        expect(request.request.body).toEqual({ choice: 'existing', customerId: 'existing-id' });
        request.flush({ kind: 'customer', workshopId: 'first', customerId: 'existing-id' });
        http.expectOne('/api/auth/me').flush({ user, workshops: [], platformAdministrator: false });
        fixture.detectChanges();
        expect(element.textContent).toContain('Tu cuenta está vinculada');
        expect(element.querySelector<HTMLAnchorElement>('a.button')?.getAttribute('href')).toBe('/portal/inicio');
        http.verify();
      });

      it('creates a new customer only after the client enters valid contact details', () => {
        TestBed.configureTestingModule({
          imports: [Invitation],
          providers: [
            provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
            { provide: ActivatedRoute, useValue: { snapshot: { fragment: null } } },
          ],
        });
        const http = TestBed.inject(HttpTestingController);
        const fixture = TestBed.createComponent(Invitation);
        fixture.detectChanges();
        http.expectOne('/api/auth/me').flush({ user, workshops: [], platformAdministrator: false });
        http.expectOne('/api/invitations/pending').flush({
          kind: 'customer', workshopName: 'Sastrería', candidates: [], hasMore: false, accepted: false,
        });
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;
        element.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
        fixture.detectChanges();
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        http.expectNone('/api/invitations/accept');
        const name = element.querySelector<HTMLInputElement>('#customer-name')!;
        const phone = element.querySelector<HTMLInputElement>('#customer-phone')!;
        name.value = 'Cliente nuevo';
        name.dispatchEvent(new Event('input'));
        phone.value = '8095550100';
        phone.dispatchEvent(new Event('input'));
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        const request = http.expectOne('/api/invitations/accept');
        expect(request.request.body).toEqual({ choice: 'new', name: name.value, phone: phone.value });
        request.flush({ kind: 'customer', workshopId: 'first', customerId: 'new-id' });
        http.expectOne('/api/auth/me').flush({ user, workshops: [], platformAdministrator: false });
        http.verify();
      });
    });
