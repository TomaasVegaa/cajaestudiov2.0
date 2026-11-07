<?php
/**
 * Instalador: crea la base (si se puede), las tablas y el usuario administrador.
 *   CLI:  php install.php email@estudio.com "Nombre" contrasena
 *   Web:  abrir /install.php (solo funciona mientras no exista ningun usuario)
 */
require __DIR__ . '/api/lib/core.php';

function run_install(string $email, string $nombre, string $pass): string
{
    $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', cfg('db_host'), cfg('db_port'));
    $pdo = new PDO($dsn, cfg('db_user'), cfg('db_pass'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    try {
        $pdo->exec('CREATE DATABASE IF NOT EXISTS `' . cfg('db_name') . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    } catch (PDOException $e) {
        // En hosting compartido la base ya existe y el usuario no puede crearla.
    }
    $pdo->exec('USE `' . cfg('db_name') . '`');
    $sql = file_get_contents(__DIR__ . '/database/schema.sql');
    $sql = preg_replace('/^\s*--.*$/m', '', $sql);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        $pdo->exec($stmt);
    }
    $n = (int)$pdo->query('SELECT COUNT(*) FROM usuarios')->fetchColumn();
    if ($n > 0) return "Tablas verificadas. Ya existen usuarios: no se creo ninguno nuevo.";
    $email = strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 8 || trim($nombre) === '') {
        throw new RuntimeException('Datos invalidos: email valido, nombre y contrasena de 8+ caracteres.');
    }
    $st = $pdo->prepare("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'admin')");
    $st->execute([trim($nombre), $email, password_hash($pass, PASSWORD_DEFAULT)]);
    return "Instalacion completa. Administrador creado: $email";
}

if (PHP_SAPI === 'cli') {
    try {
        echo run_install($argv[1] ?? '', $argv[2] ?? 'Administrador', $argv[3] ?? '') . PHP_EOL;
    } catch (Throwable $e) {
        fwrite(STDERR, 'ERROR: ' . $e->getMessage() . PHP_EOL);
        exit(1);
    }
    exit(0);
}

// ----- Modo web -----
$msg = '';
$hayUsuarios = false;
try {
    $hayUsuarios = (int)db()->query('SELECT COUNT(*) FROM usuarios')->fetchColumn() > 0;
} catch (Throwable $e) {
}
if ($hayUsuarios) {
    http_response_code(403);
    exit('El sistema ya esta instalado. Borre install.php del servidor.');
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $msg = run_install($_POST['email'] ?? '', $_POST['nombre'] ?? '', $_POST['password'] ?? '');
    } catch (Throwable $e) {
        $msg = 'ERROR: ' . $e->getMessage();
    }
}
?>
<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instalar Caja Estudio</title>
<style>body{font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px}label{display:block;margin:12px 0 4px}input{width:100%;padding:10px;font-size:16px;box-sizing:border-box}button{margin-top:16px;padding:12px;width:100%;font-size:16px;background:#1e40af;color:#fff;border:0;border-radius:6px}</style></head>
<body>
<h1>Instalar Caja Estudio</h1>
<?php if ($msg): ?><p><strong><?= htmlspecialchars($msg) ?></strong></p><?php endif; ?>
<form method="post">
  <label>Nombre del administrador</label><input name="nombre" required>
  <label>Email</label><input name="email" type="email" required>
  <label>Contrasena (minimo 8)</label><input name="password" type="password" minlength="8" required>
  <button>Instalar</button>
</form>
</body></html>

