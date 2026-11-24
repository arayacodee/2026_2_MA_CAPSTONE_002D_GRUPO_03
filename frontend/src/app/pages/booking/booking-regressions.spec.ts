import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Booking } from './booking';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { Business } from '../../models/business.model';

describe('Reservas: fechas y solicitudes de horarios', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Booking], providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ serviceId: 'service' }) } } },
      { provide: AuthService, useValue: { currentUser: signal({ id: 'client', role: 'CLIENT' }) } }
    ] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  it('cancela la consulta anterior al cambiar de fecha', () => {
    const fixture = TestBed.createComponent(Booking);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/api/services/service`).flush({ id: 'service', businessId: 'business' });
    http.expectOne(`${environment.apiUrl}/api/businesses/business`).flush({ id: 'business', timezone: 'America/Santiago' });
    const input = document.createElement('input');
    input.type = 'date';
    input.addEventListener('change', event => fixture.componentInstance.onDateChange(event));
    const change = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('change'));
    };
    change('2026-10-07');
    const previous = http.expectOne(req => req.params.get('date') === '2026-10-07' || req.url.includes('date=2026-10-07'));
    change('2026-10-08');
    expect(previous.cancelled).toBe(true);
    http.expectOne(req => req.url.includes('date=2026-10-08')).flush({ slots: ['10:00'] });
    expect(fixture.componentInstance.availableTimes()).toEqual(['10:00']);
    fixture.destroy();
  });

  it('calcula la fecha mínima en la zona del negocio y no en UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'));
    const fixture = TestBed.createComponent(Booking);
    fixture.componentInstance.business.set({ timezone: 'America/Santiago' } as Business);
    expect(fixture.componentInstance.minDate()).toBe('2026-10-05');
    fixture.destroy();
  });

  it('mantiene visible el error de reserva mientras recarga horarios', () => {
    const fixture = TestBed.createComponent(Booking);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/api/services/service`).flush({ id: 'service', businessId: 'business' });
    http.expectOne(`${environment.apiUrl}/api/businesses/business`).flush({ id: 'business', timezone: 'America/Santiago' });
    const component = fixture.componentInstance;
    component.selectedDate.set('2026-10-08');
    component.selectedTime.set('10:00');
    component.availableTimes.set(['10:00']);
    component.confirmReservation();
    http.expectOne(`${environment.apiUrl}/api/reservations`).flush({ error: 'Horario ocupado' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(req => req.url.includes('/slots')).flush({ slots: [] });
    expect(component.errorMessage()).toBe('Horario ocupado');
    fixture.destroy();
  });
});
