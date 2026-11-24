import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { contactFields, serviceFields } from '../src/lib/input-validation.js';

test('normaliza teléfonos chilenos y valida longitud y prefijo', () => {
  for (const phone of ['9 1234 5678', '56 9 1234 5678', '+56 (9) 1234-5678']) {
    assert.equal(contactFields.phone.parse(phone), '+56912345678');
  }
  assert.equal(contactFields.phone.parse('+1 (202) 555-0141'), '+12025550141');
  for (const phone of ['sin teléfono', '+56 9 1234', '+56 1 1234 5678', '123456789']) {
    assert.equal(contactFields.phone.safeParse(phone).success, false);
  }
});

test('servicios validan el nombre, la duración y la precisión del precio', () => {
  const schema = z.object(serviceFields);
  const data = { name: '  Consulta  ', durationMin: 30, price: 99999999.99 };
  assert.equal(schema.parse(data).name, 'Consulta');
  for (const change of [{ name: '  ' }, { durationMin: 1440 }, { durationMin: 1.5 }, { price: 1.001 }, { price: 100000000 }]) {
    assert.equal(schema.safeParse({ ...data, ...change }).success, false);
  }
});
