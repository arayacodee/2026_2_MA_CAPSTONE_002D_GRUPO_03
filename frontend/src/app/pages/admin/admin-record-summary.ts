import { attentionModes, businessLabels } from '../../models/business-category';

export type AdminSectionKey = 'users' | 'businesses' | 'services' | 'availabilities' | 'reservations' | 'sessions' | 'evidences' | 'subscriptions' | 'audit';
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
  NO_SHOW: { label: 'Inasistencia', tone: 'negative' },
};
const accessGrants: Record<string, string> = { LEGACY: 'Profesional previo', MANUAL: 'Habilitación manual', DEMO: 'Demostración' };
const actions: Record<string, string> = {
  password_changed: 'Cambió contraseña', user_created: 'Habilitó usuario', updated: 'Editó registro',
  disabled: 'Desactivó registro', restored: 'Reactivó registro', deleted: 'Eliminó registro',
  cancelled: 'Canceló reserva', completed: 'Registró atención',
  temporary_access: 'Habilitó acceso temporal',
};
const weekdays = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const dateTime = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' });
const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' });

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' ? String(value) : '';
}

function related(record: AdminRecord, relation: string, key: string): unknown {
  const value = record[relation];
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function relatedText(record: AdminRecord, relation: string, key: string): string {
  return text(related(record, relation, key));
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
  return relatedText(record, relation, 'name') || relatedText(record, relation, 'email');
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
      return summary(name || email || 'Usuario sin nombre', [name ? email : '', accessGrants[text(record['accessGrant'])],
        dateLabel(record['manualAccessUntil']) ? `Acceso temporal hasta ${dateLabel(record['manualAccessUntil'])}` : ''],
        record['isSuspended'] ? { label: 'Suspendido', tone: 'negative' } : roles[text(record['role'])]);
    }
    case 'businesses': {
      const owner = contactLabel(record, 'owner');
      return summary(name || 'Negocio sin nombre', [owner], record['isArchived']
        ? { label: 'Archivado', tone: 'neutral' } : { label: businessLabels(text(record['category'])).category, tone: 'neutral' });
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
      return summary(person || 'Reserva', [text(record['bookedServiceName']) || relatedText(record, 'service', 'name'), dateLabel(record['startsAt'])], reservationStatuses[text(record['status'])]);
    case 'sessions':
      return summary(person || 'Atención', [dateLabel(record['occurredAt'])]);
    case 'evidences':
      return summary(text(record['caption']) || 'Evidencia fotográfica', [dateLabel(record['createdAt'])]);
    case 'subscriptions': {
      const paidUntil = text(record['paidUntil']);
      const manualUntil = relatedText(record, 'user', 'manualAccessUntil');
      let badge: Badge = { label: 'Sin período vigente', tone: 'neutral' };
      if (related(record, 'user', 'isSuspended') === true) badge = { label: 'Cuenta suspendida', tone: 'negative' };
      else if (Date.parse(paidUntil) > Date.now()) badge = { label: 'Período pagado vigente', tone: 'positive' };
      else if (Date.parse(manualUntil) > Date.now()) badge = { label: 'Acceso temporal vigente', tone: 'positive' };
      return summary(text(record['businessName']) || 'Plan de empresa', [
        relatedText(record, 'user', 'email'), dateLabel(paidUntil),
        Date.parse(manualUntil) > Date.now() ? `Acceso temporal hasta ${dateLabel(manualUntil)}` : '',
      ], badge);
    }
    case 'audit':
      return summary(actions[text(record['action'])] || 'Acción administrativa', [dateLabel(record['createdAt']), text(record['reason'])]);
  }
}

export function adminRecordFields(section: AdminSectionKey, record: AdminRecord) {
  const fields: [label: string, value: unknown][] = [];
  const { title, badge } = describeAdminRecord(section, record);
  const business = related(record, 'business', 'name') || record['businessId'];

  switch (section) {
    case 'users':
      fields.push(['Nombre', text(record['name']) || 'Sin nombre'], ['Correo electrónico', record['email']],
        ['Rol', roles[text(record['role'])]?.label], ['Estado', record['isSuspended'] ? 'Suspendido' : 'Activo'],
        ['Acceso profesional', accessGrants[text(record['accessGrant'])]],
        ['Vencimiento del acceso temporal', dateLabel(record['manualAccessUntil'])]);
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
        ['Cliente', contactLabel(record, 'client') || record['clientId']], ['Negocio', business],
        ['Servicio', text(record['bookedServiceName']) || related(record, 'service', 'name') || record['serviceId']],
        ['Tarifa acordada', currencyLabel(record['bookedPrice']) || 'Sin registro'],
        ['Inicio', dateLabel(record['startsAt'])], ['Término', dateLabel(record['endsAt'])], ['Estado', badge?.label],
      );
      if (Array.isArray(record['changes'])) {
        for (const [i, change] of record['changes'].entries()) {
          fields.push([`Cambio de horario ${i + 1}`, `${dateLabel(change.previousStart)} → ${dateLabel(change.newStart)}`]);
        }
      }
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
    case 'subscriptions':
      fields.push(['Negocio', record['businessName']], ['Profesional', relatedText(record, 'user', 'name') || relatedText(record, 'user', 'email')],
        ['Estado en Mercado Pago', record['status']], ['Período pagado hasta', dateLabel(record['paidUntil']) || 'Sin registro'],
        ['Vencimiento del acceso temporal', dateLabel(related(record, 'user', 'manualAccessUntil'))]);
      break;
    case 'audit':
      fields.push(['Actor', record['actorId']], ['Acción', title], ['Sección', record['resource']], ['Registro afectado', record['recordId']], ['Motivo', record['reason']]);
      break;
  }

  fields.push(['Fecha de creación', dateLabel(record['createdAt'])], ['Última actualización', dateLabel(record['updatedAt'])], ['ID del registro', record.id]);
  return fields.map(([label, value]) => ({ label, value: text(value) })).filter(field => field.value);
}
