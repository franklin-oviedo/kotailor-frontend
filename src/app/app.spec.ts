import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Access } from './access/access';

describe('Access', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses the backend Google flow without requesting a password', () => {
    const fixture = TestBed.createComponent(Access);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('a.google-button')).toBeNull();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLImageElement>('.logo-desktop img')?.getAttribute('src'))
      .toContain('assets/access-logo-desktop.png');
    expect(element.querySelector<HTMLAnchorElement>('.google-button')?.getAttribute('href'))
      .toBe('/api/auth/google');
    expect(element.querySelector('.google-button svg.google-mark path')).not.toBeNull();
    expect(element.querySelector('input[type="password"]')).toBeNull();
    expect(element.querySelector('.notice')?.textContent).toBe('');
  });

  it('shows connection errors instead of treating them as a signed-out success', () => {
    const fixture = TestBed.createComponent(Access);
    fixture.detectChanges();
    http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="status"]')?.textContent).toContain(
      'No pudimos conectar con el servidor',
    );
  });

  it('sends authenticated users to the home screen', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Access);
    fixture.detectChanges();
    http.expectOne('/api/auth/me').flush({
      user: { id: 'user-id', name: 'Test', email: 'test@example.invalid' },
      platformAdministrator: false,
      canCreateWorkshop: false,
      workshops: [],
    });
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/inicio']);
  });
});
