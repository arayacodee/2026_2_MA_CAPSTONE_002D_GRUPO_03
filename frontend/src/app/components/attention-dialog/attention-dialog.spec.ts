import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Reservation, ClientSession } from '../../models/reservation.model';
import { AttentionDialog } from './attention-dialog';

describe('Registro de atención en ventana', () => {
  const reservation = { id: 'reservation', clientId: 'client', startsAt: '2026-10-05T15:00:00Z',
    client: { id: 'client', name: 'Ana' }, service: { name: 'Corte', price: '15000' } } as Reservation;
  const session = { id: 'session', reservationId: 'reservation', reservation, notes: 'Nota', amount: null, occurredAt: reservation.startsAt, evidences: [] } as unknown as ClientSession;
  let api: { completeReservation: ReturnType<typeof vi.fn>; updateSession: ReturnType<typeof vi.fn>; addEvidence: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    // jsdom has no modal top layer. Only the native browser methods are stubbed.
    HTMLDialogElement.prototype.showModal = function() { this.open = true; };
    HTMLDialogElement.prototype.close = function() { this.open = false; };
    api = {
      completeReservation: vi.fn().mockReturnValue(of({ reservation: { ...reservation, status: 'COMPLETED' }, session })),
      updateSession: vi.fn().mockReturnValue(of(session)),
      addEvidence: vi.fn().mockReturnValue(of({ id: 'image' })),
    };
    TestBed.configureTestingModule({ imports: [AttentionDialog], providers: [{ provide: ApiService, useValue: api }] });
  });
  it('abrir y cancelar no completa la reserva; guardar registra notas e imagen', () => {
    const fixture = TestBed.createComponent(AttentionDialog); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openReservation(reservation, 'America/Santiago'); fixture.detectChanges();
    expect(api.completeReservation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Ana');
    component.close();
    expect(api.completeReservation).not.toHaveBeenCalled();
    component.openReservation(reservation, 'America/Santiago');
    component.notes.setValue('Nota'); component.caption.setValue('Resultado');
    const file = new File(['image'], 'corte.png', { type: 'image/png' }); component.file.set(file);
    component.save();
    expect(api.completeReservation).toHaveBeenCalledExactlyOnceWith('reservation', 'Nota');
    expect(api.addEvidence).toHaveBeenCalledWith('session', file, 'Resultado');
    expect(component.busy()).toBe(false);
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
  });
  it('conserva la atención ante un fallo de imagen y reintenta sin volver a completar', () => {
    const fixture = TestBed.createComponent(AttentionDialog); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openReservation(reservation, 'America/Santiago');
    component.file.set(new File(['image'], 'corte.png', { type: 'image/png' }));
    api.addEvidence.mockReturnValueOnce(throwError(() => ({ error: { error: 'Error de imagen' } })));
    component.save();
    expect(component.session()?.id).toBe('session'); expect(component.file()).not.toBeNull();
    expect(component.error()).toContain('reintentar'); expect(component.busy()).toBe(false);
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
    component.save();
    expect(api.completeReservation).toHaveBeenCalledTimes(1);
    expect(api.addEvidence).toHaveBeenCalledTimes(2);
    expect(component.session()?.evidences?.length).toBe(1);
  });
  it('impide guardar notas largas y rechaza archivos incompatibles', () => {
    const fixture = TestBed.createComponent(AttentionDialog); fixture.detectChanges();
    const component = fixture.componentInstance; component.openReservation(reservation, 'America/Santiago');
    component.notes.setValue('a'.repeat(1501)); component.save();
    expect(api.completeReservation).not.toHaveBeenCalled();
    component.selectFile({ target: { files: [new File(['pdf'], 'x.pdf', { type: 'application/pdf' })], value: 'x' } } as unknown as Event);
    expect(component.file()).toBeNull(); expect(component.fileError()).toContain('JPEG');
  });
  it('un fallo al editar notas conserva el detalle y no afirma que se guardaron', () => {
    const fixture = TestBed.createComponent(AttentionDialog); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openSession(session); component.editing.set(true); component.notes.setValue('Cambio');
    api.updateSession.mockReturnValueOnce(throwError(() => ({ error: { error: 'Sin conexión' } })));
    component.save();
    expect(component.session()?.notes).toBe('Nota');
    expect(component.notes.value).toBe('Cambio');
    expect(component.error()).toBe('Sin conexión');
    expect(component.busy()).toBe(false);
  });
  it('el detalle conserva el monto registrado y distingue montos desconocidos y cero', () => {
    const fixture = TestBed.createComponent(AttentionDialog); fixture.detectChanges();
    for (const [amount, expected] of [[null, 'Sin valor registrado'], ['5000', '$5.000'], [0, '$0']] as const) {
      fixture.componentInstance.openSession({ ...session, amount }); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.summary').textContent).toContain(expected);
      expect(fixture.nativeElement.querySelector('.summary').textContent).not.toContain('$15.000');
      fixture.componentInstance.close();
    }
  });
  it('antes de registrar una atención muestra la tarifa vigente del servicio', () => {
    const fixture = TestBed.createComponent(AttentionDialog); fixture.detectChanges();
    fixture.componentInstance.openReservation(reservation, 'America/Santiago'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.summary').textContent).toContain('$15.000');
  });
});
