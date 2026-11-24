# Correos de Cronos con Outlook personal

Se usa Microsoft Graph con autorización delegada `Mail.Send` y `offline_access`.
No requiere dominio propio. La cuenta autorizada será el remitente; no se permite
elegir arbitrariamente otra dirección. No cambia las suscripciones ni agrega pruebas gratuitas.

## Conectar la cuenta una vez

En el registro de aplicación de Microsoft, habilitar cuentas personales y agregar
la plataforma **Web**, con `http://localhost:3000/api/mail/outlook/callback`.
Agregar el permiso delegado `Mail.Send` y crear un secreto de cliente.

Guardar en `backend/.env` (no compartir secretos en chat ni Git):

```dotenv
OUTLOOK_CLIENT_ID=ID_DE_APLICACION
OUTLOOK_CLIENT_SECRET=VALOR_DEL_SECRETO
OUTLOOK_REDIRECT_URI=http://localhost:3000/api/mail/outlook/callback
MAIL_MODE=disabled
MAIL_APP_URL=http://localhost:4200
```

Desde `backend`, detener temporalmente la API si usa el puerto 3000 y ejecutar:

```powershell
npm run outlook:connect
```

Abrir el enlace generado e iniciar sesión con la cuenta remitente de Cronos.
El enlace vence a los diez minutos y se protege con state y PKCE. El asistente
escucha solo en localhost y no envía correos. No hay una ruta pública de conexión
en la API: la URL de callback pertenece exclusivamente a este asistente local.
Al terminar, se puede volver a iniciar el backend.

La autorización se guarda con AES-256-GCM en `backend/.outlook/authorization.enc`,
fuera de Git. La clave se deriva de `AUTH_SECRET`: cambiarla requiere volver a
autorizar la cuenta. Los refresh tokens renovados se guardan antes de enviar.
Un secreto vencido o un permiso revocado requiere corregir la configuración o
volver a conectar. No se imprime ningún token ni secreto.

## Habilitar los eventos

Primero revisar las migraciones pendientes y aplicar las correspondientes a la
base de desarrollo, incluida `20261122000100_mail_notifications`. `prisma migrate
deploy` aplica **todas** las pendientes; revisar antes si hay trabajo de otras ramas.
Generar el cliente y compilar:

```powershell
npm run prisma:status
npx prisma migrate deploy
npm run prisma:generate
npm run build
```

Elegir `MAIL_MODE=preview` para guardar HTML en `.outlook/previews/` sin enviar,
o `MAIL_MODE=outlook` para enviar realmente. Reiniciar la API después del cambio.
`disabled` es el valor predeterminado: no crea ni procesa avisos. Los eventos
ocurridos mientras está deshabilitado no se reconstruyen retroactivamente.
Los avisos de preview quedan pendientes de envío: al cambiar a `outlook` se envían
también esos registros. Usar exclusivamente destinatarios de prueba al validar.

Eventos implementados:

- Reserva confirmada, al guardarse, al correo del cliente.
- Nueva cita agendada, al correo del dueño del negocio registrado en Cronos,
  con nombre del cliente, negocio, servicio y fecha y hora local. Abre `/dashboard`.
  Cada destinatario tiene su propia clave de evento para evitar avisos duplicados.
- Atención registrada, al completarse, al correo del cliente. Sin notas ni imágenes privadas.
- Pago de suscripción profesional aprobado y verificado con Mercado Pago, al
  correo del titular. Conciliar facturas ya registradas como aprobadas no genera avisos.

Una atención completada **no acredita que el servicio esté pagado**. No se
implementó cobro de reservas ni registro manual de pagos de servicios.
No se emiten avisos de prueba gratuita, porque no se solicitó esa funcionalidad.

El enlace del cliente abre `/my-reservations` y el de suscripción `/subscriptions`.
En despliegue, ajustar `MAIL_APP_URL` al origen público accesible a los clientes.

## Cola y operación

Los avisos se guardan en la misma transacción que el evento de negocio y tienen
una clave única. La cola se procesa cada 15 segundos, de diez en diez, con bloqueo
por mensaje y reintentos hasta una hora entre intentos. Una falla de Graph no
revierte una reserva o atención guardada. Una falla de persistencia de la cola sí
revierte la transacción para evitar perder el aviso. Revisar `lastError` y
`nextAttemptAt` de `MailNotification` si hay errores continuos.

`acceptedAt` significa que Graph devolvió 202, no entrega en bandeja de entrada.
No se puede garantizar exactamente un envío: si Microsoft acepta un correo pero
se corta la conexión antes de registrarlo, el reintento puede duplicarlo.
Microsoft puede aplicar límites de envío o bloquear temporalmente una cuenta.

La autorización local requiere almacenamiento persistente. Esta primera versión
está destinada a una instancia del backend: para múltiples réplicas, migrar el
token a un almacén de secretos compartido con coordinación de renovación.
Al desplegar una instancia, configurar `OUTLOOK_DATA_DIR` en un volumen privado
persistente, conservar `AUTH_SECRET` y transferir el archivo cifrado de forma segura.
No colocar `.outlook` en directorios públicos ni artefactos del frontend.
Definir una política de retención de la cola, porque contiene destinatarios y
datos de reservas; las vistas previas también contienen datos personales.

## Verificación

`npm test` usa simulaciones: comprueba cifrado, manipulación del token, PKCE,
escape HTML, privacidad, claves de evento, caché de acceso, Graph 202, preview y
reintentos. No conecta con Microsoft ni envía correos reales.

Fuentes oficiales:

- https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
