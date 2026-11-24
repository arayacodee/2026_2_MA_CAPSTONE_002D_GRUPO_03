import { Component, input, inject, signal, OnChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { ValidateForm } from '../core/forms/validate-form.directive';
import { imageError } from '../core/forms/image-validation';
interface Photo { id: string; imageUrl: string; caption: string | null; }
@Component({ selector: 'app-business-gallery', imports: [FormsModule, ValidateForm], template: `
<section class="gallery"><h2>Fotos del negocio</h2>
@if (error()) { <p role="alert">{{ error() }}</p> }
@if (editable()) {
<form appValidateForm (validSubmit)="upload(fileInput)"><label>Seleccionar foto<input #fileInput name="image" type="file" accept="image/jpeg,image/png,image/webp" (change)="select($event)" [disabled]="busy()" [attr.aria-invalid]="fileError() ? 'true' : null" [attr.aria-describedby]="fileError() ? 'gallery-file-error' : null"><span id="gallery-file-error" class="field-error" role="alert">{{ fileError() }}</span></label>
<label>Descripción (opcional)<input name="caption" [(ngModel)]="caption" maxlength="300" [disabled]="busy()"></label>
<small>Fotos públicas · JPEG, PNG o WebP · máximo 5 MB. No subas información privada de clientes o pacientes.</small>
<button type="submit" [disabled]="busy() || !file">{{ busy() ? 'Procesando…' : 'Subir foto' }}</button></form>
}
<div class="photos">@for (photo of photos(); track photo.id) {
<figure><a [href]="photo.imageUrl" target="_blank" rel="noopener noreferrer"><img [src]="photo.imageUrl" [alt]="photo.caption || 'Foto del negocio'" loading="lazy"></a>@if (photo.caption) { <figcaption>{{ photo.caption }}</figcaption> }
@if (editable()) { <button type="button" [disabled]="busy()" (click)="remove(photo)">Eliminar foto</button> }</figure>
} @empty { <p>El negocio todavía no ha publicado fotos.</p> }</div></section>`, styles: [`
.gallery { margin: 24px 0 0; padding: 30px; border: 1px solid var(--border); border-radius: var(--radius-large); background: var(--surface); box-shadow: var(--shadow-small); }
h2 { margin: 0 0 10px; font-size: 24px; letter-spacing: -.035em; }
.photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 18px; margin-top: 24px; }
figure { margin: 0; min-width: 0; }
img { width: 100%; height: 220px; object-fit: cover; border-radius: var(--radius-medium); }
figcaption { padding: 10px 0; overflow-wrap: anywhere; color: var(--text-secondary); font-size: 13px; }
form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 24px; min-width: 0; }
label { display: grid; gap: 9px; min-width: 0; font-size: 13px; font-weight: 600; }
input { width: 100%; min-width: 0; max-width: 100%; min-height: 48px; padding: 13px 15px; border: 1px solid #90909a; border-radius: var(--radius-small); background: var(--surface-secondary); color: inherit; font: inherit; font-size: 14px; }
input[type=file] { padding: 8px; font-size: 12px; }
input::file-selector-button { margin-right: 10px; padding: 7px 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-primary); cursor: pointer; font: inherit; font-weight: 600; }
button { min-height: 42px; padding: 10px 17px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-primary); cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; }
button[type=submit] { grid-column: 1 / -1; justify-self: end; background: var(--text-primary); border-color: var(--text-primary); color: white; }
button:disabled { opacity: .5; cursor: default; }
input:focus-visible:not([aria-invalid='true']), button:focus-visible, a:focus-visible { outline: 3px solid #0071e3; outline-offset: 3px; }
small { grid-column: 1 / -1; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.photos > p { grid-column: 1 / -1; margin: 0; padding: 30px; border: 1px dashed var(--border-strong); border-radius: var(--radius-medium); background: var(--surface-secondary); color: var(--text-secondary); font-size: 14px; text-align: center; }
@media (max-width: 520px) { .gallery { padding: 22px; } form { grid-template-columns: 1fr; } button[type=submit] { justify-self: stretch; } }
`] })
export class BusinessGallery implements OnChanges {
  readonly businessId = input.required<string>();
  readonly editable = input(false);
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl.replace(/\/$/, '') + '/api/businesses';
  readonly photos = signal<Photo[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly fileError = signal('');
  file: File | null = null;
  caption = '';
  ngOnChanges(): void { this.http.get<Photo[]>(`${this.base}/${this.businessId()}/photos`).subscribe({ next: photos => this.photos.set(photos), error: () => this.error.set('No fue posible cargar las fotos.') }); }
  select(event: Event): void {
    this.error.set(''); const input = event.target as HTMLInputElement; this.file = input.files?.[0] ?? null;
    this.fileError.set(this.file ? imageError(this.file, 5) : '');
    if (this.fileError()) { this.file = null; input.value = ''; }
  }
  upload(input: HTMLInputElement): void {
    if (!this.file || this.busy()) return;
    const data = new FormData(); data.append('image', this.file); data.append('caption', this.caption);
    this.busy.set(true); this.error.set('');
    this.http.post<Photo>(`${this.base}/me/photos`, data).subscribe({ next: photo => { this.photos.update(photos => [photo, ...photos]); this.file = null; input.value = ''; this.caption = ''; this.busy.set(false); }, error: err => { this.busy.set(false); this.error.set(err?.error?.error ?? 'No fue posible subir la foto.'); } });
  }
  remove(photo: Photo): void {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    this.http.delete(`${this.base}/me/photos/${photo.id}`).subscribe({ next: () => { this.photos.update(photos => photos.filter(item => item.id !== photo.id)); this.busy.set(false); }, error: err => { this.busy.set(false); this.error.set(err?.error?.error ?? 'No fue posible eliminar la foto.'); } });
  }
}
