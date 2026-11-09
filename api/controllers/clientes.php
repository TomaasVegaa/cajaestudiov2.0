<?php

function cliente_aliases(int $id): array
{
    return q('SELECT alias FROM clientes_alias WHERE cliente_id = ? ORDER BY alias', [$id])->fetchAll(PDO::FETCH_COLUMN);
}

function clientes_list(): array
{
    require_user();
    $internos = param('internos', '1') === '1';
    $sql = "SELECT c.id, c.nombre, c.cuit, c.telefono, c.es_interno, c.nota_revision, c.activo,
                   GROUP_CONCAT(a.alias SEPARATOR '|') aliases
            FROM clientes c LEFT JOIN clientes_alias a ON a.cliente_id = c.id
            WHERE c.activo = 1" . ($internos ? '' : ' AND c.es_interno = 0') . "
            GROUP BY c.id ORDER BY c.es_interno DESC, c.nombre";
    return array_map(fn($r) => [
        'id' => (int)$r['id'],
        'nombre' => $r['nombre'],
        'cuit' => $r['cuit'],
        'telefono' => $r['telefono'],
        'es_interno' => (bool)$r['es_interno'],
        'nota_revision' => $r['nota_revision'],
        'aliases' => $r['aliases'] ? explode('|', $r['aliases']) : [],
    ], q($sql)->fetchAll());
}

function find_cliente_by_name(string $nombre): ?int
{
    $n = normalize_name($nombre);
    $id = q('SELECT id FROM clientes WHERE nombre = ?', [$n])->fetchColumn();
    if ($id) return (int)$id;
    $id = q('SELECT cliente_id FROM clientes_alias WHERE alias = ?', [$n])->fetchColumn();
    return $id ? (int)$id : null;
}

function save_aliases(int $id, $aliases): void
{
    if (!is_array($aliases)) return;
    q('DELETE FROM clientes_alias WHERE cliente_id = ?', [$id]);
    foreach (array_unique(array_filter(array_map('normalize_name', $aliases))) as $a) {
        $owner = find_cliente_by_name($a);
        if ($owner && $owner !== $id) throw new HttpError("El alias \"$a\" ya pertenece a otro cliente");
        q('INSERT INTO clientes_alias (cliente_id, alias) VALUES (?, ?)', [$id, $a]);
    }
}

function clientes_create(): array
{
    require_user();
    $b = body();
    $nombre = normalize_name((string)($b['nombre'] ?? ''));
    if ($nombre === '') throw new HttpError('El nombre es obligatorio');
    if (find_cliente_by_name($nombre)) throw new HttpError('Ya existe un cliente (o alias) con ese nombre');
    db()->beginTransaction();
    q('INSERT INTO clientes (nombre, cuit, telefono, nota_revision) VALUES (?,?,?,?)', [
        $nombre, $b['cuit'] ?? null, $b['telefono'] ?? null, $b['nota_revision'] ?? null,
    ]);
    $id = (int)db()->lastInsertId();
    save_aliases($id, $b['aliases'] ?? []);
    audit('CREAR', 'clientes', $id, null, $b);
    db()->commit();
    return ['id' => $id, 'nombre' => $nombre, 'es_interno' => false, 'nota_revision' => $b['nota_revision'] ?? null, 'aliases' => cliente_aliases($id)];
}

function clientes_update(int $id): array
{
    require_user();
    $b = body();
    $c = q('SELECT * FROM clientes WHERE id = ?', [$id])->fetch();
    if (!$c) throw new HttpError('Cliente inexistente', 404);
    $nombre = normalize_name((string)($b['nombre'] ?? $c['nombre']));
    if ($nombre === '') throw new HttpError('El nombre es obligatorio');
    $owner = find_cliente_by_name($nombre);
    if ($owner && $owner !== $id) throw new HttpError('Ya existe otro cliente (o alias) con ese nombre');
    if ($c['es_interno'] && $nombre !== $c['nombre']) throw new HttpError('No se puede renombrar una cuenta interna');
    db()->beginTransaction();
    q('UPDATE clientes SET nombre = ?, cuit = ?, telefono = ?, nota_revision = ?, activo = ? WHERE id = ?', [
        $nombre,
        array_key_exists('cuit', $b) ? $b['cuit'] : $c['cuit'],
        array_key_exists('telefono', $b) ? $b['telefono'] : $c['telefono'],
        array_key_exists('nota_revision', $b) ? $b['nota_revision'] : $c['nota_revision'],
        isset($b['activo']) ? (int)(bool)$b['activo'] : (int)$c['activo'],
        $id,
    ]);
    if (array_key_exists('aliases', $b)) save_aliases($id, $b['aliases']);
    audit('EDITAR', 'clientes', $id, $c, $b);
    db()->commit();
    return ['ok' => true];
}

function clientes_nota(int $id): array
{
    require_user();
    $nota = trim((string)(body()['nota'] ?? ''));
    $antes = q('SELECT nota_revision FROM clientes WHERE id = ?', [$id])->fetchColumn();
    q('UPDATE clientes SET nota_revision = ? WHERE id = ?', [$nota === '' ? null : mb_substr($nota, 0, 255), $id]);
    audit('EDITAR', 'clientes.nota', $id, ['nota' => $antes], ['nota' => $nota]);
    return ['ok' => true];
}

function clientes_telefono(int $id): array
{
    require_user();
    $c = q('SELECT id, telefono FROM clientes WHERE id = ?', [$id])->fetch();
    if (!$c) throw new HttpError('Cliente inexistente', 404);
    $tel = trim((string)(body()['telefono'] ?? ''));
    $limpio = $tel === '' ? null : mb_substr($tel, 0, 50);
    q('UPDATE clientes SET telefono = ? WHERE id = ?', [$limpio, $id]);
    audit('EDITAR', 'clientes.telefono', $id, ['telefono' => $c['telefono']], ['telefono' => $limpio]);
    return ['ok' => true, 'telefono' => $limpio];
}

function clientes_saldos(): array
{
    require_user();
    $fecha = valid_date(param('fecha', date('Y-m-d')));
    $rows = q("SELECT c.id, c.nombre, c.telefono, c.nota_revision,
                  COALESCE(SUM(CASE WHEN m.afecta_cliente = 1 AND m.fecha <= ? THEN m.entrada - m.salida END), 0) saldo,
                  MAX(CASE WHEN m.fecha <= ? AND m.tipo_valor <> 'APERTURA' THEN m.fecha END) ultimo_mov
               FROM clientes c LEFT JOIN movimientos m ON m.cliente_id = c.id
               WHERE c.es_interno = 0 AND c.activo = 1
               GROUP BY c.id ORDER BY c.nombre", [$fecha, $fecha])->fetchAll();
    $clientes = array_map(fn($r) => [
        'id' => (int)$r['id'],
        'nombre' => $r['nombre'],
        'telefono' => $r['telefono'],
        'nota_revision' => $r['nota_revision'],
        'saldo' => round((float)$r['saldo'], 2),
        'ultimo_mov' => $r['ultimo_mov'],
    ], $rows);
    return ['fecha' => $fecha, 'clientes' => $clientes, 'totales' => totales_clientes($fecha)];
}

function clientes_estado_cuenta(int $id): array
{
    require_user();
    $c = q('SELECT id, nombre, cuit, telefono, nota_revision, es_interno FROM clientes WHERE id = ?', [$id])->fetch();
    if (!$c) throw new HttpError('Cliente inexistente', 404);
    $desde = valid_date(param('desde', date('Y-01-01')));
    $hasta = valid_date(param('hasta', date('Y-m-d')));
    if ($desde > $hasta) throw new HttpError('El rango de fechas es invalido');

    $anterior = saldo_cliente($id, $desde, false);
    $rows = q("SELECT m.*, u.nombre usuario FROM movimientos m LEFT JOIN usuarios u ON u.id = m.creado_por
               WHERE m.cliente_id = ? AND m.fecha BETWEEN ? AND ? ORDER BY m.fecha, m.id", [$id, $desde, $hasta])->fetchAll();

    $saldo = cents($anterior);
    $t = ['entregas' => 0, 'impuestos' => 0, 'utiles' => 0, 'honorarios_saldo' => 0, 'honorarios_directo' => 0, 'ajustes' => 0, 'apertura' => 0];
    $movs = [];
    foreach ($rows as $r) {
        $m = mov_row($r);
        $e = cents($r['entrada']);
        $s = cents($r['salida']);
        if ($m['afecta_cliente']) {
            $saldo += $e - $s;
            $m['saldo_cliente'] = from_cents($saldo);
        } else {
            $m['saldo_cliente'] = null;
        }
        switch ($r['tipo_valor']) {
            case 'IMPUESTOS':
                $t['entregas'] += $e;
                $t['impuestos'] += $s;
                break;
            case 'UTILES':
                $t['utiles'] += $s - $e;
                break;
            case 'HONORARIOS':
                if ($m['afecta_cliente']) $t['honorarios_saldo'] += $s;
                else $t['honorarios_directo'] += $e;
                break;
            case 'AJUSTE':
                $t['ajustes'] += $e - $s;
                break;
            case 'APERTURA':
                $t['apertura'] += $e - $s;
                break;
        }
        $movs[] = $m;
    }
    return [
        'cliente' => [
            'id' => (int)$c['id'], 'nombre' => $c['nombre'], 'cuit' => $c['cuit'], 'telefono' => $c['telefono'],
            'nota_revision' => $c['nota_revision'], 'es_interno' => (bool)$c['es_interno'], 'aliases' => cliente_aliases($id),
        ],
        'desde' => $desde,
        'hasta' => $hasta,
        'saldo_anterior' => $anterior,
        'saldo_final' => from_cents($saldo),
        'saldo_hoy' => saldo_cliente($id, '9999-12-31'),
        'totales' => array_map('from_cents', $t),
        'movimientos' => $movs,
    ];
}

