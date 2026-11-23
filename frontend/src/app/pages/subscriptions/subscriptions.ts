import { Component, HostListener, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

interface Subscription { id: string; status: string; paidUntil: string | null; businessName: string }

@Component({
  selector: 'app-subscriptions', imports: [DatePipe, RouterLink],
  templateUrl: './subscriptions.html', styleUrl: './subscriptions.css',
})
export class Subscriptions {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly subscriptions = signal<Subscription[]>([]);
  readonly manualAccessUntil = signal<string | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly available = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly cancelling = signal<string | null>(null);
  private lastRefresh = 0;
  constructor() { void this.initialize(); }

  private async load(): Promise<void> {
    const result = await firstValueFrom(this.api.subscriptions());
    this.subscriptions.set(result.subscriptions);
    this.manualAccessUntil.set(result.manualAccessUntil);
  }
  private async initialize(): Promise<void> {
    try {
      await this.load();
      const configuration = await firstValueFrom(this.api.accountConfiguration());
      this.available.set(configuration.paymentsAvailable);
      if (configuration.paymentsAvailable && this.subscriptions().length) await this.refresh();
    } catch { this.error.set('No pudimos cargar tu suscripción. Vuelve a intentar.'); }
    finally { this.loading.set(false); }
  }
  paid(subscription: Subscription): boolean { return Boolean(subscription.paidUntil && Date.parse(subscription.paidUntil) > Date.now()); }
  manualAccessActive(): boolean {
    return Date.parse(this.manualAccessUntil() ?? '') > Date.now();
  }
  label(subscription: Subscription): string {
    if (subscription.status === 'cancelled') return this.paid(subscription) ? 'Activa · sin renovación' : 'Cancelada';
    if (this.paid(subscription)) return 'Activa';
    return ({ authorized: 'Esperando confirmación del cobro', pending: 'Pendiente de autorización', creating: 'Preparando suscripción', paused: 'Pausada' } as Record<string, string>)[subscription.status] ?? 'En revisión';
  }
  canCancel(subscription: Subscription): boolean { return ['pending', 'authorized', 'paused'].includes(subscription.status); }
  @HostListener('window:focus')
  onFocus(): void {
    if (this.available() && !this.loading() && this.subscriptions().length && Date.now() - this.lastRefresh >= 30000) void this.refresh();
  }
  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.lastRefresh = Date.now();
    try {
      if (this.available() && this.subscriptions().length) await firstValueFrom(this.api.refreshSubscriptions());
      await this.load(); await this.auth.initialize();
    } catch { this.error.set('No pudimos actualizar el estado. La información guardada se mantiene; intenta nuevamente.'); }
    finally { this.busy.set(false); }
  }
  async cancel(id: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    try {
      await firstValueFrom(this.api.cancelSubscription(id));
      await this.load(); this.cancelling.set(null);
      this.message.set('Renovación cancelada. Conservas el acceso hasta terminar el período pagado.');
    } catch { this.error.set('No pudimos confirmar la cancelación. Actualiza el estado antes de volver a intentar.'); }
    finally { this.busy.set(false); }
  }
}
