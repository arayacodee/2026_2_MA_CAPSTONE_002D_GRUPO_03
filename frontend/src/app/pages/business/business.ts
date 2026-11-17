import { Component, OnInit, signal, computed } from '@angular/core';
import { businessLabels, attentionModes } from '../../models/business-category';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService } from '../../core/services/api.service';
import { Business as BusinessModel } from '../../models/business.model';
import { Service } from '../../models/service.model';
import { BusinessGallery } from '../../components/business-gallery';

@Component({
  selector: 'app-business',
  imports: [RouterLink, BusinessGallery],
  templateUrl: './business.html',
  styleUrl: './business.css'
})
export class Business implements OnInit {
  private readonly servicePrice = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' });

  readonly labels = computed(() => businessLabels(this.business()?.category));
  readonly mode = computed(() => attentionModes.find(item => item.value === this.business()?.attentionMode)?.label ?? '');
  business = signal<BusinessModel | null>(null);
  services = signal<Service[]>([]);
  loading = signal(true);
  errorMessage = signal('');

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService
  ) {}

  formatPrice(price: Service['price']): string {
    return this.servicePrice.format(Number(price));
  }

  ngOnInit(): void {
    const businessId = this.route.snapshot.paramMap.get('id');

    if (!businessId) {
      this.errorMessage.set('Negocio no válido.');
      this.loading.set(false);
      return;
    }

    this.api.getBusinessById(businessId).subscribe({
      next: (business) => {
        this.business.set(business);

        this.api.getServicesByBusiness(businessId).subscribe({
          next: (services) => {
            this.services.set(
              services.filter((service) => service.isActive)
            );

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
      },
      error: (error) => {
        console.error(error);
        this.errorMessage.set(
          'No fue posible cargar el negocio.'
        );

        this.loading.set(false);
      }
    });
  }
}
