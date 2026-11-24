import { ValidateForm } from '../../core/forms/validate-form.directive';
import { Component, OnInit, signal, computed } from '@angular/core';
import { businessLabels } from '../../models/business-category';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { Business } from '../../models/business.model';
import { AuthService } from '../../core/services/auth.service';

import {
  Service,
  CreateServiceRequest,
  UpdateServiceRequest
} from '../../models/service.model';

@Component({
  selector: 'app-professional-services',
  imports: [
    ValidateForm,
    FormsModule,
    RouterLink
  ],
  templateUrl: './professional-services.html',
  styleUrl: './professional-services.css'
})
export class ProfessionalServices implements OnInit {
  readonly labels = computed(() => businessLabels(this.business()?.category));
  business = signal<Business | null>(null);
  services = signal<Service[]>([]);

  loading = signal(true);
  saving = signal(false);

  errorMessage = signal('');
  successMessage = signal('');

  editingId = signal<string | null>(null);

  newService = {
    name: '',
    description: '',
    durationMin: 30,
    price: 0
  };

  editService = {
    name: '',
    description: '',
    durationMin: 30,
    price: 0
  };

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    const professional = this.auth.currentUser();

    if (
      !professional ||
      professional.role !== 'PROFESSIONAL'
    ) {
      this.errorMessage.set(
        'Debes ingresar como profesional.'
      );

      this.loading.set(false);
      return;
    }

    this.api.getMyBusiness().subscribe({
      next: (business) => {
        this.business.set(business);

        this.loadServices(business.id);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          error.status === 404 ? 'Aún no tienes un negocio.' : 'No fue posible cargar los datos.'
        );

        this.loading.set(false);
      }
    });
  }

  private loadServices(businessId: string): void {
    this.api.getServicesByBusiness(businessId).subscribe({
      next: (services) => {
        this.services.set(services);
        this.loading.set(false);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          'No fue posible cargar los servicios.'
        );

        this.loading.set(false);
      }
    });
  }

  createService(): void {
    const business = this.business();

    if (!business) {
      return;
    }

    const name = this.newService.name.trim();

    if (!name) {
      this.errorMessage.set(
        'El nombre del servicio es obligatorio.'
      );
      return;
    }

    if (this.newService.durationMin <= 0) {
      this.errorMessage.set(
        'La duración debe ser mayor que cero.'
      );
      return;
    }

    if (this.newService.price < 0) {
      this.errorMessage.set(
        'El precio no puede ser negativo.'
      );
      return;
    }

    const data: CreateServiceRequest = {
      businessId: business.id,
      name,
      description:
        this.newService.description.trim() || undefined,
      durationMin: this.newService.durationMin,
      price: this.newService.price,
      isActive: true
    };

    this.saving.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.api.createService(data).subscribe({
      next: (service) => {
        this.services.update((current) => [
          ...current,
          service
        ]);

        this.newService = {
          name: '',
          description: '',
          durationMin: 30,
          price: 0
        };

        this.successMessage.set(
          'Servicio creado correctamente.'
        );

        this.saving.set(false);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          error?.error?.error ??
            'No fue posible crear el servicio.'
        );

        this.saving.set(false);
      }
    });
  }

  startEditing(service: Service): void {
    this.editingId.set(service.id);

    this.editService = {
      name: service.name,
      description: service.description ?? '',
      durationMin: service.durationMin,
      price: Number(service.price)
    };

    this.errorMessage.set('');
    this.successMessage.set('');
  }

  cancelEditing(): void {
    this.editingId.set(null);
  }

  saveService(service: Service): void {
    const name = this.editService.name.trim();

    if (!name) {
      this.errorMessage.set(
        'El nombre del servicio es obligatorio.'
      );
      return;
    }

    if (this.editService.durationMin <= 0) {
      this.errorMessage.set(
        'La duración debe ser mayor que cero.'
      );
      return;
    }

    if (this.editService.price < 0) {
      this.errorMessage.set(
        'El precio no puede ser negativo.'
      );
      return;
    }

    const data: UpdateServiceRequest = {
      name,
      description:
        this.editService.description.trim() || null,
      durationMin: this.editService.durationMin,
      price: this.editService.price
    };

    this.updateService(service.id, data);
  }

  toggleService(service: Service): void {
    this.updateService(service.id, {
      isActive: !service.isActive
    });
  }

  private updateService(
    id: string,
    data: UpdateServiceRequest
  ): void {
    this.saving.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.api.updateService(id, data).subscribe({
      next: (updated) => {
        this.services.update((current) =>
          current.map((service) =>
            service.id === updated.id
              ? updated
              : service
          )
        );

        this.editingId.set(null);

        this.successMessage.set(
          'Servicio actualizado correctamente.'
        );

        this.saving.set(false);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          error?.error?.error ??
            'No fue posible actualizar el servicio.'
        );

        this.saving.set(false);
      }
    });
  }

  formatPrice(price: string | number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 2
    }).format(Number(price));
  }
}
