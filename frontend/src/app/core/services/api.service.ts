import { environment } from '../../../environments/environment';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Business, CreateBusinessRequest, UpdateBusinessRequest } from '../../models/business.model';


import {
  Service,
  CreateServiceRequest,
  UpdateServiceRequest
} from '../../models/service.model';


import {
  User,
  AuthResponse
} from '../../models/user.model';

import {
  CreateReservationRequest,
  Reservation,
  CompleteReservationResponse,
  ClientSession,
  SessionEvidence,
  SessionPage
} from '../../models/reservation.model';
import { AttentionMetrics } from '../../models/reservation.model';


import {
  Availability,
  CreateAvailabilityRequest,
  AvailableSlotsResponse
} from '../../models/availability.model';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  activateProfessionalDemo() { return this.http.post<AuthResponse>(`${this.baseUrl}/api/account/professional-application/activate-demo`, {}); }
  passwordLogin(email: string, password: string) { return this.http.post<AuthResponse>(`${this.baseUrl}/api/auth/login`, { email, password }); }
  register(data: { email: string; password: string; firstName: string; lastName: string; phone: string; address: string }) { return this.http.post<AuthResponse>(`${this.baseUrl}/api/auth/register`, data); }
  accountConfiguration() { return this.http.get<{ smsAvailable: boolean; monthlyPrice: number; currency: string; paymentsAvailable: boolean }>(`${this.baseUrl}/api/account/configuration`); }
  updateContact(data: { firstName: string; lastName: string; phone: string; address: string }) { return this.http.patch<AuthResponse>(`${this.baseUrl}/api/account/profile`, data); }
  sendPhoneCode() { return this.http.post<{ message: string }>(`${this.baseUrl}/api/account/phone/send`, {}); }
  checkPhoneCode(code: string) { return this.http.post<AuthResponse>(`${this.baseUrl}/api/account/phone/check`, { code }); }
  professionalApplication() { return this.http.get<{ application: { businessName: string; category: 'GENERAL' | 'WELLNESS' | 'BEAUTY'; description: string | null } | null }>(`${this.baseUrl}/api/account/professional-application`); }
  saveProfessionalApplication(data: { businessName: string; category: 'GENERAL' | 'WELLNESS' | 'BEAUTY'; description: string }) { return this.http.put(`${this.baseUrl}/api/account/professional-application`, data); }
  adminLogin(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/api/auth/admin`, { email, password });
  }
  private readonly baseUrl = environment.apiUrl.replace(/\/$/, '');

  constructor(private readonly http: HttpClient) {}

  getBusinesses(): Observable<Business[]> {
    return this.http.get<Business[]>(
      `${this.baseUrl}/api/businesses`
    );
  }

  getBusinessById(id: string): Observable<Business> {
    return this.http.get<Business>(
      `${this.baseUrl}/api/businesses/${id}`
    );
  }

  getServicesByBusiness(
    businessId: string
  ): Observable<Service[]> {
    return this.http.get<Service[]>(
      `${this.baseUrl}/api/services?businessId=${businessId}`
    );
  }

  getServiceById(id: string): Observable<Service> {
    return this.http.get<Service>(
      `${this.baseUrl}/api/services/${id}`
    );
  }

  createService(
    data: CreateServiceRequest
  ): Observable<Service> {
    return this.http.post<Service>(
      `${this.baseUrl}/api/services`,
      data
    );
  }


  completeReservation(
    reservationId: string,
    notes?: string
  ): Observable<CompleteReservationResponse> {
    // El backend valida que la reserva pertenezca al negocio del profesional autenticado.

    return this.http.patch<CompleteReservationResponse>(
      `${this.baseUrl}/api/reservations/${reservationId}/complete`,
      {
        notes: notes?.trim() || undefined
      }
    );
  }
  updateService(
    id: string,
    data: UpdateServiceRequest
  ): Observable<Service> {
    return this.http.patch<Service>(
      `${this.baseUrl}/api/services/${id}`,
      data
    );
  }


  updateMyBusiness(
    data: UpdateBusinessRequest
  ): Observable<Business> {
    // /me identifica el negocio desde la sesión HttpOnly.
    // Angular no necesita enviar ownerId ni businessId.
    return this.http.patch<Business>(
      `${this.baseUrl}/api/businesses/me`,
      data
    );
  }
  uploadBusinessAvatar(
    file: File
  ): Observable<Business> {
    const formData = new FormData();

    formData.append('image', file);

    // FormData permite enviar el archivo como multipart/form-data.
    // No configuramos Content-Type manualmente: el navegador añade el boundary.
    return this.http.put<Business>(
      `${this.baseUrl}/api/businesses/me/avatar`,
      formData
    );
  }

  uploadBusinessCover(
    file: File
  ): Observable<Business> {
    const formData = new FormData();

    formData.append('image', file);

    // La portada utiliza el mismo flujo multipart del avatar.
    // El navegador configura automáticamente el Content-Type.
    return this.http.put<Business>(
      `${this.baseUrl}/api/businesses/me/cover`,
      formData
    );
  }

  deleteBusinessAvatar(): Observable<Business> {
    return this.http.delete<Business>(`${this.baseUrl}/api/businesses/me/avatar`);
  }

  deleteBusinessCover(): Observable<Business> {
    return this.http.delete<Business>(`${this.baseUrl}/api/businesses/me/cover`);
  }


  getAvailabilitiesByBusiness(
    businessId: string
  ): Observable<Availability[]> {
    return this.http.get<Availability[]>(
      `${this.baseUrl}/api/availabilities?businessId=${businessId}`
    );
  }

  getReservationsByBusiness(
    businessId: string
  ): Observable<Reservation[]> {
    return this.http.get<Reservation[]>(
      `${this.baseUrl}/api/reservations?businessId=${businessId}`
    );
  }

    getAvailableSlots(
    serviceId: string,
    date: string
  ): Observable<AvailableSlotsResponse> {
    return this.http.get<AvailableSlotsResponse>(
      `${this.baseUrl}/api/availabilities/slots` +
      `?serviceId=${encodeURIComponent(serviceId)}` +
      `&date=${encodeURIComponent(date)}`
    );
  }

  getMyReservations(): Observable<Reservation[]> {
    return this.http.get<Reservation[]>(
      `${this.baseUrl}/api/reservations`
    );
  }
  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(
      `${this.baseUrl}/api/users`
    );
  }

  createReservation(
    data: CreateReservationRequest
  ): Observable<Reservation> {
    return this.http.post<Reservation>(
      `${this.baseUrl}/api/reservations`,
      data
    );
  }

  cancelReservation(
    id: string
  ): Observable<Reservation> {
    return this.http.patch<Reservation>(
      `${this.baseUrl}/api/reservations/${id}/cancel`,
      {}
    );
  }

  getMyBusiness(): Observable<Business> {
    return this.http.get<Business>(
      `${this.baseUrl}/api/businesses/me`
    );
  }

  createBusiness(
    data: CreateBusinessRequest
  ): Observable<Business> {
    // El backend obtiene ownerId desde la sesión.
    // Angular solo envía información del perfil.
    return this.http.post<Business>(
      `${this.baseUrl}/api/businesses`,
      data
    );
  }

  createAvailability(
    data: CreateAvailabilityRequest
  ): Observable<Availability> {
    return this.http.post<Availability>(
      `${this.baseUrl}/api/availabilities`,
      data
    );
  }

  deleteAvailability(id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/api/availabilities/${id}`
    );
  }



  googleLogin(
    credential: string
  ): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(
      `${this.baseUrl}/api/auth/google`,
      {
        credential
      }
    );
  }

  getCurrentUser(): Observable<AuthResponse> {
    return this.http.get<AuthResponse>(
      `${this.baseUrl}/api/auth/me`
    );
  }

  logoutSession(): Observable<void> {
    return this.http.post<void>(
      `${this.baseUrl}/api/auth/logout`,
      {}
    );
  }

  getSessions(cursor?: string, limit = 50, month?: string): Observable<SessionPage> {
    return this.http.get<SessionPage>(
      `${this.baseUrl}/api/sessions`,
      { params: { limit, ...(cursor ? { cursor } : {}), ...(month ? { month } : {}) } },
    );
  }

  getAttentionMetrics(month?: string): Observable<AttentionMetrics> {
    return this.http.get<AttentionMetrics>(
      `${this.baseUrl}/api/sessions/metrics`, { params: month ? { month } : {} },
    );
  }

  updateSession(id: string, notes: string | null): Observable<ClientSession> {
    return this.http.patch<ClientSession>(`${this.baseUrl}/api/sessions/${id}`, { notes });
  }

  addEvidence(id: string, file: File, caption: string): Observable<SessionEvidence> {
    const data = new FormData();
    data.append('image', file);
    data.append('caption', caption);
    return this.http.post<SessionEvidence>(`${this.baseUrl}/api/sessions/${id}/evidences`, data);
  }

  deleteEvidence(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/sessions/evidences/${id}`);
  }
}

