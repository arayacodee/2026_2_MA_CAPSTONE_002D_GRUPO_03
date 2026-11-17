import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/services/api.service';
import { AuthService } from '../core/services/auth.service';

export function testProviders() {
  return [
    provideHttpClient(), provideHttpClientTesting(),
    provideRouter([{ path: 'login', children: [] }, { path: 'professional/setup', children: [] }]),
    { provide: ApiService, useValue: {
      getBusinesses: () => of([]),
      getMyBusiness: () => of({ id: 'business', name: 'Negocio', description: null, timezone: 'America/Santiago', avatarUrl: null, coverUrl: null })
    } },
    { provide: AuthService, useValue: {
      currentUser: signal(null), isClient: () => false, isProfessional: () => false, isSuperadmin: () => false,
      managesCompany: () => false,
      isLoggedIn: () => false, logout: () => of(undefined)
    } }
  ];
}
