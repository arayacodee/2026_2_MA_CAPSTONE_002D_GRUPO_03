import { Component, OnInit, signal, computed } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { BusinessCategory, businessCategories, businessLabels } from '../../models/business-category';
import { RouterLink } from '@angular/router';

import { ApiService } from '../../core/services/api.service';
import { Business } from '../../models/business.model';
import { AutoplayPreview } from './autoplay-preview';

@Component({
  selector: 'app-home',
  imports: [RouterLink, NgOptimizedImage, AutoplayPreview],
  templateUrl: './home.html',
  styleUrls: ['./home.css', './booking-preview.css']
})
export class Home implements OnInit {
  readonly bookingSteps = [
    { title: 'Elige un servicio', description: 'Revisa el perfil del negocio y selecciona el servicio que necesitas.' },
    { title: 'Encuentra un horario', description: 'Escoge el día y la hora que te acomoden.' },
    { title: 'Confirma tu reserva', description: 'Revisa los datos de tu cita y confirma.' },
  ];

  readonly categories = businessCategories;
  readonly category = signal<BusinessCategory | ''>('');
  readonly filteredBusinesses = computed(() => this.businesses().filter(business => !this.category() || (business.category ?? 'GENERAL') === this.category()));
  readonly businessLabels = businessLabels;
  businesses = signal<Business[]>([]);
  loading = signal(true);
  errorMessage = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.api.getBusinesses().subscribe({
      next: (businesses) => {
        this.businesses.set(businesses);
        this.loading.set(false);
      },
      error: (error) => {
        console.error('Error loading businesses:', error);
        this.errorMessage.set('No fue posible cargar los negocios.');
        this.loading.set(false);
      }
    });
  }
}
