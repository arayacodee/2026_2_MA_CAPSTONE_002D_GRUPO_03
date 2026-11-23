import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { businessCategories, attentionModes } from '../../models/business-category';
import { AdminRecord, AdminSectionKey, adminRecordFields, describeAdminRecord } from './admin-record-summary';

interface Field { key: string; label: string; type: 'text' | 'number' | 'time' | 'checkbox' | 'textarea' | 'role' | 'category' | 'mode'; }
interface Section { key: AdminSectionKey; label: string; fields: Field[]; }
interface AdminPage { items: AdminRecord[]; hasMore: boolean; }
const field = (key: string, label: string, type: Field['type'] = 'text'): Field => ({ key, label, type });

@Component({ selector: 'app-admin', imports: [FormsModule, NgTemplateOutlet], templateUrl: './admin.html', styleUrl: './admin.css' })
export class Admin {
  readonly categories = businessCategories;
  readonly modes = attentionModes;
  readonly recordFields = adminRecordFields;
  private readonly injector = inject(Injector);
  private readonly editor = viewChild<ElementRef<HTMLElement>>('editor');
  private readonly sectionTitle = viewChild<ElementRef<HTMLHeadingElement>>('sectionTitle');
  private readonly businessRecords = viewChild<ElementRef<HTMLElement>>('businessRecords');
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private listRequest?: Subscription;
  private businessRequest?: Subscription;
  private editorTrigger?: HTMLElement;
  private readonly base = `${environment.apiUrl.replace(/\/$/, '')}/api/admin`;
  private readonly pageSize = 20;
  private readonly businessPageSize = 10;
  readonly sections: Section[] = [
    { key: 'users', label: 'Usuarios', fields: [field('name', 'Nombre'), field('role', 'Rol', 'role')] },
    { key: 'businesses', label: 'Negocios', fields: [field('name', 'Nombre'), field('description', 'Descripción', 'textarea'), field('category', 'Tipo de negocio', 'category'), field('professionalName', 'Profesional o terapeuta'), field('specialties', 'Especialidades', 'textarea'), field('address', 'Dirección pública'), field('attentionMode', 'Modalidad de atención', 'mode')] },
    { key: 'services', label: 'Servicios', fields: [field('name', 'Nombre'), field('description', 'Descripción', 'textarea'), field('durationMin', 'Duración en minutos', 'number'), field('price', 'Precio', 'number'), field('isActive', 'Activo', 'checkbox')] },
    { key: 'availabilities', label: 'Horarios', fields: [field('dayOfWeek', 'Día (1 lunes – 7 domingo)', 'number'), field('startTime', 'Inicio', 'time'), field('endTime', 'Término', 'time'), field('isActive', 'Activo', 'checkbox')] },
    { key: 'reservations', label: 'Reservas', fields: [] },
    { key: 'sessions', label: 'Atenciones', fields: [field('notes', 'Notas', 'textarea')] },
    { key: 'evidences', label: 'Evidencias', fields: [field('caption', 'Descripción', 'textarea')] },
    { key: 'subscriptions', label: 'Suscripciones', fields: [] },
    { key: 'audit', label: 'Bitácora', fields: [] },
  ];
  readonly section = signal(this.sections[0]);
  readonly grouped = computed(() => ['services', 'availabilities', 'reservations', 'sessions', 'evidences'].includes(this.section().key));
  readonly businesses = signal<AdminRecord[]>([]);
  readonly businessRows = computed(() => this.businesses().map(record => ({
    record,
    ...describeAdminRecord('businesses', record),
  })));
  readonly openBusiness = signal<AdminRecord | null>(null);
  readonly businessPage = signal(1);
  readonly moreBusinesses = signal(false);
  readonly loadingBusinesses = signal(false);
  readonly businessError = signal('');
  readonly records = signal<AdminRecord[]>([]);
  readonly search = signal('');
  readonly rows = computed(() => this.records().map(record => ({
    record,
    ...describeAdminRecord(this.section().key, record),
  })));
  readonly appliedSearch = signal('');
  readonly page = signal(1);
  readonly hasMore = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly loadError = signal('');
  readonly message = signal('');
  readonly expandedId = signal<string | null>(null);
  readonly selected = signal<AdminRecord | null>(null);
  readonly passwordUser = signal<AdminRecord | null>(null);
  newPassword = '';
  confirmPassword = '';
  readonly creating = signal(false);
  readonly deleting = signal<AdminRecord | null>(null);
  readonly settingState = signal<AdminRecord | null>(null);
  readonly grantingAccess = signal<{ rowId: string; user: AdminRecord } | null>(null);
  reason = '';
  readonly warning = signal('');
  readonly deletionEffects: Partial<Record<AdminSectionKey, string>> = {
    users: 'Solo se pueden eliminar cuentas sin negocio, reservas ni historial de suscripción. Si el usuario vuelve a ingresar con Google, podrá crear una cuenta nueva.',
    businesses: 'Solo se pueden eliminar negocios sin reservas. Se eliminarán sus servicios, horarios e imágenes públicas.',
    services: 'Solo se pueden eliminar servicios que nunca se reservaron.',
    availabilities: 'Se eliminará este horario disponible. Las reservas existentes se conservarán.',
    evidences: 'Se eliminarán la evidencia y su archivo de imagen. La atención y la reserva se conservarán.'
  };
  draft: Record<string, string | number | boolean | null> = {};
  constructor() { this.load(); }

  change(section: Section): void {
    if (this.saving() || section.key === this.section().key) return;
    this.businessRequest?.unsubscribe();
    this.resetBusinessSelection();
    this.section.set(section);
    this.businesses.set([]);
    this.businessPage.set(1);
    this.moreBusinesses.set(false);
    this.loadingBusinesses.set(false);
    this.businessError.set('');
    this.message.set('');
    this.warning.set('');
    this.refresh();
    this.revealSection();
  }

  refresh(): void {
    if (this.grouped() && !this.openBusiness()) this.loadBusinesses();
    else this.load();
  }

  applySearch(value = this.search()): void {
    this.search.set(value);
    this.appliedSearch.set(value.trim());
    this.page.set(1);
    this.resetRecordPanels();
    this.load();
  }

  loadBusinesses(): void {
    if (!this.grouped() || this.saving()) return;
    this.businessRequest?.unsubscribe();
    this.loadingBusinesses.set(true);
    this.businessError.set('');
    this.moreBusinesses.set(false);
    this.businessRequest = this.http.get<AdminPage>(
      `${this.base}/${this.section().key}/businesses`,
      { params: { page: this.businessPage(), limit: this.businessPageSize } },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        if (!data.items.length && this.businessPage() > 1) {
          this.businessPage.set(1);
          this.loadBusinesses();
          return;
        }
        this.businesses.set(data.items);
        this.moreBusinesses.set(data.hasMore);
        this.loadingBusinesses.set(false);
      },
      error: err => {
        this.businessError.set(err?.error?.error ?? 'No fue posible cargar los negocios.');
        this.loadingBusinesses.set(false);
      },
    });
  }

  paginateBusinesses(delta: -1 | 1): void {
    if (this.loadingBusinesses() || this.saving() || (delta === -1 ? this.businessPage() === 1 : !this.moreBusinesses())) return;
    this.resetBusinessSelection();
    this.businessPage.update(value => value + delta);
    this.loadBusinesses();
    this.revealSection(true);
  }

  toggleBusiness(business: AdminRecord): void {
    if (this.saving()) return;
    const open = this.openBusiness()?.id !== business.id;
    this.resetBusinessSelection();
    if (!open) return;

    this.message.set('');
    this.warning.set('');
    this.openBusiness.set(business);
    this.load();
    this.revealSection(false, true);
  }

  private resetBusinessSelection(): void {
    this.listRequest?.unsubscribe();
    this.openBusiness.set(null);
    this.resetRecordPanels();
    this.records.set([]);
    this.page.set(1);
    this.search.set('');
    this.appliedSearch.set('');
    this.hasMore.set(false);
    this.loading.set(false);
    this.error.set('');
    this.loadError.set('');
  }

  load(): void {
    const business = this.openBusiness();
    if (this.saving() || (this.grouped() && !business)) return;
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.loadError.set('');
    this.error.set('');
    this.hasMore.set(false);
    this.records.set([]);
    const params: Record<string, string | number> = business
      ? { page: this.page(), limit: this.businessPageSize, businessId: business.id }
      : { page: this.page(), limit: this.pageSize };
    if (this.appliedSearch()) params['q'] = this.appliedSearch();
    this.listRequest = this.http.get<AdminPage>(
      `${this.base}/${this.section().key}`, { params },
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.records.set(data.items);
        this.hasMore.set(data.hasMore);
        this.loading.set(false);
      },
      error: err => {
        this.loadError.set(err?.error?.error ?? 'No fue posible cargar los datos.');
        this.loading.set(false);
      },
    });
  }
  paginate(delta: -1 | 1): void {
    if (this.loading() || this.saving() || (delta === -1 ? this.page() === 1 : !this.hasMore())) return;
    this.resetRecordPanels();
    this.page.update(value => value + delta);
    this.load();
    this.revealSection(true, this.grouped());
  }

  private revealSection(focus = false, withinBusiness = false): void {
    afterNextRender(() => {
      const title = withinBusiness ? this.businessRecords()?.nativeElement : this.sectionTitle()?.nativeElement;
      title?.scrollIntoView?.({ block: 'nearest' });
      if (focus) title?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  private resetRecordPanels(): void {
    this.expandedId.set(null);
    this.editorTrigger = undefined;
    this.close();
    this.closePassword();
    this.deleting.set(null);
    this.settingState.set(null);
    this.grantingAccess.set(null);
    this.reason = '';
  }

  toggleRecord(record: AdminRecord): void {
    if (this.saving()) return;
    const open = this.expandedId() !== record.id;
    this.resetRecordPanels();
    this.error.set('');
    if (open) this.expandedId.set(record.id);
  }

  title(record: AdminRecord): string { return describeAdminRecord(this.section().key, record).title; }
  value(record: AdminRecord, key: string): string { return String(record[key] ?? ''); }
  edit(record: AdminRecord, trigger?: HTMLElement): void {
    this.expandedId.set(record.id);
    this.closePassword();
    this.deleting.set(null);
    this.settingState.set(null);
    this.grantingAccess.set(null);
    this.selected.set(record); this.creating.set(false); this.error.set(''); this.message.set(''); this.draft = {};
    for (const item of this.section().fields) {
      const value = record[item.key];
      this.draft[item.key] = item.type === 'number' ? Number(value) : item.type === 'checkbox' ? Boolean(value) : String(value ?? '');
    }
    this.revealEditor(trigger);
  }
  private revealEditor(trigger?: HTMLElement, selector = 'input, textarea, select'): void {
    this.editorTrigger = trigger;
    afterNextRender(() => {
      const form = this.editor()?.nativeElement;
      form?.scrollIntoView?.({ block: 'nearest' });
      form?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  dismissEditor(): void {
    this.close();
    this.closePassword();
    this.deleting.set(null);
    this.settingState.set(null);
    this.grantingAccess.set(null);
    this.error.set('');
    this.editorTrigger?.focus();
    this.editorTrigger = undefined;
  }

  newUser(trigger?: HTMLElement): void {
    this.resetRecordPanels();
    this.creating.set(true);
    this.draft = { email: '', name: '', role: 'PROFESSIONAL' };
    this.error.set('');
    this.message.set('');
    this.revealEditor(trigger);
  }
  closePassword(): void { this.passwordUser.set(null); this.newPassword = ''; this.confirmPassword = ''; }
  editPassword(record: AdminRecord, trigger?: HTMLElement): void {
    if (this.saving() || record['role'] === 'SUPERADMIN') return;
    this.expandedId.set(record.id);
    this.settingState.set(null);
    this.grantingAccess.set(null);
    this.close(); this.deleting.set(null); this.closePassword(); this.passwordUser.set(record); this.error.set(''); this.message.set('');
    this.revealEditor(trigger);
  }
  savePassword(): void {
    const user = this.passwordUser();
    if (!user || this.saving()) return;
    if (this.newPassword.length < 8 || this.newPassword !== this.confirmPassword) { this.error.set('Usa al menos 8 caracteres y confirma la misma contraseña.'); return; }
    this.saving.set(true); this.error.set('');
    this.http.patch<{ message: string }>(`${this.base}/users/${user.id}/password`, { password: this.newPassword }).subscribe({
      next: result => { this.saving.set(false); this.closePassword(); this.message.set(result.message); },
      error: err => { this.saving.set(false); this.newPassword = ''; this.confirmPassword = ''; this.error.set(err?.error?.error ?? 'No fue posible cambiar la contraseña.'); }
    });
  }
  requestDeletion(record: AdminRecord, trigger?: HTMLElement): void {
    if (this.saving() || record['role'] === 'SUPERADMIN' || !this.deletionEffects[this.section().key]) return;
    this.settingState.set(null);
    this.grantingAccess.set(null);
    this.reason = '';
    this.expandedId.set(record.id);
    this.closePassword();
    this.close(); this.deleting.set(record); this.error.set(''); this.message.set(''); this.warning.set('');
    this.revealEditor(trigger, '.cancel-deletion');
  }
  confirmDeletion(): void {
    const record = this.deleting();
    if (!record || this.saving()) return;
    if (this.reason.trim().length < 3) { this.error.set('Indica el motivo de la eliminación.'); return; }
    this.saving.set(true); this.error.set('');
    this.http.delete<{ message: string; warning: string | null }>(`${this.base}/${this.section().key}/${record.id}`, { body: { confirm: true, reason: this.reason.trim() } }).subscribe({
      next: result => {
        this.saving.set(false); this.message.set(result.message); this.warning.set(result.warning ?? '');
        if (this.openBusiness() && this.records().length === 1 && this.page() === 1 && !this.hasMore()) {
          this.resetBusinessSelection();
          this.loadBusinesses();
          this.revealSection(true);
          return;
        }
        this.resetRecordPanels();
        if (this.records().length === 1 && this.page() > 1) this.page.update(value => value - 1);
        this.load();
      },
      error: err => { this.saving.set(false); this.error.set(err?.error?.error ?? 'No fue posible eliminar el registro.'); }
    });
  }
  stateActionLabel(record: AdminRecord): string {
    switch (this.section().key) {
      case 'users': return record['role'] === 'SUPERADMIN' ? '' : record['isSuspended'] ? 'Reactivar cuenta' : 'Suspender cuenta';
      case 'businesses': return record['isArchived'] ? 'Publicar negocio' : 'Archivar negocio';
      case 'services': return record['isActive'] ? 'Desactivar servicio' : 'Activar servicio';
      default: return '';
    }
  }

  requestStateChange(record: AdminRecord, trigger: HTMLElement): void {
    this.resetRecordPanels();
    this.expandedId.set(record.id);
    this.settingState.set(record);
    this.revealEditor(trigger);
  }

  saveState(): void {
    const record = this.settingState();
    if (!record || this.saving()) return;
    if (this.reason.trim().length < 3) { this.error.set('Indica el motivo del cambio.'); return; }
    const section = this.section().key;
    const disabled = section === 'users' ? !record['isSuspended'] : section === 'businesses' ? !record['isArchived'] : Boolean(record['isActive']);
    this.saving.set(true);
    this.error.set('');
    this.http.patch<{ message: string }>(`${this.base}/${section}/${record.id}/state`, { disabled, reason: this.reason.trim() }).subscribe({
      next: result => { this.saving.set(false); this.settingState.set(null); this.message.set(result.message); this.load(); },
      error: err => { this.saving.set(false); this.error.set(err?.error?.error ?? 'No fue posible guardar el cambio.'); },
    });
  }

  temporaryAccessUser(record: AdminRecord): AdminRecord | null {
    const section = this.section().key;
    const user = section === 'users' ? record : section === 'subscriptions' ? record['user'] : null;
    if (!user || typeof user !== 'object' || !('role' in user)) return null;
    if (user.role !== 'PROFESSIONAL' && !(section === 'subscriptions' && user.role === 'CLIENT')) return null;
    return 'id' in user && typeof user.id === 'string' ? user as AdminRecord : null;
  }

  requestTemporaryAccess(record: AdminRecord, user: AdminRecord, trigger: HTMLElement): void {
    this.resetRecordPanels();
    this.expandedId.set(record.id);
    this.grantingAccess.set({ rowId: record.id, user });
    this.error.set('');
    this.message.set('');
    this.revealEditor(trigger);
  }

  saveTemporaryAccess(event: Event, duration: string, reason: string): void {
    event.preventDefault();
    const target = this.grantingAccess();
    const months = Number(duration);
    if (!target || this.saving()) return;
    if (![1, 2, 3].includes(months) || reason.trim().length < 3) {
      this.error.set('Selecciona 1, 2 o 3 meses e indica el motivo.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const subscriptionId = target.user['role'] === 'CLIENT' ? target.rowId : undefined;
    this.http.patch<{ message: string }>(`${this.base}/users/${target.user.id}/temporary-access`, {
      months, reason: reason.trim(), ...(subscriptionId ? { subscriptionId } : {}),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.saving.set(false);
          this.dismissEditor();
          this.message.set(result.message);
          this.load();
        },
        error: err => {
          this.saving.set(false);
          this.error.set(err?.error?.error ?? 'No fue posible habilitar el acceso temporal.');
        },
      });
  }
  close(): void { this.selected.set(null); this.creating.set(false); }
  save(): void {
    const data = { ...this.draft };
    const record = this.selected();
    if (this.section().key === 'users' && record?.['role'] === 'SUPERADMIN') delete data['role'];
    for (const key of ['name', 'description', 'notes', 'caption', 'professionalName', 'specialties', 'address', 'attentionMode']) if (data[key] === '') data[key] = null;
    this.saving.set(true); this.error.set('');
    const request = this.creating() ? this.http.post(`${this.base}/users`, data) : this.http.patch(`${this.base}/${this.section().key}/${record!.id}`, data);
    request.subscribe({ next: () => { this.saving.set(false); this.close(); this.message.set('Cambios guardados.'); this.load(); }, error: err => { this.saving.set(false); this.error.set(err?.error?.error ?? 'No fue posible guardar los cambios.'); } });
  }
  reservationAction(record: AdminRecord, action: 'cancel' | 'complete'): void {
    this.saving.set(true); this.error.set(''); this.message.set('');
    this.http.patch(`${this.base}/reservations/${record.id}/${action}`, {}).subscribe({ next: () => { this.saving.set(false); this.message.set(action === 'cancel' ? 'Reserva cancelada.' : 'Atención registrada.'); this.load(); }, error: err => { this.saving.set(false); this.error.set(err?.error?.error ?? 'No fue posible actualizar la reserva.'); } });
  }
}
