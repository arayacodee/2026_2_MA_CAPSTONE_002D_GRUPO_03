import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { SessionPage } from '../../models/reservation.model';
import { ProfessionalHistory } from './professional-history';

describe('Historial profesional', () => {
  const session = { id: 'session', notes: 'Nota inicial', amount: '15000', reservation: { service: { name: 'Low fade', price: '20000' } }, occurredAt: '2026-10-05T15:00:00Z', evidences: [] };
  let api: { getMyBusiness: ReturnType<typeof vi.fn>; getSessions: ReturnType<typeof vi.fn>; getAttentionMetrics: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    api = {
      getMyBusiness: vi.fn().mockReturnValue(of({ category: 'WELLNESS' })),
      getSessions: vi.fn().mockReturnValue(of({ items: [session], nextCursor: 'next' })),
      getAttentionMetrics: vi.fn().mockReturnValue(of({ month: '2026-10', timezone: 'America/Santiago', todayCount: 0, monthCount: 1, uniqueClients: 1, revenue: 15000, missingAmountCount: 0, daily: [] })),
    };
    TestBed.configureTestingModule({ imports: [ProfessionalHistory], providers: [provideRouter([]), { provide: ApiService, useValue: api }] });
  });
  it('muestra una tabla de consulta sin formularios dentro de las filas', () => {
    const fixture = TestBed.createComponent(ProfessionalHistory);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
    expect(fixture.nativeElement.querySelector('tbody textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('$15.000');
    expect(fixture.nativeElement.querySelector('tbody').textContent).not.toContain('$20.000');
    expect(fixture.nativeElement.textContent).toContain('Historial de sesiones');
    expect(fixture.nativeElement.querySelector('app-attention-metrics')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Resumen de atenciones');
    expect(fixture.nativeElement.querySelector('tbody').textContent).not.toContain('Sin registro');
  });
  it('distingue un monto cero de un registro antiguo sin monto, sin usar la tarifa actual', () => {
    api.getSessions.mockReturnValue(of({ items: [{ ...session, amount: null }, { ...session, id: 'free', amount: 0 }], nextCursor: null }));
    const fixture = TestBed.createComponent(ProfessionalHistory); fixture.detectChanges();
    const prices = fixture.nativeElement.querySelectorAll('tbody .price');
    expect(prices[0].textContent).toBe('Sin registro');
    expect(prices[1].textContent).toContain('$0');
  });
  it('reemplaza la página, usa el cursor y permite regresar sin duplicados', () => {
    const fixture = TestBed.createComponent(ProfessionalHistory);
    fixture.detectChanges();
    api.getSessions.mockReturnValueOnce(of({ items: [{ ...session, id: 'second' }], nextCursor: null }));
    fixture.componentInstance.next();
    expect(api.getSessions).toHaveBeenLastCalledWith('next', 10, undefined);
    expect(fixture.componentInstance.sessions().map(item => item.id)).toEqual(['second']);
    expect(fixture.componentInstance.page()).toBe(1);
    fixture.componentInstance.previous();
    expect(api.getSessions).toHaveBeenLastCalledWith(undefined, 10, undefined);
    expect(fixture.componentInstance.sessions().map(item => item.id)).toEqual(['session']);
    expect(fixture.componentInstance.page()).toBe(0);
  });
  it('aplica el mes al resumen y a toda la paginación, y descarta solicitudes del filtro anterior', () => {
    const fixture = TestBed.createComponent(ProfessionalHistory);
    fixture.detectChanges();
    fixture.componentInstance.next();
    const pendingPage = new Subject<SessionPage>();
    api.getSessions.mockReturnValueOnce(pendingPage);
    fixture.componentInstance.previous();
    expect(pendingPage.observed).toBe(true);

    const picker: HTMLInputElement = fixture.nativeElement.querySelector('#history-month');
    picker.value = '2026-09';
    picker.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(pendingPage.observed).toBe(false);
    expect(fixture.componentInstance.page()).toBe(0);
    expect(api.getSessions).toHaveBeenLastCalledWith(undefined, 10, '2026-09');
    expect(api.getAttentionMetrics).toHaveBeenLastCalledWith('2026-09');

    fixture.componentInstance.next();
    expect(api.getSessions).toHaveBeenLastCalledWith('next', 10, '2026-09');
    const clear: HTMLButtonElement = fixture.nativeElement.querySelector('.month-controls button');
    clear.click();
    fixture.detectChanges();
    expect(picker.value).toBe('');
    expect(fixture.componentInstance.page()).toBe(0);
    expect(api.getSessions).toHaveBeenLastCalledWith(undefined, 10, undefined);
    expect(api.getAttentionMetrics).toHaveBeenLastCalledWith(undefined);
  });
  it('conserva la página actual si falla la siguiente y permite reintentar', () => {
    const fixture = TestBed.createComponent(ProfessionalHistory);
    fixture.detectChanges();
    api.getSessions.mockReturnValueOnce(throwError(() => ({ error: { error: 'No disponible' } })));
    fixture.componentInstance.next();
    expect(fixture.componentInstance.error()).toBe('No disponible');
    expect(fixture.componentInstance.loading()).toBe(false);
    expect(fixture.componentInstance.page()).toBe(0);
    expect(fixture.componentInstance.sessions()[0].id).toBe('session');
  });
});
