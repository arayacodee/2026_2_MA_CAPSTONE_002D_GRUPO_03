import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize, interval, timeout } from 'rxjs';
import { RouterLink } from '@angular/router';

import { ApiService } from '../../core/services/api.service';
import { Reservation } from '../../models/reservation.model';
import { User } from '../../models/user.model';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-my-reservations',
  imports: [RouterLink],
  templateUrl: './my-reservations.html',
  styleUrl: './my-reservations.css'
})
export class MyReservations implements OnInit {
  client = signal<User | null>(null);
  reservations = signal<Reservation[]>([]);

  loading = signal(true);
  errorMessage = signal('');
  cancellingId = signal<string | null>(null);
  readonly refreshing = signal(false);
  readonly refreshError = signal('');
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    const currentUser = this.auth.currentUser();

    if (!currentUser || currentUser.role !== 'CLIENT') {
      this.errorMessage.set(
        'Debes ingresar como cliente.'
      );

      this.loading.set(false);
      return;
    }

    this.client.set(currentUser);

    this.loadReservations();
    interval(5_000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadReservations());
  }


  private loadReservations(): void {
    if (this.refreshing() || this.cancellingId()) return;
    this.refreshing.set(true);
    this.request = this.api.getMyReservations().pipe(
      timeout(12_000),
      finalize(() => this.refreshing.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (reservations) => {
        const ordered = [...reservations].sort(
          (a, b) =>
            new Date(a.startsAt).getTime() -
            new Date(b.startsAt).getTime()
        );

        this.reservations.set(ordered);
        this.refreshError.set('');
        this.loading.set(false);
      },

      error: (error) => {
        console.error(error);

        this.refreshError.set('No fue posible actualizar tus reservas.');

        this.loading.set(false);
      }
    });
  }

  cancelReservation(reservation: Reservation): void {
    if (this.cancellingId()) return;
    if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) {
      return;
    }

    this.cancellingId.set(reservation.id);
    this.request?.unsubscribe();
    this.errorMessage.set('');

    this.api.cancelReservation(reservation.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (cancelled) => {
        this.reservations.update((reservations) =>
          reservations.map((reservation) =>
            reservation.id === cancelled.id
              ? {
                  ...reservation,
                  status: cancelled.status,
                  updatedAt: cancelled.updatedAt,
                }
              : reservation
          )
        );

        this.cancellingId.set(null);
      },

      error: (error) => {
        console.error(error);

        this.errorMessage.set(
          error?.error?.error ??
            'No fue posible cancelar la reserva.'
        );

        this.cancellingId.set(null);
      }
    });
  }

  formatDate(value: string, timezone = 'America/Santiago'): string {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'full', timeZone: timezone
    }).format(new Date(value));
  }

  formatTime(value: string, timezone = 'America/Santiago'): string {
    return new Intl.DateTimeFormat('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false, timeZone: timezone
    }).format(new Date(value));
  }

  formatPrice(price: string | number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(Number(price));
  }

  statusLabel(
    status: Reservation['status']
  ): string {
    switch (status) {
      case 'PENDING':
        return 'Pendiente';

      case 'CONFIRMED':
        return 'Confirmada';

      case 'COMPLETED':
        return 'Atendida';

      case 'CANCELLED':
        return 'Cancelada';
      case 'NO_SHOW':
        return 'Inasistencia';

      default:
        return 'Desconocido';
    }
  }
}
