<?php
// Motor de integracion directa con ARCA (ex-AFIP): WSAA (LoginCms) + WSFEv1 (Factura Electronica CAE).
declare(strict_types=1);

const ARCA_ENDPOINTS = [
    'homologacion' => [
        'wsaa' => 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
        'wsfe' => 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    ],
    'produccion' => [
        'wsaa' => 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
        'wsfe' => 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    ],
];

// Condiciones frente al IVA del Receptor (RG 5616) para Emisor Responsable Inscripto
const ARCA_CONDICIONES_IVA = [
    'RI' => [
        'id' => 1,
        'label' => 'IVA Responsable Inscripto',
        'cbte_tipo' => 1, // Factura A
        'requiere_cuit' => true,
    ],
    'MONOTRIBUTO' => [
        'id' => 6,
        'label' => 'Responsable Monotributo',
        'cbte_tipo' => 1, // Factura A (Ley 27.618)
        'requiere_cuit' => true,
    ],
    'EXENTO' => [
        'id' => 4,
        'label' => 'IVA Sujeto Exento',
        'cbte_tipo' => 6, // Factura B
        'requiere_cuit' => true,
    ],
    'CF' => [
        'id' => 5,
        'label' => 'Consumidor Final',
        'cbte_tipo' => 6, // Factura B
        'requiere_cuit' => false,
    ],
];

const ARCA_ALICUOTAS_IVA = [
    '21' => ['id' => 5, 'pct' => 21.00, 'label' => '21%'],
    '10.5' => ['id' => 4, 'pct' => 10.50, 'label' => '10,5%'],
    '27' => ['id' => 6, 'pct' => 27.00, 'label' => '27%'],
    '0' => ['id' => 3, 'pct' => 0.00, 'label' => '0%'],
];

/**
 * Migracion automatica e idempotente para bases existentes (ej. Hostinger en produccion).
 */
function ensure_arca_schema(bool $force = false): void
{
    static $done = false;
    if ($done && !$force) return;
    $done = true;

    if (!$force && config_get('arca_schema_v1') === '1') {
        return;
    }

    db()->exec("CREATE TABLE IF NOT EXISTS arca_config (
        id TINYINT PRIMARY KEY DEFAULT 1,
        entorno ENUM('homologacion','produccion') NOT NULL DEFAULT 'homologacion',
        cuit VARCHAR(11) NOT NULL DEFAULT '',
        razon_social VARCHAR(180) NOT NULL DEFAULT '',
        domicilio_comercial VARCHAR(255) NOT NULL DEFAULT '',
        condicion_iva VARCHAR(60) NOT NULL DEFAULT 'IVA Responsable Inscripto',
        punto_venta INT NOT NULL DEFAULT 1,
        ingresos_brutos VARCHAR(60) NOT NULL DEFAULT '',
        inicio_actividades DATE NULL,
        cert_pem LONGTEXT NULL,
        key_pem LONGTEXT NULL,
        ta_homo_token LONGTEXT NULL,
        ta_homo_sign LONGTEXT NULL,
        ta_homo_exp DATETIME NULL,
        ta_prod_token LONGTEXT NULL,
        ta_prod_sign LONGTEXT NULL,
        ta_prod_exp DATETIME NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    db()->exec("CREATE TABLE IF NOT EXISTS facturas_arca (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        movimiento_id BIGINT NOT NULL UNIQUE,
        cliente_id INT NOT NULL,
        entorno ENUM('homologacion','produccion') NOT NULL,
        cuit_emisor VARCHAR(11) NOT NULL,
        razon_social_emisor VARCHAR(180) NOT NULL DEFAULT '',
        domicilio_emisor VARCHAR(255) NOT NULL DEFAULT '',
        iibb_emisor VARCHAR(60) NOT NULL DEFAULT '',
        inicio_act_emisor DATE NULL,
        punto_venta INT NOT NULL,
        cbte_tipo INT NOT NULL,
        cbte_numero BIGINT NOT NULL,
        cbte_fecha DATE NOT NULL,
        concepto TINYINT NOT NULL DEFAULT 2,
        fch_serv_desde DATE NOT NULL,
        fch_serv_hasta DATE NOT NULL,
        fch_vto_pago DATE NOT NULL,
        doc_tipo INT NOT NULL,
        doc_nro VARCHAR(20) NOT NULL,
        condicion_iva_receptor_id INT NOT NULL,
        condicion_iva_receptor VARCHAR(60) NOT NULL,
        receptor_nombre VARCHAR(180) NOT NULL,
        receptor_domicilio VARCHAR(255) NULL,
        descripcion VARCHAR(500) NOT NULL,
        alic_iva_id INT NOT NULL DEFAULT 5,
        alic_iva_pct DECIMAL(5,2) NOT NULL DEFAULT 21.00,
        imp_neto DECIMAL(15,2) NOT NULL,
        imp_iva DECIMAL(15,2) NOT NULL,
        imp_total DECIMAL(15,2) NOT NULL,
        cae VARCHAR(20) NOT NULL,
        cae_vto DATE NOT NULL,
        qr_url TEXT NOT NULL,
        observaciones_arca TEXT NULL,
        creado_por INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (movimiento_id) REFERENCES movimientos(id) ON DELETE RESTRICT,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (creado_por) REFERENCES usuarios(id),
        INDEX idx_cbte (entorno, punto_venta, cbte_tipo, cbte_numero)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $colIva = q("SHOW COLUMNS FROM clientes LIKE 'condicion_iva'")->fetch();
    if (!$colIva) {
        db()->exec("ALTER TABLE clientes ADD COLUMN condicion_iva VARCHAR(30) NULL AFTER cuit");
    }
    $colDom = q("SHOW COLUMNS FROM clientes LIKE 'domicilio'")->fetch();
    if (!$colDom) {
        db()->exec("ALTER TABLE clientes ADD COLUMN domicilio VARCHAR(255) NULL AFTER condicion_iva");
    }

    db()->exec("INSERT IGNORE INTO arca_config (id) VALUES (1)");
    config_set('arca_schema_v1', '1');
}

function arca_get_config_row(): array
{
    ensure_arca_schema();
    $row = q('SELECT * FROM arca_config WHERE id = 1')->fetch();
    if (!$row) {
        db()->exec('INSERT IGNORE INTO arca_config (id) VALUES (1)');
        $row = q('SELECT * FROM arca_config WHERE id = 1')->fetch();
    }
    return $row ?: [];
}

function arca_clean_digits(?string $s): string
{
    return preg_replace('/\D+/', '', (string)$s) ?? '';
}

function arca_valid_cuit(string $raw): bool
{
    $cuit = arca_clean_digits($raw);
    if (strlen($cuit) !== 11) return false;
    $weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    $sum = 0;
    for ($i = 0; $i < 10; $i++) {
        $sum += ((int)$cuit[$i]) * $weights[$i];
    }
    $mod = 11 - ($sum % 11);
    if ($mod === 11) $mod = 0;
    elseif ($mod === 10) $mod = 9;
    return $mod === (int)$cuit[10];
}

function arca_format_cuit(string $raw): string
{
    $d = arca_clean_digits($raw);
    if (strlen($d) !== 11) return $raw;
    return substr($d, 0, 2) . '-' . substr($d, 2, 8) . '-' . substr($d, 10, 1);
}

function arca_cbte_letra(int $cbteTipo): string
{
    return match ($cbteTipo) {
        1, 2, 3 => 'A',
        6, 7, 8 => 'B',
        11, 12, 13 => 'C',
        default => 'X',
    };
}

function arca_cbte_nombre(int $cbteTipo): string
{
    return match ($cbteTipo) {
        1 => 'FACTURA A',
        6 => 'FACTURA B',
        11 => 'FACTURA C',
        default => 'COMPROBANTE ' . $cbteTipo,
    };
}

function arca_format_numero(int $ptoVta, int $cbteNro): string
{
    return sprintf('%05d-%08d', $ptoVta, $cbteNro);
}

/**
 * Ejecuta operaciones OpenSSL garantizando un archivo openssl.cnf valido
 * incluso en entornos Windows/XAMPP donde OPENSSL_CONF no esta definido.
 */
function arca_openssl_generate_csr(string $cuitRaw, string $razonSocial): array
{
    $cuit = arca_clean_digits($cuitRaw);
    if (!arca_valid_cuit($cuit)) {
        throw new HttpError('Ingrese un CUIT emisor válido de 11 dígitos antes de generar el CSR.');
    }
    $orgClean = trim(preg_replace('/[^\p{L}\p{N}\s.\-&]/u', '', $razonSocial) ?? '');
    if ($orgClean === '') $orgClean = 'ESTUDIO CONTABLE';
    $orgClean = mb_substr($orgClean, 0, 60, 'UTF-8');

    $dn = [
        'countryName' => 'AR',
        'organizationName' => $orgClean,
        'commonName' => 'cajaestudio',
        'serialNumber' => 'CUIT ' . $cuit,
    ];

    $baseOpts = [
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
        'digest_alg' => 'sha256',
    ];

    // vaciar cola de errores OpenSSL previos
    while (openssl_error_string() !== false) {
    }

    $tmpCnf = null;
    try {
        $pkey = @openssl_pkey_new($baseOpts);
        $opts = $baseOpts;
        if ($pkey === false) {
            $tmpCnf = tempnam(sys_get_temp_dir(), 'arcacnf_');
            file_put_contents($tmpCnf, "[ req ]\ndistinguished_name = req_dn\nprompt = no\n[ req_dn ]\n");
            $opts['config'] = $tmpCnf;
            $pkey = openssl_pkey_new($opts);
        }
        if ($pkey === false) {
            throw new HttpError('OpenSSL no pudo generar la clave privada RSA 2048.');
        }

        $csr = openssl_csr_new($dn, $pkey, $opts);
        if ($csr === false) {
            throw new HttpError('OpenSSL no pudo generar la solicitud CSR.');
        }

        $keyPem = '';
        $csrPem = '';
        if (!openssl_pkey_export($pkey, $keyPem, null, $opts) || !openssl_csr_export($csr, $csrPem)) {
            throw new HttpError('No se pudo exportar la clave privada o el CSR en formato PEM.');
        }

        return [
            'key_pem' => trim($keyPem) . "\n",
            'csr_pem' => trim($csrPem) . "\n",
        ];
    } finally {
        if ($tmpCnf && is_file($tmpCnf)) {
            @unlink($tmpCnf);
        }
    }
}

function arca_parse_cert_info(?string $certPem, ?string $keyPem = null): ?array
{
    $certPem = trim((string)$certPem);
    if ($certPem === '') return null;

    $parsed = @openssl_x509_parse($certPem);
    if (!is_array($parsed)) {
        return [
            'valido' => false,
            'error' => 'El certificado cargado no tiene un formato X.509 PEM válido (-----BEGIN CERTIFICATE-----).',
        ];
    }

    $subj = $parsed['subject'] ?? [];
    $issuer = $parsed['issuer'] ?? [];
    $serialAttr = (string)($subj['serialNumber'] ?? '');
    $cuitCert = '';
    if (preg_match('/(\d{11})/', $serialAttr, $m)) {
        $cuitCert = $m[1];
    }

    $validFrom = isset($parsed['validFrom_time_t']) ? (int)$parsed['validFrom_time_t'] : null;
    $validTo = isset($parsed['validTo_time_t']) ? (int)$parsed['validTo_time_t'] : null;
    $vencido = $validTo !== null && $validTo < time();
    $diasRestantes = $validTo !== null ? (int)floor(($validTo - time()) / 86400) : null;

    $coincideClave = null;
    if ($keyPem !== null && trim($keyPem) !== '') {
        $coincideClave = @openssl_x509_check_private_key($certPem, $keyPem);
    }

    return [
        'valido' => true,
        'cn' => (string)($subj['CN'] ?? ''),
        'serial_subject' => $serialAttr,
        'cuit_certificado' => $cuitCert,
        'emisor_ca' => (string)($issuer['CN'] ?? $issuer['O'] ?? ''),
        'valido_desde' => $validFrom ? date('Y-m-d H:i', $validFrom) : null,
        'valido_hasta' => $validTo ? date('Y-m-d H:i', $validTo) : null,
        'vencido' => $vencido,
        'dias_restantes' => $diasRestantes,
        'coincide_clave' => $coincideClave,
    ];
}

function arca_translate_wsaa_fault(string $code, string $str): string
{
    $c = strtolower($code);
    if (str_contains($c, 'cms.cert.untrusted')) {
        return 'Certificado no emitido por ARCA o corresponde a otro entorno (ej. subió un certificado de Homologación en Producción o viceversa).';
    }
    if (str_contains($c, 'cms.cert.expired')) {
        return 'El certificado digital de ARCA está vencido. Debe renovar el .crt desde el portal de ARCA.';
    }
    if (str_contains($c, 'coe.notauthorized')) {
        return 'El certificado es válido, pero aún no está asociado al Web Service "Facturación Electrónica (wsfe)" en el Administrador de Relaciones de ARCA.';
    }
    if (str_contains($c, 'coe.alreadyauthenticated')) {
        return 'ARCA informa que ya existe un Ticket de Acceso activo emitido recientemente para este certificado. Aguarde unos minutos o reintente.';
    }
    return trim("$code: $str");
}

function arca_curl_post_soap(string $url, string $soapXml, string $soapActionHeader): string
{
    $ch = curl_init($url);
    if ($ch === false) {
        throw new HttpError('No se pudo inicializar cURL en el servidor.');
    }
    $opts = [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $soapXml,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: text/xml; charset=utf-8',
            'SOAPAction: ' . $soapActionHeader,
        ],
        CURLOPT_CONNECTTIMEOUT => 12,
        CURLOPT_TIMEOUT => 28,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ];
    $sslVer = curl_version()['ssl_version'] ?? '';
    if (stripos($sslVer, 'OpenSSL') !== false) {
        // Necesario en OpenSSL 3.x (Linux Hostinger / XAMPP PHP 8.2) para claves DH de servidores AFIP/ARCA
        $opts[CURLOPT_SSL_CIPHER_LIST] = 'DEFAULT@SECLEVEL=1';
    }
    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    $errno = curl_errno($ch);
    curl_close($ch);

    if ($resp === false || $errno !== 0) {
        throw new HttpError('Error de red al conectar con ARCA (' . parse_url($url, PHP_URL_HOST) . '): ' . ($err ?: "cURL #$errno"), 502);
    }
    return (string)$resp;
}

/**
 * Obtiene (o reutiliza desde cache en MySQL) el Ticket de Acceso (Token + Sign) de WSAA para el servicio "wsfe".
 */
function arca_get_ta(array $cfg, bool $forceRefresh = false): array
{
    $entorno = ($cfg['entorno'] ?? 'homologacion') === 'produccion' ? 'produccion' : 'homologacion';
    $certPem = trim((string)($cfg['cert_pem'] ?? ''));
    $keyPem = trim((string)($cfg['key_pem'] ?? ''));

    if ($certPem === '' || $keyPem === '') {
        throw new HttpError('Falta configurar el Certificado (.crt) o la Clave Privada (.key) de ARCA en Configuración > Facturación ARCA.');
    }
    if (!@openssl_x509_check_private_key($certPem, $keyPem)) {
        throw new HttpError('El Certificado (.crt) no coincide con la Clave Privada (.key) guardada. Verifique que pertenezcan al mismo CSR.');
    }

    $colPrefix = $entorno === 'produccion' ? 'ta_prod' : 'ta_homo';
    $tokCol = $colPrefix . '_token';
    $sgnCol = $colPrefix . '_sign';
    $expCol = $colPrefix . '_exp';

    if (!$forceRefresh && !empty($cfg[$tokCol]) && !empty($cfg[$sgnCol]) && !empty($cfg[$expCol])) {
        $expTs = strtotime((string)$cfg[$expCol]);
        if ($expTs !== false && $expTs > time() + 600) {
            return [
                'token' => (string)$cfg[$tokCol],
                'sign' => (string)$cfg[$sgnCol],
                'exp' => (string)$cfg[$expCol],
                'cached' => true,
            ];
        }
    }

    $uniqueId = time() % 2000000000;
    $genTime = date('c', time() - 600);
    $expTime = date('c', time() + 600);

    $traXml = '<?xml version="1.0" encoding="UTF-8"?>'
        . '<loginTicketRequest version="1.0">'
        . '<header>'
        . '<uniqueId>' . $uniqueId . '</uniqueId>'
        . '<generationTime>' . $genTime . '</generationTime>'
        . '<expirationTime>' . $expTime . '</expirationTime>'
        . '</header>'
        . '<service>wsfe</service>'
        . '</loginTicketRequest>';

    $traFile = tempnam(sys_get_temp_dir(), 'arca_tra_');
    $cmsFile = tempnam(sys_get_temp_dir(), 'arca_cms_');
    $crtFile = tempnam(sys_get_temp_dir(), 'arca_crt_');
    $keyFile = tempnam(sys_get_temp_dir(), 'arca_key_');

    try {
        file_put_contents($traFile, $traXml);
        file_put_contents($crtFile, $certPem);
        file_put_contents($keyFile, $keyPem);

        $signed = @openssl_pkcs7_sign(
            $traFile,
            $cmsFile,
            'file://' . $crtFile,
            ['file://' . $keyFile, ''],
            [],
            0
        );
        if (!$signed) {
            throw new HttpError('No se pudo firmar el Ticket de Acceso (PKCS#7 CMS) con el certificado configurado.');
        }

        $rawSmime = (string)file_get_contents($cmsFile);
    } finally {
        foreach ([$traFile, $cmsFile, $crtFile, $keyFile] as $f) {
            if ($f && is_file($f)) @unlink($f);
        }
    }

    $parts = preg_split('/\r?\n\r?\n/', trim($rawSmime), 2);
    $cmsB64 = preg_replace('/\s+/', '', $parts[1] ?? '') ?? '';
    if ($cmsB64 === '') {
        throw new HttpError('Firma CMS vacía al preparar autenticación WSAA.');
    }

    $soap = '<?xml version="1.0" encoding="UTF-8"?>'
        . '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">'
        . '<soapenv:Header/>'
        . '<soapenv:Body>'
        . '<wsaa:loginCms><wsaa:in0>' . $cmsB64 . '</wsaa:in0></wsaa:loginCms>'
        . '</soapenv:Body>'
        . '</soapenv:Envelope>';

    $wsaaUrl = ARCA_ENDPOINTS[$entorno]['wsaa'];
    $respXml = arca_curl_post_soap($wsaaUrl, $soap, '""');

    $prevErr = libxml_use_internal_errors(true);
    $sx = simplexml_load_string($respXml);
    libxml_clear_errors();
    libxml_use_internal_errors($prevErr);

    if ($sx === false) {
        throw new HttpError('Respuesta XML inválida desde WSAA de ARCA.', 502);
    }

    $faults = $sx->xpath('//*[local-name()="Fault"]');
    if (!empty($faults)) {
        $f = $faults[0];
        $fCode = trim((string)($f->xpath('*[local-name()="faultcode"]')[0] ?? 'Fault'));
        $fStr = trim((string)($f->xpath('*[local-name()="faultstring"]')[0] ?? 'Error de autenticación'));

        // Si otro request paralelo acaba de refrescar el TA, reutilizarlo
        if (stripos($fCode, 'alreadyAuthenticated') !== false) {
            $freshCfg = arca_get_config_row();
            if (!empty($freshCfg[$tokCol]) && !empty($freshCfg[$sgnCol]) && !empty($freshCfg[$expCol])) {
                if (strtotime((string)$freshCfg[$expCol]) > time() + 60) {
                    return [
                        'token' => (string)$freshCfg[$tokCol],
                        'sign' => (string)$freshCfg[$sgnCol],
                        'exp' => (string)$freshCfg[$expCol],
                        'cached' => true,
                    ];
                }
            }
        }
        throw new HttpError('ARCA WSAA (' . strtoupper($entorno) . '): ' . arca_translate_wsaa_fault($fCode, $fStr), 422);
    }

    $retNodes = $sx->xpath('//*[local-name()="loginCmsReturn"]');
    $taXmlStr = trim((string)($retNodes[0] ?? ''));
    if ($taXmlStr === '') {
        throw new HttpError('WSAA no devolvió loginCmsReturn.', 502);
    }

    $taSx = @simplexml_load_string($taXmlStr);
    if ($taSx === false) {
        throw new HttpError('No se pudo interpretar el Ticket de Acceso devuelto por WSAA.', 502);
    }

    $token = trim((string)($taSx->credentials->token ?? ''));
    $sign = trim((string)($taSx->credentials->sign ?? ''));
    $expIso = trim((string)($taSx->header->expirationTime ?? ''));

    if ($token === '' || $sign === '') {
        throw new HttpError('Ticket de Acceso incompleto devuelto por ARCA.', 502);
    }

    try {
        $dtExp = new DateTime($expIso ?: '+11 hours');
        $dtExp->setTimezone(new DateTimeZone(date_default_timezone_get()));
        $expDb = $dtExp->format('Y-m-d H:i:s');
    } catch (Throwable $e) {
        $expDb = date('Y-m-d H:i:s', time() + 39600);
    }

    q("UPDATE arca_config SET $tokCol = ?, $sgnCol = ?, $expCol = ? WHERE id = 1", [$token, $sign, $expDb]);

    return [
        'token' => $token,
        'sign' => $sign,
        'exp' => $expDb,
        'cached' => false,
    ];
}

function arca_xml_escape(string $s): string
{
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function arca_wsfe_call(string $entorno, string $method, string $innerBodyXml): SimpleXMLElement
{
    $env = $entorno === 'produccion' ? 'produccion' : 'homologacion';
    $url = ARCA_ENDPOINTS[$env]['wsfe'];

    $soap = '<?xml version="1.0" encoding="UTF-8"?>'
        . '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">'
        . '<soap:Header/>'
        . '<soap:Body>'
        . '<ar:' . $method . '>'
        . $innerBodyXml
        . '</ar:' . $method . '>'
        . '</soap:Body>'
        . '</soap:Envelope>';

    $respXml = arca_curl_post_soap($url, $soap, '"http://ar.gov.afip.dif.FEV1/' . $method . '"');

    $prevErr = libxml_use_internal_errors(true);
    $sx = simplexml_load_string($respXml);
    libxml_clear_errors();
    libxml_use_internal_errors($prevErr);

    if ($sx === false) {
        throw new HttpError("Respuesta XML inválida de ARCA WSFEv1 ($method).", 502);
    }

    $faults = $sx->xpath('//*[local-name()="Fault"]');
    if (!empty($faults)) {
        $f = $faults[0];
        $fStr = trim((string)($f->xpath('*[local-name()="faultstring"]')[0] ?? 'Error SOAP en WSFEv1'));
        throw new HttpError("ARCA WSFEv1 ($method): $fStr", 502);
    }

    $resNodes = $sx->xpath('//*[local-name()="' . $method . 'Result"]');
    if (empty($resNodes)) {
        throw new HttpError("ARCA WSFEv1 no devolvió resultado para $method.", 502);
    }
    return $resNodes[0];
}

function arca_wsfe_auth_xml(array $ta, string $cuitEmisor): string
{
    return '<ar:Auth>'
        . '<ar:Token>' . arca_xml_escape($ta['token']) . '</ar:Token>'
        . '<ar:Sign>' . arca_xml_escape($ta['sign']) . '</ar:Sign>'
        . '<ar:Cuit>' . arca_clean_digits($cuitEmisor) . '</ar:Cuit>'
        . '</ar:Auth>';
}

function arca_wsfe_extract_errors(SimpleXMLElement $resultNode): array
{
    $out = [];
    $errs = $resultNode->xpath('.//*[local-name()="Errors"]/*[local-name()="Err"]') ?: [];
    foreach ($errs as $e) {
        $code = trim((string)($e->xpath('*[local-name()="Code"]')[0] ?? ''));
        $msg = trim((string)($e->xpath('*[local-name()="Msg"]')[0] ?? ''));
        if ($code !== '' || $msg !== '') {
            $out[] = ['code' => (int)$code, 'msg' => $msg, 'formatted' => "[$code] $msg"];
        }
    }
    return $out;
}

function arca_wsfe_extract_obs(SimpleXMLElement $resultNode): array
{
    $out = [];
    $obs = $resultNode->xpath('.//*[local-name()="Observaciones"]/*[local-name()="Obs"]') ?: [];
    foreach ($obs as $o) {
        $code = trim((string)($o->xpath('*[local-name()="Code"]')[0] ?? ''));
        $msg = trim((string)($o->xpath('*[local-name()="Msg"]')[0] ?? ''));
        if ($code !== '' || $msg !== '') {
            $out[] = ['code' => (int)$code, 'msg' => $msg, 'formatted' => "[$code] $msg"];
        }
    }
    return $out;
}

function arca_wsfe_dummy(string $entorno): array
{
    $res = arca_wsfe_call($entorno, 'FEDummy', '');
    return [
        'app_server' => trim((string)($res->xpath('*[local-name()="AppServer"]')[0] ?? '')),
        'db_server' => trim((string)($res->xpath('*[local-name()="DbServer"]')[0] ?? '')),
        'auth_server' => trim((string)($res->xpath('*[local-name()="AuthServer"]')[0] ?? '')),
    ];
}

function arca_wsfe_ultimo_autorizado(array $cfg, array $ta, int $ptoVta, int $cbteTipo): int
{
    $cuit = arca_clean_digits((string)$cfg['cuit']);
    $xml = arca_wsfe_auth_xml($ta, $cuit)
        . '<ar:PtoVta>' . $ptoVta . '</ar:PtoVta>'
        . '<ar:CbteTipo>' . $cbteTipo . '</ar:CbteTipo>';

    $res = arca_wsfe_call((string)$cfg['entorno'], 'FECompUltimoAutorizado', $xml);
    $errs = arca_wsfe_extract_errors($res);
    if (!empty($errs)) {
        $msgs = array_column($errs, 'formatted');
        throw new HttpError('ARCA FECompUltimoAutorizado: ' . implode(' | ', $msgs), 422);
    }
    $nro = (int)($res->xpath('*[local-name()="CbteNro"]')[0] ?? 0);
    return $nro;
}

/**
 * Construye la URL oficial del codigo QR de ARCA segun RG 4892.
 */
function arca_build_qr_url(array $d): string
{
    $numOrInt = static fn(string $digits) => PHP_INT_SIZE >= 8 ? (int)$digits : (float)$digits;

    $payload = [
        'ver' => 1,
        'fecha' => (string)$d['cbte_fecha'], // YYYY-MM-DD
        'cuit' => $numOrInt(arca_clean_digits((string)$d['cuit_emisor'])),
        'ptoVta' => (int)$d['punto_venta'],
        'tipoCmp' => (int)$d['cbte_tipo'],
        'nroCmp' => (int)$d['cbte_numero'],
        'importe' => round((float)$d['imp_total'], 2),
        'moneda' => 'PES',
        'ctz' => 1,
        'tipoDocRec' => (int)$d['doc_tipo'],
        'nroDocRec' => $numOrInt(arca_clean_digits((string)$d['doc_nro']) ?: '0'),
        'tipoCodAut' => 'E',
        'codAut' => $numOrInt(arca_clean_digits((string)$d['cae'])),
    ];

    $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    return 'https://www.afip.gob.ar/fe/qr/?p=' . base64_encode((string)$json);
}

/**
 * Solicita autorizacion CAE en ARCA WSFEv1 (FECAESolicitar) para Factura A (1) o Factura B (6).
 */
function arca_wsfe_solicitar_cae(array $cfg, array $ta, array $req): array
{
    $entorno = (string)$cfg['entorno'];
    $cuitEmisor = arca_clean_digits((string)$cfg['cuit']);
    $ptoVta = (int)$req['punto_venta'];
    $cbteTipo = (int)$req['cbte_tipo'];

    $ultimo = arca_wsfe_ultimo_autorizado($cfg, $ta, $ptoVta, $cbteTipo);
    $proximo = $ultimo + 1;

    $cbteFchYmd = str_replace('-', '', (string)$req['cbte_fecha']);
    $servDesdeYmd = str_replace('-', '', (string)$req['fch_serv_desde']);
    $servHastaYmd = str_replace('-', '', (string)$req['fch_serv_hasta']);
    $vtoPagoYmd = str_replace('-', '', (string)$req['fch_vto_pago']);

    $concepto = (int)($req['concepto'] ?? 2);
    $docTipo = (int)$req['doc_tipo'];
    $docNro = arca_clean_digits((string)$req['doc_nro']) ?: '0';
    $condIvaId = (int)$req['condicion_iva_receptor_id'];

    $impNeto = number_format((float)$req['imp_neto'], 2, '.', '');
    $impIva = number_format((float)$req['imp_iva'], 2, '.', '');
    $impTotal = number_format((float)$req['imp_total'], 2, '.', '');
    $alicId = (int)$req['alic_iva_id'];

    $servXml = '';
    if ($concepto === 2 || $concepto === 3) {
        $servXml = '<ar:FchServDesde>' . $servDesdeYmd . '</ar:FchServDesde>'
            . '<ar:FchServHasta>' . $servHastaYmd . '</ar:FchServHasta>'
            . '<ar:FchVtoPago>' . $vtoPagoYmd . '</ar:FchVtoPago>';
    }

    $ivaXml = '<ar:Iva>'
        . '<ar:AlicIva>'
        . '<ar:Id>' . $alicId . '</ar:Id>'
        . '<ar:BaseImp>' . $impNeto . '</ar:BaseImp>'
        . '<ar:Importe>' . $impIva . '</ar:Importe>'
        . '</ar:AlicIva>'
        . '</ar:Iva>';

    $inner = arca_wsfe_auth_xml($ta, $cuitEmisor)
        . '<ar:FeCAEReq>'
        . '<ar:FeCabReq>'
        . '<ar:CantReg>1</ar:CantReg>'
        . '<ar:PtoVta>' . $ptoVta . '</ar:PtoVta>'
        . '<ar:CbteTipo>' . $cbteTipo . '</ar:CbteTipo>'
        . '</ar:FeCabReq>'
        . '<ar:FeDetReq>'
        . '<ar:FECAEDetRequest>'
        . '<ar:Concepto>' . $concepto . '</ar:Concepto>'
        . '<ar:DocTipo>' . $docTipo . '</ar:DocTipo>'
        . '<ar:DocNro>' . $docNro . '</ar:DocNro>'
        . '<ar:CbteDesde>' . $proximo . '</ar:CbteDesde>'
        . '<ar:CbteHasta>' . $proximo . '</ar:CbteHasta>'
        . '<ar:CbteFch>' . $cbteFchYmd . '</ar:CbteFch>'
        . '<ar:ImpTotal>' . $impTotal . '</ar:ImpTotal>'
        . '<ar:ImpTotConc>0.00</ar:ImpTotConc>'
        . '<ar:ImpNeto>' . $impNeto . '</ar:ImpNeto>'
        . '<ar:ImpOpEx>0.00</ar:ImpOpEx>'
        . '<ar:ImpTrib>0.00</ar:ImpTrib>'
        . '<ar:ImpIVA>' . $impIva . '</ar:ImpIVA>'
        . $servXml
        . '<ar:MonId>PES</ar:MonId>'
        . '<ar:MonCotiz>1</ar:MonCotiz>'
        . '<ar:CondicionIVAReceptorId>' . $condIvaId . '</ar:CondicionIVAReceptorId>'
        . $ivaXml
        . '</ar:FECAEDetRequest>'
        . '</ar:FeDetReq>'
        . '</ar:FeCAEReq>';

    $res = arca_wsfe_call($entorno, 'FECAESolicitar', $inner);
    $errs = arca_wsfe_extract_errors($res);
    $obs = arca_wsfe_extract_obs($res);

    $detResNodes = $res->xpath('.//*[local-name()="FECAEDetResponse"]');
    $det = $detResNodes[0] ?? null;
    $resultado = $det ? trim((string)($det->xpath('*[local-name()="Resultado"]')[0] ?? '')) : '';
    $cae = $det ? trim((string)($det->xpath('*[local-name()="CAE"]')[0] ?? '')) : '';
    $caeFchVtoRaw = $det ? trim((string)($det->xpath('*[local-name()="CAEFchVto"]')[0] ?? '')) : '';

    if ($resultado !== 'A' || $cae === '') {
        $motivos = array_merge(
            array_column($errs, 'formatted'),
            array_column($obs, 'formatted')
        );
        $detalleError = !empty($motivos)
            ? implode(' · ', $motivos)
            : 'Comprobante rechazado sin detalle adicional (Resultado=' . ($resultado ?: 'N/A') . ')';
        throw new HttpError('ARCA rechazó la emisión: ' . $detalleError, 422);
    }

    $caeVtoIso = preg_match('/^(\d{4})(\d{2})(\d{2})$/', $caeFchVtoRaw, $m)
        ? "{$m[1]}-{$m[2]}-{$m[3]}"
        : date('Y-m-d', strtotime('+10 days'));

    $obsTxt = !empty($obs) ? implode(' | ', array_column($obs, 'formatted')) : null;

    $qrUrl = arca_build_qr_url([
        'cbte_fecha' => $req['cbte_fecha'],
        'cuit_emisor' => $cuitEmisor,
        'punto_venta' => $ptoVta,
        'cbte_tipo' => $cbteTipo,
        'cbte_numero' => $proximo,
        'imp_total' => $req['imp_total'],
        'doc_tipo' => $docTipo,
        'doc_nro' => $docNro,
        'cae' => $cae,
    ]);

    return [
        'cbte_numero' => $proximo,
        'cae' => $cae,
        'cae_vto' => $caeVtoIso,
        'qr_url' => $qrUrl,
        'observaciones_arca' => $obsTxt,
    ];
}

function factura_arca_row(array $f): array
{
    $cbteTipo = (int)$f['cbte_tipo'];
    $ptoVta = (int)$f['punto_venta'];
    $cbteNro = (int)$f['cbte_numero'];
    return [
        'id' => (int)$f['id'],
        'movimiento_id' => (int)$f['movimiento_id'],
        'cliente_id' => (int)$f['cliente_id'],
        'entorno' => $f['entorno'],
        'cuit_emisor' => $f['cuit_emisor'],
        'razon_social_emisor' => $f['razon_social_emisor'],
        'domicilio_emisor' => $f['domicilio_emisor'],
        'iibb_emisor' => $f['iibb_emisor'],
        'inicio_act_emisor' => $f['inicio_act_emisor'],
        'punto_venta' => $ptoVta,
        'cbte_tipo' => $cbteTipo,
        'cbte_letra' => arca_cbte_letra($cbteTipo),
        'cbte_nombre' => arca_cbte_nombre($cbteTipo),
        'cbte_numero' => $cbteNro,
        'numero_formateado' => arca_format_numero($ptoVta, $cbteNro),
        'cbte_fecha' => $f['cbte_fecha'],
        'concepto' => (int)$f['concepto'],
        'fch_serv_desde' => $f['fch_serv_desde'],
        'fch_serv_hasta' => $f['fch_serv_hasta'],
        'fch_vto_pago' => $f['fch_vto_pago'],
        'doc_tipo' => (int)$f['doc_tipo'],
        'doc_nro' => $f['doc_nro'],
        'condicion_iva_receptor_id' => (int)$f['condicion_iva_receptor_id'],
        'condicion_iva_receptor' => $f['condicion_iva_receptor'],
        'receptor_nombre' => $f['receptor_nombre'],
        'receptor_domicilio' => $f['receptor_domicilio'],
        'descripcion' => $f['descripcion'],
        'alic_iva_id' => (int)$f['alic_iva_id'],
        'alic_iva_pct' => (float)$f['alic_iva_pct'],
        'imp_neto' => (float)$f['imp_neto'],
        'imp_iva' => (float)$f['imp_iva'],
        'imp_total' => (float)$f['imp_total'],
        'cae' => $f['cae'],
        'cae_vto' => $f['cae_vto'],
        'qr_url' => $f['qr_url'],
        'observaciones_arca' => $f['observaciones_arca'],
        'created_at' => $f['created_at'] ?? null,
    ];
}
