import { ValidateForm } from '../../core/forms/validate-form.directive';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { BusinessCategory, businessCategories } from '../../models/business-category';

@Component({ selector: 'app-companies', imports: [ValidateForm, FormsModule, RouterLink, DatePipe], templateUrl: './companies.html', styleUrl: './companies.css' })
export class Companies {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly paymentsAvailable = signal(false);
  readonly configurationLoaded = signal(false);
  readonly subscriptions = signal<{ id: string; status: string; paidUntil: string | null }[]>([]);
  readonly message = signal('');
  readonly cancelling = signal<string | null>(null);
  readonly checkoutOpened = signal(false);
  readonly hasMandate = computed(() => this.subscriptions().some(item => ['authorized', 'paused'].includes(item.status)));
  readonly hasPaidAccess = computed(() => this.subscriptions().some(item => item.paidUntil && Date.parse(item.paidUntil) > Date.now()));
  private lastRefresh = 0;
  acceptedRecurring = false;
  readonly statusLabels: Record<string, string> = { creating: 'Preparando', pending: 'Pendiente de autorización', authorized: 'Autorizada', paused: 'Pausada', cancelled: 'Renovación cancelada' };
  readonly categories = businessCategories;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly step = signal<'business' | 'payment'>('business');
  form = { businessName: '', category: 'GENERAL' as BusinessCategory, description: '' };
  constructor() {
    if (this.route.snapshot.queryParamMap.get('view') === 'subscription' || this.route.snapshot.queryParamMap.has('payment')) {
      void this.router.navigateByUrl('/subscriptions', { replaceUrl: true });
      return;
    }
    if (this.route.snapshot.queryParamMap.get('view') === 'subscription') this.step.set('payment');
    this.api.accountConfiguration().subscribe({ next: config => {
      this.paymentsAvailable.set(config.paymentsAvailable); this.configurationLoaded.set(true);
      if (config.paymentsAvailable && this.auth.isLoggedIn() && (this.route.snapshot.queryParamMap.get('view') === 'subscription' || this.route.snapshot.queryParamMap.has('payment'))) this.refresh();
    }, error: () => this.error.set('No fue posible consultar la disponibilidad del pago.') });
    if (this.auth.isLoggedIn()) {
      this.loadSubscriptions();
      if (this.route.snapshot.queryParamMap.has('payment')) this.step.set('payment');
    }
    if (this.auth.isLoggedIn()) this.api.professionalApplication().subscribe({ next: response => { if (response.application) this.form = { businessName: response.application.businessName, category: response.application.category, description: response.application.description ?? '' }; }, error: () => this.error.set('No fue posible recuperar tu solicitud anterior.') });
  }
  save(): void {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.saved.set(false);
    this.api.saveProfessionalApplication({ ...this.form, businessName: this.form.businessName.trim(), description: this.form.description.trim() }).subscribe({
      next: () => { this.auth.markCompanyApplication(); this.busy.set(false); this.saved.set(true); this.step.set('payment'); },
      error: err => { this.busy.set(false); this.error.set(err?.error?.error ?? 'No fue posible guardar la solicitud.'); }
    });
  }
  activate(): void {
    if (this.busy() || !this.acceptedRecurring || !this.paymentsAvailable()) return;
    // Open during the user's click, before the HTTP request, to avoid popup blocking.
    const checkoutTab = window.open('about:blank', '_blank');
    if (checkoutTab) checkoutTab.opener = null;
    this.busy.set(true); this.error.set('');
    this.api.subscriptionCheckout(this.acceptedRecurring).subscribe({
      next: response => {
        this.busy.set(false); this.checkoutOpened.set(true);
        if (checkoutTab && !checkoutTab.closed) {
          checkoutTab.location.replace(response.checkoutUrl);
          void this.router.navigateByUrl('/subscriptions');
          this.message.set('Completa la suscripción en la pestaña de Mercado Pago. Cuando termines, vuelve a esta pestaña para ver el resultado.');
        } else window.location.assign(response.checkoutUrl);
      },
      error: err => { checkoutTab?.close(); this.busy.set(false); this.loadSubscriptions(); this.error.set(err?.error?.error ?? 'No fue posible iniciar el pago.'); }
    });
  }
  @HostListener('window:focus')
  onFocus(): void {
    if (this.checkoutOpened() && this.auth.isLoggedIn() && !this.busy() && Date.now() - this.lastRefresh >= 15000) this.refresh();
  }
  loadSubscriptions(): void {
    this.api.subscriptions().subscribe({ next: response => { this.subscriptions.set(response.subscriptions); if (response.subscriptions.length) this.step.set('payment'); }, error: () => this.error.set('No fue posible consultar tu suscripción.') });
  }
  refresh(): void {
    if (this.busy()) return;
    this.lastRefresh = Date.now();
    this.busy.set(true); this.error.set(''); this.message.set('');
    this.api.refreshSubscriptions().subscribe({
      next: () => { this.busy.set(false); this.loadSubscriptions(); void this.auth.initialize(); this.message.set('Estado consultado. El acceso se activa cuando se confirma el primer pago.'); },
      error: err => { this.busy.set(false); this.error.set(err?.error?.error ?? 'No fue posible actualizar el estado.'); },
    });
  }
  cancel(id: string): void {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    this.api.cancelSubscription(id).subscribe({
      next: () => { this.busy.set(false); this.cancelling.set(null); this.loadSubscriptions(); this.message.set('Renovación cancelada. Conservas el período ya pagado.'); },
      error: err => { this.busy.set(false); this.error.set(err?.error?.error ?? 'No fue posible cancelar.'); },
    });
  }
}
