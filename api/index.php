<?php
// Punto de entrada unico de la API: /api/index.php?r=recurso/accion
declare(strict_types=1);

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/saldos.php';
foreach (glob(__DIR__ . '/controllers/*.php') as $f) require $f;
// Cargar la zona horaria antes de resolver fechas por defecto.
cfg('timezone');

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$method = $_SERVER['REQUEST_METHOD'];
$route = trim((string)($_GET['r'] ?? ''), '/');

// JSON estricto evita aceptar formularios text/plain disfrazados de JSON.
// Mantener CORS cerrado: la app se sirve en el mismo origen que la API.
if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    $mediaType = strtolower(trim(explode(';', $ct, 2)[0]));
    if ($mediaType !== 'application/json') {
        json_out(['error' => 'Content-Type invalido'], 415);
    }
    if (strtolower($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
        json_out(['error' => 'No se permiten escrituras desde otro sitio'], 403);
    }
}

$routes = [
    ['POST', 'auth/login', 'auth_login'],
    ['POST', 'auth/logout', 'auth_logout'],
    ['GET', 'auth/me', 'auth_me'],
    ['POST', 'auth/password', 'auth_password'],

    ['GET', 'clientes', 'clientes_list'],
    ['POST', 'clientes', 'clientes_create'],
    ['GET', 'clientes/saldos', 'clientes_saldos'],
    ['PUT', 'clientes/(\d+)', 'clientes_update'],
    ['PATCH', 'clientes/(\d+)/nota', 'clientes_nota'],
    ['GET', 'clientes/(\d+)/estado-cuenta', 'clientes_estado_cuenta'],

    ['GET', 'movimientos', 'movimientos_list'],
    ['POST', 'movimientos/carga-rapida', 'movimientos_carga_rapida'],
    ['PUT', 'movimientos/(\d+)', 'movimientos_update'],
    ['DELETE', 'movimientos/(\d+)', 'movimientos_delete'],

    ['GET', 'periodos', 'periodos_list'],
    ['POST', 'periodos/cerrar', 'periodos_cerrar'],
    ['POST', 'periodos/reabrir', 'periodos_reabrir'],

    ['GET', 'arqueos', 'arqueos_list'],
    ['POST', 'arqueos', 'arqueos_create'],
    ['GET', 'arqueos/teorico', 'arqueos_teorico'],

    ['GET', 'apertura', 'apertura_get'],
    ['POST', 'apertura', 'apertura_save'],
    ['POST', 'apertura/importar', 'apertura_importar'],
    ['POST', 'apertura/cliente', 'apertura_cliente'],

    ['GET', 'usuarios', 'usuarios_list'],
    ['POST', 'usuarios', 'usuarios_create'],
    ['PUT', 'usuarios/(\d+)', 'usuarios_update'],

    ['GET', 'export/saldos', 'export_saldos'],
    ['GET', 'export/movimientos', 'export_movimientos'],
];

try {
    foreach ($routes as [$m, $pattern, $handler]) {
        if ($m === $method && preg_match('#^' . $pattern . '$#', $route, $matches)) {
            array_shift($matches);
            $result = $handler(...array_map('intval', $matches));
            json_out($result);
        }
    }
    json_out(['error' => 'Ruta no encontrada: ' . $method . ' ' . $route], 404);
} catch (HttpError $e) {
    db_rollback();
    json_out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    db_rollback();
    error_log(get_class($e) . ': ' . $e->getMessage());
    if ($e instanceof PDOException && stripos($e->getMessage(), 'Unknown database') !== false) {
        json_out(['error' => 'La base de datos no existe. Ejecute install.php'], 500);
    }
    $msg = cfg('debug') ? $e->getMessage() : 'Error interno del servidor';
    json_out(['error' => $msg], 500);
}
