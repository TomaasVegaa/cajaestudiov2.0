<?php

function apertura_get(): array
{
    require_user();
    $fa = fecha_apertura();
    $estudio = internal_id('ESTUDIO');
    $caja = ['EFECTIVO' => 0.0, 'BANCO' => 0.0];
    foreach (q("SELECT medio, SUM(entrada - salida) s FROM movimientos WHERE tipo_valor = 'APERTURA' AND afecta_caja = 1 GROUP BY medio")->fetchAll() as $r) {
        $caja[$r['medio']] = round((float)$r['s'], 2);
    }
    $clientes = q("SELECT c.id, c.nombre, c.nota_revision, SUM(m.entrada - m.salida) saldo
                   FROM movimientos m JOIN clientes c ON c.id = m.cliente_id
                   WHERE m.tipo_valor = 'APERTURA' AND m.afecta_cliente = 1
                   GROUP BY c.id ORDER BY c.nombre")->fetchAll();
    $total = 0;
    foreach ($clientes as &$c) {
        $c['id'] = (int)$c['id'];
        $c['saldo'] = round((float)$c['saldo'], 2);
        $total += cents($c['saldo']);
    }
    return [
        'fecha_inicio' => config_get('fecha_inicio'),
        'fecha_apertura' => $fa,
        'nombre_estudio' => config_get('nombre_estudio'),
        'subtitulo_estudio' => config_get('subtitulo_estudio', ''),
        'datos_contacto_estudio' => config_get('datos_contacto_estudio', ''),
        'efectivo' => $caja['EFECTIVO'],
        'banco' => $caja['BANCO'],
        'clientes' => $clientes,
        'total_clientes' => from_cents($total),
        'estudio_id' => $estudio,
    ];
}

/** Inserta o reemplaza el asiento de apertura de un cliente. */
function upsert_apertura_cliente(int $clienteId, float $saldo, int $userId): void
{
    q("DELETE FROM movimientos WHERE tipo_valor = 'APERTURA' AND cliente_id = ?", [$clienteId]);
    if (abs($saldo) < 0.005) return;
    insert_mov([
        'fecha' => fecha_apertura(), 'cod_conce' => 'C', 'medio' => 'EFECTIVO', 'cliente_id' => $clienteId,
        'tipo_valor' => 'APERTURA', 'detalle' => 'SALDO INICIAL AL ' . date('d/m/Y', strtotime(fecha_apertura())),
        'entrada' => $saldo > 0 ? $saldo : 0, 'salida' => $saldo < 0 ? -$saldo : 0,
        'afecta_caja' => 0, 'afecta_cliente' => 1, 'creado_por' => $userId,
    ]);
}

function apertura_save(): array
{
    $u = require_admin();
    $b = body();
    $antes = apertura_get();
    db()->beginTransaction();
    if (!empty($b['nombre_estudio'])) config_set('nombre_estudio', mb_substr(trim((string)$b['nombre_estudio']), 0, 120));
    if (array_key_exists('subtitulo_estudio', $b)) config_set('subtitulo_estudio', mb_substr(trim((string)$b['subtitulo_estudio']), 0, 160));
    if (array_key_exists('datos_contacto_estudio', $b)) config_set('datos_contacto_estudio', mb_substr(trim((string)$b['datos_contacto_estudio']), 0, 200));
    if (!empty($b['fecha_inicio'])) {
        $fi = valid_date($b['fecha_inicio']);
        if (substr($fi, 8, 2) !== '01') throw new HttpError('La fecha de inicio debe ser el dia 1 de un mes');
        config_set('fecha_inicio', $fi);
        q("UPDATE movimientos SET fecha = ? WHERE tipo_valor = 'APERTURA'", [fecha_apertura()]);
    }
    $estudio = internal_id('ESTUDIO');
    foreach (['EFECTIVO' => 'efectivo', 'BANCO' => 'banco'] as $medio => $campo) {
        if (!array_key_exists($campo, $b)) continue;
        $v = money($b[$campo]);
        q("DELETE FROM movimientos WHERE tipo_valor = 'APERTURA' AND afecta_caja = 1 AND medio = ?", [$medio]);
        if (abs($v) >= 0.005) {
            insert_mov([
                'fecha' => fecha_apertura(), 'cod_conce' => $medio === 'BANCO' ? 'T' : 'E', 'medio' => $medio, 'cliente_id' => $estudio,
                'tipo_valor' => 'APERTURA', 'detalle' => 'SALDO INICIAL DE CAJA - ' . $medio,
                'entrada' => $v > 0 ? $v : 0, 'salida' => $v < 0 ? -$v : 0, 'afecta_caja' => 1, 'afecta_cliente' => 0, 'creado_por' => $u['id'],
            ]);
        }
    }
    audit('APERTURA', 'configuracion', null, ['fecha_inicio' => $antes['fecha_inicio'], 'efectivo' => $antes['efectivo'], 'banco' => $antes['banco']], $b);
    db()->commit();
    return apertura_get();
}

function apertura_cliente(): array
{
    $u = require_admin();
    $b = body();
    $id = (int)($b['cliente_id'] ?? 0);
    $c = q('SELECT id, es_interno FROM clientes WHERE id = ?', [$id])->fetch();
    if (!$c || $c['es_interno']) throw new HttpError('Cliente invalido');
    $saldo = money($b['saldo'] ?? 0);
    db()->beginTransaction();
    upsert_apertura_cliente($id, $saldo, $u['id']);
    audit('APERTURA', 'clientes', $id, null, ['saldo_inicial' => $saldo]);
    db()->commit();
    return ['ok' => true];
}

/**
 * Importa saldos pegados desde Excel: una linea por cliente "NOMBRE <tab> SALDO <tab> NOTA".
 * Acepta tabulador o punto y coma como separador e importes en formato 1.234,56 o 1,234.56.
 */
function apertura_importar(): array
{
    $u = require_admin();
    $b = body();
    $texto = str_replace("\r", '', (string)($b['texto'] ?? ''));
    $simular = !empty($b['simular']);
    $lineas = array_filter(array_map('trim', explode("\n", $texto)), fn($l) => $l !== '');
    if (!$lineas) throw new HttpError('Pegue al menos una linea');

    $res = ['creados' => [], 'actualizados' => [], 'errores' => [], 'total' => 0.0, 'filas' => []];
    $total = 0;
    if (!$simular) db()->beginTransaction();
    foreach (array_values($lineas) as $i => $linea) {
        $sep = str_contains($linea, "\t") ? "\t" : ';';
        $cols = array_map('trim', explode($sep, $linea));
        $nombre = normalize_name($cols[0] ?? '');
        $saldoTxt = $cols[1] ?? '';
        $nota = isset($cols[2]) ? trim($cols[2]) : '';
        if ($nombre === '') continue;
        try {
            $saldo = parse_amount($saldoTxt);
        } catch (HttpError $e) {
            if ($i === 0) continue; // encabezado
            $res['errores'][] = 'Linea ' . ($i + 1) . ": importe invalido \"$saldoTxt\" ($nombre)";
            continue;
        }
        $id = find_cliente_by_name($nombre);
        $res['filas'][] = ['nombre' => $nombre, 'saldo' => $saldo, 'nota' => $nota, 'nuevo' => !$id];
        $total += cents($saldo);
        if ($simular) {
            $res[$id ? 'actualizados' : 'creados'][] = $nombre;
            continue;
        }
        if (!$id) {
            q('INSERT INTO clientes (nombre, nota_revision) VALUES (?, ?)', [$nombre, $nota ?: null]);
            $id = (int)db()->lastInsertId();
            $res['creados'][] = $nombre;
        } else {
            if ($nota !== '') q('UPDATE clientes SET nota_revision = ? WHERE id = ?', [mb_substr($nota, 0, 255), $id]);
            $res['actualizados'][] = $nombre;
        }
        upsert_apertura_cliente($id, $saldo, $u['id']);
    }
    $res['total'] = from_cents($total);
    if (!$simular) {
        audit('APERTURA', 'importacion', null, null, ['creados' => count($res['creados']), 'actualizados' => count($res['actualizados']), 'total' => $res['total']]);
        db()->commit();
    }
    return $res;
}

// ---------------- Exportaciones CSV (Excel en espanol: separador ;) ----------------
function csv_num(float $v): string
{
    return number_format($v, 2, ',', '');
}

function csv_out(string $filename, array $header, array $rows): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $f = fopen('php://output', 'w');
    fwrite($f, "\xEF\xBB\xBF");
    fputcsv($f, $header, ';');
    foreach ($rows as $r) fputcsv($f, $r, ';');
    fclose($f);
    exit;
}

function export_saldos(): void
{
    require_user();
    $_GET['fecha'] = param('fecha', date('Y-m-d'));
    $data = clientes_saldos();
    $rows = array_map(fn($c) => [$c['nombre'], csv_num($c['saldo']), $c['saldo'] < 0 ? 'DEBE' : ($c['saldo'] > 0 ? 'A FAVOR' : ''), $c['nota_revision'] ?? ''], $data['clientes']);
    $rows[] = ['TOTAL P/CONTROL', csv_num($data['totales']['total']), '', ''];
    csv_out('saldos_clientes_' . $data['fecha'] . '.csv', ['Cliente', 'Saldo', 'Estado', 'Nota de revision'], $rows);
}

function export_movimientos(): void
{
    require_user();
    $data = movimientos_list();
    $rows = array_map(fn($m) => [
        date('d/m/Y', strtotime($m['fecha'])), $m['cod_conce'], $m['medio'], $m['cliente'], $m['tipo_valor'], $m['detalle'],
        $m['entrada'] ? csv_num($m['entrada']) : '', $m['salida'] ? csv_num($m['salida']) : '', csv_num($m['saldo_caja']),
        $m['saldo_cliente'] === null ? '' : csv_num($m['saldo_cliente']),
    ], $data['movimientos']);
    csv_out(sprintf('caja_%04d_%02d.csv', $data['anio'], $data['mes']),
        ['Fecha', 'Cod', 'Medio', 'Cliente', 'Tipo de valor', 'Detalle', 'Entradas', 'Salidas', 'Saldo caja', 'Saldo cliente'], $rows);
}

