import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

describe('AuthService', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  const user = { id: 'client', email: 'client@example.test', name: 'Cliente', role: 'CLIENT' };
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });
  afterEach(() => http.verify());
  it('restaura la sesión y deriva el rol del servidor', async () => {
    const initialized = auth.initialize();
    http.expectOne(`${environment.apiUrl}/api/auth/me`).flush({ user });
    await initialized;
    expect(auth.isClient()).toBe(true);
    expect(auth.isProfessional()).toBe(false);
  });
  it('permite iniciar sin una sesión válida', async () => {
    const initialized = auth.initialize();
    http.expectOne(`${environment.apiUrl}/api/auth/me`).flush({}, { status: 401, statusText: 'Unauthorized' });
    await initialized;
    expect(auth.isLoggedIn()).toBe(false);
  });
  it('mantiene el superadmin fuera del rol profesional', async () => {
    const initialized = auth.initialize();
    http.expectOne(`${environment.apiUrl}/api/auth/me`).flush({ user: { ...user, role: 'SUPERADMIN' } });
    await initialized;
    expect(auth.isSuperadmin()).toBe(true);
    expect(auth.isProfessional()).toBe(false);
  });
});
