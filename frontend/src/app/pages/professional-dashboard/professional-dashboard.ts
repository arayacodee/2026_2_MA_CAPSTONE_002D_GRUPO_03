import {
  Component,
  DestroyRef,
  inject,
  OnInit,
  computed,
  viewChild,
  signal
} from '@angular/core';

import {
  Router,
  RouterLink
} from '@angular/router';

import { EMPTY, Subject, catchError, exhaustMap, finalize, forkJoin, interval, map, startWith, switchMap, timeout, timer } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

import { User } from '../../models/user.model';
import { Business } from '../../models/business.model';
import { businessLabels } from '../../models/business-category';
import { Service } from '../../models/service.model';
import { Availability } from '../../models/availability.model';
import { ClientSession, Reservation } from '../../models/reservation.model';
import { AttentionDialog } from '../../components/attention-dialog/attention-dialog';

@Component({
  selector: 'app-professional-dashboard',
  imports: [RouterLink, AttentionDialog],
  templateUrl: './professional-dashboard.html',
  styleUrl: './professional-dashboard.css'
})
export class ProfessionalDashboard implements OnInit {
  readonly labels = computed(() => businessLabels(this.business()?.category));
  private readonly destroyRef = inject(DestroyRef);
  readonly now = signal(new Date());
  private readonly refreshAgenda = new Subject<void>();
  readonly refreshingAgenda = signal(false);
  readonly agendaError = signal('');
  readonly editingReservation = signal<string | null>(null);
  readonly changingReservation = signal(false);

  professional = signal<User | null>(null);
  business = signal<Business | null>(null);

  services = signal<Service[]>([]);
  availabilities = signal<Availability[]>([]);
  reservations = signal<Reservation[]>([]);

  loading = signal(true);

  readonly attentionDialog = viewChild.required(AttentionDialog);

  errorMessage = signal('');
  successMessage = signal('');

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    interval(1000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.now.set(new Date()));
    this.loadDashboard();
  }

  private loadDashboard(): void {
    const professional =
      this.auth.currentUser();

    if (
      !professional ||
      professional.role !== 'PROFESSIONAL'
    ) {
      this.router.navigate(['/login']);
      return;
    }

    this.professional.set(professional);

    // /businesses/me obtiene el perfil asociado
    // directamente al usuario autenticado.
    this.api.getMyBusiness().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (business) => {
        this.business.set(business);

        this.loadBusinessData(
          business.id
        );
      },

      error: (error) => {
        if (error.status === 404) {
          this.router.navigate([
            '/professional/setup'
          ]);

          return;
        }

        console.error(error);

        this.errorMessage.set(
          'No fue posible cargar el panel profesional.'
        );

        this.loading.set(false);
      }
    });
  }

  private loadBusinessData(
    businessId: string
  ): void {
    forkJoin({
      services:
        this.api.getServicesByBusiness(
          businessId
        ),

      availabilities:
        this.api.getAvailabilitiesByBusiness(
          businessId
        ),

      reservations:
        this.api.getReservationsByBusiness(
          businessId
        )
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({
        services,
        availabilities,
        reservations
      }) => {
        this.services.set(services);

        this.availabilities.set(
          [...availabilities].sort(
            (a, b) =>
              a.dayOfWeek - b.dayOfWeek ||
              a.startTime.localeCompare(
                b.startTime
              )
          )
        );

        this.reservations.set(
          [...reservations].sort(
            (a, b) =>
              new Date(
                a.startsAt
              ).getTime() -
              new Date(
                b.startsAt
              ).getTime()
          )
        );

        this.loading.set(false);
        this.watchAgenda(businessId);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          'No fue posible cargar los datos del negocio.'
        );

        this.loading.set(false);
      }
    });
  }

  private watchAgenda(businessId: string): void {
    this.refreshAgenda.pipe(
      map(() => 0),
      startWith(5_000),
      switchMap(delay => timer(delay, 5_000).pipe(exhaustMap(() => {
        this.refreshingAgenda.set(true);
        return this.api.getReservationsByBusiness(businessId).pipe(
          timeout(12_000),
          catchError(() => {
            this.agendaError.set('No pudimos actualizar la agenda. Mostramos la última información disponible.');
            return EMPTY;
          }),
          finalize(() => this.refreshingAgenda.set(false)),
        );
      }))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(reservations => {
      this.reservations.set(reservations);
      this.agendaError.set('');
    });
  }

  refreshReservations(): void {
    this.refreshAgenda.next();
  }

  reprogram(event: Event, id: string, day: string, time: string): void {
    event.preventDefault();
    if (!day || !time) return;
    this.changeReservation(this.api.rescheduleReservation(id, day, time), 'Reserva reprogramada.');
  }

  markNoShow(id: string): void {
    this.changeReservation(this.api.markNoShow(id), 'Inasistencia registrada.');
  }

  private changeReservation(request: ReturnType<ApiService['markNoShow']>, message: string): void {
    if (this.changingReservation()) return;
    this.changingReservation.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    request.pipe(
      finalize(() => this.changingReservation.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: reservation => {
        this.reservations.update(items => items.map(item => item.id === reservation.id ? reservation : item));
        this.editingReservation.set(null);
        this.successMessage.set(message);
        this.refreshReservations();
      },
      error: err => this.errorMessage.set(err?.error?.error ?? 'No fue posible actualizar la reserva.'),
    });
  }

  canMarkNoShow(reservation: Reservation): boolean {
    return new Date(reservation.endsAt) <= this.now();
  }

  completeReservation(reservationId: string): void {
    this.successMessage.set('');
    this.errorMessage.set('');
    const reservation = this.reservations().find(item => item.id === reservationId);
    if (reservation) this.attentionDialog().openReservation(reservation, this.business()?.timezone ?? 'America/Santiago');
  }

  attentionChanged(session: ClientSession): void {
    this.reservations.update(items => items.map(item => item.id === session.reservationId ? { ...item, status: 'COMPLETED' } : item));
    this.refreshReservations();
  }

  activeServicesCount(): number {
    return this.services().filter(
      (service) => service.isActive
    ).length;
  }

  confirmedReservationsCount(): number {
    return this.reservations().filter(
      (reservation) =>
        reservation.status === 'CONFIRMED'
    ).length;
  }

  upcomingReservations = computed(() => {
    const now = this.now();

    // Próximas reservas son las confirmadas
    // cuya hora todavía no ha llegado.
    return this.reservations()
      .filter(
        (reservation) =>
          reservation.status ===
            'CONFIRMED' &&
          new Date(
            reservation.startsAt
          ) > now
      )
      .sort(
        (a, b) =>
          new Date(a.startsAt).getTime() -
          new Date(b.startsAt).getTime()
      );
  });

  readonly closedReservations = computed(() => this.reservations()
    .filter(item => item.status === 'NO_SHOW' || item.status === 'CANCELLED')
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 10));

  pendingAttentionReservations =
    computed(() => {
      const now = this.now();

      // Estas reservas ya ocurrieron pero continúan
      // CONFIRMED, por lo que falta registrar la atención.
      return this.reservations()
        .filter(
          (reservation) =>
            reservation.status ===
              'CONFIRMED' &&
            new Date(
              reservation.startsAt
            ) <= now
        )
        .sort(
          (a, b) =>
            new Date(
              b.startsAt
            ).getTime() -
            new Date(
              a.startsAt
            ).getTime()
        );
    });

  dayName(day: number): string {
    const days:
      Record<number, string> = {
        1: 'Lunes',
        2: 'Martes',
        3: 'Miércoles',
        4: 'Jueves',
        5: 'Viernes',
        6: 'Sábado',
        7: 'Domingo'
      };

    return days[day] ?? 'Día';
  }

  formatDate(value: string): string {
    const business =
      this.business();

    return new Intl.DateTimeFormat(
      'es-CL',
      {
        dateStyle: 'medium',
        timeZone:
          business?.timezone
      }
    ).format(
      new Date(value)
    );
  }

  formatTime(value: string): string {
    const business =
      this.business();

    return new Intl.DateTimeFormat(
      'es-CL',
      {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone:
          business?.timezone
      }
    ).format(
      new Date(value)
    );
  }

  formatPrice(
    price: string | number
  ): string {
    return new Intl.NumberFormat(
      'es-CL',
      {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0
      }
    ).format(
      Number(price)
    );
  }
}
