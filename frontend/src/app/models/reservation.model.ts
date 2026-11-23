import { Business } from './business.model';
import { Service } from './service.model';
import { User } from './user.model';

export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface Reservation {
  id: string;
  businessId: string;
  serviceId: string;
  clientId: string;

  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  bookedServiceName?: string | null;
  bookedDurationMin?: number | null;
  bookedPrice?: string | number | null;

  createdAt: string;
  updatedAt: string;

  business?: Business;
  service?: Service;
  client?: User;
}

export interface CreateReservationRequest {
  serviceId: string;
  startsAt: string;
}

export interface ClientSession {
  id: string;
  businessId: string;
  clientId: string;
  reservationId: string;
  occurredAt: string;
  notes: string | null;
  amount?: string | number | null;
  createdAt: string;
  updatedAt: string;
  client?: Pick<User, 'id' | 'name' | 'email'>;
  business?: Pick<Business, 'id' | 'name' | 'timezone'>;
  reservation?: Reservation;
  evidences?: SessionEvidence[];
}

export interface SessionEvidence {
  id: string;
  sessionId: string;
  imageUrl: string | null;
  caption: string | null;
  createdAt: string;
}

export interface SessionPage {
  items: ClientSession[];
  nextCursor: string | null;
}

export interface CompleteReservationResponse {
  reservation: Reservation;
  session: ClientSession;
}

export interface AttentionMetrics {
  month: string;
  timezone: string;
  todayCount: number;
  monthCount: number;
  uniqueClients: number;
  revenue: number;
  missingAmountCount: number;
  daily: { date: string; count: number }[];
}
