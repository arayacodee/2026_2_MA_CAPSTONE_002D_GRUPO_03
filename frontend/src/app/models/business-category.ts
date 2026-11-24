export type BusinessCategory = 'GENERAL' | 'WELLNESS' | 'BEAUTY' | 'AUTOMOTIVE' | 'PETS' | 'EDUCATION' | 'FITNESS' | 'TECHNICAL' | 'HOME';
export type AttentionMode = 'ONSITE' | 'ONLINE' | 'BOTH';
export const businessCategories: { value: BusinessCategory; label: string }[] = [
  { value: 'GENERAL', label: 'Servicios generales' },
  { value: 'WELLNESS', label: 'Bienestar y terapias' },
  { value: 'BEAUTY', label: 'Belleza y cuidado personal' },
  { value: 'AUTOMOTIVE', label: 'Automotriz' },
  { value: 'PETS', label: 'Mascotas' },
  { value: 'EDUCATION', label: 'Clases y asesorías' },
  { value: 'FITNESS', label: 'Deporte y entrenamiento' },
  { value: 'TECHNICAL', label: 'Servicio técnico' },
  { value: 'HOME', label: 'Hogar y mantenimiento' }
];
export const attentionModes = [{ value: 'ONSITE', label: 'Presencial' }, { value: 'ONLINE', label: 'En línea' }, { value: 'BOTH', label: 'Presencial y en línea' }] as const;
export function businessLabels(category?: string) {
  const wellness = category === 'WELLNESS';
  return {
    category: businessCategories.find(item => item.value === category)?.label ?? 'Servicios generales',
    professional: wellness ? 'Terapeuta' : category === 'BEAUTY' ? 'Especialista' : 'Profesional',
    person: wellness ? 'Paciente' : 'Cliente', people: wellness ? 'Pacientes' : 'Clientes',
    service: wellness ? 'Terapia' : 'Servicio', services: wellness ? 'Terapias' : 'Servicios',
    booking: wellness ? 'Cita' : 'Reserva', bookings: wellness ? 'Citas' : 'Reservas',
    reserve: wellness ? 'Reservar cita' : 'Reservar',
    history: wellness ? 'Historial de sesiones' : 'Historial de atenciones'
  };
}
export interface BusinessProfileForm {
  category: BusinessCategory; professionalName: string; specialties: string; address: string; attentionMode: AttentionMode | '';
}
export function profileForm(business?: { category?: BusinessCategory; professionalName?: string | null; specialties?: string | null; address?: string | null; attentionMode?: AttentionMode | null }): BusinessProfileForm {
  return { category: business?.category ?? 'GENERAL', professionalName: business?.professionalName ?? '', specialties: business?.specialties ?? '', address: business?.address ?? '', attentionMode: business?.attentionMode ?? '' };
}
export function profileRequest(form: BusinessProfileForm) {
  return { category: form.category, professionalName: form.professionalName.trim() || null, specialties: form.specialties.trim() || null, address: form.address.trim() || null, attentionMode: form.attentionMode || null };
}
