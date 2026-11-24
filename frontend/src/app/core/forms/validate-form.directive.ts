import { afterNextRender, Directive, ElementRef, inject, Injector, output, Renderer2 } from '@angular/core';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const phoneFormat = /^(?:\+(?!56)[1-9]\d{7,14}|(?:\+?56)?[2-9]\d{8})$/;
// Same address format used by z.email() on the server.
const emailFormat = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
let errorId = 0;

@Directive({
  selector: 'form[appValidateForm]',
  exportAs: 'appValidateForm',
  host: {
    novalidate: '',
    '(submit)': 'submit($event)',
    '(input)': 'onInput($event)',
    '(change)': 'onInput($event)',
  },
})
export class ValidateForm {
  private readonly form = inject<ElementRef<HTMLFormElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);
  private readonly injector = inject(Injector);
  private readonly errors = new WeakMap<Field, HTMLElement>();
  readonly validSubmit = output<SubmitEvent>();

  submit(event: SubmitEvent): void {
    event.preventDefault();
    if (this.validate()) this.validSubmit.emit(event);
  }

  validate(): boolean {
    let firstInvalid: Field | undefined;
    for (const field of this.fields()) {
      const message = this.getMessage(field);
      this.renderError(field, message);
      if (message) firstInvalid ??= field;
    }
    firstInvalid?.focus();
    return !firstInvalid;
  }

  show(name: string, message: string): void {
    const field = Array.from(this.form.querySelectorAll<Field>('input, select, textarea'))
      .find(field => field.name === name || field.id === name);
    if (!field) return;
    this.renderError(field, message);
    if (!field.disabled) field.focus();
    else afterNextRender(() => {
      if (field.isConnected && !field.disabled) field.focus();
    }, { injector: this.injector });
  }

  reset(): void {
    for (const field of this.fields()) this.renderError(field, '');
  }

  onInput(event: Event): void {
    const field = event.target;
    for (const control of this.fields()) {
      if (this.errors.has(control) && (control === field || field === this.relatedField(control))) {
        this.renderError(control, this.getMessage(control));
      }
    }
  }

  private fields(): Field[] {
    return Array.from(this.form.querySelectorAll<Field>('input:not([type=hidden]), select, textarea'))
      .filter(field => field.willValidate);
  }

  private relatedField(field: Field): Field | undefined {
    const name = field.dataset['after'] ?? field.dataset['match'];
    return name ? this.fields().find(other => other.name === name || other.id === name) : undefined;
  }

  private getMessage(field: Field): string {
    const { valid, badInput, rangeUnderflow, rangeOverflow, stepMismatch, typeMismatch, patternMismatch, valueMissing } = field.validity;
    const value = field.type === 'password' ? field.value : field.value.trim();
    const minLength = Number(field.getAttribute('minlength') ?? 0);
    const maxLength = Number(field.getAttribute('maxlength') ?? Infinity);
    if (badInput) return field.type === 'number' ? 'Ingresa un número válido.' : 'Ingresa una fecha u hora válida.';
    if (valueMissing || (field.required && !value && field.type !== 'checkbox')) {
      return field.dataset['requiredMessage'] ?? (field.type === 'checkbox' ? 'Marca esta opción para continuar.' : 'Completa este campo.');
    }
    if (!value) return '';
    if (value.length < minLength) return `Ingresa al menos ${minLength} caracteres.`;
    if (value.length > maxLength) return `Usa como máximo ${maxLength} caracteres.`;
    if (field.type === 'email' && (typeMismatch || (field.dataset['publicEmail'] !== undefined && !emailFormat.test(value)))) return 'Usa un correo válido, por ejemplo nombre@correo.cl.';
    if (field.type === 'tel' && !phoneFormat.test(value.replace(/[\s()-]/g, ''))) return 'Usa un número como +56 9 1234 5678 o 9 1234 5678.';
    if (rangeUnderflow || rangeOverflow) {
      const min = field.getAttribute('min');
      const max = field.getAttribute('max');
      if (field.type === 'date' && rangeUnderflow) return 'Elige la fecha indicada o una posterior.';
      return min !== null && max !== null ? `Ingresa un valor entre ${min} y ${max}.` : rangeUnderflow ? `Ingresa un valor desde ${min}.` : `Ingresa un valor de hasta ${max}.`;
    }
    if (stepMismatch && field.type === 'number') return field.getAttribute('step') === '0.01' ? 'Usa hasta dos decimales.' : 'Ingresa un número entero.';
    const related = this.relatedField(field);
    if (related?.value && field.dataset['after'] && value <= related.value) return 'Elige una hora posterior a la de inicio.';
    if (related && field.dataset['match'] && value !== related.value) return 'Repite la misma contraseña.';
    if (patternMismatch || !valid) return 'Revisa el formato de este campo.';
    return '';
  }

  private renderError(field: Field, message: string): void {
    let error = this.errors.get(field);
    const descriptions = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== error?.id);
    if (message) {
      if (!error) {
        error = this.renderer.createElement('span') as HTMLElement;
        this.renderer.setAttribute(error, 'id', `field-error-${++errorId}`);
        this.renderer.setAttribute(error, 'class', 'field-error');
        // Keep the help out of an enclosing label's name. aria-describedby still exposes it.
        this.renderer.setAttribute(error, 'aria-hidden', 'true');
        this.renderer.insertBefore(field.parentNode, error, field.nextSibling);
        this.errors.set(field, error);
      }
      this.renderer.setProperty(error, 'textContent', message);
      this.renderer.setAttribute(field, 'aria-invalid', 'true');
      descriptions.push(error.id);
    } else {
      if (!error) return;
      this.renderer.removeChild(error.parentNode, error);
      this.errors.delete(field);
      this.renderer.removeAttribute(field, 'aria-invalid');
    }
    if (descriptions.length) this.renderer.setAttribute(field, 'aria-describedby', descriptions.join(' '));
    else this.renderer.removeAttribute(field, 'aria-describedby');
  }
}
