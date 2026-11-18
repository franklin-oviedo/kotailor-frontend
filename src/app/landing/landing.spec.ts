import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom } from 'rxjs';
import { routes } from '../app.routes';

describe('Public landing and access navigation', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('opens publicly without an API session and keeps Google login on the access page', async () => {
    const harness = await RouterTestingHarness.create('/');
    const page = harness.routeNativeElement!;
    expect(page.querySelector('h1')?.textContent).toContain('Cada puntada');
    http.expectNone('/api/auth/me');
    const access = page.querySelector<HTMLAnchorElement>('.hero a[href="/acceso"]')!;
    const navigation = firstValueFrom(
      TestBed.inject(Router).events.pipe(filter((event) => event instanceof NavigationEnd)),
    );
    access.click();
    await navigation;
    await harness.fixture.whenStable();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/acceso');
    expect(harness.routeNativeElement!.querySelector('a.google-button')?.getAttribute('href')).toBe(
      '/api/auth/google',
    );
    expect(harness.routeNativeElement!.querySelector('.google-mark')).not.toBeNull();
  });

  it('preserves existing Google error callbacks to the root URL', async () => {
    const harness = await RouterTestingHarness.create('/?authError=cancelled');
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/acceso?authError=cancelled');
    expect(harness.routeNativeElement!.textContent).toContain('Cancelaste el acceso con Google');
  });

  it('sends protected-page requests to login, not back to the public landing', async () => {
    const navigation = RouterTestingHarness.create('/inicio');
    await vi.waitFor(() => {
      http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    });
    const harness = await navigation;
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/acceso');
    expect(harness.routeNativeElement!.querySelector('a.google-button')).not.toBeNull();
  });
});
