import { businessLabels } from '../../models/business-category';

export type AdminSectionKey = 'users' | 'businesses' | 'services' | 'availabilities' | 'reservations' | 'sessions' | 'evidences';
export interface AdminRecord { id: string; [key: string]: unknown; }

interface Badge {
  label: string;
  tone: 'neutral' | 'info' | 'positive' | 'pending' | 'negative';
}

const roles: Record<string, Badge> = {
  SUPERADMIN: { label: 'Superadmin', tone: 'info' },
  PROFESSIONAL: { label: 'Profesional', tone: 'info' },
  CLIENT: { label: 'Cliente', tone: 'neutral' },
};
const reservationStatuses: Record<string, Badge> = {
  PENDING: { label: 'Pendiente', tone: 'pending' },
  CONFIRMED: { label: 'Confirmada', tone: 'info' },
  COMPLETED: { label: 'Completada', tone: 'positive' },
  CANCELLED: { label: 'Cancelada', tone: 'negative' },
};
const weekdays = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const dateTime = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' });
const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' });

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

function related(record: AdminRecord, relation: string, key: string): string {
  const value = record[relation];
  return value && typeof value === 'object' ? text((value as Record<string, unknown>)[key]) : '';
}

function dateLabel(value: unknown): string {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? '' : dateTime.format(date);
}

function summary(title: string, context: string[], badge?: Badge) {
  return {
    title,
    description: context.filter(Boolean).join(' · '),
    initials: title.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('es-CL'),
    badge,
  };
}

function activeBadge(value: unknown): Badge | undefined {
  if (value === true) return { label: 'Activo', tone: 'positive' };
  if (value === false) return { label: 'Inactivo', tone: 'neutral' };
  return undefined;
}

export function describeAdminRecord(section: AdminSectionKey, record: AdminRecord) {
  const business = related(record, 'business', 'name');
  const person = related(record, 'client', 'name') || related(record, 'client', 'email');
  const name = text(record['name']);

  switch (section) {
    case 'users': {
      const email = text(record['email']);
      return summary(name || email || 'Usuario sin nombre', name ? [email] : [], roles[text(record['role'])]);
    }
    case 'businesses': {
      const owner = related(record, 'owner', 'name') || related(record, 'owner', 'email');
      return summary(name || 'Negocio sin nombre', [owner], { label: businessLabels(text(record['category'])).category, tone: 'neutral' });
    }
    case 'services': {
      const duration = text(record['durationMin']);
      const price = text(record['price']);
      return summary(name || 'Servicio sin nombre', [
        business, duration ? `${duration} min` : '', price && Number.isFinite(Number(price)) ? clp.format(Number(price)) : '',
      ], activeBadge(record['isActive']));
    }
    case 'availabilities': {
      const hours = [text(record['startTime']), text(record['endTime'])].filter(Boolean).join(' – ');
      return summary(weekdays[Number(record['dayOfWeek'])] || 'Horario', [hours, business], activeBadge(record['isActive']));
    }
    case 'reservations':
      return summary(person || 'Reserva', [related(record, 'service', 'name'), business, dateLabel(record['startsAt'])], reservationStatuses[text(record['status'])]);
    case 'sessions':
      return summary(person || 'Atención', [business, dateLabel(record['occurredAt'])]);
    case 'evidences':
      return summary(text(record['caption']) || 'Evidencia fotográfica', [dateLabel(record['createdAt'])]);
  }
}

export function adminSearchKey(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-CL').trim();
}
