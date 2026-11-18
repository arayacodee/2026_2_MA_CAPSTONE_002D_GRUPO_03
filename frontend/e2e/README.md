# Pruebas de Cronos con Playwright

Diez casos ejecutados en Chromium contra la aplicación y su API real. Cinco verifican validaciones de formularios, dos comprueban restricciones de acceso y tres recorren el ingreso y la consulta por rol.

## Preparación

Desde la carpeta frontend, instalar las dependencias y Chromium.

```powershell
npm ci
npx playwright install chromium
Copy-Item e2e/.env.example .env.e2e
```

Completar las seis variables de las cuentas compartidas de prueba en `.env.e2e`. El archivo está excluido de Git. En el equipo de Manuel ya está configurado.

Iniciar el backend en el puerto 3000 y el frontend en el puerto 4200 con la configuración habitual del proyecto. La base de datos utilizada depende del entorno del backend.

El negocio y el servicio indicados en `E2E_BUSINESS` y `E2E_SERVICE` deben existir y aceptar reservas. El caso 08 busca un horario libre a partir de mañana dentro de los siguientes catorce días.

Cada ejecución del caso 08 crea una reserva real para el cliente de prueba y la conserva. Comprueba la respuesta 201, registra su identificador y verifica que la misma reserva aparece en la consulta de la API y en Mis reservas, con su servicio, negocio, fecha, hora y estado confirmado. Las ejecuciones posteriores eligen el siguiente horario libre.

El caso 09 utiliza la cuenta profesional de prueba en su estado actual, todavía sin negocio vinculado, para verificar la redirección al formulario de creación de perfil.

## Ejecución

```powershell
npm run test:e2e
npm run test:e2e:report
```

Para observar el navegador durante una demostración, ejecutar `npm run test:e2e -- --headed`.

Para elegir y ejecutar casos desde una interfaz, usar `npm run test:e2e:ui` y abrir `http://127.0.0.1:9324`. En la lista de la izquierda, pasar el cursor sobre un caso y pulsar su triángulo de ejecución. Después se puede seleccionar cada acción para recorrer lo que ocurrió paso a paso.

Para repetir un caso en el navegador visible desde la terminal, usar su número, por ejemplo `npm run test:e2e -- --headed --grep "07 ·"`.

Para seleccionar una categoría completa, usar `npm run test:e2e -- --grep @validacion`, `--grep @acceso` o `--grep @flujo`. Las mismas etiquetas permiten filtrar en el informe y el panel interactivo.

## Casos

| Caso | Tipo | Acción | Resultado esperado |
| --- | --- | --- | --- |
| 01 | Validación | Ingresar con correo vacío | Campo obligatorio inválido, respuesta 400 y mensaje de validación. |
| 02 | Validación | Ingresar con correo sin formato de email | Formato inválido, respuesta 400 y mensaje de validación. |
| 03 | Validación | Ingresar con contraseña vacía | Campo obligatorio inválido, respuesta 400 y mensaje de validación. |
| 04 | Validación | Registrarse con una contraseña de tres caracteres | Respuesta 400 y mensaje que exige un mínimo de ocho caracteres. |
| 05 | Validación | Usar la cuenta del cliente con contraseña incorrecta | Respuesta 401, mensaje de credenciales incorrectas y sesión de cliente sin iniciar. |
| 06 | Acceso | Intentar reservar como visitante | Redirección al ingreso con destino de regreso a la reserva. |
| 07 | Acceso | Intentar entrar a administración como cliente | Redirección al acceso de administración conservando la sesión de cliente. |
| 08 | Flujo por rol | Reservar y consultar como cliente | Reserva creada con respuesta 201 y el mismo identificador en la consulta de Mis reservas. Tarjeta visible con servicio, negocio, fecha, hora y estado confirmado. |
| 09 | Flujo por rol | Ingresar como profesional sin negocio | Formulario de creación del perfil con sus campos y botón disponibles. |
| 10 | Flujo por rol | Ingresar como superadmin | Búsqueda del cliente de prueba y consulta de su ficha. |

## Evidencia visual

Cada caso adjunta una captura con una etiqueta de resultado. Verde y ✓ indican APROBADA, rojo y ✗ indican FALLIDA, y ámbar indica OMITIDA. El texto y el símbolo acompañan al color. La misma etiqueta aparece durante 1,2 segundos al final del video.

Una validación negativa se aprueba cuando la aplicación rechaza correctamente la entrada inválida y muestra el mensaje esperado. Los resultados se calculan a partir de las comprobaciones de cada caso.

Cada ejecución conserva un video de 1280 × 720 píxeles, con una pausa de 200 ms entre acciones para facilitar su lectura. El informe HTML en `playwright-report/index.html` reúne los resultados, pasos, capturas y videos de la última ejecución. Al abrir un caso, el apartado Video permite reproducir la grabación. Los archivos originales en formato WebM quedan en `test-results`, y ambos directorios de resultados están excluidos de Git.

Las contraseñas de las cuentas se cargan desde el entorno y se escriben en el formulario sin incorporarlas a los títulos de los pasos.

Los videos registran la pantalla completa durante el recorrido, incluidos los listados que se abran.

Cada rol inicia sesión una vez durante la ejecución. Los casos siguientes del mismo rol cargan sus cookies en un navegador aislado. Las validaciones de credenciales también consultan la API real. La API admite diez intentos de ingreso por dirección cada quince minutos. Si responde 429 después de muchas ejecuciones seguidas, hay que esperar el plazo indicado en su cabecera `Retry-After` antes de repetirlas.

Un caso que necesita una cuenta queda omitido cuando faltan sus variables. Los resultados aprobados, fallidos y omitidos se distinguen en el informe.

El alcance comprende las validaciones descritas, las restricciones de acceso, la creación y consulta de una reserva y los recorridos por rol. Los pagos de Mercado Pago y el envío de correos requieren casos adicionales.

Configuración y evidencias basadas en la documentación oficial de [reportes](https://playwright.dev/docs/test-reporters), [capturas de pantalla](https://playwright.dev/docs/screenshots), [videos](https://playwright.dev/docs/videos), [modo interactivo](https://playwright.dev/docs/test-ui-mode) y [reutilización de sesiones](https://playwright.dev/docs/auth).
