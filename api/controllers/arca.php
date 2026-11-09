<?php
// Controlador de Facturacion Electronica ARCA (configuracion, CSR, prueba WS y emision de Factura A / B).
declare(strict_types=1);

function arca_config_get(): array
{
    require_user();
    $cfg = arca_get_config_row();
    $tieneCert = trim((string)($cfg['cert_pem'] ?? '')) !== '';
    $tieneKey = trim((string)($cfg['key_pem'] ?? '')) !== '';
    $certInfo = arca_parse_cert_info($cfg['cert_pem'] ?? null, $cfg['key_pem'] ?? null);

    $cuitValido = arca_valid_cuit((string)($cfg['cuit'] ?? ''));
    $certOk = is_array($certInfo)
        && !empty($certInfo['valido'])
        && empty($certInfo['vencido'])
        && ($certInfo['coincide_clave'] === true);

    return [
        'configurado' => $cuitValido && $tieneCert && $tieneKey && $certOk,
        'entorno' => ($cfg['entorno'] ?? 'homologacion') === 'produccion' ? 'produccion' : 'homologacion',
        'cuit' => (string)($cfg['cuit'] ?? ''),
        'razon_social' => (string)($cfg['razon_social'] ?: config_get('nombre_estudio', 'Estudio Contable')),
        'domicilio_comercial' => (string)($cfg['domicilio_comercial'] ?? ''),
        'condicion_iva' => (string)($cfg['condicion_iva'] ?: 'IVA Responsable Inscripto'),
        'punto_venta' => max(1, (int)($cfg['punto_venta'] ?? 1)),
        'ingresos_brutos' => (string)($cfg['ingresos_brutos'] ?? ''),
        'inicio_actividades' => $cfg['inicio_actividades'] ?: null,
        'tiene_cert' => $tieneCert,
        'tiene_key' => $tieneKey,
        'cert_info' => $certInfo,
    ];
}

function arca_config_save(): array
{
    require_admin();
    $b = body();
    $actual = arca_get_config_row();

    $entorno = ($b['entorno'] ?? $actual['entorno'] ?? 'homologacion') === 'produccion'
        ? 'produccion'
        : 'homologacion';

    $cuit = array_key_exists('cuit', $b)
        ? arca_clean_digits((string)$b['cuit'])
        : (string)$actual['cuit'];
    if ($cuit !== '' && !arca_valid_cuit($cuit)) {
        throw new HttpError('El CUIT del emisor no es válido (verifique los 11 dígitos).');
    }

    $razonSocial = array_key_exists('razon_social', $b)
        ? mb_substr(trim((string)$b['razon_social']), 0, 180, 'UTF-8')
        : (string)$actual['razon_social'];

    $domicilio = array_key_exists('domicilio_comercial', $b)
        ? mb_substr(trim((string)$b['domicilio_comercial']), 0, 255, 'UTF-8')
        : (string)$actual['domicilio_comercial'];

    $ptoVta = array_key_exists('punto_venta', $b)
        ? (int)$b['punto_venta']
        : (int)$actual['punto_venta'];
    if ($ptoVta < 1 || $ptoVta > 99999) {
        throw new HttpError('El Punto de Venta debe estar entre 1 y 99999.');
    }

    $iibb = array_key_exists('ingresos_brutos', $b)
        ? mb_substr(trim((string)$b['ingresos_brutos']), 0, 60, 'UTF-8')
        : (string)$actual['ingresos_brutos'];

    $inicioAct = $actual['inicio_actividades'] ?: null;
    if (array_key_exists('inicio_actividades', $b)) {
        $rawIni = trim((string)($b['inicio_actividades'] ?? ''));
        $inicioAct = $rawIni === '' ? null : valid_date($rawIni);
    }

    $certPem = (string)($actual['cert_pem'] ?? '');
    $keyPem = (string)($actual['key_pem'] ?? '');
    $limpiarTa = ($cuit !== (string)$actual['cuit']);

    if (!empty($b['cert_pem']) && is_string($b['cert_pem'])) {
        $nuevoCert = trim($b['cert_pem']);
        if (@openssl_x509_parse($nuevoCert) === false) {
            throw new HttpError('El archivo o texto de Certificado (.crt) no es un certificado X.509 PEM válido.');
        }
        $certPem = $nuevoCert . "\n";
        $limpiarTa = true;
    }

    if (!empty($b['key_pem']) && is_string($b['key_pem'])) {
        $nuevaKey = trim($b['key_pem']);
        if (@openssl_pkey_get_private($nuevaKey) === false) {
            throw new HttpError('La Clave Privada (.key) ingresada no tiene un formato PEM válido o tiene contraseña.');
        }
        $keyPem = $nuevaKey . "\n";
        $limpiarTa = true;
    }

    if ($certPem !== '' && $keyPem !== '' && !@openssl_x509_check_private_key($certPem, $keyPem)) {
        throw new HttpError('El Certificado (.crt) no corresponde a la Clave Privada (.key) guardada. Asegúrese de subir el .crt emitido a partir del último CSR.');
    }

    if ($limpiarTa) {
        q("UPDATE arca_config SET
            entorno = ?, cuit = ?, razon_social = ?, domicilio_comercial = ?,
            punto_venta = ?, ingresos_brutos = ?, inicio_actividades = ?,
            cert_pem = ?, key_pem = ?,
            ta_homo_token = NULL, ta_homo_sign = NULL, ta_homo_exp = NULL,
            ta_prod_token = NULL, ta_prod_sign = NULL, ta_prod_exp = NULL
           WHERE id = 1", [
            $entorno, $cuit, $razonSocial, $domicilio,
            $ptoVta, $iibb, $inicioAct,
            $certPem ?: null, $keyPem ?: null,
        ]);
    } else {
        q("UPDATE arca_config SET
            entorno = ?, cuit = ?, razon_social = ?, domicilio_comercial = ?,
            punto_venta = ?, ingresos_brutos = ?, inicio_actividades = ?
           WHERE id = 1", [
            $entorno, $cuit, $razonSocial, $domicilio,
            $ptoVta, $iibb, $inicioAct,
        ]);
    }

    audit('EDITAR', 'arca_config', 1, null, [
        'entorno' => $entorno,
        'cuit' => $cuit,
        'razon_social' => $razonSocial,
        'punto_venta' => $ptoVta,
        'cert_actualizado' => !empty($b['cert_pem']),
        'key_actualizada' => !empty($b['key_pem']),
    ]);

    return arca_config_get();
}

function arca_generar_csr(): array
{
    require_admin();
    $b = body();
    $actual = arca_get_config_row();

    $cuit = arca_clean_digits((string)($b['cuit'] ?? $actual['cuit'] ?? ''));
    $razon = trim((string)($b['razon_social'] ?? $actual['razon_social'] ?? config_get('nombre_estudio', 'Estudio Contable')));

    $gen = arca_openssl_generate_csr($cuit, $razon);

    // Guardamos la nueva clave privada y limpiamos certificado previo incompatible y cache TA
    q("UPDATE arca_config SET
        cuit = ?, razon_social = ?, key_pem = ?, cert_pem = NULL,
        ta_homo_token = NULL, ta_homo_sign = NULL, ta_homo_exp = NULL,
        ta_prod_token = NULL, ta_prod_sign = NULL, ta_prod_exp = NULL
       WHERE id = 1", [
        $cuit,
        mb_substr($razon, 0, 180, 'UTF-8'),
        $gen['key_pem'],
    ]);

    audit('GENERAR_CSR', 'arca_config', 1, null, ['cuit' => $cuit, 'razon_social' => $razon]);

    return [
        'ok' => true,
        'csr_pem' => $gen['csr_pem'],
        'filename' => 'solicitud_arca_' . $cuit . '.csr',
        'config' => arca_config_get(),
    ];
}

function arca_probar_conexion(): array
{
    require_admin();
    $cfg = arca_get_config_row();
    $entorno = ($cfg['entorno'] ?? 'homologacion') === 'produccion' ? 'produccion' : 'homologacion';

    $dummy = arca_wsfe_dummy($entorno);

    if (trim((string)($cfg['cert_pem'] ?? '')) === '' || trim((string)($cfg['key_pem'] ?? '')) === '') {
        return [
            'ok' => false,
            'red_ok' => true,
            'entorno' => $entorno,
            'dummy' => $dummy,
            'mensaje' => 'Conexión de red con ARCA exitosa (AppServer=' . $dummy['app_server'] . '), pero aún falta cargar el Certificado (.crt) y la Clave Privada (.key).',
        ];
    }

    if (!arca_valid_cuit((string)($cfg['cuit'] ?? ''))) {
        throw new HttpError('Ingrese y guarde un CUIT emisor válido antes de probar la autenticación.');
    }

    $ta = arca_get_ta($cfg);
    $ptoVta = max(1, (int)($cfg['punto_venta'] ?? 1));
    $ultA = arca_wsfe_ultimo_autorizado($cfg, $ta, $ptoVta, 1);
    $ultB = arca_wsfe_ultimo_autorizado($cfg, $ta, $ptoVta, 6);

    return [
        'ok' => true,
        'red_ok' => true,
        'entorno' => $entorno,
        'dummy' => $dummy,
        'ta_expira' => $ta['exp'],
        'ta_cacheado' => $ta['cached'],
        'punto_venta' => $ptoVta,
        'ultimo_factura_a' => $ultA,
        'ultimo_factura_b' => $ultB,
        'proximo_factura_a' => $ultA + 1,
        'proximo_factura_b' => $ultB + 1,
        'mensaje' => sprintf(
            'Conexión y autenticación ARCA (%s) exitosa. Pto. Vta. %05d operativo · Próxima Factura A: %08d · Próxima Factura B: %08d.',
            strtoupper($entorno),
            $ptoVta,
            $ultA + 1,
            $ultB + 1
        ),
    ];
}

function movimientos_factura_prep(int $id): array
{
    require_user();
    ensure_arca_schema();

    $m = q("SELECT m.*, c.nombre cliente, c.cuit, c.condicion_iva, c.domicilio, c.telefono, c.es_interno, u.nombre usuario
            FROM movimientos m
            JOIN clientes c ON c.id = m.cliente_id
            LEFT JOIN usuarios u ON u.id = m.creado_por
            WHERE m.id = ?", [$id])->fetch();
    if (!$m) {
        throw new HttpError('Movimiento inexistente', 404);
    }

    $existente = q('SELECT * FROM facturas_arca WHERE movimiento_id = ?', [$id])->fetch();
    $clienteOut = [
        'id' => (int)$m['cliente_id'],
        'nombre' => $m['cliente'],
        'cuit' => $m['cuit'],
        'condicion_iva' => $m['condicion_iva'],
        'domicilio' => $m['domicilio'],
        'telefono' => $m['telefono'],
    ];

    if ($existente) {
        return [
            'emitida' => true,
            'factura' => factura_arca_row($existente),
            'cliente' => $clienteOut,
            'movimiento' => mov_row($m),
            'emisor' => arca_config_get(),
        ];
    }

    if ($m['es_interno'] || $m['tipo_valor'] !== 'HONORARIOS' || $m['medio'] !== 'BANCO' || (float)$m['entrada'] <= 0) {
        throw new HttpError('Solo se pueden facturar en ARCA los cobros de Honorarios ingresados por Transferencia.');
    }

    $emisor = arca_config_get();
    $cfgRow = arca_get_config_row();

    // Sugerencias inteligentes de fechas segun reglas WSFEv1 (Concepto 2 = Servicios)
    $hoy = date('Y-m-d');
    $fechaMov = (string)$m['fecha'];
    $diffDias = abs((strtotime($hoy) - strtotime($fechaMov)) / 86400);
    // ARCA permite CbteFch hasta 10 dias antes/despues de hoy en servicios
    $cbteFechaSug = $diffDias <= 10 ? $fechaMov : $hoy;
    $servDesdeSug = date('Y-m-01', strtotime($fechaMov));
    $servHastaSug = date('Y-m-t', strtotime($fechaMov));
    $vtoPagoSug = $cbteFechaSug >= $hoy ? $cbteFechaSug : $hoy;

    $condGuardada = strtoupper(trim((string)($m['condicion_iva'] ?? '')));
    if (!isset(ARCA_CONDICIONES_IVA[$condGuardada])) {
        $condGuardada = arca_valid_cuit((string)($m['cuit'] ?? '')) ? 'RI' : 'CF';
    }

    $detRaw = trim((string)$m['detalle']);
    $descripcionSug = ($detRaw === '' || $detRaw === 'HONORARIOS' || $detRaw === 'PAGO DE HONORARIOS')
        ? 'HONORARIOS PROFESIONALES CONTABLES'
        : $detRaw;

    $proximos = null;
    $avisoWs = null;
    if ($emisor['configurado']) {
        try {
            $ta = arca_get_ta($cfgRow);
            $pto = (int)$emisor['punto_venta'];
            $proximos = [
                'factura_a' => arca_wsfe_ultimo_autorizado($cfgRow, $ta, $pto, 1) + 1,
                'factura_b' => arca_wsfe_ultimo_autorizado($cfgRow, $ta, $pto, 6) + 1,
            ];
        } catch (Throwable $e) {
            $avisoWs = $e->getMessage();
        }
    }

    return [
        'emitida' => false,
        'factura' => null,
        'cliente' => $clienteOut,
        'movimiento' => mov_row($m),
        'emisor' => $emisor,
        'sugerido' => [
            'condicion_iva' => $condGuardada,
            'cbte_fecha' => $cbteFechaSug,
            'fch_serv_desde' => $servDesdeSug,
            'fch_serv_hasta' => $servHastaSug,
            'fch_vto_pago' => $vtoPagoSug,
            'descripcion' => $descripcionSug,
            'alic_iva' => '21',
            'imp_total' => round((float)$m['entrada'], 2),
        ],
        'proximos_numeros' => $proximos,
        'aviso_ws' => $avisoWs,
    ];
}

function movimientos_facturar(int $id): array
{
    $u = require_user();
    ensure_arca_schema();
    $b = body();

    $m = q("SELECT m.*, c.nombre cliente, c.cuit, c.condicion_iva, c.domicilio, c.telefono, c.es_interno
            FROM movimientos m
            JOIN clientes c ON c.id = m.cliente_id
            WHERE m.id = ?", [$id])->fetch();
    if (!$m) {
        throw new HttpError('Movimiento inexistente', 404);
    }
    if ($m['es_interno'] || $m['tipo_valor'] !== 'HONORARIOS' || $m['medio'] !== 'BANCO' || (float)$m['entrada'] <= 0) {
        throw new HttpError('Solo se pueden facturar en ARCA los cobros de Honorarios ingresados por Transferencia.');
    }

    $existente = q('SELECT * FROM facturas_arca WHERE movimiento_id = ?', [$id])->fetch();
    if ($existente) {
        return [
            'emitida' => true,
            'duplicado' => true,
            'factura' => factura_arca_row($existente),
        ];
    }

    $cfg = arca_get_config_row();
    if (!arca_valid_cuit((string)($cfg['cuit'] ?? ''))) {
        throw new HttpError('Falta configurar un CUIT emisor válido en Configuración > Facturación ARCA.');
    }
    $razonEmisor = trim((string)($cfg['razon_social'] ?: config_get('nombre_estudio', 'Estudio Contable')));
    $ptoVta = max(1, (int)($cfg['punto_venta'] ?? 1));

    $condKey = strtoupper(trim((string)($b['condicion_iva'] ?? '')));
    if (!isset(ARCA_CONDICIONES_IVA[$condKey])) {
        throw new HttpError('Seleccione una condición frente al IVA válida para el receptor.');
    }
    $condMeta = ARCA_CONDICIONES_IVA[$condKey];
    $cbteTipo = (int)$condMeta['cbte_tipo'];
    $condIvaReceptorId = (int)$condMeta['id'];

    $docDigits = arca_clean_digits((string)($b['doc_nro'] ?? ''));
    if ($condMeta['requiere_cuit']) {
        if (!arca_valid_cuit($docDigits)) {
            throw new HttpError('Para ' . $condMeta['label'] . ' debe ingresar un CUIT válido de 11 dígitos.');
        }
        $docTipo = 80;
        $docNro = $docDigits;
    } else {
        // Consumidor Final
        if ($docDigits === '') {
            $docTipo = 99;
            $docNro = '0';
        } elseif (strlen($docDigits) === 11) {
            if (!arca_valid_cuit($docDigits)) {
                throw new HttpError('El CUIT/CUIL ingresado no es válido (verifique el dígito verificador).');
            }
            $docTipo = 80;
            $docNro = $docDigits;
        } elseif (strlen($docDigits) >= 7 && strlen($docDigits) <= 8) {
            $docTipo = 96;
            $docNro = $docDigits;
        } else {
            throw new HttpError('Para Consumidor Final ingrese un CUIT/CUIL (11 dígitos), un DNI (7 u 8 dígitos) o déjelo vacío.');
        }
    }

    $receptorNombre = mb_substr(normalize_name((string)($b['receptor_nombre'] ?? $m['cliente'])), 0, 180, 'UTF-8');
    if ($receptorNombre === '') {
        throw new HttpError('El nombre o razón social del receptor es obligatorio.');
    }
    $receptorDomicilio = mb_substr(trim((string)($b['receptor_domicilio'] ?? $m['domicilio'] ?? '')), 0, 255, 'UTF-8');

    $descripcion = mb_substr(trim((string)($b['descripcion'] ?? '')), 0, 500, 'UTF-8');
    if ($descripcion === '') {
        throw new HttpError('Ingrese el concepto / descripción de los honorarios a facturar.');
    }

    $cbteFecha = valid_date((string)($b['cbte_fecha'] ?? date('Y-m-d')));
    $hoy = date('Y-m-d');
    if (abs((strtotime($hoy) - strtotime($cbteFecha)) / 86400) > 10) {
        throw new HttpError('ARCA solo permite fecha de comprobante hasta 10 días antes o después de hoy (puede indicar cualquier mes anterior en Período Facturado Desde/Hasta).');
    }

    $fchServDesde = valid_date((string)($b['fch_serv_desde'] ?? date('Y-m-01', strtotime($cbteFecha))));
    $fchServHasta = valid_date((string)($b['fch_serv_hasta'] ?? date('Y-m-t', strtotime($cbteFecha))));
    $fchVtoPago = valid_date((string)($b['fch_vto_pago'] ?? $cbteFecha));

    if ($fchServDesde > $fchServHasta) {
        throw new HttpError('La fecha "Servicio Desde" no puede ser posterior a "Servicio Hasta".');
    }
    if ($fchVtoPago < $cbteFecha) {
        throw new HttpError('El "Vencimiento de Pago" no puede ser anterior a la Fecha de Emisión de la factura.');
    }

    $alicKey = (string)($b['alic_iva'] ?? '21');
    if (!isset(ARCA_ALICUOTAS_IVA[$alicKey])) {
        throw new HttpError('Alícuota de IVA inválida.');
    }
    $alicMeta = ARCA_ALICUOTAS_IVA[$alicKey];
    $alicId = (int)$alicMeta['id'];
    $alicPct = (float)$alicMeta['pct'];

    $impTotal = round((float)$m['entrada'], 2);
    if ($alicPct > 0) {
        $impNeto = round($impTotal / (1.0 + ($alicPct / 100.0)), 2);
        $impIva = round($impTotal - $impNeto, 2);
    } else {
        $impNeto = $impTotal;
        $impIva = 0.00;
    }

    // Actualizar ficha fiscal del cliente para futuros comprobantes
    $nuevoCuitCli = $docTipo === 80 ? arca_format_cuit($docNro) : ($m['cuit'] ?: null);
    $nuevoTelCli = array_key_exists('telefono', $b)
        ? (trim((string)$b['telefono']) ?: null)
        : $m['telefono'];

    q('UPDATE clientes SET cuit = ?, condicion_iva = ?, domicilio = ?, telefono = ? WHERE id = ?', [
        $nuevoCuitCli,
        $condKey,
        $receptorDomicilio !== '' ? $receptorDomicilio : null,
        $nuevoTelCli ? mb_substr($nuevoTelCli, 0, 50, 'UTF-8') : null,
        (int)$m['cliente_id'],
    ]);

    // Autenticar en WSAA y solicitar CAE en WSFEv1
    $ta = arca_get_ta($cfg);
    $wsRes = arca_wsfe_solicitar_cae($cfg, $ta, [
        'punto_venta' => $ptoVta,
        'cbte_tipo' => $cbteTipo,
        'concepto' => 2,
        'cbte_fecha' => $cbteFecha,
        'fch_serv_desde' => $fchServDesde,
        'fch_serv_hasta' => $fchServHasta,
        'fch_vto_pago' => $fchVtoPago,
        'doc_tipo' => $docTipo,
        'doc_nro' => $docNro,
        'condicion_iva_receptor_id' => $condIvaReceptorId,
        'alic_iva_id' => $alicId,
        'imp_neto' => $impNeto,
        'imp_iva' => $impIva,
        'imp_total' => $impTotal,
    ]);

    $entorno = ($cfg['entorno'] ?? 'homologacion') === 'produccion' ? 'produccion' : 'homologacion';
    $cuitEmisor = arca_clean_digits((string)$cfg['cuit']);

    db()->beginTransaction();
    q("INSERT INTO facturas_arca (
        movimiento_id, cliente_id, entorno,
        cuit_emisor, razon_social_emisor, domicilio_emisor, iibb_emisor, inicio_act_emisor,
        punto_venta, cbte_tipo, cbte_numero, cbte_fecha, concepto,
        fch_serv_desde, fch_serv_hasta, fch_vto_pago,
        doc_tipo, doc_nro, condicion_iva_receptor_id, condicion_iva_receptor,
        receptor_nombre, receptor_domicilio, descripcion,
        alic_iva_id, alic_iva_pct, imp_neto, imp_iva, imp_total,
        cae, cae_vto, qr_url, observaciones_arca, creado_por
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        $id,
        (int)$m['cliente_id'],
        $entorno,
        $cuitEmisor,
        $razonEmisor,
        (string)($cfg['domicilio_comercial'] ?? ''),
        (string)($cfg['ingresos_brutos'] ?? ''),
        $cfg['inicio_actividades'] ?: null,
        $ptoVta,
        $cbteTipo,
        (int)$wsRes['cbte_numero'],
        $cbteFecha,
        2,
        $fchServDesde,
        $fchServHasta,
        $fchVtoPago,
        $docTipo,
        $docNro,
        $condIvaReceptorId,
        $condMeta['label'],
        $receptorNombre,
        $receptorDomicilio !== '' ? $receptorDomicilio : null,
        $descripcion,
        $alicId,
        $alicPct,
        $impNeto,
        $impIva,
        $impTotal,
        $wsRes['cae'],
        $wsRes['cae_vto'],
        $wsRes['qr_url'],
        $wsRes['observaciones_arca'],
        $u['id'],
    ]);
    $facturaId = (int)db()->lastInsertId();

    audit('FACTURAR_ARCA', 'facturas_arca', $facturaId, null, [
        'movimiento_id' => $id,
        'entorno' => $entorno,
        'cbte_tipo' => $cbteTipo,
        'punto_venta' => $ptoVta,
        'cbte_numero' => $wsRes['cbte_numero'],
        'cae' => $wsRes['cae'],
        'imp_total' => $impTotal,
    ]);
    db()->commit();

    $inserted = q('SELECT * FROM facturas_arca WHERE id = ?', [$facturaId])->fetch();
    return [
        'emitida' => true,
        'duplicado' => false,
        'factura' => factura_arca_row($inserted),
    ];
}
