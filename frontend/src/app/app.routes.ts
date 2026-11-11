import { Routes } from '@angular/router';
import { superadminGuard } from './core/guards/superadmin.guard';
import { accountGuard } from './core/guards/account.guard';
import { Home } from './pages/home/home';
import { Booking } from './pages/booking/booking';
import { ProfessionalDashboard } from './pages/professional-dashboard/professional-dashboard';
import { MyReservations } from './pages/my-reservations/my-reservations';
import { ProfessionalServices } from './pages/professional-services/professional-services';
import { ProfessionalAvailability } from './pages/professional-availability/professional-availability';
import { clientGuard } from './core/guards/client.guard';
import { professionalGuard } from './core/guards/professional.guard';
import { ProfessionalOnboarding } from './pages/professional-onboarding/professional-onboarding';


export const routes: Routes = [
  { path: 'account/profile', loadComponent: () => import('./pages/account-profile/account-profile').then(module => module.AccountProfile), canActivate: [accountGuard] },
  { path: 'companies', loadComponent: () => import('./pages/companies/companies').then(module => module.Companies) },
  { path: 'admin/login', loadComponent: () => import('./pages/admin-login/admin-login').then(module => module.AdminLogin) },
  { path: 'admin', loadComponent: () => import('./pages/admin/admin').then(module => module.Admin), canActivate: [superadminGuard] },
  { path: 'dashboard/history', loadComponent: () => import('./pages/professional-history/professional-history').then(module => module.ProfessionalHistory), canActivate: [professionalGuard] },
  {
    path: '',
    component: Home
  },
  {
    path: 'about',
    loadComponent: () => import('./pages/about/about').then(module => module.About)
  },
  {
    path: 'business/:id',
    loadComponent: () => import('./pages/business/business').then(module => module.Business)
  },
  {
    path: 'booking/:serviceId',
    component: Booking,
    canActivate: [clientGuard]
  },
  {
    path: 'my-reservations',
    component: MyReservations,
    canActivate: [clientGuard]
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then(module => module.Login)
  },
  {
    path: 'dashboard',
    component: ProfessionalDashboard,
    canActivate: [professionalGuard]
  },
  {
    path: 'dashboard/services',
    component: ProfessionalServices,
    canActivate: [professionalGuard]
  },
  {
    path: 'dashboard/availability',
    component: ProfessionalAvailability,
    canActivate: [professionalGuard]
  },
  {
    path: 'professional/setup',
    component: ProfessionalOnboarding,
    canActivate: [professionalGuard]
  },
  {
    path: 'dashboard/profile',
    redirectTo: '/account/profile',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
