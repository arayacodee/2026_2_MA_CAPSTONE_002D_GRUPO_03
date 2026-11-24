import { ValidateForm } from '../../core/forms/validate-form.directive';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ProfessionalProfile } from '../professional-profile/professional-profile';

@Component({ selector: 'app-account-profile', imports: [ValidateForm, ReactiveFormsModule, RouterLink, ProfessionalProfile], templateUrl: './account-profile.html', styleUrl: './account-profile.css' })
export class AccountProfile {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly hasReturnUrl = this.route.snapshot.queryParamMap.has('returnUrl');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly form = new FormGroup({
    firstName: new FormControl(this.auth.currentUser()?.firstName ?? '', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)] }),
    lastName: new FormControl(this.auth.currentUser()?.lastName ?? '', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)] }),
    phone: new FormControl(this.auth.currentUser()?.phone ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
    address: new FormControl(this.auth.currentUser()?.address ?? '', { nonNullable: true, validators: [Validators.required, Validators.minLength(5), Validators.maxLength(300)] }),
  });

  save(proceed = false): void {
    if (this.busy()) return;
    const values = this.form.getRawValue();
    this.form.setValue({ firstName: values.firstName.trim(), lastName: values.lastName.trim(), phone: values.phone.trim(), address: values.address.trim() });
    if (this.form.invalid) { this.form.markAllAsTouched(); this.error.set('Revisa tu nombre, apellido, teléfono y dirección antes de guardar.'); return; }
    this.busy.set(true); this.error.set(''); this.message.set('');
    this.form.disable();
    this.auth.updateContact(this.form.getRawValue()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.busy.set(false); this.form.enable(); }),
    ).subscribe({
      next: () => { this.message.set('Información personal actualizada.'); if (proceed) this.navigate(); },
      error: err => this.error.set(err?.error?.error ?? 'No fue posible guardar tu información personal.'),
    });
  }
  private navigate(): void {
    const target = this.route.snapshot.queryParamMap.get('returnUrl');
    const allowed = target && /^\/(?:companies|booking\/[^/?#]+|my-reservations|dashboard(?:\/[a-z-]+)?|professional\/setup)(?:[?#].*)?$/.test(target);
    void this.router.navigateByUrl(allowed ? target : this.auth.isProfessional() ? '/dashboard' : '/');
  }
}

