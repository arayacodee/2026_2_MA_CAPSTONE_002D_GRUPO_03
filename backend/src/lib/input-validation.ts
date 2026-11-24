import { z } from 'zod';

export const contactFields = {
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(300),
  phone: z.string().trim().min(1).max(40).transform(value => {
    const number = value.replace(/[\s()-]/g, '');
    if (/^56[2-9]\d{8}$/.test(number)) return `+${number}`;
    return /^[2-9]\d{8}$/.test(number) ? `+56${number}` : number;
  }).pipe(z.string().regex(/^(?:\+56[2-9]\d{8}|\+(?!56)[1-9]\d{7,14})$/)),
};

export const serviceFields = {
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  durationMin: z.number().int().min(1).max(1439),
  price: z.number().min(0).max(99999999.99).multipleOf(0.01),
  isActive: z.boolean().optional(),
};
