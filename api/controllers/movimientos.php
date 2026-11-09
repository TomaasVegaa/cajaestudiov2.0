<?php

const TIPOS_CARGA = ['IMPUESTOS', 'HONORARIOS', 'GASTO_ESTUDIO', 'AJUSTE', 'RETIRO'];

function movimientos_list(): array
{
    require_user();
    $anio = (int)param('anio', date('Y'));
    $mes = (int)param('mes', date('n'));
    if ($mes < 1 || $mes > 12 || $anio < 2000) throw new HttpError('Periodo invalido');
    $desde = sprintf('%04d-%02d-01', $anio, $mes);
    $hasta = date('Y-m-t', strtotime($desde));

    ensure_arca_schema();
    $rows = q("SELECT m.*, c.nombre cliente, c.es_interno, u.nombre usuario,
                      fa.id fa_id, fa.cbte_tipo fa_cbte_tipo, fa.punto_venta fa_punto_venta,
                      fa.cbte_numero fa_cbte_numero, fa.cae fa_cae, fa.entorno fa_entorno
               FROM movimientos m
               JOIN clientes c ON c.id = m.cliente_id
               LEFT JOIN usuarios u ON u.id = m.creado_por
               LEFT JOIN facturas_arca fa ON fa.movimiento_id = m.id
               WHERE m.fecha BETWEEN ? AND ?
               ORDER BY m.fecha, m.id", [$desde, $hasta])->fetchAll();

    $clienteId = (int)param('cliente_id', 0);
    $cod = param('cod');
    $tipo = param('tipo');
    $medio = param('medio');
    $orden = strtolower((string)param('orden', 'desc'));
    $texto = mb_strtoupper(trim((string)param('q', '')), 'UTF-8');

    $saldoCliente = $clienteId ? cents(saldo_cliente($clienteId, $desde, false)) : 0;
    $saldoCaja = 0;
    $entradas = 0;
    $salidas = 0;
    $out = [];
    foreach ($rows as $r) {
        $m = mov_row($r);
        $e = cents($r['entrada']);
        $s = cents($r['salida']);
        if ($m['afecta_caja'] && $r['tipo_valor'] !== 'APERTURA') {
            $saldoCaja += $e - $s;
            $entradas += $e;
            $salidas += $s;
        }
        $m['saldo_caja'] = from_cents($saldoCaja);
        if ($clienteId && $m['cliente_id'] === $clienteId && $m['afecta_cliente']) {
            $saldoCliente += $e - $s;
        }
        $m['saldo_cliente'] = ($clienteId && $m['cliente_id'] === $clienteId && $m['afecta_cliente']) ? from_cents($saldoCliente) : null;

        if ($clienteId && $m['cliente_id'] !== $clienteId) continue;
        if ($cod && $m['cod_conce'] !== $cod) continue;
        if ($tipo && $m['tipo_valor'] !== $tipo) continue;
        if ($medio && $m['medio'] !== $medio) continue;
        if ($texto !== '' && mb_strpos(mb_strtoupper($m['detalle'] . ' ' . $m['cliente'], 'UTF-8'), $texto) === false) continue;
        $out[] = $m;
    }

    $inicio = saldo_caja($desde, false);
    $fin = saldo_caja($hasta);
    $res = [
        'anio' => $anio,
        'mes' => $mes,
        'desde' => $desde,
        'hasta' => $hasta,
        'cerrado' => periodo_cerrado($desde),
        'orden' => $orden,
        'movimientos' => ($orden === 'asc') ? $out : array_reverse($out),
        'resumen' => [
            'entradas_mes' => from_cents($entradas),
            'salidas_mes' => from_cents($salidas),
            'saldo_mes' => from_cents($entradas - $salidas),
            'saldo_real_inicio' => $inicio,
            'saldo_real_fin' => $fin,
        ],
    ];
    if ($clienteId) {
        $res['cliente_saldo_anterior'] = saldo_cliente($clienteId, $desde, false);
        $res['cliente_saldo_fin'] = saldo_cliente($clienteId, $hasta);
    }
    return $res;
}

function insert_mov(array $d): int
{
    q('INSERT INTO movimientos (fecha, cod_conce, medio, cliente_id, tipo_valor, detalle, entrada, salida,
            afecta_caja, afecta_cliente, movimiento_padre_id, grupo, idempotency_key, creado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        $d['fecha'], $d['cod_conce'], $d['medio'], $d['cliente_id'], $d['tipo_valor'], mb_substr($d['detalle'], 0, 255),
        $d['entrada'] ?? 0, $d['salida'] ?? 0, (int)$d['afecta_caja'], (int)$d['afecta_cliente'],
        $d['movimiento_padre_id'] ?? null, $d['grupo'] ?? null, $d['idempotency_key'] ?? null, $d['creado_por'] ?? null,
    ]);
    return (int)db()->lastInsertId();
}

function fetch_movs(string $where, array $params): array
{
    ensure_arca_schema();
    $rows = q("SELECT m.*, c.nombre cliente, c.es_interno, u.nombre usuario,
                      fa.id fa_id, fa.cbte_tipo fa_cbte_tipo, fa.punto_venta fa_punto_venta,
                      fa.cbte_numero fa_cbte_numero, fa.cae fa_cae, fa.entorno fa_entorno
               FROM movimientos m
               JOIN clientes c ON c.id = m.cliente_id
               LEFT JOIN usuarios u ON u.id = m.creado_por
               LEFT JOIN facturas_arca fa ON fa.movimiento_id = m.id
               WHERE $where ORDER BY m.id", $params)->fetchAll();
    return array_map('mov_row', $rows);
}

/**
 * Carga rapida "todo en uno". Genera en una transaccion todas las filas necesarias.
 * Ver matriz de movimientos en especificacion_srs_v3.md
 */
function movimientos_carga_rapida(): array
{
    $u = require_user();
    $b = body();

    $key = isset($b['idempotency_key']) ? substr((string)$b['idempotency_key'], 0, 64) : null;
    if ($key) {
        $g = q('SELECT grupo FROM movimientos WHERE idempotency_key = ?', [$key])->fetchColumn();
        if ($g) return ['duplicado' => true, 'movimientos' => fetch_movs('m.grupo = ?', [$g])];
    }

    $fecha = valid_date($b['fecha'] ?? null);
    $tipo = (string)($b['tipo_valor'] ?? 'IMPUESTOS');
    if (!in_array($tipo, TIPOS_CARGA, true)) throw new HttpError('Tipo de valor invalido');
    $cod = in_array($b['cod_conce'] ?? '', ['E', 'C', 'T'], true) ? $b['cod_conce'] : ($tipo === 'HONORARIOS' ? 'E' : 'C');
    $medio = in_array($b['medio'] ?? '', ['EFECTIVO', 'BANCO'], true) ? $b['medio'] : ($cod === 'T' ? 'BANCO' : 'EFECTIVO');
    $detalle = normalize_name((string)($b['detalle'] ?? ''));
    $detalleSalida = normalize_name((string)($b['detalle_salida'] ?? '')) ?: $detalle;
    $entrada = money($b['entrada'] ?? 0);
    $salida = money($b['salida'] ?? 0);
    $utiles = money($b['utiles'] ?? 0);
    $honorarios = money($b['honorarios'] ?? 0);
    $loreHon = (bool)($b['pase_lore'] ?? true);
    $loreUtiles = (bool)($b['pase_lore_utiles'] ?? true);
    foreach ([$entrada, $salida, $utiles, $honorarios] as $v) {
        if ($v < 0) throw new HttpError('Los importes no pueden ser negativos');
    }

    $clienteId = (int)($b['cliente_id'] ?? 0);
    if ($tipo === 'GASTO_ESTUDIO') $clienteId = $clienteId ?: internal_id('ESTUDIO');
    if ($tipo === 'RETIRO') $clienteId = $clienteId ?: internal_id('LORE');
    $cli = q('SELECT id, nombre, es_interno FROM clientes WHERE id = ?', [$clienteId])->fetch();
    if (!$cli) throw new HttpError('Seleccione un cliente');
    $interno = (bool)$cli['es_interno'];
    if (in_array($tipo, ['IMPUESTOS', 'AJUSTE', 'HONORARIOS'], true) && $interno) {
        throw new HttpError('Para ' . $tipo . ' seleccione un cliente (no una cuenta interna)');
    }

    assert_abierto($fecha);
    ensure_periodo($fecha);
    $lore = internal_id('LORE');
    $grupo = bin2hex(random_bytes(8));
    $base = ['fecha' => $fecha, 'cod_conce' => $cod, 'medio' => $medio, 'grupo' => $grupo, 'creado_por' => $u['id']];
    $ids = [];
    $first = true;
    $add = function (array $d) use (&$ids, &$first, $base, $key) {
        $d = array_merge($base, $d);
        if ($first) {
            $d['idempotency_key'] = $key;
            $first = false;
        }
        $id = insert_mov($d);
        $ids[] = $id;
        return $id;
    };
    $retiro = function (int $padre, float $monto, string $det) use ($add, $lore) {
        $add(['cliente_id' => $lore, 'tipo_valor' => 'RETIRO', 'detalle' => $det, 'salida' => $monto,
              'afecta_caja' => 1, 'afecta_cliente' => 0, 'movimiento_padre_id' => $padre]);
    };

    db()->beginTransaction();
    switch ($tipo) {
        case 'IMPUESTOS':
            if ($entrada + $salida + $utiles + $honorarios <= 0) throw new HttpError('Ingrese al menos un importe');
            if ($entrada > 0) {
                $add(['cliente_id' => $clienteId, 'tipo_valor' => 'IMPUESTOS', 'detalle' => $detalle ?: 'ENTREGA PARA IMPUESTOS',
                      'entrada' => $entrada, 'afecta_caja' => 1, 'afecta_cliente' => 1]);
            }
            if ($salida > 0) {
                $add(['cliente_id' => $clienteId, 'tipo_valor' => 'IMPUESTOS', 'detalle' => $detalleSalida ?: 'PAGO DE IMPUESTOS',
                      'salida' => $salida, 'afecta_caja' => 1, 'afecta_cliente' => 1]);
            }
            if ($utiles > 0) {
                $id = $add(['cliente_id' => $clienteId, 'tipo_valor' => 'UTILES', 'detalle' => 'GASTO DE UTILES' . ($detalle ? ' - ' . $detalle : ''),
                            'salida' => $utiles, 'afecta_caja' => 0, 'afecta_cliente' => 1]);
                if ($loreUtiles) $retiro($id, $utiles, 'UTILES DE ' . $cli['nombre']);
            }
            if ($honorarios > 0) {
                $det = normalize_name((string)($b['detalle_honorarios'] ?? '')) ?: 'HONORARIOS DESCONTADOS DEL SALDO';
                $id = $add(['cliente_id' => $clienteId, 'tipo_valor' => 'HONORARIOS', 'detalle' => $det,
                            'salida' => $honorarios, 'afecta_caja' => 0, 'afecta_cliente' => 1]);
                if ($loreHon) $retiro($id, $honorarios, 'DE ' . $det . ' DE ' . $cli['nombre']);
            }
            break;

        case 'HONORARIOS':
            if ($entrada <= 0) throw new HttpError('Ingrese el importe de honorarios cobrados');
            $id = $add(['cliente_id' => $clienteId, 'tipo_valor' => 'HONORARIOS', 'detalle' => $detalle ?: 'HONORARIOS',
                        'entrada' => $entrada, 'afecta_caja' => 1, 'afecta_cliente' => 0]);
            if ($loreHon) $retiro($id, $entrada, 'DE ' . ($detalle ?: 'HONORARIOS') . ' DE ' . $cli['nombre']);
            break;

        case 'GASTO_ESTUDIO':
        case 'RETIRO':
            if (($entrada > 0) === ($salida > 0)) throw new HttpError('Ingrese una entrada o una salida (no ambas)');
            if ($tipo === 'RETIRO' && $entrada > 0) throw new HttpError('Un retiro solo puede ser salida');
            $add(['cliente_id' => $clienteId, 'tipo_valor' => $tipo, 'detalle' => $detalle ?: ($tipo === 'RETIRO' ? 'RETIRO' : 'GASTO DEL ESTUDIO'),
                  'entrada' => $entrada, 'salida' => $salida, 'afecta_caja' => 1, 'afecta_cliente' => 0]);
            break;

        case 'AJUSTE':
            if (($entrada > 0) === ($salida > 0)) throw new HttpError('Ingrese un ajuste a favor (entrada) o en contra (salida)');
            $add(['cliente_id' => $clienteId, 'tipo_valor' => 'AJUSTE', 'detalle' => $detalle ?: 'AJUSTE DE SALDO',
                  'entrada' => $entrada, 'salida' => $salida, 'afecta_caja' => 0, 'afecta_cliente' => 1]);
            break;
    }
    audit('CREAR', 'movimientos', $ids[0], null, ['grupo' => $grupo, 'ids' => $ids, 'payload' => $b]);
    db()->commit();

    $res = ['movimientos' => fetch_movs('m.grupo = ?', [$grupo])];
    if (!$interno) $res['saldo_cliente'] = saldo_cliente($clienteId, '9999-12-31');
    return $res;
}

function movimientos_update(int $id): array
{
    require_user();
    $b = body();
    $m = q('SELECT * FROM movimientos WHERE id = ?', [$id])->fetch();
    if (!$m) throw new HttpError('Movimiento inexistente', 404);
    if ($m['tipo_valor'] === 'APERTURA') throw new HttpError('Los saldos de apertura se editan desde Configuracion > Apertura');
    assert_abierto($m['fecha']);

    $fecha = array_key_exists('fecha', $b) ? valid_date($b['fecha']) : $m['fecha'];
    assert_abierto($fecha);
    $cod = in_array($b['cod_conce'] ?? '', ['E', 'C', 'T'], true) ? $b['cod_conce'] : $m['cod_conce'];
    $medio = in_array($b['medio'] ?? '', ['EFECTIVO', 'BANCO'], true) ? $b['medio'] : $m['medio'];
    if (isset($b['cod_conce']) && !isset($b['medio']) && $b['cod_conce'] !== $m['cod_conce']) {
        $medio = $cod === 'T' ? 'BANCO' : 'EFECTIVO';
    }
    $detalle = array_key_exists('detalle', $b) ? normalize_name((string)$b['detalle']) : $m['detalle'];
    $entrada = array_key_exists('entrada', $b) ? money($b['entrada']) : (float)$m['entrada'];
    $salida = array_key_exists('salida', $b) ? money($b['salida']) : (float)$m['salida'];
    if ($entrada < 0 || $salida < 0) throw new HttpError('Los importes no pueden ser negativos');
    if ($entrada > 0 && $salida > 0) throw new HttpError('Una fila no puede tener entrada y salida a la vez');
    if ($entrada == 0 && $salida == 0) throw new HttpError('El importe no puede ser cero. Para anularlo, elimine la fila.');

    $clienteId = array_key_exists('cliente_id', $b) ? (int)$b['cliente_id'] : (int)$m['cliente_id'];
    if ($clienteId !== (int)$m['cliente_id']) {
        $cli = q('SELECT es_interno FROM clientes WHERE id = ?', [$clienteId])->fetch();
        if (!$cli) throw new HttpError('Cliente inexistente');
        if ($m['afecta_cliente'] && $cli['es_interno']) throw new HttpError('Este movimiento debe imputarse a un cliente, no a una cuenta interna');
    }

    ensure_arca_schema();
    $fac = q('SELECT cbte_tipo, punto_venta, cbte_numero FROM facturas_arca WHERE movimiento_id = ?', [$id])->fetch();
    if ($fac && ($entrada != (float)$m['entrada'] || $salida != (float)$m['salida'] || $medio !== $m['medio'] || $clienteId !== (int)$m['cliente_id'])) {
        throw new HttpError(
            'Este cobro ya tiene emitida la ' . arca_cbte_nombre((int)$fac['cbte_tipo']) . ' '
            . arca_format_numero((int)$fac['punto_venta'], (int)$fac['cbte_numero'])
            . ' en ARCA; no se puede alterar su importe, medio ni cliente.',
            409
        );
    }

    db()->beginTransaction();
    ensure_periodo($fecha);
    q('UPDATE movimientos SET fecha = ?, cod_conce = ?, medio = ?, cliente_id = ?, detalle = ?, entrada = ?, salida = ? WHERE id = ?',
        [$fecha, $cod, $medio, $clienteId, $detalle, $entrada, $salida, $id]);

    // Mantener sincronizado el espejo de pase a LORE.
    $monto = $entrada > 0 ? $entrada : $salida;
    $hijos = q("SELECT * FROM movimientos WHERE movimiento_padre_id = ? AND tipo_valor = 'RETIRO'", [$id])->fetchAll();
    if ($hijos && (($entrada > 0) !== ((float)$m['entrada'] > 0))) {
        throw new HttpError('No se puede invertir la entrada/salida de un movimiento con pase a LORE');
    }
    foreach ($hijos as $h) {
        assert_abierto($h['fecha']);
        q('UPDATE movimientos SET fecha = ?, cod_conce = ?, medio = ?, salida = ? WHERE id = ?', [$fecha, $cod, $medio, $monto, $h['id']]);
    }
    audit('EDITAR', 'movimientos', $id, $m, ['fecha' => $fecha, 'cod_conce' => $cod, 'medio' => $medio, 'cliente_id' => $clienteId,
        'detalle' => $detalle, 'entrada' => $entrada, 'salida' => $salida, 'espejos' => count($hijos), 'espejos_anteriores' => $hijos]);
    db()->commit();
    return ['movimientos' => fetch_movs('m.id = ? OR m.movimiento_padre_id = ?', [$id, $id])];
}

function movimientos_delete(int $id): array
{
    require_user();
    $m = q('SELECT * FROM movimientos WHERE id = ?', [$id])->fetch();
    if (!$m) throw new HttpError('Movimiento inexistente', 404);
    if ($m['tipo_valor'] === 'APERTURA') throw new HttpError('Los saldos de apertura se editan desde Configuracion > Apertura');
    assert_abierto($m['fecha']);
    ensure_arca_schema();
    $fac = q('SELECT cbte_tipo, punto_venta, cbte_numero FROM facturas_arca WHERE movimiento_id = ?', [$id])->fetch();
    if ($fac) {
        throw new HttpError(
            'No se puede eliminar este movimiento porque ya tiene emitida la '
            . arca_cbte_nombre((int)$fac['cbte_tipo']) . ' '
            . arca_format_numero((int)$fac['punto_venta'], (int)$fac['cbte_numero'])
            . ' con CAE en ARCA.',
            409
        );
    }
    $hijos = q('SELECT * FROM movimientos WHERE movimiento_padre_id = ?', [$id])->fetchAll();
    foreach ($hijos as $h) assert_abierto($h['fecha']);
    db()->beginTransaction();
    q('DELETE FROM movimientos WHERE id = ?', [$id]); // los espejos se borran en cascada
    audit('ELIMINAR', 'movimientos', $id, ['movimiento' => $m, 'espejos' => $hijos], null);
    db()->commit();
    return ['ok' => true, 'eliminados' => 1 + count($hijos)];
}

/**
 * Devuelve los datos puntuales de una operacion de IMPUESTOS para emitir su recibo PDF / WhatsApp
 * sin exponer saldos anteriores de cuenta corriente.
 */
function movimientos_recibo(int $id): array
{
    require_user();
    $m = q("SELECT m.*, c.nombre cliente, c.cuit, c.telefono, c.es_interno, u.nombre usuario
            FROM movimientos m
            JOIN clientes c ON c.id = m.cliente_id
            LEFT JOIN usuarios u ON u.id = m.creado_por
            WHERE m.id = ?", [$id])->fetch();
    if (!$m) throw new HttpError('Movimiento inexistente', 404);
    if ($m['es_interno'] || $m['tipo_valor'] !== 'IMPUESTOS') {
        throw new HttpError('Los recibos solo se emiten para operaciones de Impuestos de clientes');
    }

    if (!empty($m['grupo'])) {
        $opMovs = fetch_movs("m.grupo = ? AND m.cliente_id = ? AND m.tipo_valor = 'IMPUESTOS'", [$m['grupo'], (int)$m['cliente_id']]);
    } else {
        $opMovs = [mov_row($m)];
    }

    $opIds = array_map(fn($x) => $x['id'], $opMovs);
    $placeholders = implode(',', array_fill(0, count($opIds), '?'));
    $otrosParams = array_merge([(int)$m['cliente_id'], $m['fecha']], $opIds);
    $otrosDia = fetch_movs(
        "m.cliente_id = ? AND m.fecha = ? AND m.tipo_valor = 'IMPUESTOS' AND m.id NOT IN ($placeholders)",
        $otrosParams
    );

    return [
        'cliente' => [
            'id' => (int)$m['cliente_id'],
            'nombre' => $m['cliente'],
            'cuit' => $m['cuit'],
            'telefono' => $m['telefono'],
        ],
        'movimientos_operacion' => $opMovs,
        'otros_mismo_dia' => $otrosDia,
        'estudio' => [
            'nombre_estudio' => config_get('nombre_estudio', 'Estudio Contable'),
            'subtitulo_estudio' => config_get('subtitulo_estudio', ''),
            'datos_contacto_estudio' => config_get('datos_contacto_estudio', ''),
        ],
    ];
}

