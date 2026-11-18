import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';

export const accessErrorRedirectGuard: CanActivateFn = (route) =>
  route.queryParamMap.has('authError')
    ? inject(Router).createUrlTree(['/acceso'], { queryParams: { authError: route.queryParamMap.get('authError') } })
    : true;

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.restore().pipe(
    map((session) => session ? true : router.createUrlTree(['/acceso'])),
    catchError(() => of(router.createUrlTree(['/acceso'], { queryParams: { authError: 'server_unavailable' } }))),
  );
};

export const workshopSelectionGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.restore().pipe(
    map((session) => {
      if (!session) return router.createUrlTree(['/acceso']);
      return session.workshops.length > 1 && !auth.currentWorkshop()
        ? router.createUrlTree(['/seleccionar-taller'])
        : true;
    }),
    catchError(() => of(router.createUrlTree(['/acceso'], { queryParams: { authError: 'server_unavailable' } }))),
  );
};

export const clientPortalGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const http = inject(HttpClient);
  return auth.restore().pipe(
    switchMap((session) => {
      if (!session) return of(router.createUrlTree(['/portal']));
      return http.get<{ workshops: { id: string }[] }>('/api/client/workshops').pipe(
        map((result) => result.workshops.length
          ? true
          : router.createUrlTree(['/portal'], { queryParams: { access: 'denied' } })),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 403) {
            return of(router.createUrlTree(['/portal'], { queryParams: { access: 'denied' } }));
          }
          if (error instanceof HttpErrorResponse && error.status === 401) {
            return of(router.createUrlTree(['/portal']));
          }
          return of(router.createUrlTree(['/portal'], { queryParams: { authError: 'server_unavailable' } }));
        }),
      );
    }),
    catchError(() => of(router.createUrlTree(['/portal'], { queryParams: { authError: 'server_unavailable' } }))),
  );
};
