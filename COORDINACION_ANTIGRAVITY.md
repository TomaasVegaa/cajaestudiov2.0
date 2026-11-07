# Caja Estudio: coordinación entre Antigravity y Codex

Actualizado: 05/11/2026. Fuente funcional: `especificacion_srs_v3.md`; la v2 queda como antecedente.

## Reparto de trabajo

El usuario informó que Antigravity está inicializando React/Vite/Tailwind y construyendo la grilla de Caja Diaria y la ficha de cuenta corriente. Codex tomó una primera tanda de seguridad de la API, consistencia de pases a LORE, pruebas y revisión de UX.

| Responsable | Área actual | Archivos |
| --- | --- | --- |
| Antigravity | Interfaz, navegación, carga rápida y cuenta corriente | `frontend/`; salida compilada en `app/` |
| Codex | Seguridad y consistencia del backend | `api/config.php`, `api/index.php`, `api/lib/core.php`, `api/controllers/auth.php`, `api/controllers/movimientos.php` |
| Codex | Verificación y entrega de contexto | `tests/`, este documento |

La coordinación disponible en esta sesión es mediante archivos compartidos. No se estableció un canal directo de mensajes con Antigravity. Este documento contiene cambios realizados y tareas propuestas; las tareas pendientes no se consideran implementadas ni aceptadas por Antigravity.

## Primera contribución implementada por Codex

1. Las solicitudes autenticadas verifican en la base el usuario activo, su rol actual y una huella de su credencial. Desactivar un usuario o cambiarle la contraseña deja sin acceso sus sesiones anteriores en la siguiente solicitud. Los cambios de rol se aplican y regeneran el identificador de sesión.
2. Vencimiento controlado por servidor: 30 minutos de inactividad y 8 horas de duración máxima. Se puede ajustar con `session_idle_timeout` y `session_absolute_timeout` en `api/config.local.php`. Las sesiones anteriores a esta actualización requieren un nuevo login.
3. El cambio de contraseña conserva la sesión que lo solicita e invalida las otras. Logout destruye la sesión y vence la cookie.
4. La administración de usuarios valida la contraseña antes de guardar y usa una transacción con auditoría. Un error de validación ya no deja cambios parciales de nombre/rol.
5. Escrituras con tipo MIME exactamente `application/json`, permitiendo `; charset=utf-8`. Se rechaza `text/plain; application/json` y solicitudes identificadas por el navegador como `Sec-Fetch-Site: cross-site`. Un cuerpo JSON malformado o con raíz distinta de un objeto devuelve HTTP 400.
6. La zona horaria se configura al iniciar la API, antes de calcular fechas por defecto. `debug` queda desactivado por defecto; los errores inesperados se registran del lado del servidor.
7. Al editar un movimiento con retiro automático a LORE se sincronizan importe, fecha, código y medio del retiro. No se permite invertir su entrada/salida mientras tenga ese retiro asociado. Si la edición falla, la transacción se revierte. La auditoría incluye los valores previos de los retiros asociados.

Se conservaron rutas, campos de respuesta y payloads válidos de la API. No se modificaron el esquema ni los datos de la base del proyecto.

## Indicaciones inmediatas para Antigravity

La lectura del frontend es una revisión intermedia: sus archivos siguen en construcción. Estas observaciones deben comprobarse contra la versión final.

### Evitar duplicados al reintentar

En `frontend/src/views/CajaView.tsx`, `submitCarga` genera `idempotency_key: uid()` dentro de cada intento. Si el servidor guarda pero la respuesta se pierde, volver a pulsar Guardar crea una clave diferente y puede duplicar la operación.

Mantener una clave por operación lógica, incluyendo todos sus reintentos. Renovarla tras confirmar el guardado o iniciar explícitamente otra operación. Si se cambia el contenido después de una respuesta incierta, primero resolver el resultado de la operación anterior. No mostrar «Guardado» ni limpiar el formulario antes de la confirmación del servidor.

La API ya reconoce reintentos secuenciales con la misma clave; aún falta resolver correctamente las colisiones simultáneas y detectar una misma clave con distinto contenido.

### Importes inválidos

`parseLocalAmount` en `frontend/src/lib/api.ts` devuelve cero ante varios errores de formato. En una carga combinada eso puede guardar la parte válida y omitir silenciosamente otra parte mal escrita.

Distinguir vacío opcional de importe inválido. Mostrar el error junto al campo y conservar lo escrito. Verificar `Number.isFinite`. Enviar números normalizados a la API; aplicar `$ 1.234,56` solamente a la presentación. No convertir la falta de datos o un error de consulta en un saldo de cero.

### Integración y errores

- La app compilada y la API deben compartir origen. El proxy `/api` de Vite permite desarrollar con la API PHP sin abrir CORS. El cliente actual ya envía JSON y cookies, compatible con esta contribución.
- `GET auth/me` sin sesión devuelve 200 con `user: null`; los recursos protegidos devuelven 401. Gestionar ambos casos en la navegación general.
- Ante 401, ofrecer volver a ingresar y conservar el borrador sólo en memoria. Evitar guardar movimientos, saldos o credenciales en `localStorage`.
- Ante 403, explicar el permiso que falta. Ante 409 por mes cerrado, actualizar su estado y conservar el borrador para que el usuario pueda resolverlo.
- El resumen de caja ya viene en `GET movimientos`, propiedad `resumen`. `caja/resumen` figura en la SRS pero no existe como ruta independiente.
- `PATCH clientes/{id}/nota` recibe `{ "nota": "..." }`.
- Identificar visualmente los retiros automáticos asociados. La protección de todas las ediciones directas sobre esos retiros todavía es una tarea del backend; ocultar botones no reemplaza esa validación.

## Diseño y experiencia de uso propuestos

Mantener la dirección visual ya iniciada: fondo claro, superficies blancas, tipografía legible, importes alineados a la derecha con cifras tabulares, azul oscuro para acciones principales y una densidad de filas útil en escritorio.

### Caja diaria

Jerarquía sugerida:

```text
Caja diaria                  Noviembre 2026    [Mes abierto]

[Efectivo real] [Banco real] [Total real] [Resultado del mes]
Saldo real al inicio del mes: ...              Corte: ...

Carga rápida
Fecha | Cliente | Operación | Medio | Detalle | Entrada | Salida
[Útiles / honorarios desde saldo]     [Pase a LORE ✓] [Guardar]
Efecto en el cliente: ...             Efecto en caja: ...

Buscar | Cliente | Tipo | Medio | Limpiar filtros       [CSV]
Fecha | Cliente | Detalle | Medio | Entrada | Salida | Saldo
```

El «Resultado del mes» empieza desde cero; el «Total real» incluye las aperturas y el historial. Explicar esa diferencia con etiquetas visibles y fecha de corte. Al filtrar por cliente, mantener el saldo de caja general provisto por la API y mostrar por separado el saldo del cliente.

Orden de carga por teclado: fecha, cliente, operación, medio, detalle, entrada, salida y guardar. En el selector de cliente, Enter debe confirmar la selección sin enviar accidentalmente el formulario; Escape cierra el selector. Después de guardar, devolver el foco a la carga siguiente. No interceptar Tab de forma que atrape al usuario.

La vista previa debe explicar qué se guarda, especialmente en cargas combinadas: dinero recibido, impuestos pagados, cargos desde saldo y retiro a LORE. Los honorarios directos no aumentan el saldo del cliente. Un saldo negativo se permite y se identifica como «Debe al estudio»; no bloquear por ese motivo.

En móvil, usar tarjetas con cliente, concepto, importe y medio, y un formulario de carga que deje visibles los errores y el botón Guardar al abrir el teclado. Evitar depender de una grilla horizontal para completar una operación habitual.

### Ficha del cliente

Mostrar nombre, identificador, nota de revisión, rango y saldo anterior al rango. El extracto presenta fecha, detalle, entrada, salida y saldo del cliente por línea. Diferenciar «Saldo al cierre del rango» y «Saldo a la fecha de corte».

Separar los honorarios directos de los movimientos que afectan la cuenta corriente. Ofrecer «Nueva entrega», «Registrar pago» y «Ver honorarios» con el cliente ya seleccionado. Una impresión debe indicar rango y fecha de emisión. La opción WhatsApp debe preparar el contenido para revisión y envío manual.

No depender sólo del rojo o verde para comunicar estados: acompañarlos con «Debe al estudio», «A favor» o «Sin saldo». Conservar foco visible y anunciar guardados/errores sin moverlo innecesariamente. Estos criterios se apoyan en las guías W3C sobre [uso del color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [foco visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) y [mensajes de estado](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

## Pendientes priorizados del backend

Estas observaciones provienen de revisión del código; salvo donde se indica, no se ejecutaron escenarios de explotación ni pruebas de concurrencia.

| Prioridad | Hallazgo concreto | Resultado esperado |
| --- | --- | --- |
| Antes de operar con datos reales | `apertura_save`, `apertura_cliente` y `apertura_importar` pueden cambiar aperturas sin consultar los cierres | Una apertura no debe modificar saldos de meses congelados sin un flujo explícito, auditado y consistente con los cierres posteriores |
| Antes de operar con datos reales | Varias comprobaciones `assert_abierto` suceden antes de iniciar la transacción; no comparten bloqueo con `periodos_cerrar` | Un cierre y una escritura simultáneos deben resolverse de forma serializada, con foto de saldos consistente |
| Antes de operar con datos reales | La clave de idempotencia es opcional y una colisión simultánea termina en error genérico | Resolver reintentos concurrentes sin duplicar ni informar un fracaso cuando ya se guardó; rechazar reutilización con distinto payload |
| Antes de exponer el instalador | `install.php` permite crear el primer administrador por web mientras no hay usuarios | Restringir el aprovisionamiento inicial mediante CLI o un secreto de instalación; retirar o bloquear el instalador al terminar |
| Alta | El login sólo aplica una pausa por fallo | Añadir limitación persistente de intentos y comprobar su funcionamiento con múltiples sesiones |
| Alta | Los retiros automáticos pueden editarse o eliminarse directamente sin validar su relación con el origen | Definir correcciones y desvinculación explícitas; protegerlas también en la API |
| Alta | `csv_out` exporta nombre, nota y detalle sin tratamiento de fórmulas de planilla | Definir exportación segura para el consumidor previsto y probar Excel/LibreOffice; considerar XLSX con celdas de texto tipadas |
| Alta | Se valida poco la matriz de tipos/direcciones y el estado activo del cliente al cargar/editar | Rechazar combinaciones incompatibles, importes fuera de rango y cuentas internas mal asignadas; mantener negativos de saldo permitidos |
| Media | `saldo_hoy` de la ficha usa el límite `9999-12-31` | Definir política de movimientos futuros y devolver un saldo que corresponda a la fecha comunicada al usuario |
| Media | El listado de saldos excluye clientes inactivos, pero el total de control puede incluir sus movimientos | Mostrar y explicar saldos de archivados o establecer una política que evite diferencias entre grilla y total |
| Media | No hay historial de auditoría consultable ni procedimiento de restauración documentado | Vista de auditoría para administrador y copias de respaldo con restauración verificada |

Cerrar estos puntos requiere otra tanda de implementación; este documento no certifica que el sistema esté listo para producción. Para sesiones y solicitudes desde otros sitios se consultaron las guías [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) y [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). El riesgo de fórmulas exportadas y sus límites de mitigación se describe en [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).

## Funciones posteriores propuestas

Después de estabilizar carga, cuenta corriente y controles: arqueo con diferencias separadas por efectivo/banco; importación con simulación y reporte de errores por fila; consulta de auditoría; comprobantes imprimibles; y transferencias internas entre efectivo y banco sin alterar el saldo del cliente.

La PWA puede instalar la interfaz. El almacenamiento sin conexión de información financiera y el envío diferido de movimientos requieren un diseño específico de privacidad y sincronización; no deben aparecer automáticamente al añadir un service worker.

## Verificación reproducible

Desde la raíz del proyecto:

```powershell
C:\xampp\php\php.exe tests\integration.php
```

Requiere PHP CLI con PDO MySQL y cURL, MySQL accesible y permiso para crear/eliminar bases temporales. Usa las credenciales configuradas, crea exclusivamente una base con nombre aleatorio `caja_test_<16 caracteres hexadecimales>`, copia la API a un directorio temporal y levanta PHP en un puerto libre de `127.0.0.1`. Las sesiones también quedan aisladas. Al terminar elimina la copia y la base temporal.

Resultado obtenido: **46 comprobaciones correctas**. Incluyen solicitudes HTTP reales, permisos, revocación y expiración de sesiones, rechazo de escrituras inválidas, ausencia de cambios parciales de usuarios, corrección de pases a LORE, rollback, negativos permitidos, reintentos secuenciales y cierre/reapertura ordinarios. También se verificó sintaxis PHP de API y pruebas.

El ensayo no utiliza ni modifica la base operativa. No verifica aún carreras entre solicitudes, protección del instalador, seguridad de exportaciones, todas las vías de apertura ni comportamiento de la interfaz en navegador. La interfaz sigue a cargo de Antigravity.


---

## Actualización implementada por Antigravity (Frontend v3.1)

1. **Limpieza operativa solicitada por el usuario:** eliminados los chips de texto rápido (`+MONO`, `+IIBB`, etc.) de `CajaView.tsx` para dejar el formulario limpio en 2 líneas puras de teclado.
2. **Idempotencia por borrador lógico:** `idemKey` se conserva en memoria para reintentos de la misma operación y sólo se renueva tras confirmación del servidor o edición explícita del borrador.
3. **Validación numérica estricta (`parseStrictAmount`):** distingue campo vacío (`0`) de error de tipeo (bloquea envío, resalta el input con `aria-invalid` y muestra el motivo sin perder lo escrito).
4. **Sesión vencida (`401`) y mes cerrado (`409`) sin pérdida de datos:** modal de reconexión sobre la vista activa conservando el borrador en memoria; ante `409` refresca el estado del período sin limpiar el formulario.
5. **Trazabilidad y accesibilidad visual:**
   - Saldo actual en vivo del cliente al seleccionarlo en Carga Rápida.
   - Al filtrar por cliente en Caja Diaria se muestran simultáneamente `Saldo Cliente` y `Saldo Caja Mes`.
   - Filas espejo de `LORE` (`movimiento_padre_id !== null`) identificadas con etiqueta `Auto` para editarse desde su movimiento origen.
   - Etiquetas explícitas (`Debe al estudio`, `A favor`, `Sin saldo`), diferencia entre `Saldo al cierre del rango` y `Saldo hoy`, y fecha de emisión en vista imprimible.
