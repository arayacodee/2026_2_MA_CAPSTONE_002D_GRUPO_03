import { afterNextRender, DestroyRef, Directive, effect, ElementRef, inject, input, signal } from '@angular/core';

@Directive({
  selector: '[appAutoplayPreview]',
  exportAs: 'autoplayPreview',
})
export class AutoplayPreview {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentStep = signal(0);
  private readonly visible = signal(false);
  private readonly manuallyPaused = signal(false);
  private readonly motionPreference = signal(false);

  readonly stepCount = input.required<number>({ alias: 'appAutoplayPreview' });
  readonly step = this.currentStep.asReadonly();
  readonly paused = this.manuallyPaused.asReadonly();

  constructor() {
    afterNextRender({ read: () => this.watchVisibility() });
    effect((onCleanup) => {
      const steps = this.stepCount();
      if (!this.visible() || this.paused() || this.motionPreference() || steps < 2) return;

      const interval = window.setInterval(() => {
        this.currentStep.update(step => (step + 1) % steps);
      }, 3200);
      onCleanup(() => window.clearInterval(interval));
    });
  }

  selectStep(step: number): void {
    const resume = this.paused() && this.step() === step;
    this.currentStep.set(step);
    this.manuallyPaused.set(!resume);
  }

  private watchVisibility(): void {
    if (typeof IntersectionObserver === 'undefined') return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => this.motionPreference.set(reducedMotion.matches);
    syncMotionPreference();
    reducedMotion.addEventListener('change', syncMotionPreference);
    this.destroyRef.onDestroy(() => reducedMotion.removeEventListener('change', syncMotionPreference));

    const observer = new IntersectionObserver(([entry]) => {
      this.visible.set(entry.intersectionRatio >= 0.25);
    }, { threshold: 0.25 });
    observer.observe(this.element.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
