import { ValidateForm } from '../../core/forms/validate-form.directive';
import { imageError } from '../../core/forms/image-validation';
import {
  Component,
  OnDestroy,
  computed,
  OnInit,
  signal
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../../core/services/api.service';
import { Business } from '../../models/business.model';
import { profileForm, profileRequest } from '../../models/business-category';
import { BusinessProfileFields } from '../../components/business-profile-fields';
import { BusinessGallery } from '../../components/business-gallery';

@Component({
  selector: 'app-professional-profile',
  imports: [
    ValidateForm,
    BusinessProfileFields,
    BusinessGallery,
    FormsModule,
    RouterLink
  ],
  templateUrl: './professional-profile.html',
  styleUrl: './professional-profile.css'
})
export class ProfessionalProfile implements OnInit, OnDestroy {
  readonly missingBusiness = signal(false);
  business = signal<Business | null>(null);

    // Estado temporal usado para seleccionar,
  // previsualizar y subir la foto de perfil.
  selectedAvatar = signal<File | null>(null);
  readonly avatarError = signal('');
  avatarPreview = signal<string | null>(null);
  uploadingAvatar = signal(false);

  selectedCover = signal<File | null>(null);
  readonly coverError = signal('');
  coverPreview = signal<string | null>(null);
  uploadingCover = signal(false);


  loading = signal(true);
  saving = signal(false);
  deletingImage = signal<'avatar' | 'cover' | null>(null);
  readonly imageBusy = computed(() => this.saving() || this.uploadingAvatar() || this.uploadingCover() || this.deletingImage() !== null);

  errorMessage = signal('');
  successMessage = signal('');

  form = {
    ...profileForm(),
    name: '',
    description: ''
  };

  constructor(
    private readonly api: ApiService
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  private loadProfile(): void {
    // El backend determina qué negocio pertenece
    // al profesional que posee la sesión activa.
    this.api.getMyBusiness().subscribe({
      next: (business) => {
        this.business.set(business);

        this.form = {
          ...profileForm(business),
          name: business.name,
          description:
            business.description ?? ''
        };

        this.loading.set(false);
      },

      error: (error) => {
        if (error.status === 404) this.missingBusiness.set(true);
        else this.errorMessage.set('No fue posible cargar el perfil de tu negocio.');

        this.loading.set(false);
      }
    });
  }

  onAvatarSelected(event: Event): void {
      if (this.imageBusy()) return;
      const input =
        event.target as HTMLInputElement;

      const file =
        input.files?.[0] ?? null;

      if (!file) {
        return;
      }

      this.errorMessage.set('');
      this.successMessage.set('');
      this.cancelAvatarSelection();
      input.value = '';
      this.avatarError.set(imageError(file, 2));
      if (this.avatarError()) return;
      this.selectedAvatar.set(file);

      // La previsualización es local y no sube nada todavía.
      // El archivo llegará a Cloudinary solo al guardar la fotografía.
      this.avatarPreview.set(
        URL.createObjectURL(file)
      );
    }

    uploadAvatar(): void {
    if (this.imageBusy()) return;
    const file =
      this.selectedAvatar();

    if (!file) {
      this.errorMessage.set(
        'Selecciona una imagen primero.'
      );

      return;
    }

    this.uploadingAvatar.set(true);

    this.errorMessage.set('');
    this.successMessage.set('');

    this.api
      .uploadBusinessAvatar(file)
      .subscribe({
        next: (business) => {
          // La respuesta ya contiene la URL guardada en Neon.
          // Actualizamos el perfil sin tener que recargar la página.
          this.business.set(business);

          this.cancelAvatarSelection();

          this.successMessage.set(
            'Foto de perfil actualizada correctamente.'
          );

          this.uploadingAvatar.set(false);
        },

        error: (error) => {
          console.error(error);

          this.errorMessage.set(
            error?.error?.error ??
              'No fue posible subir la fotografía.'
          );

          this.uploadingAvatar.set(false);
        }
      });
  }


  onCoverSelected(event: Event): void {
    if (this.imageBusy()) return;
    const input =
      event.target as HTMLInputElement;

    const file =
      input.files?.[0] ?? null;

    if (!file) {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.cancelCoverSelection();
    input.value = '';
    this.coverError.set(imageError(file, 5));
    if (this.coverError()) return;
    this.selectedCover.set(file);

    // Creamos una URL temporal para mostrar la portada
    // antes de enviarla realmente a Cloudinary.
    this.coverPreview.set(
      URL.createObjectURL(file)
    );
  }

  uploadCover(): void {
    if (this.imageBusy()) return;
    const file =
      this.selectedCover();

    if (!file) {
      this.errorMessage.set(
        'Selecciona una portada primero.'
      );

      return;
    }

    this.uploadingCover.set(true);

    this.errorMessage.set('');
    this.successMessage.set('');

    this.api
      .uploadBusinessCover(file)
      .subscribe({
        next: (business) => {
          // La respuesta ya contiene la URL persistida en Neon.
          // Actualizamos inmediatamente la vista local.
          this.business.set(business);

          this.cancelCoverSelection();

          this.successMessage.set(
            'Portada actualizada correctamente.'
          );

          this.uploadingCover.set(false);
        },

        error: (error) => {
          console.error(error);

          this.errorMessage.set(
            error?.error?.error ??
              'No fue posible subir la portada.'
          );

          this.uploadingCover.set(false);
        }
      });
  }


  saveProfile(): void {
    if (this.imageBusy()) return;
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
    this.successMessage.set('');

    this.api.updateMyBusiness({
      ...profileRequest(this.form),
      name,
      description:
        description || null
    }).subscribe({
      next: (business) => {
        // Actualizamos también el estado local para que
        // la página refleje inmediatamente los cambios.
        this.business.set(business);

        this.form = {
          ...profileForm(business),
          name: business.name,
          description:
            business.description ?? ''
        };

        this.successMessage.set(
          'Perfil actualizado correctamente.'
        );

        this.saving.set(false);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          error?.error?.error ??
            'No fue posible actualizar tu perfil.'
        );

        this.saving.set(false);
      }
    });
  }
  cancelAvatarSelection(): void {
    const url = this.avatarPreview();
    if (url) URL.revokeObjectURL(url);
    this.avatarPreview.set(null);
    this.selectedAvatar.set(null);
  }

  cancelCoverSelection(): void {
    const url = this.coverPreview();
    if (url) URL.revokeObjectURL(url);
    this.coverPreview.set(null);
    this.selectedCover.set(null);
  }

  removeImage(kind: 'avatar' | 'cover'): void {
    if (this.imageBusy()) return;
    this.deletingImage.set(kind);
    this.errorMessage.set('');
    this.successMessage.set('');
    const request = kind === 'avatar' ? this.api.deleteBusinessAvatar() : this.api.deleteBusinessCover();
    request.subscribe({
      next: business => {
        this.business.set(business);
        if (kind === 'avatar') this.cancelAvatarSelection();
        else this.cancelCoverSelection();
        this.deletingImage.set(null);
        this.successMessage.set(kind === 'avatar' ? 'Foto de perfil eliminada.' : 'Portada eliminada.');
      },
      error: error => {
        this.errorMessage.set(error?.error?.error ?? 'No fue posible eliminar la imagen.');
        this.deletingImage.set(null);
      }
    });
  }

  ngOnDestroy(): void {
    this.cancelAvatarSelection();
    this.cancelCoverSelection();
  }
}
