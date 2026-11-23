# Suscripción profesional de Cronos

Plan fijo: $7.900 CLP cada mes, sin prueba gratuita. Los datos de tarjeta se
ingresan en el checkout de Mercado Pago. Cronos no los recibe ni almacena.

## Configuración para pruebas

1. Entrar en https://www.mercadopago.cl/developers/panel/app y crear una aplicación
   para Cronos con integración de Suscripciones. Completar los requisitos que
   indique la cuenta de Mercado Pago Chile.
2. Seguir el entorno de pruebas que indique el producto Suscripciones en esa
   aplicación: usar vendedor, comprador y tarjetas de prueba compatibles entre
   sí. No mezclar credenciales ni usar una tarjeta real para simular un pago.
3. Publicar temporalmente el backend y frontend con HTTPS, o usar un túnel para
   desarrollo. El webhook debe ser accesible desde Internet. No hace falta
   comprar un dominio: puede utilizarse el subdominio del alojamiento/túnel.
4. En Webhooks de la aplicación, configurar la URL del backend terminada en
   `/api/subscriptions/webhook`. Habilitar Suscripciones (`subscription_preapproval`),
   cobros de suscripción (`subscription_authorized_payment`) y pagos (`payment`).
5. Guardar las variables en `backend/.env`, nunca en Git ni en el frontend:

```dotenv
MP_ACCESS_TOKEN=REEMPLAZAR_CON_CREDENCIAL_DEL_ENTORNO_DE_PRUEBA
MP_WEBHOOK_SECRET=REEMPLAZAR_CON_FIRMA_SECRETA_DEL_WEBHOOK
MP_RETURN_URL=https://TU_FRONTEND/subscriptions?payment=return
MP_WEBHOOK_URL=https://TU_BACKEND/api/subscriptions/webhook
MP_TEST_PAYER_EMAIL=CORREO_REAL_DE_LA_CUENTA_COMPRADORA_DE_PRUEBA
```

6. Aplicar migraciones al desplegar (`npx prisma migrate deploy`), generar Prisma,
   compilar y reiniciar el backend. Actualizar también la URL de API del frontend,
   CORS y las cookies según el alojamiento. Un túnel que cambie de URL requiere
   actualizar estas variables y la configuración de Webhooks.

El correo de la cuenta compradora de prueba se obtiene iniciando sesión con esa
cuenta en Mercado Pago y consultando sus datos; no se deduce del nombre de usuario.
`MP_TEST_PAYER_EMAIL` solo se usa fuera de producción y no modifica el correo del
usuario registrado en Cronos. Retirarlo antes del lanzamiento.

Para probar el frontend con Cloudflare Tunnel, actualizar `allowedHosts` en
`frontend/angular.json` con el hostname exacto del nuevo túnel. El proxy local
envía `/api/**` al backend en el puerto 3000. Usar el origen HTTPS del frontend
como `CORS_ORIGIN` del backend y mantener los dos túneles encendidos.
Cada colaborador configura su propio `.env`: las credenciales no se comparten
por Git. Las URLs temporales actuales no son direcciones de producción.

La gestión del plan está en `/subscriptions` (acceso «Mi suscripción»); `/companies`
se utiliza para registrar la empresa. Los enlaces antiguos con `view=subscription`
o `payment` redirigen a la página independiente.

No se han agregado credenciales de Mercado Pago ni se han creado suscripciones
reales. La integración permanece deshabilitada hasta configurar las cuatro variables.
La activación gratuita de prueba deja de estar disponible con pagos configurados.

## Recorrido de validación antes de cobrar

- Registrar una cuenta CLIENT de prueba, guardar su solicitud de empresa y abrir
  el checkout aceptando explícitamente la renovación mensual.
- Aprobar el pago con los medios de prueba de la aplicación. Comprobar la recepción
  del webhook y usar «Consultar estado del pago» si el primer cobro sigue pendiente.
  Una autorización de tarjeta por sí sola no activa el perfil.
- Comprobar activación tras el primer pago aprobado; repetir una notificación y
  verificar que no se duplique el negocio ni se agreguen meses adicionales.
- Probar pago pendiente/rechazado, renovación, cancelación desde Cronos, vencimiento
  del período y reembolso. Comprobar los importes y estados en el panel del proveedor.
- Probar webhook sin firma, firma incorrecta y acceso a cancelaciones de otra cuenta:
  deben rechazarse. Verificar regreso al frontend conservando la sesión.
- Antes de producción, completar los requisitos comerciales de Mercado Pago,
  usar credenciales y firma del entorno correcto y repetir una prueba controlada.

## Comportamiento y operación

Las solicitudes usan precio y frecuencia del servidor; no se confía en montos,
usuarios ni resultados de pago enviados por el navegador. Webhooks firmados
provocan consultas a la API autenticada, que valida la suscripción, referencia,
moneda, importe y pagos. Cada factura se registra una sola vez y el período se
calcula desde su fecha de débito. Los reembolsos retiran el período correspondiente.
La cancelación mantiene lo ya pagado y libera la posibilidad de contratar nuevamente.

La base de datos registra las habilitaciones previas, manuales y de demostración.
Un profesional sin habilitación y con el período pagado vencido puede consultar
sus datos y gestionar reservas ya existentes. Su perfil puede seguir visible,
con un aviso de que dejó de recibir nuevas reservas y sin botón para reservar.
La disponibilidad y la confirmación verifican ese mismo estado aunque los
equipos tengan configuraciones de Mercado Pago distintas.

Una creación con respuesta ambigua queda reservada para esa cuenta y se intenta
recuperar por referencia externa, sin emitir otro mandato recurrente. Si el proveedor
no encuentra el intento, soporte debe investigar en Mercado Pago antes de liberar
manualmente el registro; no borrar intentos a ciegas.

Los errores de conciliación responden 503 para permitir reintentos del proveedor.
También hay consulta manual por el titular desde la página Empresas. No hay un
trabajo programado de conciliación independiente: monitorear los Webhooks fallidos
en Mercado Pago y volver a enviarlos si agotaron sus reintentos. Mantener la
configuración de pagos habilitada mientras existan suscripciones en producción.

Tarifas publicadas, consultadas el 14-11-2026: 3,19% + IVA al instante y
2,89% + IVA en 10 días. Confirmar las condiciones aplicables a la cuenta antes
de lanzar. La comisión la descuenta Mercado Pago; el precio al cliente es $7.900.

Fuentes oficiales:
- https://www.mercadopago.cl/herramientas-para-vender/suscripciones
- https://www.mercadopago.cl/developers/es/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.cl/developers/es/reference/online-payments/subscriptions/authorized-payment-search/get
- https://www.mercadopago.cl/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks
