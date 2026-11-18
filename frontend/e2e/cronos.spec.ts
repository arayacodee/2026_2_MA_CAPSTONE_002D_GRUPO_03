import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

const businessName = process.env['E2E_BUSINESS'] || 'Barberia De Prueba';
const serviceName = process.env['E2E_SERVICE'] || 'Low fade';

type Role = 'CLIENT' | 'PROFESSIONAL' | 'ADMIN';
type SessionCookies = Awaited<ReturnType<BrowserContext['cookies']>>;
const sessions = new Map<Role, SessionCookies>();

async function writePassword(input: Locator, value: string) {
  // fill incluye el valor en el título del paso. Así la contraseña queda fuera del informe.
  await input.evaluate((element, password) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, password);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function submitForm(page: Page, path = '/api/auth/login', button = 'Ingresar') {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST'),
    page.getByRole('main').locator('form').getByRole('button', { name: button, exact: true }).click(),
  ]);
  return response;
}

function account(role: Role) {
  const user = process.env[`E2E_${role}_USER`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  test.skip(!user || !password, `Faltan las variables E2E_${role}_USER y E2E_${role}_PASSWORD.`);
  return { user: user!, password: password! };
}

async function signIn(page: Page, role: Role) {
  const { user, password } = account(role);
  const cookies = sessions.get(role);
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: /^Mi perfil: / })).toBeVisible();
    return;
  }
  const admin = role === 'ADMIN';
  await page.goto(admin ? '/admin/login' : '/login');
  if (!admin) await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const form = page.getByRole('main').locator('form');
  await form.getByLabel(admin ? 'Usuario' : 'Correo electrónico', { exact: true }).fill(user);
  await writePassword(form.getByLabel('Contraseña', { exact: true }), password);
  const path = admin ? '/api/auth/admin' : '/api/auth/login';
  const response = await submitForm(page, path);
  expect(response.status(), `El inicio de sesión del rol ${role} debe responder 200`).toBe(200);
  sessions.set(role, await page.context().cookies());
}

async function openBusiness(page: Page) {
  await page.goto('/');
  const business = page.getByRole('link').filter({ has: page.getByRole('heading', { name: businessName, exact: true }) });
  await business.click();
  await expect(page).toHaveURL(/\/business\/[^/]+$/);
  await expect(page.getByRole('heading', { name: businessName, exact: true })).toBeVisible();
}

function reserveLink(page: Page) {
  return page.getByRole('article')
    .filter({ has: page.getByRole('heading', { name: serviceName, exact: true }) })
    .getByRole('link', { name: /Reservar/ });
}

test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  const passed = info.status === 'passed';
  const skipped = info.status === 'skipped';
  const label = skipped ? 'OMITIDA' : passed ? 'APROBADA' : 'FALLIDA';
  const color = skipped ? '#854d0e' : passed ? '#166534' : '#b91c1c';
  const symbol = skipped ? '–' : passed ? '✓' : '✗';
  await page.evaluate(({ title, label, color, symbol }) => {
    const banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.dataset['testResult'] = label;
    banner.textContent = `${symbol} PRUEBA ${label}\n${title}`;
    Object.assign(banner.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
      maxWidth: 'min(520px, calc(100vw - 32px))', padding: '16px 20px',
      border: '2px solid #fff', borderRadius: '12px', background: color,
      color: '#fff', font: '600 15px/1.5 Arial, sans-serif', whiteSpace: 'pre-line',
      boxShadow: '0 8px 24px #0003', pointerEvents: 'none',
    });
    document.body.append(banner);
  }, { title: info.title, label, color, symbol });
  const screenshot = info.outputPath('resultado.png');
  await page.screenshot({ path: screenshot, animations: 'disabled', timeout: 5_000 });
  await info.attach(`Resultado ${label}`, { path: screenshot, contentType: 'image/png' });
  // Deja visible el resultado al final de la grabación.
  await page.waitForTimeout(1_200);
});

test('01 · Validación · Rechaza el correo vacío', { tag: '@validacion' }, async ({ page }) => {
  await page.goto('/login?mode=login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico', exact: true });
  await writePassword(page.getByLabel('Contraseña', { exact: true }), 'Clave-de-validacion-123');
  expect(await email.evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  const response = await submitForm(page);
  expect(response.status()).toBe(400);
  await expect(page.getByText('Ingresa un correo y una contraseña válidos.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?mode=login$/);
});

test('02 · Validación · Rechaza el formato de correo incorrecto', { tag: '@validacion' }, async ({ page }) => {
  await page.goto('/login?mode=login');
  const email = page.getByRole('textbox', { name: 'Correo electrónico', exact: true });
  await email.fill('correo-invalido');
  await writePassword(page.getByLabel('Contraseña', { exact: true }), 'Clave-de-validacion-123');
  expect(await email.evaluate(element => (element as HTMLInputElement).validity.typeMismatch)).toBe(true);
  const response = await submitForm(page);
  expect(response.status()).toBe(400);
  await expect(page.getByText('Ingresa un correo y una contraseña válidos.', { exact: true })).toBeVisible();
});

test('03 · Validación · Rechaza la contraseña vacía', { tag: '@validacion' }, async ({ page }) => {
  await page.goto('/login?mode=login');
  await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill('validacion@cronos.example.invalid');
  const password = page.getByLabel('Contraseña', { exact: true });
  expect(await password.evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
  const response = await submitForm(page);
  expect(response.status()).toBe(400);
  await expect(page.getByText('Ingresa un correo y una contraseña válidos.', { exact: true })).toBeVisible();
});

test('04 · Validación · Rechaza una contraseña de registro de tres caracteres', { tag: '@validacion' }, async ({ page }) => {
  await page.goto('/login?mode=register');
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Prueba');
  await page.getByRole('textbox', { name: 'Apellido', exact: true }).fill('Validacion');
  await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill('validacion-e2e@cronos.example.invalid');
  await writePassword(page.getByLabel('Contraseña', { exact: true }), '123');
  await page.getByRole('textbox', { name: 'Número de teléfono', exact: true }).fill('+56911111111');
  await page.getByRole('textbox', { name: 'Dirección', exact: true }).fill('Direccion de prueba 123');
  const response = await submitForm(page, '/api/auth/register', 'Crear cuenta');
  expect(response.status()).toBe(400);
  await expect(page.getByText('Completa todos los datos. La contraseña debe tener al menos 8 caracteres.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?mode=register$/);
});

test('05 · Validación · Rechaza la contraseña incorrecta de una cuenta existente', { tag: '@validacion' }, async ({ page }) => {
  const { user } = account('CLIENT');
  await page.goto('/login?mode=login');
  await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(user);
  await writePassword(page.getByLabel('Contraseña', { exact: true }), 'Contrasena-incorrecta-e2e');
  const response = await submitForm(page);
  expect(response.status()).toBe(401);
  await expect(page.getByText('Correo o contraseña incorrectos.', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('link', { name: 'Mis reservas', exact: true })).toHaveCount(0);
});

test('06 · Acceso · Pide iniciar sesión al reservar como visitante', { tag: '@acceso' }, async ({ page }) => {
  await openBusiness(page);
  const link = reserveLink(page);
  const bookingPath = await link.getAttribute('href');
  await link.click();
  await expect(page.getByRole('heading', { name: 'Bienvenido a Cronos' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(bookingPath);
});

test('07 · Acceso · Restringe el panel de administración al cliente', { tag: '@acceso' }, async ({ page }) => {
  await signIn(page, 'CLIENT');
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(nav.getByRole('link', { name: 'Mis reservas' })).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(nav.getByRole('link', { name: 'Mis reservas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ingresa al panel' })).toBeVisible();
});

test('08 · Flujo · El cliente reserva y consulta su nueva reserva', { tag: '@flujo' }, async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, 'CLIENT');
  await openBusiness(page);
  await reserveLink(page).click();
  await expect(page).toHaveURL(/\/booking\/[^/]+$/);
  const serviceId = new URL(page.url()).pathname.split('/').pop()!;
  const dateInput = page.getByLabel(/^Fecha de la /);
  await expect(dateInput).toBeVisible();
  const minimum = await dateInput.getAttribute('min');
  expect(minimum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(`${minimum}T12:00:00Z`);
  let selected: { date: string; time: string; timezone: string } | undefined;

  for (let offset = 1; offset <= 14; offset++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0, 10);
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/availabilities/slots'
          && url.searchParams.get('serviceId') === serviceId
          && url.searchParams.get('date') === day;
      }),
      dateInput.fill(day),
    ]);
    expect(response.ok(), 'La consulta de horarios debe finalizar correctamente').toBe(true);
    const available = await response.json() as { timezone: string; slots: string[] };
    expect(Array.isArray(available.slots)).toBe(true);
    if (available.slots.length) {
      selected = { date: day, time: available.slots[0], timezone: available.timezone };
      break;
    }
  }

  if (!selected) throw new Error('El servicio de prueba necesita un horario libre en los próximos catorce días.');
  await page.getByRole('button', { name: selected.time, exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Confirma tu / })).toBeVisible();
  const [creation] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/reservations'
      && response.request().method() === 'POST'),
    page.getByRole('button', { name: /^Confirmar / }).click(),
  ]);
  expect(creation.status(), 'La reserva debe quedar creada en la base de datos').toBe(201);
  const created = await creation.json() as { id: string; serviceId: string; startsAt: string; status: string };
  expect(created.id).toBeTruthy();
  expect(created).toMatchObject({ serviceId, status: 'CONFIRMED' });
  await test.info().attach('Reserva creada', {
    body: JSON.stringify({ id: created.id, serviceId, startsAt: created.startsAt, ...selected }, null, 2),
    contentType: 'application/json',
  });
  await expect(page.getByRole('status').filter({
    hasText: `Reserva confirmada para ${selected.time}.`,
  })).toBeVisible();

  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/reservations' && response.request().method() === 'GET'),
    page.getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Mis reservas' }).click(),
  ]);
  expect(response.ok(), 'La consulta de reservas del cliente debe finalizar correctamente').toBe(true);
  const reservations = await response.json() as { id: string; serviceId: string; startsAt: string }[];
  expect(reservations).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: created.id, serviceId, startsAt: created.startsAt }),
  ]));
  await expect(page).toHaveURL(/\/my-reservations$/);
  await expect(page.getByRole('heading', { name: 'Mis reservas', exact: true })).toBeVisible();
  const dateLabel = new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'full', timeZone: selected.timezone,
  }).format(new Date(created.startsAt));
  const card = page.getByRole('article')
    .filter({ has: page.getByRole('heading', { name: serviceName, exact: true }) })
    .filter({ hasText: dateLabel })
    .filter({ hasText: selected.time });
  await expect(card).toHaveCount(1);
  await expect(card.getByText(businessName, { exact: true })).toBeVisible();
  await expect(card.getByText('Confirmada', { exact: true })).toBeVisible();
  await card.scrollIntoViewIfNeeded();
});

test('09 · Flujo · El profesional sin negocio accede a crear su perfil', { tag: '@flujo' }, async ({ page }) => {
  await signIn(page, 'PROFESSIONAL');
  await expect(page).toHaveURL(/\/professional\/setup$/);
  await expect(page.getByRole('heading', { name: 'Crea tu espacio en Cronos' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Nombre profesional o negocio' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Descripción', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear mi perfil', exact: true })).toBeEnabled();
});

test('10 · Flujo · El superadmin consulta la ficha del cliente de prueba', { tag: '@flujo' }, async ({ page }) => {
  const { user } = account('CLIENT');
  await signIn(page, 'ADMIN');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Administración de Cronos' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar en esta página' }).fill(user);
  const record = page.getByRole('article').filter({ hasText: user });
  await record.getByRole('button', { name: /^Gestionar / }).click();
  await record.getByText('Datos del registro', { exact: true }).click();
  const details = record.locator('.record-data');
  await expect(details.getByText('Correo electrónico', { exact: true })).toBeVisible();
  await expect(details.getByText(user, { exact: true })).toBeVisible();
  await expect(details.getByText('Cliente', { exact: true })).toBeVisible();
});
