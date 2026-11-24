# Notificaciones de Cronos con Gmail

Cronos utiliza SMTP de Gmail con TLS y una contraseña de aplicación. No requiere
dominio propio. El remitente es la cuenta configurada en `GMAIL_USER`, con el
nombre visible Cronos. Nunca guardar la contraseña habitual de Google.

## Configuración local

Activar la verificación en dos pasos de la cuenta remitente y generar una
contraseña de aplicación llamada Cronos. Desde `backend`, en Windows:

```powershell
npm run gmail:configure
npm run gmail:verify
```

El primer comando solicita el correo y la contraseña de aplicación mediante una
entrada oculta. Guarda `GMAIL_USER`, `GMAIL_APP_PASSWORD` y `MAIL_MODE=gmail` en el
archivo `.env` privado. Acepta la contraseña con o sin los espacios de presentación.
El segundo comprueba conexión y autenticación sin enviar mensajes.

Reiniciar el backend después de configurar. Para otros entornos, definir esas
variables mediante su gestor de secretos. Configurar `MAIL_APP_URL` con la URL del
frontend accesible para los destinatarios; no es la dirección del backend ni la
del webhook de Mercado Pago. `CORS_ORIGIN` debe coincidir con el frontend utilizado.

La tabla `MailNotification` requiere la migración correspondiente. Revisar las
migraciones pendientes antes de aplicar cambios a la base.

## Eventos y comprobación

Cada reserva confirmada genera una confirmación al cliente y un aviso al
propietario del negocio. También existen eventos para atención registrada y pago
de suscripción aprobado según la conciliación. Se conservan las plantillas y la
cola de reintentos. No se envían notas ni imágenes privadas del historial.

El 24 de noviembre de 2026 el equipo confirmó la recepción de cuatro correos para
dos reservas de prueba: dos confirmaciones al cliente y dos avisos al profesional.
Esta comprobación no acredita los otros eventos ni garantiza la entrega futura.

`acceptedAt` indica aceptación por el proveedor, no recepción en bandeja de entrada.
Los errores registran códigos técnicos sin direcciones, contraseñas ni contenido.
Revisar `lastError`, `attempts` y `nextAttemptAt` si un aviso continúa pendiente.

## Modos y avisos pendientes

`disabled` no crea ni procesa avisos. `preview` guarda HTML sin enviar y conserva
los mensajes pendientes. `gmail` los envía con Gmail y `outlook` con Microsoft Graph.
Cambiar de proveedor puede procesar avisos pendientes de una configuración anterior;
los ya aceptados no se reenvían automáticamente. Revisar la cola antes de activar
un entorno compartido o cambiar de modo.

Gmail aplica límites y restricciones de envío. Si se cambia la contraseña de la
cuenta, Google puede revocar sus contraseñas de aplicación; generar otra y volver
a verificar. No se garantiza exactamente un envío ante un corte posterior a la
aceptación del proveedor y anterior al registro de ese resultado.

Fuentes oficiales:

https://support.google.com/accounts/answer/185833

https://nodemailer.com/guides/using-gmail
