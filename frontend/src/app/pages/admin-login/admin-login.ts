import { ValidateForm } from '../../core/forms/validate-form.directive';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({ selector: 'app-admin-login', imports: [ValidateForm, FormsModule, RouterLink], templateUrl: './admin-login.html', styleUrl: '../login/login.css' })
export class AdminLogin {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal('');
  email = '';
  password = '';
  constructor() { if (this.auth.isSuperadmin()) void this.router.navigate(['/admin']); }
  submit(): void {
    if (this.loading()) return;
    this.loading.set(true); this.error.set('');
    this.auth.loginAsAdmin(this.email.trim(), this.password).subscribe({
      next: () => { this.password = ''; this.loading.set(false); void this.router.navigate(['/admin']); },
      error: err => { this.password = ''; this.loading.set(false); this.error.set(err?.error?.error ?? 'No fue posible iniciar sesión.'); }
    });
  }
}
