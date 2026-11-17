import { attentionModes, businessLabels } from '../../models/business-category';

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

function currencyLabel(value: unknown): string {
  const price = text(value);
  return price && Number.isFinite(Number(price)) ? clp.format(Number(price)) : '';
}

function durationLabel(value: unknown): string {
  const minutes = text(value);
  return minutes ? `${minutes} min` : '';
}

function contactLabel(record: AdminRecord, relation: 'client' | 'owner'): string {
  return related(record, relation, 'name') || related(record, relation, 'email');
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
  const person = contactLabel(record, 'client');
  const name = text(record['name']);

  switch (section) {
    case 'users': {
      const email = text(record['email']);
      return summary(name || email || 'Usuario sin nombre', name ? [email] : [], roles[text(record['role'])]);
    }
    case 'businesses': {
      const owner = contactLabel(record, 'owner');
      return summary(name || 'Negocio sin nombre', [owner], { label: businessLabels(text(record['category'])).category, tone: 'neutral' });
    }
    case 'services':
      return summary(name || 'Servicio sin nombre', [
        durationLabel(record['durationMin']), currencyLabel(record['price']),
      ], activeBadge(record['isActive']));
    case 'availabilities': {
      const hours = [text(record['startTime']), text(record['endTime'])].filter(Boolean).join(' – ');
      return summary(weekdays[Number(record['dayOfWeek'])] || 'Horario', [hours], activeBadge(record['isActive']));
    }
    case 'reservations':
      return summary(person || 'Reserva', [related(record, 'service', 'name'), dateLabel(record['startsAt'])], reservationStatuses[text(record['status'])]);
    case 'sessions':
      return summary(person || 'Atención', [dateLabel(record['occurredAt'])]);
    case 'evidences':
      return summary(text(record['caption']) || 'Evidencia fotográfica', [dateLabel(record['createdAt'])]);
  }
}

export function adminRecordFields(section: AdminSectionKey, record: AdminRecord) {
  const fields: [label: string, value: unknown][] = [];
  const { title, badge } = describeAdminRecord(section, record);
  const business = related(record, 'business', 'name') || record['businessId'];

  switch (section) {
    case 'users':
      fields.push(['Nombre', text(record['name']) || 'Sin nombre'], ['Correo electrónico', record['email']], ['Rol', badge?.label]);
      break;
    case 'businesses':
      fields.push(
        ['Nombre', title], ['Tipo de negocio', badge?.label], ['Propietario', contactLabel(record, 'owner') || record['ownerId']],
        ['Profesional o terapeuta', record['professionalName']], ['Especialidades', record['specialties']],
        ['Modalidad de atención', attentionModes.find(mode => mode.value === record['attentionMode'])?.label],
        ['Dirección pública', record['address']], ['Descripción', record['description']],
      );
      break;
    case 'services':
      fields.push(
        ['Nombre', title], ['Negocio', business], ['Estado', badge?.label],
        ['Duración', durationLabel(record['durationMin'])], ['Precio', currencyLabel(record['price'])], ['Descripción', record['description']],
      );
      break;
    case 'availabilities':
      fields.push(['Día', title], ['Negocio', business], ['Inicio', record['startTime']], ['Término', record['endTime']], ['Estado', badge?.label]);
      break;
    case 'reservations':
      fields.push(
        ['Cliente', contactLabel(record, 'client') || record['clientId']], ['Negocio', business], ['Servicio', related(record, 'service', 'name') || record['serviceId']],
        ['Inicio', dateLabel(record['startsAt'])], ['Término', dateLabel(record['endsAt'])], ['Estado', badge?.label],
      );
      break;
    case 'sessions':
      fields.push(
        ['Cliente', contactLabel(record, 'client') || record['clientId']], ['Negocio', business], ['Fecha de atención', dateLabel(record['occurredAt'])],
        ['Monto', currencyLabel(record['amount'])], ['Notas', record['notes']], ['ID de la reserva', record['reservationId']],
      );
      break;
    case 'evidences':
      fields.push(['Descripción', record['caption']], ['Fecha de atención', dateLabel(related(record, 'session', 'occurredAt'))], ['ID de la atención', record['sessionId']]);
      break;
  }

  fields.push(['Fecha de creación', dateLabel(record['createdAt'])], ['Última actualización', dateLabel(record['updatedAt'])], ['ID del registro', record.id]);
  return fields.map(([label, value]) => ({ label, value: text(value) })).filter(field => field.value);
}

export function adminSearchKey(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-CL').trim();
}
