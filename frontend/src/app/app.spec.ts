import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { testProviders } from './testing/test-providers';
import { AuthService } from './core/services/auth.service';
import { signal } from '@angular/core';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: testProviders() }).compileComponents();
  });
  it('renderiza sin sesión y sin depender de servicios externos', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeTruthy();
    const adminAccess = fixture.nativeElement.querySelector('footer a[href="/admin/login"]');
    expect(adminAccess?.textContent.trim()).toBe('Acceso administración');
  });
  it('muestra Resumen para profesionales y lo dirige al historial', () => {
    TestBed.overrideProvider(AuthService, { useValue: {
      currentUser: signal({ name: 'Profesional' }), isProfessional: () => true,
      isClient: () => false, isSuperadmin: () => false,
    } });
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const summary = fixture.nativeElement.querySelector('nav a[href="/dashboard/history"]');
    expect(summary?.textContent.trim()).toBe('Resumen');
    const profile = fixture.nativeElement.querySelector('.account-name');
    expect(profile.tagName).toBe('A');
    expect(profile.getAttribute('href')).toBe('/account/profile');
    expect(profile.textContent.trim()).toBe('Profesional');
    expect(fixture.nativeElement.textContent).not.toContain('Mis datos');
  });
  it('permite abrir el perfil desde el correo cuando la cuenta no tiene nombre', () => {
    TestBed.overrideProvider(AuthService, { useValue: {
      currentUser: signal({ name: null, email: 'cliente@ejemplo.cl' }), isProfessional: () => false,
      isClient: () => true, isSuperadmin: () => false,
    } });
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.account-name').textContent.trim()).toBe('cliente@ejemplo.cl');
    expect(fixture.nativeElement.querySelectorAll('a[href="/account/profile"]').length).toBe(1);
  });
  it('oculta Resumen cuando no hay sesión profesional', () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav a[href="/dashboard/history"]')).toBeNull();
  });
});
