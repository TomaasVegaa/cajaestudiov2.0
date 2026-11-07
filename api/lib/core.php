<?php
// Nucleo: conexion, respuestas JSON, sesion, auditoria y utilidades.

class HttpError extends Exception
{
    public int $status;
    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

function cfg(string $key)
{
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/../config.php';
    }
    return $config[$key] ?? null;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', cfg('db_host'), cfg('db_port'), cfg('db_name'));
        $pdo = new PDO($dsn, cfg('db_user'), cfg('db_pass'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '-03:00'");
    }
    return $pdo;
}

function db_rollback(): void
{
    try {
        if (db()->inTransaction()) db()->rollBack();
    } catch (Throwable $ignored) {
    }
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function body(): array
{
    static $body = null;
    if ($body === null) {
        $raw = file_get_contents('php://input');
        if ($raw === '' || $raw === false) return $body = [];
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new HttpError('El cuerpo de la solicitud no es JSON valido');
        }
        if (!is_array($decoded) || !str_starts_with(ltrim($raw), '{')) {
            throw new HttpError('El cuerpo JSON debe ser un objeto');
        }
        $body = $decoded;
    }
    return $body;
}

function param(string $key, $default = null)
{
    return $_GET[$key] ?? $default;
}

// ---------- Sesion / autenticacion ----------
function start_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_name('CAJAESTUDIO');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        ]);
        session_start();
    }
}

function current_user(): ?array
{
    static $checked = false;
    static $user = null;
    if ($checked) return $user;
    start_session();
    $checked = true;
    $stored = $_SESSION['user'] ?? null;
    if (!$stored) return null;

    $now = time();
    $idle = (int)(cfg('session_idle_timeout') ?? 1800);
    $absolute = (int)(cfg('session_absolute_timeout') ?? 28800);
    if ($now - (int)($_SESSION['last_activity'] ?? 0) >= $idle ||
        $now - (int)($_SESSION['authenticated_at'] ?? 0) >= $absolute) {
        end_session();
        return null;
    }

    // El rol, el estado y la credencial se verifican de nuevo en cada solicitud.
    $row = q('SELECT id, nombre, email, rol, activo, password_hash FROM usuarios WHERE id = ?', [$stored['id']])->fetch();
    $fingerprint = $_SESSION['password_fingerprint'] ?? '';
    if (!$row || !$row['activo'] || !is_string($fingerprint) ||
        !hash_equals(hash('sha256', $row['password_hash']), $fingerprint)) {
        end_session();
        return null;
    }
    $user = ['id' => (int)$row['id'], 'nombre' => $row['nombre'], 'email' => $row['email'], 'rol' => $row['rol']];
    if (($stored['rol'] ?? null) !== $user['rol']) session_regenerate_id(true);
    $_SESSION['user'] = $user;
    $_SESSION['last_activity'] = $now;
    return $user;
}

function end_session(): void
{
    $_SESSION = [];
    if (session_status() !== PHP_SESSION_ACTIVE) return;
    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires' => time() - 3600,
        'path' => $params['path'],
        'domain' => $params['domain'],
        'secure' => $params['secure'],
        'httponly' => $params['httponly'],
        'samesite' => $params['samesite'],
    ]);
    session_destroy();
}

function require_user(): array
{
    $u = current_user();
    if (!$u) throw new HttpError('Sesion expirada. Vuelva a ingresar.', 401);
    return $u;
}

function require_admin(): array
{
    $u = require_user();
    if ($u['rol'] !== 'admin') throw new HttpError('Solo el administrador puede hacer esto.', 403);
    return $u;
}

function audit(string $accion, string $entidad, $id, $antes = null, $despues = null): void
{
    $u = current_user();
    q('INSERT INTO audit_logs (usuario_id, accion, entidad, entidad_id, datos_anteriores, datos_nuevos) VALUES (?,?,?,?,?,?)', [
        $u['id'] ?? null,
        $accion,
        $entidad,
        $id,
        $antes === null ? null : json_encode($antes, JSON_UNESCAPED_UNICODE),
        $despues === null ? null : json_encode($despues, JSON_UNESCAPED_UNICODE),
    ]);
}

// ---------- Utilidades de dominio ----------
function money($v): float
{
    if ($v === null || $v === '') return 0.0;
    if (is_numeric($v)) return round((float)$v, 2);
    return round(parse_amount((string)$v), 2);
}

/**
 * Interpreta importes como vienen del Excel: "1.234,56", "1,234.56", "- 21,596.14", "$ 7.430", "-".
 */
function parse_amount(string $s): float
{
    $s = trim(str_replace(['$', ' ', "\xc2\xa0"], '', $s));
    if ($s === '' || $s === '-') return 0.0;
    $neg = false;
    if (str_starts_with($s, '-') || (str_starts_with($s, '(') && str_ends_with($s, ')'))) {
        $neg = true;
        $s = trim($s, '-()');
    }
    $lastComma = strrpos($s, ',');
    $lastDot = strrpos($s, '.');
    if ($lastComma !== false && $lastDot !== false) {
        $dec = $lastComma > $lastDot ? ',' : '.';
    } elseif ($lastComma !== false) {
        $dec = (strlen($s) - $lastComma - 1) <= 2 ? ',' : '';
    } elseif ($lastDot !== false) {
        $dec = (strlen($s) - $lastDot - 1) <= 2 && substr_count($s, '.') === 1 ? '.' : '';
    } else {
        $dec = '';
    }
    if ($dec === ',') {
        $s = str_replace('.', '', $s);
        $s = str_replace(',', '.', $s);
    } elseif ($dec === '.') {
        $s = str_replace(',', '', $s);
    } else {
        $s = str_replace([',', '.'], '', $s);
    }
    if (!is_numeric($s)) throw new HttpError("Importe invalido: $s");
    $n = (float)$s;
    return $neg ? -$n : $n;
}

function valid_date(?string $d): string
{
    if (!$d) return date('Y-m-d');
    if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})$#', $d, $m)) {
        $d = sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
    }
    $dt = DateTime::createFromFormat('Y-m-d', $d);
    if (!$dt || $dt->format('Y-m-d') !== $d) throw new HttpError('Fecha invalida');
    return $d;
}

function normalize_name(string $s): string
{
    $s = trim(preg_replace('/\s+/', ' ', $s));
    return mb_strtoupper($s, 'UTF-8');
}

function config_get(string $key, $default = null)
{
    $v = q('SELECT valor FROM configuracion WHERE clave = ?', [$key])->fetchColumn();
    return $v === false ? $default : $v;
}

function config_set(string $key, $value): void
{
    q('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [$key, $value]);
}

function internal_id(string $nombre): int
{
    $id = q('SELECT id FROM clientes WHERE nombre = ? AND es_interno = 1', [$nombre])->fetchColumn();
    if (!$id) {
        q('INSERT INTO clientes (nombre, es_interno) VALUES (?, 1)', [$nombre]);
        $id = db()->lastInsertId();
    }
    return (int)$id;
}

function periodo_cerrado(string $fecha): bool
{
    [$y, $m] = array_map('intval', explode('-', $fecha));
    return (bool)q('SELECT cerrado FROM periodos WHERE anio = ? AND mes = ?', [$y, $m])->fetchColumn();
}

function assert_abierto(string $fecha): void
{
    if (periodo_cerrado($fecha)) {
        throw new HttpError('El mes ' . substr($fecha, 5, 2) . '/' . substr($fecha, 0, 4) . ' esta cerrado. Pida al administrador que lo reabra.', 409);
    }
}

function ensure_periodo(string $fecha): void
{
    [$y, $m] = array_map('intval', explode('-', $fecha));
    q('INSERT IGNORE INTO periodos (anio, mes) VALUES (?, ?)', [$y, $m]);
}

function fecha_apertura(): string
{
    $inicio = config_get('fecha_inicio', date('Y-m-01'));
    return date('Y-m-d', strtotime($inicio . ' -1 day'));
}
