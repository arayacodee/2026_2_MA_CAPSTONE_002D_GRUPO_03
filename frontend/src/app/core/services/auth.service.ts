import {
  Injectable,
  computed,
  effect,
  signal
} from '@angular/core';

import {
  firstValueFrom,
  Observable,
  finalize,
  map,
  tap
} from 'rxjs';

import { ApiService } from './api.service';

import {
  User
} from '../../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly companyApplicantId = signal<string | null>(null);
  readonly managesCompany = computed(() => {
    const user = this.currentUserSignal();
    return Boolean(user && user.role !== 'SUPERADMIN' && (user.role === 'PROFESSIONAL' || this.companyApplicantId() === user.id));
  });
  markCompanyApplication(): void {
    this.companyApplicantId.set(this.currentUserSignal()?.id ?? null);
  }
  activateProfessionalDemo(): Observable<User> { return this.api.activateProfessionalDemo().pipe(tap(r => this.currentUserSignal.set(r.user)), map(r => r.user)); }
  login(email: string, password: string): Observable<User> { return this.api.passwordLogin(email, password).pipe(tap(r => this.currentUserSignal.set(r.user)), map(r => r.user)); }
  register(data: { email: string; password: string; firstName: string; lastName: string; phone: string; address: string }): Observable<User> { return this.api.register(data).pipe(tap(r => this.currentUserSignal.set(r.user)), map(r => r.user)); }
  updateContact(data: { firstName: string; lastName: string; phone: string; address: string }): Observable<User> {
    return this.api.updateContact(data).pipe(tap(response => this.currentUserSignal.set(response.user)), map(response => response.user));
  }
  verifyPhone(code: string): Observable<User> {
    return this.api.checkPhoneCode(code).pipe(tap(response => this.currentUserSignal.set(response.user)), map(response => response.user));
  }
  loginAsAdmin(email: string, password: string): Observable<User> {
    return this.api.adminLogin(email, password).pipe(tap(response => this.currentUserSignal.set(response.user)), map(response => response.user));
  }
  readonly isSuperadmin = computed(() => this.currentUserSignal()?.role === 'SUPERADMIN');
  private readonly currentUserSignal =
    signal<User | null>(null);

  readonly currentUser =
    this.currentUserSignal.asReadonly();

  readonly isLoggedIn = computed(
    () => this.currentUserSignal() !== null
  );

  readonly isClient = computed(
    () =>
      this.currentUserSignal()?.role ===
      'CLIENT'
  );

  readonly isProfessional = computed(
    () =>
      this.currentUserSignal()?.role ===
      'PROFESSIONAL'
  );

  constructor(
    private readonly api: ApiService
  ) {
    effect(onCleanup => {
      const user = this.currentUserSignal();
      if (!user || user.role !== 'CLIENT') { this.companyApplicantId.set(null); return; }
      const request = this.api.professionalApplication().subscribe({
        next: response => this.companyApplicantId.set(response.application ? user.id : null),
        error: () => this.companyApplicantId.set(null),
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  async initialize(): Promise<void> {
    try {
      const response =
        await firstValueFrom(
          this.api.getCurrentUser()
        );

      this.currentUserSignal.set(
        response.user
      );
    } catch {
      this.currentUserSignal.set(null);
    }
  }

  loginWithGoogle(
    credential: string
  ): Observable<User> {
    return this.api
      .googleLogin(credential)
      .pipe(
        tap((response) => {
          this.currentUserSignal.set(
            response.user
          );
        }),

        map((response) => response.user)
      );
  }

  logout(): Observable<void> {
    return this.api
      .logoutSession()
      .pipe(
        finalize(() => {
          this.currentUserSignal.set(null);
        })
      );
  }
}
