import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, of, tap, throwError } from 'rxjs';

export enum MembershipRole {
  Owner = 'owner',
  Manager = 'manager',
  Staff = 'staff',
}

export enum AuthenticationError {
  Cancelled = 'cancelled',
  InvalidFlow = 'invalid_flow',
  GoogleUnavailable = 'google_unavailable',
  ServerUnavailable = 'server_unavailable',
}

export interface AuthenticatedSession {
  user: { id: string; email: string; name: string };
  workshops: { id: string; name: string; role: MembershipRole }[];
  platformAdministrator: boolean;
  canCreateWorkshop: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly currentSession = signal<AuthenticatedSession | null>(null);
  private readonly selectedWorkshopId = signal<string | null>(null);
  readonly session = this.currentSession.asReadonly();
  readonly currentWorkshop = computed(() => {
    const workshops = this.currentSession()?.workshops ?? [];
    return workshops.find((workshop) => workshop.id === this.selectedWorkshopId()) ??
      (workshops.length === 1 ? workshops[0] : null);
  });

  selectWorkshop(id: string): boolean {
    if (!this.currentSession()?.workshops.some((workshop) => workshop.id === id)) return false;
    this.selectedWorkshopId.set(id);
    return true;
  }

  updateWorkshopName(id: string, name: string): void {
    this.currentSession.update((session) => session && {
      ...session, workshops: session.workshops.map((workshop) => workshop.id === id ? { ...workshop, name } : workshop),
    });
  }

  restore() {
    return this.http.get<AuthenticatedSession>('/api/auth/me').pipe(
      tap((session) => {
        if (this.currentSession()?.user.id !== session.user.id ||
            !session.workshops.some((workshop) => workshop.id === this.selectedWorkshopId())) {
          this.selectedWorkshopId.set(null);
        }
        this.currentSession.set(session);
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.currentSession.set(null);
          this.selectedWorkshopId.set(null);
          return of(null);
        }
        return throwError(() => error);
      }),
    );
  }

  logout() {
    return this.http.post<void>('/api/auth/logout', {}).pipe(
      tap(() => { this.currentSession.set(null); this.selectedWorkshopId.set(null); }),
    );
  }
}
