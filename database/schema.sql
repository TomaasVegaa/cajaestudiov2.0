-- =====================================================================
-- Caja Estudio - Esquema v3 (compatible MariaDB 10.4+ y MySQL 8)
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol ENUM('admin','operador') NOT NULL DEFAULT 'operador',
    activo TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clientes y entidades internas (LORE, ESTUDIO)
CREATE TABLE IF NOT EXISTS clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    cuit VARCHAR(20) NULL,
    telefono VARCHAR(50) NULL,
    es_interno TINYINT(1) NOT NULL DEFAULT 0,
    nota_revision VARCHAR(255) NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clientes_alias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NOT NULL,
    alias VARCHAR(150) NOT NULL UNIQUE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS configuracion (
    clave VARCHAR(60) PRIMARY KEY,
    valor VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estado de cada mes (abierto/cerrado)
CREATE TABLE IF NOT EXISTS periodos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    anio INT NOT NULL,
    mes INT NOT NULL,
    cerrado TINYINT(1) NOT NULL DEFAULT 0,
    fecha_cierre TIMESTAMP NULL,
    cerrado_por INT NULL,
    UNIQUE KEY uk_anio_mes (anio, mes),
    FOREIGN KEY (cerrado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla central
CREATE TABLE IF NOT EXISTS movimientos (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    cod_conce ENUM('E','C','T') NOT NULL,
    medio ENUM('EFECTIVO','BANCO') NOT NULL DEFAULT 'EFECTIVO',
    cliente_id INT NOT NULL,
    tipo_valor ENUM('IMPUESTOS','HONORARIOS','UTILES','RETIRO','GASTO_ESTUDIO','AJUSTE','APERTURA') NOT NULL,
    detalle VARCHAR(255) NOT NULL DEFAULT '',
    entrada DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    salida DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    afecta_caja TINYINT(1) NOT NULL DEFAULT 1,
    afecta_cliente TINYINT(1) NOT NULL DEFAULT 1,
    movimiento_padre_id BIGINT NULL,
    grupo VARCHAR(40) NULL,            -- todas las filas de una misma carga rapida
    idempotency_key VARCHAR(64) NULL,
    creado_por INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_idem (idempotency_key),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (movimiento_padre_id) REFERENCES movimientos(id) ON DELETE CASCADE,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id),
    INDEX idx_fecha (fecha, id),
    INDEX idx_cliente_fecha (cliente_id, fecha, id),
    INDEX idx_grupo (grupo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Foto de saldos al cerrar un periodo (control, no fuente de verdad)
CREATE TABLE IF NOT EXISTS cierres_saldos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    periodo_id INT NOT NULL,
    cliente_id INT NOT NULL,
    saldo DECIMAL(15,2) NOT NULL,
    UNIQUE KEY uk_per_cli (periodo_id, cliente_id),
    FOREIGN KEY (periodo_id) REFERENCES periodos(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS arqueos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    teorico_efectivo DECIMAL(15,2) NOT NULL DEFAULT 0,
    teorico_banco DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_clientes DECIMAL(15,2) NOT NULL DEFAULT 0,
    fondos_propios DECIMAL(15,2) NOT NULL DEFAULT 0,
    tengo DECIMAL(15,2) NOT NULL DEFAULT 0,
    banco_hoy DECIMAL(15,2) NOT NULL DEFAULT 0,
    banco_calle DECIMAL(15,2) NOT NULL DEFAULT 0,
    calle_erika DECIMAL(15,2) NOT NULL DEFAULT 0,
    me_deben DECIMAL(15,2) NOT NULL DEFAULT 0,
    otros DECIMAL(15,2) NOT NULL DEFAULT 0,
    diferencia DECIMAL(15,2) NOT NULL DEFAULT 0,  -- >0 SOBRA, <0 FALTANTE
    observaciones TEXT NULL,
    creado_por INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NULL,
    accion VARCHAR(30) NOT NULL,
    entidad VARCHAR(50) NOT NULL,
    entidad_id BIGINT NULL,
    datos_anteriores LONGTEXT NULL,
    datos_nuevos LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_entidad (entidad, entidad_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos base
INSERT IGNORE INTO clientes (nombre, es_interno) VALUES ('LORE', 1), ('ESTUDIO', 1);
INSERT IGNORE INTO configuracion (clave, valor) VALUES
    ('fecha_inicio', '2026-11-01'),
    ('nombre_estudio', 'Estudio Contable');

