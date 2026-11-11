import { Component, DestroyRef, OnInit, inject, signal, computed, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Business } from '../../models/business.model';
import { businessLabels } from '../../models/business-category';
import { ClientSession } from '../../models/reservation.model';
import { AttentionDialog } from '../../components/attention-dialog/attention-dialog';
import { AttentionMetrics } from '../../components/attention-metrics/attention-metrics';

@Component({
  selector: 'app-professional-history', imports: [RouterLink, AttentionDialog, AttentionMetrics],
  templateUrl: './professional-history.html', styleUrl: './professional-history.css',
})
export class ProfessionalHistory implements OnInit {
  readonly business = signal<Business | null>(null);
  readonly labels = computed(() => businessLabels(this.business()?.category));
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly detail = viewChild.required(AttentionDialog);
  readonly sessions = signal<ClientSession[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly nextCursor = signal<string | null>(null);
  readonly page = signal(0);
  readonly month = signal('');
  readonly pageSize = 10;
  private cursors: (string | undefined)[] = [undefined];
  private request?: Subscription;

  ngOnInit() {
    this.api.getMyBusiness().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: business => this.business.set(business),
      error: () => this.error.set('No fue posible cargar la configuración del negocio.'),
    });
    this.load();
  }

  load(target = this.page(), cursor = this.cursors[target]) {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.request = this.api.getSessions(cursor, this.pageSize, this.month() || undefined).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)),
    ).subscribe({
      next: result => {
        this.sessions.set(result.items);
        this.page.set(target);
        this.cursors[target] = cursor;
        this.nextCursor.set(result.nextCursor);
      },
      error: error => this.error.set(error?.error?.error ?? 'No fue posible cargar el historial.'),
    });
  }

  selectMonth(month: string) {
    if (month === this.month()) return;

    this.request?.unsubscribe();
    this.month.set(month);
    this.sessions.set([]);
    this.page.set(0);
    this.nextCursor.set(null);
    this.cursors = [undefined];
    this.load();
  }

  next() { const cursor = this.nextCursor(); if (cursor) this.load(this.page() + 1, cursor); }
  previous() { if (this.page() > 0) this.load(this.page() - 1); }
  updateSession(session: ClientSession) { this.sessions.update(items => items.map(item => item.id === session.id ? session : item)); }

  formatDate(session: ClientSession) {
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short',
      timeZone: session.business?.timezone ?? this.business()?.timezone ?? 'America/Santiago',
    }).format(new Date(session.occurredAt));
  }
  formatPrice(value: string | number | null | undefined) {
    return value == null ? 'Sin registro' : new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
    }).format(Number(value));
  }
}
