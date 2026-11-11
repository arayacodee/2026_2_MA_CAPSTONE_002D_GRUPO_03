import { afterNextRender, DestroyRef, Directive, ElementRef, inject, signal } from '@angular/core';

@Directive({
  selector: '[appAutoplayPreview]',
  exportAs: 'autoplayPreview',
})
export class AutoplayPreview {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentStep = signal(0);
  readonly step = this.currentStep.asReadonly();

  constructor() {
    afterNextRender({ read: () => this.playWhenVisible() });
  }

  private playWhenVisible(): void {
    if (typeof IntersectionObserver === 'undefined') return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio < 0.5 || this.destroyRef.destroyed) return;

      observer.disconnect();
      if (reducedMotion.matches) return;

      const showSecondStep = window.setTimeout(() => {
        if (!reducedMotion.matches) this.currentStep.set(1);
      }, 1800);
      const showThirdStep = window.setTimeout(() => {
        if (!reducedMotion.matches) this.currentStep.set(2);
      }, 3600);

      this.destroyRef.onDestroy(() => {
        window.clearTimeout(showSecondStep);
        window.clearTimeout(showThirdStep);
      });
    }, { threshold: 0.5 });

    observer.observe(this.element.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
