<?php

function auth_login(): array
{
    $b = body();
    $email = trim(strtolower((string)($b['email'] ?? '')));
    $pass = (string)($b['password'] ?? '');
    $u = q('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [$email])->fetch();
    if (!$u || !password_verify($pass, $u['password_hash'])) {
        usleep(400000);
        throw new HttpError('Email o contrasena incorrectos', 401);
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION = [
        'user' => ['id' => (int)$u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'rol' => $u['rol']],
        'password_fingerprint' => hash('sha256', $u['password_hash']),
        'authenticated_at' => time(),
        'last_activity' => time(),
    ];
    return auth_me();
}

function auth_logout(): array
{
    start_session();
    end_session();
    return ['ok' => true];
}

function auth_me(): array
{
    $u = current_user();
    return [
        'user' => $u,
        'config' => $u ? [
            'fecha_inicio' => config_get('fecha_inicio'),
            'nombre_estudio' => config_get('nombre_estudio', 'Estudio Contable'),
            'subtitulo_estudio' => config_get('subtitulo_estudio', ''),
            'datos_contacto_estudio' => config_get('datos_contacto_estudio', ''),
            'hoy' => date('Y-m-d'),
        ] : null,
    ];
}

function auth_password(): array
{
    $u = require_user();
    $b = body();
    $row = q('SELECT password_hash FROM usuarios WHERE id = ?', [$u['id']])->fetch();
    if (!password_verify((string)($b['actual'] ?? ''), $row['password_hash'])) {
        throw new HttpError('La contrasena actual no es correcta');
    }
    $nueva = (string)($b['nueva'] ?? '');
    if (strlen($nueva) < 8) throw new HttpError('La nueva contrasena debe tener al menos 8 caracteres');
    $hash = password_hash($nueva, PASSWORD_DEFAULT);
    db()->beginTransaction();
    q('UPDATE usuarios SET password_hash = ? WHERE id = ?', [$hash, $u['id']]);
    audit('EDITAR', 'usuarios', $u['id'], null, ['password' => 'cambiada']);
    db()->commit();
    $_SESSION['password_fingerprint'] = hash('sha256', $hash);
    session_regenerate_id(true);
    return ['ok' => true];
}

// ---------------- Usuarios (admin) ----------------
function usuarios_list(): array
{
    require_admin();
    return q('SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY nombre')->fetchAll();
}

function usuarios_create(): array
{
    require_admin();
    $b = body();
    $nombre = trim((string)($b['nombre'] ?? ''));
    $email = trim(strtolower((string)($b['email'] ?? '')));
    $pass = (string)($b['password'] ?? '');
    $rol = ($b['rol'] ?? 'operador') === 'admin' ? 'admin' : 'operador';
    if ($nombre === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new HttpError('Nombre y email validos son obligatorios');
    if (strlen($pass) < 8) throw new HttpError('La contrasena debe tener al menos 8 caracteres');
    if (q('SELECT id FROM usuarios WHERE email = ?', [$email])->fetch()) throw new HttpError('Ya existe un usuario con ese email');
    q('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?,?,?,?)', [$nombre, $email, password_hash($pass, PASSWORD_DEFAULT), $rol]);
    $id = (int)db()->lastInsertId();
    audit('CREAR', 'usuarios', $id, null, ['nombre' => $nombre, 'email' => $email, 'rol' => $rol]);
    return ['id' => $id];
}

function usuarios_update(int $id): array
{
    $me = require_admin();
    $b = body();
    $u = q('SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = ?', [$id])->fetch();
    if (!$u) throw new HttpError('Usuario inexistente', 404);
    $nombre = trim((string)($b['nombre'] ?? $u['nombre']));
    $rol = ($b['rol'] ?? $u['rol']) === 'admin' ? 'admin' : 'operador';
    $activo = isset($b['activo']) ? (int)(bool)$b['activo'] : (int)$u['activo'];
    if ($id === $me['id'] && ($rol !== 'admin' || !$activo)) throw new HttpError('No puede quitarse a si mismo el rol de administrador');
    if ($nombre === '') throw new HttpError('El nombre es obligatorio');
    $pass = (string)($b['password'] ?? '');
    if ($pass !== '' && strlen($pass) < 8) throw new HttpError('La contrasena debe tener al menos 8 caracteres');
    $hash = $pass === '' ? null : password_hash($pass, PASSWORD_DEFAULT);
    db()->beginTransaction();
    q('UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?', [$nombre, $rol, $activo, $id]);
    if ($hash !== null) {
        q('UPDATE usuarios SET password_hash = ? WHERE id = ?', [$hash, $id]);
    }
    audit('EDITAR', 'usuarios', $id, $u, ['nombre' => $nombre, 'rol' => $rol, 'activo' => $activo, 'password_cambiada' => $hash !== null]);
    db()->commit();
    if ($hash !== null && $id === $me['id']) {
        $_SESSION['password_fingerprint'] = hash('sha256', $hash);
        session_regenerate_id(true);
    }
    return ['ok' => true];
}

