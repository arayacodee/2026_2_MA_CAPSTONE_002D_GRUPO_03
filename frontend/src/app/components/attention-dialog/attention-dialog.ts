import { afterNextRender, Component, DestroyRef, ElementRef, inject, Injector, output, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, map, switchMap, finalize } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ValidateForm } from '../../core/forms/validate-form.directive';
import { imageError } from '../../core/forms/image-validation';
import { ClientSession, Reservation, SessionEvidence } from '../../models/reservation.model';

@Component({
  selector: 'app-attention-dialog', imports: [ReactiveFormsModule, ValidateForm],
  templateUrl: './attention-dialog.html', styleUrl: './attention-dialog.css',
})
export class AttentionDialog {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly notesField = viewChild<ElementRef<HTMLTextAreaElement>>('notesField');
  readonly changed = output<ClientSession>();
  readonly saved = output<void>();
  readonly reservation = signal<Reservation | null>(null);
  readonly session = signal<ClientSession | null>(null);
  readonly editing = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly fileError = signal('');
  readonly file = signal<File | null>(null);
  readonly notes = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1500)] });
  readonly caption = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] });
  timezone = 'America/Santiago';

  openReservation(reservation: Reservation, timezone: string) {
    this.reset();
    this.reservation.set(reservation);
    this.timezone = timezone;
    this.editing.set(true);
    this.dialog().nativeElement.showModal();
  }

  openSession(session: ClientSession) {
    this.reset();
    this.session.set(session);
    this.reservation.set(session.reservation ?? null);
    this.timezone = session.business?.timezone ?? 'America/Santiago';
    this.notes.setValue(session.notes ?? '');
    this.dialog().nativeElement.showModal();
  }

  close(event?: Event) {
    if (this.busy()) { event?.preventDefault(); return; }
    this.dialog().nativeElement.close();
  }

  edit() {
    this.editing.set(true);
    afterNextRender(() => this.notesField()?.nativeElement.focus(), { injector: this.injector });
  }

  selectFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.fileError.set(imageError(file, 5));
    if (this.fileError()) {
      this.file.set(null);
      return;
    }
    this.error.set('');
    this.file.set(file);
  }

  save() {
    if (this.busy() || this.notes.invalid || this.caption.invalid) return;
    const reservation = this.reservation();
    const existing = this.session();
    if (!reservation && !existing) return;
    this.busy.set(true);
    this.error.set('');
    this.notes.disable();
    this.caption.disable();
    let notesSaved = false;
    const save = existing
      ? this.api.updateSession(existing.id, this.notes.value).pipe(map(updated => ({ ...existing, ...updated })))
      : this.api.completeReservation(reservation!.id, this.notes.value).pipe(map(result => ({
          ...result.session, reservation: { ...reservation!, status: 'COMPLETED' as const },
          client: reservation?.client, business: reservation?.business,
        })));
    save.pipe(
      switchMap(session => {
        // Keep the persisted session on upload failure; retries never complete twice.
        this.session.set(session);
        notesSaved = true;
        const file = this.file();
        if (file) this.changed.emit(session);
        return file ? this.api.addEvidence(session.id, file, this.caption.value).pipe(
          map(evidence => ({ ...session, evidences: [evidence, ...(session.evidences ?? [])] }))
        ) : of(session);
      }),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.busy.set(false); this.notes.enable(); this.caption.enable(); }),
    ).subscribe({
      next: session => {
        this.session.set(session);
        this.changed.emit(session);
        this.file.set(null);
        this.dialog().nativeElement.close();
        this.saved.emit();
      },
      error: error => this.error.set((notesSaved ? 'La atención y la nota están guardadas. Puedes reintentar la imagen. ' : '') +
        (error?.error?.error ?? 'No fue posible guardar. Intenta nuevamente.')),
    });
  }

  removeEvidence(evidence: SessionEvidence) {
    if (this.busy() || !window.confirm('¿Eliminar esta imagen de la atención?')) return;
    this.busy.set(true);
    this.error.set('');
    this.api.deleteEvidence(evidence.id).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        const session = this.session()!;
        const updated = { ...session, evidences: session.evidences?.filter(item => item.id !== evidence.id) };
        this.session.set(updated);
        this.changed.emit(updated);
      },
      error: error => this.error.set(error?.error?.error ?? 'No fue posible eliminar la imagen.'),
    });
  }

  formatDate(value: string) {
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: this.timezone }).format(new Date(value));
  }

  formatPrice(value: string | number | null | undefined) {
    return value == null ? 'Sin valor registrado' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value));
  }

  private reset() {
    this.reservation.set(null); this.session.set(null); this.editing.set(false);
    this.error.set(''); this.fileError.set(''); this.file.set(null); this.notes.reset(''); this.caption.reset('');
  }
}
