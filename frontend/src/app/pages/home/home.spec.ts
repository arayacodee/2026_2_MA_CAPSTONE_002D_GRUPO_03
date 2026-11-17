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
