# SRS v3 — Caja Diaria y Cuentas Corrientes de Clientes (Estudio Contable)

**Versión:** 3.0 — reemplaza a la v2 (se conserva `especificaci_n_de_requerimientos_srs_v2.md` como antecedente)
**Formato:** `America/Argentina/Tucuman` · Moneda `$ 1.234,56` · Fecha `dd/mm/aaaa`
**Fecha de inicio operativo:** `01/11/2026` (saldos iniciales por cliente al `31/10/2026`)

---

## 0. Cambios respecto de la v2

| # | Cambio | Motivo contable |
|---|---|---|
| 1 | Nuevo campo **`medio`** (`EFECTIVO` / `BANCO`), separado de `cod_conce` | El arqueo debe decir si la diferencia está en el cajón o en el banco |
| 2 | **Saldos de clientes siempre calculados** = Apertura + Σ movimientos. El cierre **congela** y guarda una foto de control, no copia saldos | Evita descuadres si se reabre un período; el arrastre anual es automático |
| 3 | **Útiles** = cargo del estudio que se descuenta del saldo del cliente (no es pago a terceros) | Separar ingresos propios de fondos de terceros |
| 4 | **Honorarios descontados del saldo** del cliente (además del cobro directo) | Cobros mixtos (ej. ACOSTA SRL) y clientes con saldo a favor |
| 5 | Dos flags por movimiento: **`afecta_caja`** y **`afecta_cliente`** | Hay movimientos que mueven plata pero no la cuenta del cliente (honorarios cobrados) y viceversa (útiles desde saldo) |
| 6 | Caja del mes se muestra **desde $0** (como el Excel) **y además** el saldo real acumulado, que es el que usa el arqueo | Costumbre del usuario + control real |
| 7 | La trazabilidad es el **extracto cronológico con saldo línea a línea**; `movimiento_padre_id` solo vincula la carga 2‑en‑1 y el pase a LORE | La plata del cliente es fungible |
| 8 | Stack: **PHP 8.2 sin frameworks (PDO) + React/Vite compilado a estáticos** | Hostinger compartido sin Node ni Composer |

---

## 1. Ecuación de control (la que el sistema garantiza)

$$\underbrace{\text{Efectivo} + \text{Banco}}_{\text{Caja real acumulada}} = \underbrace{\sum \text{Saldos de clientes}}_{\text{TOTAL P/CONTROL}} + \text{Fondos propios del estudio}$$

* **Saldo cliente > 0** → fondos de terceros en custodia (a favor del cliente).
* **Saldo cliente < 0** (rojo) → el estudio adelantó plata (el cliente debe). **Nunca se bloquea.**
* **Fondos propios** = honorarios/útiles cobrados que todavía no se retiraron (LORE). Si todo se pasa a LORE, tiende a $0.

---

## 2. Matriz de movimientos

| Operación (carga rápida) | Filas generadas | `afecta_caja` | `afecta_cliente` | Efecto cliente | Efecto caja |
|---|---|:-:|:-:|---|---|
| Cliente deja plata para impuestos | `IMPUESTOS` entrada | ✔ | ✔ | + | + |
| Pago de impuestos (VEP) | `IMPUESTOS` salida | ✔ | ✔ | − | − |
| Útiles descontados del saldo | `UTILES` salida | ✘ | ✔ | − | 0 |
| Honorarios descontados del saldo | `HONORARIOS` salida | ✘ | ✔ | − | 0 |
| Honorarios cobrados en mano / transferencia | `HONORARIOS` entrada | ✔ | ✘ | 0 | + |
| Pase a LORE (retiro de honorarios/útiles) | `RETIRO` salida a LORE | ✔ | ✘ | 0 | − |
| Gasto del estudio | `GASTO_ESTUDIO` salida a ESTUDIO | ✔ | ✘ | 0 | − |
| Ajuste de saldo de cliente (sin plata) | `AJUSTE` entrada/salida | ✘ | ✔ | ± | 0 |
| Apertura (saldo inicial cliente) | `APERTURA` | ✘ | ✔ | ± | 0 |
| Apertura de caja (efectivo/banco inicial) | `APERTURA` a ESTUDIO | ✔ | ✘ | 0 | ± |

**Carga 2‑en‑1 / 4‑en‑1:** una sola fila de carga puede generar: entrada de impuestos + salida de impuestos + útiles desde saldo + honorarios desde saldo + pase a LORE, todo en **una transacción SQL** con idempotency key.

> Ejemplo Excel: `GELSI MARIA CONSTANZA` entrega $17.130 para *TEM 11/2025 y útiles* → Entrada 17.130 · Salida impuestos 15.000 · Útiles 2.130 → saldo de la clienta queda en $0.

---

## 3. Reglas de negocio

* **RB-01 Caja mensual:** la grilla del mes muestra el SALDO acumulado desde $0 (solo filas `afecta_caja`, excluyendo aperturas). La cabecera muestra *Saldo real al inicio del mes* y *Saldo real actual* (efectivo y banco).
* **RB-02 Arrastre de clientes:** el saldo de un cliente nunca se reinicia. El saldo al inicio de cualquier mes/año = Σ de todo lo anterior (incluida la apertura).
* **RB-03 Honorarios a LORE:** al cargar honorarios (cobro directo o desde saldo) el check *"Pase a LORE"* viene tildado; genera la salida espejo vinculada.
* **RB-04 Negativos permitidos** con nota de revisión editable por cliente (*"DIF POR SEOC"*).
* **RB-05 Período abierto:** edición inline y borrado libres, auditados en `audit_logs`. Editar el importe de una fila con espejo LORE actualiza el espejo.
* **RB-06 Cierre (admin):** congela el mes (solo lectura) y guarda la foto de saldos en `cierres_saldos`. El admin puede reabrir (auditado). Cerrar diciembre = cierre anual.
* **RB-07 Arqueo:** teórico (efectivo, banco, total clientes, fondos propios) vs. real (`TENGO`, `BCO HOY`, `BANCO CALLE`, `CALLE ERIKA`, `ME DEBEN`, `OTROS`) → `SOBRA` / `FALTANTE`. Se guarda historial.
* **RB-08 Medio:** `T` → `BANCO`; `E`/`C` → `EFECTIVO` (editable).

---

## 4. Modelo de datos

Ver [`database/schema.sql`](database/schema.sql). Tablas: `usuarios`, `clientes`, `clientes_alias`, `configuracion`, `periodos`, `movimientos`, `cierres_saldos`, `arqueos`, `audit_logs`.

---

## 5. Pantallas

1. **Caja diaria** — selector de mes, KPIs, fila de carga rápida por teclado con chips (`MONO`, `IIBB`, `TEM`, `CISI`, `SERV DOMEST`, `PAT`, `PYP`, `SEOC`, `AUT`), filtros (cliente, código, tipo, medio, texto), edición inline, móvil con tarjetas + botón flotante.
2. **Clientes** — directorio con saldo actual, filtros (rojo / a favor / con nota), nota editable, exportar CSV.
3. **Ficha del cliente** — saldo anterior al rango, entregas, pagos, útiles, honorarios, saldo actual, extracto línea a línea, pestaña honorarios, imprimir/PDF, enviar por WhatsApp.
4. **Arqueo** — cuadro de control automático + historial.
5. **Períodos** — cierre / reapertura (admin).
6. **Configuración** (admin) — apertura (caja inicial + importar saldos pegando desde Excel), usuarios, cambio de contraseña.

## 6. API (`/api/index.php?r=...`)

`auth/login|logout|me|password` · `clientes` (GET/POST/PUT) · `clientes/saldos` · `clientes/{id}/estado-cuenta` · `clientes/{id}/nota` · `movimientos` (GET) · `movimientos/carga-rapida` (POST) · `movimientos/{id}` (PUT/DELETE) · `caja/resumen` · `periodos` · `periodos/cerrar|reabrir` · `arqueos` (GET/POST) · `arqueos/teorico` · `apertura` (GET/POST) · `apertura/importar` · `usuarios` · `export/saldos|movimientos`

