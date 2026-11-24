import {
  Component,
  DestroyRef,
  computed,
  inject,
  OnInit,
  signal
} from '@angular/core';

import {
  ActivatedRoute,
  RouterLink
} from '@angular/router';

import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

import { Business } from '../../models/business.model';
import { businessLabels } from '../../models/business-category';
import { Service } from '../../models/service.model';

@Component({
  selector: 'app-booking',
  imports: [RouterLink],
  templateUrl: './booking.html',
  styleUrl: './booking.css'
})
export class Booking implements OnInit {
  readonly labels = computed(() => businessLabels(this.business()?.category));
  service = signal<Service | null>(null);
  business = signal<Business | null>(null);

  selectedDate = signal('');
  readonly dateError = signal('');
  selectedTime = signal('');
  readonly timeError = signal('');
  availableTimes = signal<string[]>([]);

  loading = signal(true);
  loadingSlots = signal(false);
  submitting = signal(false);

  errorMessage = signal('');
  successMessage = signal('');

  private readonly destroyRef = inject(DestroyRef);
  private slotsRequest?: Subscription;
  readonly minDate = computed(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.business()?.timezone ?? 'America/Santiago',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return part('year') + '-' + part('month') + '-' + part('day');
  });

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
    private readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    const currentUser =
      this.auth.currentUser();

    if (
      !currentUser ||
      currentUser.role !== 'CLIENT'
    ) {
      this.errorMessage.set(
        'Debes ingresar como cliente.'
      );

      this.loading.set(false);
      return;
    }

    const serviceId =
      this.route.snapshot.paramMap.get(
        'serviceId'
      );

    if (!serviceId) {
      this.errorMessage.set(
        'Servicio no válido.'
      );

      this.loading.set(false);
      return;
    }

    this.loadService(serviceId);
  }

  private loadService(
    serviceId: string
  ): void {
    this.api
      .getServiceById(serviceId)
      .subscribe({
        next: (service) => {
          if (service.isActive === false) {
            this.errorMessage.set('Este servicio ya no está disponible.');
            this.loading.set(false);
            return;
          }
          this.service.set(service);

          this.loadBusiness(
            service.businessId
          );
        },

        error: (error) => {
          console.error(error);

          this.errorMessage.set(
            'No fue posible cargar el servicio.'
          );

          this.loading.set(false);
        }
      });
  }

  private loadBusiness(
    businessId: string
  ): void {
    this.api
      .getBusinessById(businessId)
      .subscribe({
        next: (business) => {
          if (business.canBook === false) {
            this.errorMessage.set('Este negocio no está recibiendo nuevas reservas.');
            this.loading.set(false);
            return;
          }
          this.business.set(business);
          this.loading.set(false);
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

  onDateChange(event: Event): void {
    const input =
      event.target as HTMLInputElement;

    this.slotsRequest?.unsubscribe();
    this.loadingSlots.set(false);
    const invalid = input.validity.badInput || input.validity.rangeUnderflow;
    this.dateError.set(invalid ? 'Elige la fecha de hoy o una posterior.' : '');
    this.selectedDate.set(invalid ? '' : input.value);

    this.selectedTime.set('');
    this.timeError.set('');
    this.availableTimes.set([]);

    this.errorMessage.set('');
    this.successMessage.set('');

    if (this.selectedDate()) {
      this.loadAvailableSlots();
    }
  }

  private loadAvailableSlots(): void {
    const service = this.service();
    const date = this.selectedDate();

    if (!service || !date) {
      return;
    }

    this.slotsRequest?.unsubscribe();
    this.loadingSlots.set(true);

    // Angular ya no descarga reservas de otros clientes.
    // Express devuelve únicamente los horarios libres.
    this.slotsRequest = this.api
      .getAvailableSlots(
        service.id,
        date
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.availableTimes.set(
            response.slots
          );

          this.loadingSlots.set(false);
        },

        error: (error) => {
          console.error(error);

          this.availableTimes.set([]);

          this.errorMessage.set(
            error?.error?.error ??
              'No fue posible cargar los horarios disponibles.'
          );

          this.loadingSlots.set(false);
        }
      });
  }

  selectTime(time: string): void {
    this.selectedTime.set(time);
    this.timeError.set('');

    this.errorMessage.set('');
    this.successMessage.set('');
  }

  confirmReservation(): void {
    if (this.submitting() || this.loadingSlots()) return;
    const service = this.service();
    const business = this.business();

    if (
      !service ||
      !business ||
      !this.selectedDate() ||
      !this.selectedTime() ||
      !this.availableTimes().includes(this.selectedTime())
    ) {
      this.errorMessage.set(
        'Selecciona una fecha y una hora.'
      );

      return;
    }

    // Convertimos la hora local del negocio a UTC.
    // El backend vuelve a validar disponibilidad y conflictos.
    const startsAt =
      this.zonedLocalToDate(
        this.selectedDate(),
        this.selectedTime(),
        business.timezone
      ).toISOString();

    this.submitting.set(true);

    this.errorMessage.set('');
    this.successMessage.set('');

    this.api
      .createReservation({
        serviceId: service.id,
        startsAt
      })
      .subscribe({
        next: () => {
          const reservedTime =
            this.selectedTime();

          this.successMessage.set(
            `Reserva confirmada para ${reservedTime}.`
          );

          this.selectedTime.set('');
          this.submitting.set(false);

          // Volvemos a pedir los slots al servidor para retirar
          // inmediatamente el horario recién reservado.
          this.loadAvailableSlots();
        },

        error: (error) => {
          const message = error?.error?.error ?? 'No fue posible crear la reserva.';
          const field = error?.error?.field;
          if (field === 'day' || field === 'time') {
            this.selectedTime.set('');
            if (field === 'day') this.dateError.set(message);
            else this.timeError.set(message);
          } else {
            this.errorMessage.set(message);
          }

          this.submitting.set(false);

          // Otro cliente podría haber reservado el mismo horario
          // mientras esta pantalla estaba abierta.
          this.loadAvailableSlots();
        }
      });
  }

  formatPrice(
    price: string | number
  ): string {
    return new Intl.NumberFormat(
      'es-CL',
      {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 2
      }
    ).format(Number(price));
  }

  private getTimeZoneOffsetMs(
    date: Date,
    timeZone: string
  ): number {
    const formatter =
      new Intl.DateTimeFormat(
        'en-US',
        {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }
      );

    const parts =
      formatter.formatToParts(date);

    const values =
      Object.fromEntries(
        parts
          .filter(
            (part) =>
              part.type !== 'literal'
          )
          .map(
            (part) => [
              part.type,
              part.value
            ]
          )
      );

    const representedAsUtc =
      Date.UTC(
        Number(values['year']),
        Number(values['month']) - 1,
        Number(values['day']),
        Number(values['hour']),
        Number(values['minute']),
        Number(values['second'])
      );

    return (
      representedAsUtc -
      date.getTime()
    );
  }

  private zonedLocalToDate(
    date: string,
    time: string,
    timeZone: string
  ): Date {
    const [year, month, day] =
      date.split('-').map(Number);

    const [hour, minute] =
      time.split(':').map(Number);

    const guess =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          hour,
          minute
        )
      );

    let offset =
      this.getTimeZoneOffsetMs(
        guess,
        timeZone
      );

    let result =
      new Date(
        guess.getTime() - offset
      );

    const correctedOffset =
      this.getTimeZoneOffsetMs(
        result,
        timeZone
      );

    if (
      correctedOffset !== offset
    ) {
      offset = correctedOffset;

      result =
        new Date(
          guess.getTime() - offset
        );
    }

    return result;
  }
}
