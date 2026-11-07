<?php
// Configuracion por defecto (XAMPP local).
// En Hostinger: copiar a config.local.php y completar los datos reales.
$config = [
    'db_host' => '127.0.0.1',
    'db_port' => 3306,
    'db_name' => 'estudio_caja',
    'db_user' => 'root',
    'db_pass' => '',
    'timezone' => 'America/Argentina/Tucuman',
    'debug' => false,
    'session_idle_timeout' => 1800,
    'session_absolute_timeout' => 28800,
];

if (file_exists(__DIR__ . '/config.local.php')) {
    $config = array_merge($config, require __DIR__ . '/config.local.php');
}

date_default_timezone_set($config['timezone']);
return $config;

