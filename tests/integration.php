<?php
/** Pruebas HTTP reales contra una copia temporal de la API y una base descartable. */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);
$config = require $root . '/api/config.php';
$testName = 'caja_test_' . bin2hex(random_bytes(8));
$temporary = sys_get_temp_dir() . DIRECTORY_SEPARATOR . $testName;
$server = null;
$pdo = null;
$created = false;
$checks = 0;

function check(bool $condition, string $description): void
{
    global $checks;
    if (!$condition) throw new RuntimeException($description);
    $checks++;
    echo 'PASS ', $description, PHP_EOL;
}

function request_api(string $client, string $method, string $route, $payload = null, array $headers = []): array
{
    global $temporary, $base;
    $cookie = $temporary . '/' . $client . '.cookies';
    $curl = curl_init($base . '/api/index.php?r=' . rawurlencode($route));
    $requestHeaders = $headers ?: ['Content-Type: application/json'];
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $requestHeaders,
        CURLOPT_COOKIEFILE => $cookie,
        CURLOPT_COOKIEJAR => $cookie,
        CURLOPT_CONNECTTIMEOUT => 1,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_PROXY => '',
    ]);
    if ($payload !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, is_string($payload) ? $payload : json_encode($payload));
    }
    $raw = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_setopt($curl, CURLOPT_COOKIELIST, 'FLUSH');
    unset($curl);
    if ($raw === false) throw new RuntimeException('No se pudo consultar el servidor de pruebas: ' . $error);
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new RuntimeException('La API no respondio JSON en ' . $route);
    return [$status, $data];
}

function expire_test_session(string $client, string $field, int $age): void
{
    global $temporary;
    $id = null;
    foreach (file($temporary . '/' . $client . '.cookies', FILE_IGNORE_NEW_LINES) as $line) {
        $parts = explode("\t", $line);
        if (count($parts) === 7 && $parts[5] === 'CAJAESTUDIO') $id = $parts[6];
    }
    if (!$id || !preg_match('/^[a-zA-Z0-9,-]+$/', $id)) throw new RuntimeException('Cookie de prueba no encontrada');
    $file = $temporary . '/sessions/sess_' . $id;
    $content = file_get_contents($file);
    $content = preg_replace('/' . preg_quote($field, '/') . '\|i:\d+;/', $field . '|i:' . (time() - $age) . ';', $content, 1, $count);
    if ($count !== 1) throw new RuntimeException('No se encontro el reloj de la sesion de prueba');
    file_put_contents($file, $content);
}

function remove_test_tree(string $path, string $verifiedRoot): void
{
    $resolved = realpath($path);
    if ($resolved === false) return;
    if ($resolved !== $verifiedRoot && !str_starts_with($resolved, $verifiedRoot . DIRECTORY_SEPARATOR)) {
        throw new RuntimeException('La limpieza saldria del directorio temporal de pruebas');
    }
    foreach (new DirectoryIterator($path) as $entry) {
        if ($entry->isDot()) continue;
        if ($entry->isDir() && !$entry->isLink()) {
            remove_test_tree($entry->getPathname(), $verifiedRoot);
        } else {
            unlink($entry->getPathname());
        }
    }
    rmdir($path);
}

try {
    $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $config['db_host'], $config['db_port']);
    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    // Nombre generado internamente: nunca se usa db_name para crear o borrar una base.
    $pdo->exec('CREATE DATABASE `' . $testName . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    $created = true;
    $pdo->exec('USE `' . $testName . '`');
    $schema = preg_replace('/^\s*--.*$/m', '', file_get_contents($root . '/database/schema.sql'));
    foreach (array_filter(array_map('trim', explode(';', $schema))) as $statement) $pdo->exec($statement);
    $insert = $pdo->prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?,?,?,?)');
    $insert->execute(['Administrador de prueba', 'admin@example.test', password_hash('ClavePrueba123', PASSWORD_DEFAULT), 'admin']);
    $adminId = (int)$pdo->lastInsertId();
    $insert->execute(['Operador de prueba', 'operador@example.test', password_hash('ClavePrueba123', PASSWORD_DEFAULT), 'operador']);
    $operatorId = (int)$pdo->lastInsertId();

    mkdir($temporary . '/public/api', 0700, true);
    mkdir($temporary . '/sessions', 0700);
    $source = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/api', FilesystemIterator::SKIP_DOTS));
    foreach ($source as $file) {
        if ($file->getExtension() !== 'php' || $file->getFilename() === 'config.local.php') continue;
        $relative = substr($file->getPathname(), strlen($root . '/api') + 1);
        $target = $temporary . '/public/api/' . $relative;
        if (!is_dir(dirname($target))) mkdir(dirname($target), 0700, true);
        copy($file->getPathname(), $target);
    }
    $testConfig = array_merge($config, ['db_name' => $testName, 'debug' => false, 'session_idle_timeout' => 1800, 'session_absolute_timeout' => 28800]);
    file_put_contents($temporary . '/public/api/config.local.php', '<?php return ' . var_export($testConfig, true) . ';');

    $socket = stream_socket_server('tcp://127.0.0.1:0', $errorCode, $errorText);
    if (!$socket) throw new RuntimeException('No se pudo reservar un puerto local');
    $address = stream_socket_get_name($socket, false);
    fclose($socket);
    $base = 'http://' . $address;
    $server = proc_open([
        PHP_BINARY, '-d', 'session.save_path=' . $temporary . '/sessions',
        '-d', 'session.serialize_handler=php', '-S', $address, '-t', $temporary . '/public',
    ], [0 => ['pipe', 'r'], 1 => ['file', $temporary . '/server.log', 'a'], 2 => ['file', $temporary . '/server.log', 'a']], $pipes);
    if (!is_resource($server)) throw new RuntimeException('No se pudo iniciar PHP para las pruebas');
    fclose($pipes[0]);
    $ready = false;
    for ($attempt = 0; $attempt < 40; $attempt++) {
        try {
            [$status, $data] = request_api('anonimo', 'GET', 'auth/me');
            if ($status === 200) { $ready = true; break; }
        } catch (RuntimeException $e) {
        }
        usleep(100000);
    }
    check($ready, 'Servidor aislado disponible');
    check($data['user'] === null, 'La consulta anonima no autentica un usuario');
    check(request_api('anonimo', 'GET', 'clientes')[0] === 401, 'Los datos de clientes requieren sesion');

    $login = ['email' => 'admin@example.test', 'password' => 'ClavePrueba123'];
    check(request_api('anonimo', 'POST', 'auth/login', $login, ['Content-Type: text/plain; application/json'])[0] === 415, 'Rechaza Content-Type text/plain disfrazado de JSON');
    check(request_api('anonimo', 'POST', 'auth/login', '{"email":')[0] === 400, 'Rechaza JSON malformado con HTTP 400');
    foreach (['[]', 'null', '"texto"'] as $invalid) {
        check(request_api('anonimo', 'POST', 'auth/login', $invalid)[0] === 400, 'Rechaza cuerpo JSON que no es objeto: ' . $invalid);
    }
    check(request_api('anonimo', 'POST', 'auth/login', $login, ['Content-Type: application/json', 'Sec-Fetch-Site: cross-site'])[0] === 403, 'Rechaza escritura identificada como cross-site');
    check(request_api('admin', 'POST', 'auth/login', $login, ['Content-Type: application/json; charset=utf-8'])[0] === 200, 'Login compatible con JSON y charset');
    check(request_api('operador', 'POST', 'auth/login', ['email' => 'operador@example.test', 'password' => 'ClavePrueba123'])[0] === 200, 'Login del operador');
    check(request_api('operador', 'GET', 'usuarios')[0] === 403, 'El operador no administra usuarios');

    check(request_api('admin', 'PUT', 'usuarios/' . $operatorId, ['nombre' => 'Cambio parcial', 'rol' => 'admin', 'password' => 'x'])[0] === 400, 'Una contrasena invalida rechaza la edicion completa');
    $row = $pdo->query('SELECT nombre, rol FROM usuarios WHERE id = ' . $operatorId)->fetch();
    check($row['nombre'] === 'Operador de prueba' && $row['rol'] === 'operador', 'No guarda nombre ni rol al fallar la validacion');
    $pdo->exec("UPDATE usuarios SET rol = 'admin' WHERE id = " . $operatorId);
    check(request_api('operador', 'GET', 'usuarios')[0] === 200, 'Una sesion existente utiliza el rol actual');
    $pdo->exec("UPDATE usuarios SET rol = 'operador' WHERE id = " . $operatorId);
    check(request_api('operador', 'GET', 'usuarios')[0] === 403, 'La quita de privilegios rige en la siguiente solicitud');
    $pdo->exec('UPDATE usuarios SET activo = 0 WHERE id = ' . $operatorId);
    check(request_api('operador', 'GET', 'clientes')[0] === 401, 'Desactivar un usuario invalida su sesion existente');

    check(request_api('otra_sesion', 'POST', 'auth/login', $login)[0] === 200, 'Segunda sesion del administrador');
    check(request_api('admin', 'POST', 'auth/password', ['actual' => 'ClavePrueba123', 'nueva' => 'ClaveRenovada456'])[0] === 200, 'Cambio de contrasena correcto');
    check(request_api('admin', 'GET', 'usuarios')[0] === 200, 'El cambio conserva la sesion que lo realizo');
    check(request_api('otra_sesion', 'GET', 'usuarios')[0] === 401, 'El cambio invalida las otras sesiones');
    $login['password'] = 'ClaveRenovada456';
    check(request_api('sesion_reinicio', 'POST', 'auth/login', $login)[0] === 200, 'Login con la credencial nueva');
    check(request_api('admin', 'PUT', 'usuarios/' . $adminId, ['password' => 'ClaveRestablecida789'])[0] === 200, 'Restablecimiento administrativo de contrasena');
    check(request_api('admin', 'GET', 'usuarios')[0] === 200, 'El restablecimiento propio conserva la sesion actual');
    check(request_api('sesion_reinicio', 'GET', 'usuarios')[0] === 401, 'El restablecimiento invalida las otras sesiones');
    $login['password'] = 'ClaveRestablecida789';
    foreach ([['inactiva', 'last_activity', 1801], ['antigua', 'authenticated_at', 28801]] as [$client, $field, $age]) {
        check(request_api($client, 'POST', 'auth/login', $login)[0] === 200, 'Crear sesion para probar vencimiento: ' . $client);
        expire_test_session($client, $field, $age);
        check(request_api($client, 'GET', 'clientes')[0] === 401, 'El servidor aplica vencimiento: ' . $field);
    }

    [$status, $client] = request_api('admin', 'POST', 'clientes', ['nombre' => 'Cliente de prueba']);
    check($status === 200, 'Alta de cliente por la API');
    $clientId = $client['id'];
    [$status, $result] = request_api('admin', 'POST', 'movimientos/carga-rapida', [
        'fecha' => '2026-11-05', 'cliente_id' => $clientId, 'tipo_valor' => 'HONORARIOS',
        'entrada' => 100, 'pase_lore' => true, 'idempotency_key' => 'honorarios-prueba',
    ]);
    check($status === 200 && count($result['movimientos']) === 2, 'Honorarios y pase a LORE se crean juntos');
    $parentId = $result['movimientos'][0]['id'];
    [$status, $result] = request_api('admin', 'PUT', 'movimientos/' . $parentId, ['entrada' => 150, 'cod_conce' => 'T', 'medio' => 'BANCO']);
    check($status === 200, 'Se puede corregir el cobro vinculado');
    $parent = $result['movimientos'][0];
    $mirror = $result['movimientos'][1];
    check($parent['medio'] === 'BANCO' && $mirror['medio'] === 'BANCO' && $mirror['cod_conce'] === 'T' && (float)$mirror['salida'] === 150.0, 'El pase sincroniza medio, codigo e importe');
    $net = $pdo->query('SELECT medio, SUM(entrada - salida) saldo FROM movimientos WHERE afecta_caja = 1 GROUP BY medio')->fetchAll();
    check(count($net) === 1 && $net[0]['medio'] === 'BANCO' && (float)$net[0]['saldo'] === 0.0, 'La correccion no deja diferencias entre efectivo y banco');
    check(request_api('admin', 'PUT', 'movimientos/' . $parentId, ['entrada' => 0, 'salida' => 150])[0] === 400, 'No permite invertir un cobro con retiro automatico');
    $row = $pdo->query('SELECT entrada, salida FROM movimientos WHERE id = ' . $parentId)->fetch();
    check((float)$row['entrada'] === 150.0 && (float)$row['salida'] === 0.0, 'La edicion rechazada revierte todos sus cambios');

    [$status, $result] = request_api('admin', 'POST', 'movimientos/carga-rapida', [
        'fecha' => '2026-11-05', 'cliente_id' => $clientId, 'salida' => 50,
    ]);
    check($status === 200 && (float)$result['saldo_cliente'] === -50.0, 'Se permiten saldos negativos de clientes');
    $payload = ['fecha' => '2026-11-05', 'cliente_id' => $clientId, 'entrada' => 100, 'idempotency_key' => 'reintento-prueba'];
    request_api('admin', 'POST', 'movimientos/carga-rapida', $payload);
    $countBefore = (int)$pdo->query('SELECT COUNT(*) FROM movimientos')->fetchColumn();
    [$status, $result] = request_api('admin', 'POST', 'movimientos/carga-rapida', $payload);
    check($status === 200 && $result['duplicado'] === true && (int)$pdo->query('SELECT COUNT(*) FROM movimientos')->fetchColumn() === $countBefore, 'El reintento secuencial no duplica movimientos');
    [$status, $statement] = request_api('admin', 'GET', 'clientes/' . $clientId . '/estado-cuenta');
    check($status === 200 && (float)$statement['saldo_hoy'] === 50.0, 'Los honorarios directos no alteran la cuenta del cliente');
    check(request_api('admin', 'POST', 'periodos/cerrar', ['anio' => 2026, 'mes' => 11])[0] === 200, 'El administrador puede cerrar un mes');
    check(request_api('admin', 'PUT', 'movimientos/' . $parentId, ['entrada' => 175])[0] === 409, 'Un mes cerrado rechaza ediciones normales');
    check(request_api('admin', 'POST', 'movimientos/carga-rapida', ['fecha' => '2026-11-05', 'cliente_id' => $clientId, 'entrada' => 20])[0] === 409, 'Un mes cerrado rechaza cargas normales');
    check(request_api('admin', 'POST', 'periodos/reabrir', ['anio' => 2026, 'mes' => 11])[0] === 200, 'La reapertura sigue disponible para el administrador');
    check((int)$pdo->query('SELECT COUNT(*) FROM audit_logs WHERE usuario_id IS NULL')->fetchColumn() === 0, 'Las operaciones auditadas conservan al usuario responsable');
    check(request_api('admin', 'POST', 'auth/logout', new stdClass())[0] === 200, 'Cierre de sesion');
    check(request_api('admin', 'GET', 'clientes')[0] === 401, 'La sesion cerrada no permite consultar clientes');
    echo PHP_EOL, $checks, ' comprobaciones correctas.', PHP_EOL;
} catch (Throwable $e) {
    fwrite(STDERR, 'FAIL: ' . $e->getMessage() . PHP_EOL);
    $failed = true;
} finally {
    if (is_resource($server)) {
        proc_terminate($server);
        proc_close($server);
    }
    if ($created && $pdo && preg_match('/^caja_test_[a-f0-9]{16}$/', $testName)) {
        $pdo->exec('DROP DATABASE `' . $testName . '`');
    }
    if (is_dir($temporary)) remove_test_tree($temporary, realpath($temporary));
}
exit(!empty($failed) ? 1 : 0);
