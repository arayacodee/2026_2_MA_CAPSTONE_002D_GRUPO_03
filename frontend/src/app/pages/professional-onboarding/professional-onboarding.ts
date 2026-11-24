import { ValidateForm } from '../../core/forms/validate-form.directive';
import {
  Component,
  OnInit,
  signal
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  Router,
} from '@angular/router';

import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { profileForm, profileRequest } from '../../models/business-category';
import { BusinessProfileFields } from '../../components/business-profile-fields';

@Component({
  selector: 'app-professional-onboarding',
  imports: [
    ValidateForm,
    BusinessProfileFields,
    FormsModule
  ],
  templateUrl: './professional-onboarding.html',
  styleUrl: './professional-onboarding.css'
})
export class ProfessionalOnboarding
  implements OnInit {

  loading = signal(true);
  saving = signal(false);

  errorMessage = signal('');

  form = {
    ...profileForm(),
    name: '',
    description: ''
  };

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    const user =
      this.auth.currentUser();

    if (
      !user ||
      user.role !== 'PROFESSIONAL'
    ) {
      this.router.navigate(['/']);
      return;
    }

    // Si el profesional ya tiene perfil no permitimos
    // crear otro y lo enviamos directamente al dashboard.
    this.api.getMyBusiness().subscribe({
      next: () => {
        this.router.navigate([
          '/dashboard'
        ]);
      },

      error: (error) => {
        if (error.status === 404) {
          this.loading.set(false);
          return;
        }

        console.error(error);

        this.errorMessage.set(
          'No fue posible comprobar tu perfil.'
        );

        this.loading.set(false);
      }
    });
  }

  createProfile(): void {
    const name =
      this.form.name.trim();

    const description =
      this.form.description.trim();

    if (name.length < 2) {
      this.errorMessage.set(
        'El nombre debe tener al menos 2 caracteres.'
      );

      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');

    this.api.createBusiness({
      ...profileRequest(this.form),
      name,

      description:
        description || undefined
    }).subscribe({
      next: () => {
        this.router.navigate([
          '/dashboard'
        ]);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          error?.error?.error ??
            'No fue posible crear el perfil.'
        );

        this.saving.set(false);
      }
    });
  }
}
