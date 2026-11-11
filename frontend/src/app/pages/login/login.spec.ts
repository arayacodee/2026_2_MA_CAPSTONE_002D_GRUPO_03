import { TestBed } from '@angular/core/testing';
import { Login } from './login';
import { testProviders } from '../../testing/test-providers';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { of } from 'rxjs';

describe('Login', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Login], providers: testProviders() }).compileComponents();
  });
  it('renderiza sin sesión y sin depender de servicios externos', async () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeTruthy();
  });
  it('permite elegir acceso o registro y solo el registro solicita datos personales', async () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    fixture.componentInstance.choose('login'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="email"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('input[name="password"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('input[name="phone"]')).toBeNull();
    fixture.componentInstance.choose('register'); fixture.detectChanges();
    for (const name of ['firstName', 'lastName', 'email', 'password', 'phone', 'address']) expect(fixture.nativeElement.querySelector(`input[name="${name}"]`)).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('sin solicitar un código SMS');
  });
  it('abre el registro de empresas directamente y vuelve a empresas al crear la cuenta', async () => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ mode: 'register', returnUrl: '/companies' }) } } });
    const auth = TestBed.inject(AuthService);
    const user = { id: 'client', role: 'CLIENT' } as any;
    auth.register = () => of(user);
    const router = TestBed.inject(Router);
    let destination = '';
    router.navigateByUrl = ((url: string) => { destination = url; return Promise.resolve(true); }) as any;
    const fixture = TestBed.createComponent(Login); fixture.detectChanges();
    expect(fixture.componentInstance.mode()).toBe('register');
    expect(fixture.nativeElement.querySelector('.company-invitation')).toBeNull();
    fixture.componentInstance.submit();
    expect(destination).toBe('/companies');
  });
  it('muestra el acceso con Google y continúa a la ruta solicitada tras autenticar', () => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ returnUrl: '/my-reservations' }) } } });
    const originalGoogle = window.google;
    let callback: ((response: GoogleCredentialResponse) => void) | undefined;
    const renderButton = vi.fn();
    const initialize = vi.fn((config: { callback: (response: GoogleCredentialResponse) => void }) => { callback = config.callback; });
    window.google = { accounts: { id: {
      initialize, renderButton, prompt: vi.fn()
    } } };
    const auth = TestBed.inject(AuthService);
    const user = { id: 'client', role: 'CLIENT' } as any;
    const loginWithGoogle = vi.fn(() => of(user));
    auth.loginWithGoogle = loginWithGoogle;
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    try {
      const fixture = TestBed.createComponent(Login);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#google-signin-button')).toBeTruthy();
      expect(renderButton).toHaveBeenCalledOnce();
      callback?.({ credential: 'google-id-token' });
      expect(loginWithGoogle).toHaveBeenCalledWith('google-id-token');
      expect(navigateByUrl).toHaveBeenCalledWith('/my-reservations');
      fixture.destroy();
      const secondVisit = TestBed.createComponent(Login);
      secondVisit.detectChanges();
      expect(initialize).toHaveBeenCalledOnce();
      expect(renderButton).toHaveBeenCalledTimes(2);
      secondVisit.destroy();
    } finally {
      window.google = originalGoogle;
    }
  });
});
