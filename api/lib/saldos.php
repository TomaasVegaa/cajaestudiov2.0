<?php
// Calculos de saldos compartidos (fuente unica de verdad = tabla movimientos).

function cents($v): int
{
    return (int)round(((float)$v) * 100);
}

function from_cents(int $c): float
{
    return $c / 100;
}

/** Saldo de cuenta corriente de un cliente hasta una fecha (inclusive) o antes de una fecha (exclusive). */
function saldo_cliente(int $clienteId, string $fecha, bool $inclusive = true): float
{
    $op = $inclusive ? '<=' : '<';
    $v = q("SELECT COALESCE(SUM(entrada - salida), 0) FROM movimientos
            WHERE cliente_id = ? AND afecta_cliente = 1 AND fecha $op ?", [$clienteId, $fecha])->fetchColumn();
    return round((float)$v, 2);
}

/** Saldo real de caja (efectivo, banco y total) hasta una fecha. */
function saldo_caja(string $fecha, bool $inclusive = true): array
{
    $op = $inclusive ? '<=' : '<';
    $rows = q("SELECT medio, COALESCE(SUM(entrada - salida), 0) s FROM movimientos
               WHERE afecta_caja = 1 AND fecha $op ? GROUP BY medio", [$fecha])->fetchAll();
    $out = ['efectivo' => 0.0, 'banco' => 0.0];
    foreach ($rows as $r) {
        $out[$r['medio'] === 'BANCO' ? 'banco' : 'efectivo'] = round((float)$r['s'], 2);
    }
    $out['total'] = round($out['efectivo'] + $out['banco'], 2);
    return $out;
}

/** Totales de cuentas corrientes de clientes (no internos) a una fecha. */
function totales_clientes(string $fecha): array
{
    $r = q("SELECT
              COALESCE(SUM(s), 0) total,
              COALESCE(SUM(CASE WHEN s > 0 THEN s ELSE 0 END), 0) a_favor,
              COALESCE(SUM(CASE WHEN s < 0 THEN s ELSE 0 END), 0) en_rojo,
              SUM(CASE WHEN s < 0 THEN 1 ELSE 0 END) cant_rojo
            FROM (
              SELECT m.cliente_id, SUM(m.entrada - m.salida) s
              FROM movimientos m JOIN clientes c ON c.id = m.cliente_id
              WHERE m.afecta_cliente = 1 AND c.es_interno = 0 AND m.fecha <= ?
              GROUP BY m.cliente_id
            ) t", [$fecha])->fetch();
    return [
        'total' => round((float)$r['total'], 2),
        'a_favor' => round((float)$r['a_favor'], 2),
        'en_rojo' => round((float)$r['en_rojo'], 2),
        'cant_rojo' => (int)$r['cant_rojo'],
    ];
}

function teorico(string $fecha): array
{
    $caja = saldo_caja($fecha);
    $cli = totales_clientes($fecha);
    return [
        'fecha' => $fecha,
        'teorico_efectivo' => $caja['efectivo'],
        'teorico_banco' => $caja['banco'],
        'caja_total' => $caja['total'],
        'total_clientes' => $cli['total'],
        'clientes_a_favor' => $cli['a_favor'],
        'clientes_en_rojo' => $cli['en_rojo'],
        'cant_clientes_rojo' => $cli['cant_rojo'],
        'fondos_propios' => round($caja['total'] - $cli['total'], 2),
    ];
}

function mov_row(array $r): array
{
    $factura = null;
    if (!empty($r['fa_id'])) {
        $cbteTipo = (int)$r['fa_cbte_tipo'];
        $ptoVta = (int)$r['fa_punto_venta'];
        $cbteNro = (int)$r['fa_cbte_numero'];
        $factura = [
            'id' => (int)$r['fa_id'],
            'cbte_tipo' => $cbteTipo,
            'cbte_letra' => arca_cbte_letra($cbteTipo),
            'punto_venta' => $ptoVta,
            'cbte_numero' => $cbteNro,
            'numero_formateado' => arca_format_numero($ptoVta, $cbteNro),
            'cae' => $r['fa_cae'],
            'entorno' => $r['fa_entorno'],
        ];
    }

    return [
        'id' => (int)$r['id'],
        'fecha' => $r['fecha'],
        'cod_conce' => $r['cod_conce'],
        'medio' => $r['medio'],
        'cliente_id' => (int)$r['cliente_id'],
        'cliente' => $r['cliente'] ?? null,
        'es_interno' => isset($r['es_interno']) ? (bool)$r['es_interno'] : false,
        'tipo_valor' => $r['tipo_valor'],
        'detalle' => $r['detalle'],
        'entrada' => (float)$r['entrada'],
        'salida' => (float)$r['salida'],
        'afecta_caja' => (bool)$r['afecta_caja'],
        'afecta_cliente' => (bool)$r['afecta_cliente'],
        'movimiento_padre_id' => $r['movimiento_padre_id'] ? (int)$r['movimiento_padre_id'] : null,
        'grupo' => $r['grupo'],
        'creado_por' => $r['usuario'] ?? null,
        'factura_arca' => $factura,
    ];
}

