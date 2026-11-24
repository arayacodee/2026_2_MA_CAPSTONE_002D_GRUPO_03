import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Home } from './home';
import { ApiService } from '../../core/services/api.service';
import { testProviders } from '../../testing/test-providers';

describe('Home', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Home], providers: testProviders() }).compileComponents();
  });
  it('renderiza sin sesión y sin depender de servicios externos', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('filtra los rubros nuevos y permite volver a todos', () => {
    TestBed.overrideProvider(ApiService, { useValue: { getBusinesses: () => of([
      { id: 'auto', name: 'Taller', category: 'AUTOMOTIVE' },
      { id: 'pet', name: 'Peluquería canina', category: 'PETS' },
    ]) } });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    const filter = [...page.querySelectorAll<HTMLButtonElement>('.category-filters button')].find(button => button.textContent?.trim() === 'Mascotas')!;
    filter.click();
    fixture.detectChanges();
    expect(page.querySelectorAll('.business-card').length).toBe(1);
    expect(page.querySelector('.business-card h3')?.textContent?.trim()).toBe('Peluquería canina');
    page.querySelector<HTMLButtonElement>('.category-filters button')!.click();
    fixture.detectChanges();
    expect(page.querySelectorAll('.business-card').length).toBe(2);
  });

  it('muestra una portada decorativa sin foto y conserva la foto del siguiente negocio', () => {
    TestBed.overrideProvider(ApiService, { useValue: {
      getBusinesses: () => of([
        { id: 'sin-foto', name: 'Negocio sin foto', category: 'BEAUTY', avatarUrl: null },
        { id: 'con-foto', name: 'Negocio con foto', category: 'WELLNESS', avatarUrl: '/foto.jpg' },
      ]),
    } });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const page: HTMLElement = fixture.nativeElement;
    const [fallback, photo] = page.querySelectorAll('.business-card');
    expect(fallback.querySelector('.business-art-beauty .business-art-glyph')).not.toBeNull();
    expect(fallback.querySelector('.business-visual img')).toBeNull();
    expect(fallback.querySelector('.business-art')?.getAttribute('aria-hidden')).toBe('true');
    expect(photo.querySelector('.business-visual img')?.getAttribute('src')).toBe('/foto.jpg');
    expect(photo.querySelector('h3')?.textContent?.trim()).toBe('Negocio con foto');
  });
});
