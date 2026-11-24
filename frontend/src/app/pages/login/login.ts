import { ValidateForm } from '../../core/forms/validate-form.directive';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../models/user.model';
import { environment } from '../../../environments/environment';

let initializedGoogle: GoogleAccountsId | null = null;
let activeCredentialHandler: ((response: GoogleCredentialResponse) => void) | null = null;

@Component({ selector: 'app-login', imports: [ValidateForm, RouterLink, FormsModule], templateUrl: './login.html', styleUrl: './login.css' })
export class Login implements OnInit, AfterViewInit, OnDestroy {
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly googleErrorMessage = signal('');
  readonly mode = signal<'login' | 'register' | null>(null);
  private readonly googleButton = viewChild.required<ElementRef<HTMLElement>>('googleButton');
  private readonly formValidation = viewChild(ValidateForm);
  private googleButtonObserver?: ResizeObserver;
  private googleButtonWidth = 0;
  private googleScript: HTMLScriptElement | null = null;
  private destroyed = false;
  private readonly onGoogleCredential = (response: GoogleCredentialResponse) => this.handleGoogleCredential(response);
  private readonly onGoogleScriptLoad = () => {
    if (this.googleScript) this.googleScript.dataset['googleState'] = 'loaded';
    this.renderGoogleButton();
  };
  private readonly onGoogleScriptError = () => {
    if (this.googleScript) this.googleScript.dataset['googleState'] = 'failed';
    this.googleErrorMessage.set('No fue posible cargar Google. Recarga la página e inténtalo nuevamente.');
  };
  form = { email: '', password: '', firstName: '', lastName: '', phone: '', address: '' };
  constructor(private readonly auth: AuthService, private readonly router: Router, private readonly route: ActivatedRoute) {}
  get companyRegistration(): boolean { return this.route.snapshot.queryParamMap.get('returnUrl') === '/companies'; }
  ngOnInit(): void {
    const user = this.auth.currentUser();
    if (user) { this.navigateAfterLogin(user); return; }
    const mode = this.route.snapshot.queryParamMap.get('mode');
    if (mode === 'register' || mode === 'login') this.choose(mode);
  }
  ngAfterViewInit(): void {
    if (this.auth.currentUser()) return;
    if (typeof ResizeObserver !== 'undefined') {
      this.googleButtonObserver = new ResizeObserver(() => {
        if (window.google?.accounts?.id) this.renderGoogleButton();
      });
      this.googleButtonObserver.observe(this.googleButton().nativeElement);
    }
    if (window.google?.accounts?.id) { this.renderGoogleButton(); return; }

    let script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (script?.dataset['googleState'] === 'failed') script.remove();
    if (!script || script.dataset['googleState'] === 'failed') {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
    }
    this.googleScript = script;
    script.addEventListener('load', this.onGoogleScriptLoad);
    script.addEventListener('error', this.onGoogleScriptError);
    if (!script.isConnected) document.head.appendChild(script);
    else if (script.dataset['googleState'] === 'loaded') this.renderGoogleButton();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.googleButtonObserver?.disconnect();
    if (activeCredentialHandler === this.onGoogleCredential) activeCredentialHandler = null;
    this.googleScript?.removeEventListener('load', this.onGoogleScriptLoad);
    this.googleScript?.removeEventListener('error', this.onGoogleScriptError);
  }
  private renderGoogleButton(): void {
    if (this.destroyed) return;
    const google = window.google?.accounts?.id;
    if (!google) { this.onGoogleScriptError(); return; }
    const container = this.googleButton().nativeElement;
    const width = Math.min(320, container.clientWidth || 320);
    if (this.googleButtonWidth === width && initializedGoogle === google) return;
    this.googleButtonWidth = width;
    activeCredentialHandler = this.onGoogleCredential;
    if (initializedGoogle !== google) {
      google.initialize({ client_id: environment.googleClientId, callback: response => activeCredentialHandler?.(response) });
      initializedGoogle = google;
    }
    container.replaceChildren();
    google.renderButton(container, {
      type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
      shape: 'rectangular', width, locale: 'es'
    });
    this.googleErrorMessage.set('');
  }
  private handleGoogleCredential(response: GoogleCredentialResponse): void {
    if (this.destroyed || this.loading() || !response.credential) return;
    this.loading.set(true);
    this.errorMessage.set('');
    this.auth.loginWithGoogle(response.credential).subscribe({
      next: user => { if (this.destroyed) return; this.loading.set(false); this.navigateAfterLogin(user); },
      error: error => { if (this.destroyed) return; this.loading.set(false); this.errorMessage.set(error?.error?.error ?? 'No fue posible iniciar sesión con Google.'); }
    });
  }
  choose(mode: 'login' | 'register'): void {
    this.formValidation()?.reset();
    this.mode.set(mode);
    this.errorMessage.set('');
    this.form.password = '';
  }
  submit(validation?: ValidateForm): void {
    if (this.loading() || !this.mode()) return;
    this.loading.set(true); this.errorMessage.set('');
    const request = this.mode() === 'login' ? this.auth.login(this.form.email, this.form.password) : this.auth.register(this.form);
    request.subscribe({
      next: user => { this.form.password = ''; this.loading.set(false); this.navigateAfterLogin(user); },
      error: err => {
        this.loading.set(false);
        if (this.mode() === 'register' && err.status === 409 && validation) {
          validation.show('email', 'Ya existe una cuenta con este correo. Inicia sesión o usa otro correo.');
        } else {
          this.errorMessage.set(err?.error?.error ?? 'No fue posible acceder. Intenta nuevamente.');
        }
      }
    });
  }
  private navigateAfterLogin(user: User): void {
    const target = this.route.snapshot.queryParamMap.get('returnUrl');
    const safe = target && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\') && (!target.startsWith('/admin') || user.role === 'SUPERADMIN') && (!target.startsWith('/dashboard') || user.role === 'PROFESSIONAL') && (!(target.startsWith('/booking') || target.startsWith('/my-reservations')) || user.role === 'CLIENT');
    void this.router.navigateByUrl(safe ? target : user.role === 'SUPERADMIN' ? '/admin' : user.role === 'PROFESSIONAL' ? '/dashboard' : '/');
  }
}
