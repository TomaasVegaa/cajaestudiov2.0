<?php

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function periodos_list(): array
{
    require_user();
    $inicio = config_get('fecha_inicio', date('Y-m-01'));
    $ultimo = q('SELECT MAX(fecha) FROM movimientos')->fetchColumn() ?: date('Y-m-d');
    $fin = max(date('Y-m-01'), substr($ultimo, 0, 8) . '01');
    $estado = [];
    foreach (q('SELECT p.*, u.nombre cerrado_por_nombre FROM periodos p LEFT JOIN usuarios u ON u.id = p.cerrado_por')->fetchAll() as $p) {
        $estado[sprintf('%04d-%02d', $p['anio'], $p['mes'])] = $p;
    }
    $tot = [];
    foreach (q("SELECT DATE_FORMAT(fecha, '%Y-%m') ym, SUM(entrada) e, SUM(salida) s, COUNT(*) n
                FROM movimientos WHERE afecta_caja = 1 AND tipo_valor <> 'APERTURA' GROUP BY ym")->fetchAll() as $r) {
        $tot[$r['ym']] = $r;
    }
    $out = [];
    for ($d = substr($inicio, 0, 8) . '01'; $d <= $fin; $d = date('Y-m-d', strtotime($d . ' +1 month'))) {
        $ym = substr($d, 0, 7);
        [$y, $m] = array_map('intval', explode('-', $ym));
        $finMes = date('Y-m-t', strtotime($d));
        $p = $estado[$ym] ?? null;
        $out[] = [
            'anio' => $y,
            'mes' => $m,
            'nombre' => MESES[$m] . ' ' . $y,
            'cerrado' => $p ? (bool)$p['cerrado'] : false,
            'fecha_cierre' => $p['fecha_cierre'] ?? null,
            'cerrado_por' => $p['cerrado_por_nombre'] ?? null,
            'entradas' => round((float)($tot[$ym]['e'] ?? 0), 2),
            'salidas' => round((float)($tot[$ym]['s'] ?? 0), 2),
            'cantidad' => (int)($tot[$ym]['n'] ?? 0),
            'caja_fin' => saldo_caja($finMes)['total'],
            'clientes_fin' => totales_clientes($finMes)['total'],
        ];
    }
    return array_reverse($out);
}

function periodos_cerrar(): array
{
    $u = require_admin();
    $b = body();
    $anio = (int)($b['anio'] ?? 0);
    $mes = (int)($b['mes'] ?? 0);
    if ($mes < 1 || $mes > 12) throw new HttpError('Periodo invalido');
    $fin = date('Y-m-t', strtotime(sprintf('%04d-%02d-01', $anio, $mes)));
    db()->beginTransaction();
    q('INSERT IGNORE INTO periodos (anio, mes) VALUES (?, ?)', [$anio, $mes]);
    $pid = (int)q('SELECT id FROM periodos WHERE anio = ? AND mes = ?', [$anio, $mes])->fetchColumn();
    q('UPDATE periodos SET cerrado = 1, fecha_cierre = NOW(), cerrado_por = ? WHERE id = ?', [$u['id'], $pid]);
    q('DELETE FROM cierres_saldos WHERE periodo_id = ?', [$pid]);
    q("INSERT INTO cierres_saldos (periodo_id, cliente_id, saldo)
       SELECT ?, m.cliente_id, SUM(m.entrada - m.salida) FROM movimientos m JOIN clientes c ON c.id = m.cliente_id
       WHERE m.afecta_cliente = 1 AND c.es_interno = 0 AND m.fecha <= ? GROUP BY m.cliente_id", [$pid, $fin]);
    $tot = totales_clientes($fin);
    audit('CIERRE_PERIODO', 'periodos', $pid, null, ['anio' => $anio, 'mes' => $mes, 'total_clientes' => $tot['total'], 'caja' => saldo_caja($fin)]);
    db()->commit();
    return ['ok' => true, 'anual' => $mes === 12, 'total_clientes' => $tot['total']];
}

function periodos_reabrir(): array
{
    require_admin();
    $b = body();
    $anio = (int)($b['anio'] ?? 0);
    $mes = (int)($b['mes'] ?? 0);
    $p = q('SELECT * FROM periodos WHERE anio = ? AND mes = ?', [$anio, $mes])->fetch();
    if (!$p || !$p['cerrado']) throw new HttpError('El periodo no esta cerrado');
    q('UPDATE periodos SET cerrado = 0, fecha_cierre = NULL, cerrado_por = NULL WHERE id = ?', [$p['id']]);
    audit('REAPERTURA', 'periodos', $p['id'], $p, ['cerrado' => 0]);
    return ['ok' => true];
}

// ---------------- Arqueo / cuadro de control ----------------
function arqueos_teorico(): array
{
    require_user();
    return teorico(valid_date(param('fecha', date('Y-m-d'))));
}

function arqueos_list(): array
{
    require_user();
    $rows = q('SELECT a.*, u.nombre usuario FROM arqueos a LEFT JOIN usuarios u ON u.id = a.creado_por ORDER BY a.fecha DESC, a.id DESC LIMIT 60')->fetchAll();
    foreach ($rows as &$r) {
        foreach ($r as $k => $v) {
            if (!in_array($k, ['id', 'fecha', 'observaciones', 'usuario', 'created_at', 'creado_por'], true)) $r[$k] = (float)$v;
        }
    }
    return $rows;
}

function arqueos_create(): array
{
    $u = require_user();
    $b = body();
    $fecha = valid_date($b['fecha'] ?? null);
    $t = teorico($fecha);
    $campos = ['tengo', 'banco_hoy', 'banco_calle', 'calle_erika', 'me_deben', 'otros'];
    $real = 0.0;
    $vals = [];
    foreach ($campos as $c) {
        $vals[$c] = money($b[$c] ?? 0);
        $real += $vals[$c];
    }
    $dif = round($real - $t['caja_total'], 2);
    q('INSERT INTO arqueos (fecha, teorico_efectivo, teorico_banco, total_clientes, fondos_propios, tengo, banco_hoy, banco_calle,
            calle_erika, me_deben, otros, diferencia, observaciones, creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        $fecha, $t['teorico_efectivo'], $t['teorico_banco'], $t['total_clientes'], $t['fondos_propios'],
        $vals['tengo'], $vals['banco_hoy'], $vals['banco_calle'], $vals['calle_erika'], $vals['me_deben'], $vals['otros'],
        $dif, $b['observaciones'] ?? null, $u['id'],
    ]);
    $id = (int)db()->lastInsertId();
    audit('CREAR', 'arqueos', $id, null, $vals + ['diferencia' => $dif]);
    return ['id' => $id, 'diferencia' => $dif, 'teorico' => $t];
}

