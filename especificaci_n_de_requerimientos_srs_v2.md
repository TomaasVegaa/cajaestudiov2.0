# SRS v2 — Sistema Web de Caja Diaria y Cuentas Corrientes para Estudio Contable

**Versión:** 2.0 (Optimizada para Velocidad Operativa y Despliegue en Hostinger)  
**Destino:** Implementación directa en Antigravity / Codex  
**Zona Horaria y Formato:** `America/Argentina/Tucuman` | Moneda `ARS ($ 1.234,56)` | Fecha `dd/mm/aaaa`

---

## 1. Resumen Ejecutivo y Filosofía del Sistema

Construir una aplicación web **Mobile-First (PWA)** y de escritorio para gestionar la caja diaria y las cuentas corrientes de clientes de un estudio contable. 

**Regla de diseño principal:** **La carga diaria debe ser más rápida que usar Excel.** Se descarta la sobre-ingeniería bancaria (no obligar a crear obligaciones previas, ni reservas, ni asientos de reverso manuales para corregir un error de tipeo en el día). En su lugar, se implementa una grilla interactiva de alta velocidad con **carga simultánea de Entrada/Salida (2 en 1)**, **pase automático de honorarios a "LORE"** y **filtrado instantáneo por cliente** sin romper el saldo de la caja general.

---

## 2. Reglas de Negocio Contables (Operatoria Real del Estudio)

### RB-01: Dos Saldos Independientes (Caja Mensual desde $0 vs. Cuenta Corriente de Cliente)
1. **Saldo de Caja Operativa (Mensual):** Cada mes nuevo puede iniciar su vista de caja diaria en $\$0,00$ (o con el saldo inicial de caja chica que se defina). Su fórmula fila a fila en la vista general es:
   $$\text{Saldo Caja}_n = \text{Saldo Caja}_{n-1} + \text{Entrada}_n - \text{Salida}_n$$
2. **Saldo de Cuenta Corriente del Cliente (Continuo y Anual):** Los saldos de los clientes **nunca se reinician a cero** al cambiar de mes o de año. Arrastran el saldo acumulado del período anterior:
   $$\text{Saldo Cliente} = \text{Saldo Arrastrado} + \sum \text{Entradas de Impuestos} - \sum \text{Salidas Aplicadas}$$

### RB-02: Flujo de Honorarios y Pase Automático a "LORE"
* Cuando un cliente abona `HONORARIOS` (ya sea bajo código `E` Estudio/Efectivo o `T` Transferencia), ese dinero no debe quedarse inflando el saldo disponible de la caja operativa de impuestos.
* **Automatización:** Al cargar una `ENTRADA` con Tipo de Valor `HONORARIOS`, el sistema tendrá activado por defecto el check **"Generar salida automática a LORE"**. Al guardar, el backend crea en una misma transacción SQL:
  1. El registro de `ENTRADA` a nombre del cliente (ej. `ORTIZ PATRICIA` entra $\$168.700,00$).
  2. El registro espejo de `SALIDA` inmediata a nombre de la entidad interna `LORE` por el mismo monto ($\$168.700,00$), vinculado mediante `movimiento_padre_id`, dejando el efecto neto en la caja de impuestos en $\$0,00$.

### RB-03: Custodia de Fondos para Impuestos y Carga "2 en 1"
* Cuando un cliente entrega dinero para impuestos (código `C` - `CLIENTES` o `T` - `TRANSFERENCIA`), suele registrarse la entrada del dinero y, en el acto o días después, la salida por el pago de obligaciones (`MONO`, `IIBB`, `TEM`, `CISI`, `SERV DOMEST`, `PAT`, `PYP`, `SEOC`, `UTILES`).
* **Carga Simultánea:** El formulario de carga rápida permite ingresar en un solo paso el monto de `ENTRADA` y opcionalmente el monto de `SALIDA`.
  * *Ejemplo con remanente:* Si en la fila de carga para `MARTINEZ FONT DANIELA` se ingresa Entrada $\$215.431,24$ y Salida $\$208.001,24$, el sistema genera automáticamente los dos renglones vinculados (el ingreso y el pago), dejando reflejado que a la clienta le quedaron $\$7.430,00$ a favor en su cuenta corriente y en la caja.

### RB-04: Saldos Negativos (En Rojo) Permitidos sin Bloqueos
* En la operatoria real del estudio es habitual pagar un impuesto antes de que el cliente transfiera o cubrir diferencias de VEPs con fondos del estudio.
* **Prohibido bloquear saldos negativos:** El sistema debe permitir libremente que el saldo de un cliente quede en negativo (ej. $-\$25.485,20$), mostrándolo resaltado en **color rojo** tanto en el listado de clientes como en su ficha, e incluyendo un campo editable rápido de **"Nota de Revisión"** al lado del saldo (ej. *"DIF POR SEOC"*, *"VER Y REVISAR GRUPO"*, *"agregar en feb para recuperar negativo"*).

### RB-05: Trazabilidad ("¿Qué pagó y qué se hizo con esa plata?")
* Al filtrar por un cliente o entrar a su ficha, el sistema muestra:
  1. Su **Saldo Arrastrado** del año/período anterior.
  2. Cada entrega de dinero (`ENTRADA`) y debajo (o vinculado) los pagos de impuestos (`SALIDA`) que se hicieron con esa plata.
  3. El **Saldo Actual** del cliente (en negro/verde si tiene dinero a favor, en rojo si le debe al estudio).
  4. El historial separado de los **Honorarios** que pagó para que el cliente tenga control total sin mezclar honorarios con saldo de impuestos.

### RB-06: Cuadro de Control y Arqueo Real del Estudio
* El módulo de Arqueo replica y automatiza el cuadro de control del estudio:
  * Toma automáticamente el `TOTAL P/CONTROL` (sumatoria de saldos de cuentas corrientes de clientes).
  * Permite ingresar/actualizar los saldos físicos y pendientes: `BANCO HOY`, `TENGO` (Efectivo real), `BANCO CALLE`, `CALLE ERIKA` y `ME DEBEN`.
  * Calcula en vivo la diferencia (`FALTANTE` o `SOBRA`) sin alterar los movimientos de los clientes.

### RB-07: Edición Ágil en Período Abierto vs. Cierre de Período
* Mientras el período mensual esté **Abierto**, los usuarios pueden editar cualquier celda (inline editing) o eliminar un renglón mal cargado sin necesidad de hacer contra-asientos de reverso (todo cambio queda registrado silenciosamente en `audit_logs`).
* Cuando se ejecuta el **Cierre Mensual / Anual**, los movimientos de ese período quedan congelados (solo lectura) y los saldos finales de cada cliente se copian automáticamente a la tabla `saldos_arrastrados` del nuevo período.

---

## 3. Stack Tecnológico (Optimizado para Hostinger + Celular)

* **Frontend:** **React 18+ con Vite, TypeScript y TailwindCSS** configurado como **PWA (Progressive Web App)** para instalarse en el celular con ícono propio.
  * *Por qué:* Permite que el filtrado por cliente, la búsqueda predictiva y la navegación con teclado (`Tab` / `Enter`) tengan respuesta instantánea ($0\text{ ms}$) igual que Excel.
* **Backend:** **API REST en PHP 8.2+ (Laravel API o arquitectura MVC ligera)** sobre **MySQL 8 / MariaDB** (compatible 100% con planes Hostinger Web/Business sin requerir procesos Node.js residentes si el plan no los soporta). *Nota: Si se despliega en VPS o plan Hostinger con soporte Node.js, se admite Node.js + Express + Prisma.*
* **Autenticación y Roles:** Autenticación por Token/Cookie segura con solo **2 roles**:
  1. `admin` (Contador/Titular: acceso total, cierres de período, arqueo y auditoría).
  2. `operador` (Carga diaria de ingresos/egresos y consulta de clientes).

---

## 4. Modelo de Base de Datos (Esquema SQL Definitivo)

```sql
CREATE DATABASE IF NOT EXISTS estudio_caja CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE estudio_caja;

-- 1. Usuarios del Sistema (2 roles simples)
CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol ENUM('admin', 'operador') NOT NULL DEFAULT 'operador',
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Clientes y Entidades Internas (Ej: 'LORE')
CREATE TABLE clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    cuit VARCHAR(20) NULL,
    telefono VARCHAR(50) NULL,
    es_interno BOOLEAN DEFAULT FALSE, -- TRUE para 'LORE' u otras cuentas internas del estudio
    nota_revision VARCHAR(255) NULL, -- Ej: 'DIF POR SEOC', 'VER Y REVISAR GRUPO'
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nombre (nombre)
);

-- 3. Alias de Clientes (Para unificar nombres distintos provenientes del Excel)
CREATE TABLE clientes_alias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NOT NULL,
    alias_excel VARCHAR(150) NOT NULL UNIQUE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);

-- 4. Períodos Contables (Meses y Años)
CREATE TABLE periodos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    anio INT NOT NULL,
    mes INT NOT NULL, -- 1 al 12
    caja_inicial DECIMAL(15,2) NOT NULL DEFAULT 0.00, -- Permite iniciar el mes en $0.00
    cerrado BOOLEAN DEFAULT FALSE,
    fecha_cierre TIMESTAMP NULL,
    cerrado_por INT NULL,
    UNIQUE KEY uk_anio_mes (anio, mes),
    FOREIGN KEY (cerrado_por) REFERENCES usuarios(id)
);

-- 5. Saldos Arrastrados de Clientes (Apertura al corte y cierres mensuales/anuales)
CREATE TABLE saldos_arrastrados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    periodo_id INT NOT NULL,
    cliente_id INT NOT NULL,
    saldo_arrastrado DECIMAL(15,2) NOT NULL DEFAULT 0.00, -- Positivo: a favor cliente | Negativo: debe al estudio (Rojo)
    nota_corte VARCHAR(255) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_periodo_cliente (periodo_id, cliente_id),
    FOREIGN KEY (periodo_id) REFERENCES periodos(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

-- 6. Movimientos de Caja (Tabla central de alta velocidad)
CREATE TABLE movimientos (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    periodo_id INT NOT NULL,
    fecha DATE NOT NULL,
    cod_conce ENUM('E', 'C', 'T') NOT NULL, -- E: Estudio/Efectivo, C: Clientes, T: Transferencia
    concepto VARCHAR(50) NOT NULL, -- 'ESTUDIO', 'CLIENTES', 'TRANSFERENCIA'
    cliente_id INT NOT NULL,
    tipo_valor ENUM('HONORARIOS', 'IMPUESTOS', 'UTILES', 'GASTOS_ESTUDIO', 'AJUSTE') NOT NULL,
    detalle VARCHAR(255) NOT NULL, -- Ej: 'MONO 12/25 - IIBB - TEM 11/25 UTILES'
    entrada DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    salida DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    afecta_saldo_cliente BOOLEAN NOT NULL DEFAULT TRUE, -- TRUE para impuestos/clientes, FALSE para pases internos ya compensados
    movimiento_padre_id BIGINT NULL, -- Vincula el pago (salida) con la entrada de dinero original o el pase automático a LORE
    comprobante_url VARCHAR(255) NULL,
    idempotency_key VARCHAR(64) NULL UNIQUE, -- Evita duplicados por doble clic en móvil
    creado_por INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (periodo_id) REFERENCES periodos(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (movimiento_padre_id) REFERENCES movimientos(id) ON DELETE CASCADE,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id),
    INDEX idx_periodo_fecha (periodo_id, fecha, id),
    INDEX idx_cliente_fecha (cliente_id, fecha)
);

-- 7. Cuadro de Control y Arqueo (Replica el cuadro final del Excel)
CREATE TABLE arqueos_control (
    id INT AUTO_INCREMENT PRIMARY KEY,
    periodo_id INT NOT NULL,
    fecha DATE NOT NULL,
    total_control_clientes DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    banco_hoy DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    tengo_efectivo DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    banco_calle DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    calle_erika DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    me_deben DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    sobra DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    faltante DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    observaciones TEXT NULL,
    creado_por INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (periodo_id) REFERENCES periodos(id)
);

-- 8. Auditoría Silenciosa (Registra ediciones/borrados sin trabar al usuario)
CREATE TABLE audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NULL,
    accion ENUM('CREAR', 'EDITAR', 'ELIMINAR', 'CIERRE_PERIODO', 'APERTURA') NOT NULL,
    entidad VARCHAR(50) NOT NULL,
    entidad_id BIGINT NOT NULL,
    datos_anteriores JSON NULL,
    datos_nuevos JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Diseño de Interfaz y Experiencia de Usuario (UX/UI)

### 5.1. Pantalla 1: Caja Diaria (Modo Excel Rápido en PC)
* **Fila Superior de Carga Rápida Fija:** Siempre visible arriba de la tabla. Permite cargar usando solo el teclado:
  1. `Fecha` (por defecto hoy).
  2. `Cod.` (`E`, `C`, `T`) -> autocompleta `Concepto` (`ESTUDIO`, `CLIENTES`, `TRANSFERENCIA`).
  3. `Cliente` (buscador predictivo tolerante a errores/alias; si no existe, botón `+ Crear rápido`).
  4. `Tipo de Valor` (`IMPUESTOS` o `HONORARIOS`).
  5. `Detalle` con **Chips clicables** (`MONO`, `IIBB`, `TEM`, `CISI`, `UTILES`, `SERV DOMEST`, `PAT`, `PYP`, `SEOC`) que insertan el texto + mes/año actual con 1 clic, permitiendo además escribir libremente.
  6. `Entrada ($)` y `Salida ($)` en la misma fila:
     * Si elige `HONORARIOS` y pone `Entrada: 168700`, el sistema muestra activado el tilde *"Pase automático a LORE"* y al presionar `Enter` inserta las 2 filas en la tabla.
     * Si elige `IMPUESTOS` y completa `Entrada: 215431.24` y `Salida: 208001.24`, al presionar `Enter` inserta la fila de entrada y debajo la fila de salida con el detalle de los impuestos pagados.
* **Edición Inline:** Doble clic en cualquier celda de la tabla permite corregir el importe, el detalle o el cliente en el acto (si el mes está abierto).

### 5.2. Pantalla 2: Vista por Cliente ("¿Qué pagó y qué se hizo con su plata?")
* Al seleccionar o buscar un cliente (ej. `PAZ JULIETA` o `MARTINEZ FONT DANIELA`), la pantalla muestra:
  * **Cabecera Resumen:**
    * **Saldo Arrastrado Anterior:** $\$X.XXX,XX$
    * **Total Entregado en el Período:** $+\$X.XXX,XX$
    * **Total Impuestos Pagados:** $-\$X.XXX,XX$
    * **SALDO ACTUAL DISPONIBLE:** Resaltado en grande (Verde/Negro si es $\ge 0$, **Rojo** si es $< 0$).
    * **Campo de Nota de Revisión editable en vivo:** Ej. `"DIF POR SEOC"`.
  * **Tabla Desglosada del Cliente:** Muestra cronológicamente cada ingreso, qué impuestos se pagaron con ese dinero, el saldo acumulado del cliente línea por línea y una pestaña o filtro para ver sus pagos de `HONORARIOS`.

### 5.3. Pantalla 3: Directorio de Saldos de Clientes (Reemplaza las filas 2100+ del Excel)
* Lista alfabética de todos los clientes con su saldo actual al día de hoy y su columna de `Nota de Revisión`.
* Filtros de 1 clic: `Todos`, `Con Saldo en Rojo (Me deben)`, `Con Saldo a Favor`, `Con Notas de Revisión`.
* Botón de exportación inmediata a Excel (`.xlsx` / `.csv`) y PDF de Estado de Cuenta para enviar por WhatsApp al cliente.

### 5.4. Pantalla 4: Versión Móvil (Celular < 768px)
* **Sin scroll horizontal:** Cada movimiento se ve como una tarjeta compacta con Cliente, Fecha, Chips de impuestos y Monto en verde (`+`) o rojo (`-`).
* **Buscador fijo superior:** Para consultar en 2 segundos desde el celular cuánto debe o cuánto tiene a favor un cliente.
* **Botón Flotante `+` (Bottom Sheet de 1 pantalla):** Abre un panel inferior simple donde se elige Cliente, se tocan los chips de impuestos (`MONO`, `IIBB`, `TEM`, `UTILES`), se escribe `Entrada` y/o `Salida` con teclado numérico grande y se guarda con un solo botón.

---

## 6. Endpoints Principales de la API REST (`/api/v1`)

1. `GET /periodos/actual` — Devuelve el período activo, saldo de caja inicial y métricas globales.
2. `POST /periodos/cerrar` — Ejecuta el cierre mensual/anual: calcula el saldo final de cada cliente y lo inserta como `saldo_arrastrado` en el período siguiente, iniciando la nueva caja operativa en $\$0,00$.
3. `GET /movimientos?periodo_id=&cliente_id=&cod_conce=&tipo_valor=&q=` — Devuelve los movimientos filtrados y el saldo calculado dinámicamente.
4. `POST /movimientos/carga-rapida` — Endpoint transaccional que recibe una carga simple o compuesta (crea Entrada + Salida a `LORE` si es Honorarios, o Entrada + Salida de Impuestos si ambos campos vienen con monto).
5. `PUT /movimientos/{id}` y `DELETE /movimientos/{id}` — Edición rápida y borrado en períodos abiertos (con registro automático en `audit_logs` y actualización de su movimiento espejo si lo tuviera).
6. `GET /clientes/saldos?periodo_id=` — Devuelve el padrón completo de clientes con su cálculo exacto:
   $$\text{Saldo Actual} = \text{Saldo Arrastrado} + \text{Entradas Custodia} - \text{Salidas Custodia}$$
7. `GET /clientes/{id}/estado-cuenta` — Devuelve la trazabilidad completa del cliente ("qué pagó y en qué se usó").
8. `PATCH /clientes/{id}/nota` — Actualiza en tiempo real la nota de revisión (`nota_revision`) desde la grilla.
9. `GET/POST /arqueos` — Obtiene y guarda el cuadro de control (`TOTAL P/CONTROL`, `BANCO HOY`, `TENGO`, `BANCO CALLE`, `CALLE ERIKA`, `ME DEBEN`, `FALTANTE/SOBRA`).

---

## 7. Plan de Implementación Paso a Paso para Antigravity

Ejecutar el desarrollo en este orden estricto:
1. **Paso 1 (Base de Datos y Backend Core):** Crear las migraciones SQL de las 8 tablas, el seeder con el usuario `admin`, la entidad interna `LORE` y el período inicial abierto.
2. **Paso 2 (API Transaccional):** Implementar los endpoints de Clientes, Saldos Arrastrados y Carga Rápida 2 en 1 (incluyendo la regla de pase automático a `LORE` y edición inline).
3. **Paso 3 (Frontend Grilla Rápida y Móvil):** Construir la SPA en React + TailwindCSS con:
   * Vista de Caja Diaria con fila de carga rápida por teclado y chips de impuestos (`MONO`, `IIBB`, `TEM`, `CISI`, `UTILES`, `SERV DOMEST`, `PAT`).
   * Vista de Cuenta Corriente por Cliente y Directorio de Saldos (con saldos negativos resaltados en rojo y notas editables).
   * Vista de Cuadro de Control / Arqueo y botón de Cierre de Período/Año.
4. **Paso 4 (Importador Inicial de Saldos desde Excel):** Crear una pantalla/script donde se pueda pegar o subir un CSV/Excel con las columnas `Cliente | Saldo Inicial | Nota de Revisión` para dejar cargados todos los saldos al día de corte en 1 minuto.