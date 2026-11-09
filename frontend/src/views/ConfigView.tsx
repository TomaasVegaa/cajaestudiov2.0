import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileKey2,
  Loader2,
  Lock,
  LockOpen,
  PlugZap,
  ShieldCheck,
  Upload,
  UserPlus,
} from 'lucide-react';
import {
  api,
  ArcaConfigData,
  fmtARS,
  fmtDate,
  parseLocalAmount,
  PeriodoItem,
  User,
} from '../lib/api';
import { cleanDigits, formatCuitDisplay, isValidCuitAR } from '../lib/facturaPdf';

export type ConfigSubTab = 'PERIODOS' | 'APERTURA' | 'ARCA' | 'USUARIOS';

interface Props {
  user: User;
  onDataChanged: () => void;
  initialTab?: ConfigSubTab;
}

interface AperturaData {
  fecha_inicio: string;
  fecha_apertura: string;
  nombre_estudio: string;
  subtitulo_estudio?: string;
  datos_contacto_estudio?: string;
  efectivo: number;
  banco: number;
  clientes: { id: number; nombre: string; nota_revision?: string | null; saldo: number }[];
  total_clientes: number;
}

export function ConfigView({ user, onDataChanged, initialTab }: Props) {
  const isAdmin = user.rol === 'admin';
  const [tab, setTab] = useState<ConfigSubTab>(initialTab || 'PERIODOS');

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // Períodos
  const [periodos, setPeriodos] = useState<PeriodoItem[]>([]);

  // ARCA Facturación Electrónica
  const [arcaCfg, setArcaCfg] = useState<ArcaConfigData | null>(null);
  const [arcaEntorno, setArcaEntorno] = useState<'homologacion' | 'produccion'>('homologacion');
  const [arcaCuit, setArcaCuit] = useState('');
  const [arcaRazon, setArcaRazon] = useState('');
  const [arcaDomicilio, setArcaDomicilio] = useState('');
  const [arcaPtoVta, setArcaPtoVta] = useState('1');
  const [arcaIibb, setArcaIibb] = useState('');
  const [arcaInicioAct, setArcaInicioAct] = useState('');
  const [arcaCertDraft, setArcaCertDraft] = useState('');
  const [arcaKeyDraft, setArcaKeyDraft] = useState('');
  const [showKeyManual, setShowKeyManual] = useState(false);
  const [arcaBusy, setArcaBusy] = useState(false);
  const [arcaTesting, setArcaTesting] = useState(false);
  const [arcaMsg, setArcaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Apertura e importador Excel
  const [ap, setAp] = useState<AperturaData | null>(null);
  const [nombreEstudio, setNombreEstudio] = useState('');
  const [subtituloEstudio, setSubtituloEstudio] = useState('');
  const [contactoEstudio, setContactoEstudio] = useState('');
  const [fechaInicio, setFechaInicio] = useState('2026-11-01');
  const [efInicial, setEfInicial] = useState('');
  const [bcoInicial, setBcoInicial] = useState('');
  const [textoExcel, setTextoExcel] = useState('');
  const [preview, setPreview] = useState<{
    creados: string[];
    actualizados: string[];
    errores: string[];
    total: number;
    filas: { nombre: string; saldo: number; nota: string; nuevo: boolean }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Usuarios y clave
  const [usuarios, setUsuarios] = useState<
    { id: number; nombre: string; email: string; rol: 'admin' | 'operador'; activo: number }[]
  >([]);
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [newUser, setNewUser] = useState({
    nombre: '',
    email: '',
    password: '',
    rol: 'operador' as 'admin' | 'operador',
  });

  const loadPeriodos = useCallback(async () => {
    const res = await api<PeriodoItem[]>('GET', 'periodos');
    setPeriodos(res);
  }, []);

  const loadApertura = useCallback(async () => {
    const res = await api<AperturaData>('GET', 'apertura');
    setAp(res);
    setNombreEstudio(res.nombre_estudio || 'Estudio Contable');
    setSubtituloEstudio(res.subtitulo_estudio || '');
    setContactoEstudio(res.datos_contacto_estudio || '');
    setFechaInicio(res.fecha_inicio || '2026-11-01');
    setEfInicial(res.efectivo ? String(res.efectivo) : '');
    setBcoInicial(res.banco ? String(res.banco) : '');
  }, []);

  const loadUsuarios = useCallback(async () => {
    if (!isAdmin) return;
    const res = await api<any[]>('GET', 'usuarios');
    setUsuarios(res);
  }, [isAdmin]);

  const applyArcaResponse = (res: ArcaConfigData) => {
    setArcaCfg(res);
    setArcaEntorno(res.entorno || 'homologacion');
    setArcaCuit(res.cuit || '');
    setArcaRazon(res.razon_social || '');
    setArcaDomicilio(res.domicilio_comercial || '');
    setArcaPtoVta(String(res.punto_venta || 1));
    setArcaIibb(res.ingresos_brutos || '');
    setArcaInicioAct(res.inicio_actividades || '');
  };

  const loadArca = useCallback(async () => {
    const res = await api<ArcaConfigData>('GET', 'arca/config');
    applyArcaResponse(res);
  }, []);

  useEffect(() => {
    if (tab === 'PERIODOS') loadPeriodos();
    if (tab === 'APERTURA') loadApertura();
    if (tab === 'ARCA') loadArca();
    if (tab === 'USUARIOS') loadUsuarios();
  }, [tab, loadPeriodos, loadApertura, loadArca, loadUsuarios]);

  const saveArcaConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setArcaBusy(true);
    setArcaMsg(null);
    try {
      const payload: Record<string, unknown> = {
        entorno: arcaEntorno,
        cuit: cleanDigits(arcaCuit),
        razon_social: arcaRazon,
        domicilio_comercial: arcaDomicilio,
        punto_venta: Number(arcaPtoVta) || 1,
        ingresos_brutos: arcaIibb,
        inicio_actividades: arcaInicioAct || null,
      };
      if (arcaCertDraft.trim()) payload.cert_pem = arcaCertDraft.trim();
      if (arcaKeyDraft.trim()) payload.key_pem = arcaKeyDraft.trim();

      const res = await api<ArcaConfigData>('POST', 'arca/config', payload);
      applyArcaResponse(res);
      setArcaCertDraft('');
      setArcaKeyDraft('');
      setArcaMsg({
        ok: true,
        text: 'Datos fiscales y credenciales ARCA guardados correctamente.',
      });
    } catch (ex: any) {
      setArcaMsg({
        ok: false,
        text: ex.message || 'Error al guardar la configuración de ARCA.',
      });
    } finally {
      setArcaBusy(false);
    }
  };

  const handleGenerarCsr = async () => {
    if (!isAdmin) return;
    const digits = cleanDigits(arcaCuit);
    if (!isValidCuitAR(digits)) {
      setArcaMsg({
        ok: false,
        text: 'Ingrese primero un CUIT válido de 11 dígitos del emisor para generar el CSR.',
      });
      return;
    }
    if (
      arcaCfg?.tiene_cert &&
      !window.confirm(
        'Ya hay un certificado cargado. Generar una nueva Clave Privada y CSR reemplazará la clave actual y requerirá subir un nuevo .crt desde ARCA. ¿Continuar?',
      )
    ) {
      return;
    }

    setArcaBusy(true);
    setArcaMsg(null);
    try {
      const res = await api<{
        ok: boolean;
        csr_pem: string;
        filename: string;
        config: ArcaConfigData;
      }>('POST', 'arca/generar-csr', {
        cuit: digits,
        razon_social: arcaRazon,
      });
      applyArcaResponse(res.config);

      // Descargar automáticamente el archivo .csr
      const blob = new Blob([res.csr_pem], { type: 'application/pkcs10' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || `solicitud_arca_${digits}.csr`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setArcaMsg({
        ok: true,
        text: `Clave Privada guardada en el sistema y archivo "${res.filename}" descargado. Súbalo en el portal de ARCA para obtener el archivo .crt.`,
      });
    } catch (ex: any) {
      setArcaMsg({
        ok: false,
        text: ex.message || 'No se pudo generar el CSR.',
      });
    } finally {
      setArcaBusy(false);
    }
  };

  const handleProbarArca = async () => {
    if (!isAdmin) return;
    setArcaTesting(true);
    setArcaMsg(null);
    try {
      const res = await api<{ ok: boolean; mensaje: string }>('POST', 'arca/probar', {});
      setArcaMsg({
        ok: res.ok,
        text: res.mensaje,
      });
    } catch (ex: any) {
      setArcaMsg({
        ok: false,
        text: ex.message || 'Error al probar conexión con los servidores de ARCA.',
      });
    } finally {
      setArcaTesting(false);
    }
  };

  const readPemFile = (file: File | undefined, setter: (txt: string) => void) => {
    if (!file) return;
    file
      .text()
      .then((t) => setter(t))
      .catch(() => alert('No se pudo leer el archivo seleccionado.'));
  };

  const togglePeriodo = async (p: PeriodoItem) => {
    if (!isAdmin) return;
    const accion = p.cerrado ? 'reabrir' : 'cerrar';
    const msg = p.cerrado
      ? `¿Reabrir ${p.nombre} para permitir correcciones?`
      : `¿Cerrar ${p.nombre}? Los movimientos de este mes quedarán protegidos en modo lectura y los saldos continúan arrastrándose automáticamente.`;
    if (!confirm(msg)) return;
    await api('POST', `periodos/${accion}`, { anio: p.anio, mes: p.mes });
    await loadPeriodos();
  };

  const saveAperturaBase = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', 'apertura', {
        nombre_estudio: nombreEstudio,
        subtitulo_estudio: subtituloEstudio,
        datos_contacto_estudio: contactoEstudio,
        fecha_inicio: fechaInicio,
        efectivo: parseLocalAmount(efInicial),
        banco: parseLocalAmount(bcoInicial),
      });
      await loadApertura();
      onDataChanged();
      alert('Configuración y caja inicial actualizadas.');
    } catch (ex: any) {
      alert(ex.message || 'Error al guardar apertura');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async (simular: boolean) => {
    if (!textoExcel.trim()) return;
    setBusy(true);
    try {
      const res = await api<any>('POST', 'apertura/importar', {
        texto: textoExcel,
        simular,
      });
      if (simular) {
        setPreview(res);
      } else {
        setPreview(null);
        setTextoExcel('');
        await loadApertura();
        onDataChanged();
        alert(
          `Importación completada: ${res.creados.length} clientes nuevos, ${res.actualizados.length} actualizados. Total saldos: ${fmtARS(res.total)}`,
        );
      }
    } catch (ex: any) {
      alert(ex.message || 'Error al procesar datos');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('POST', 'auth/password', { actual: passActual, nueva: passNueva });
      setPassActual('');
      setPassNueva('');
      alert('Contraseña actualizada correctamente.');
    } catch (ex: any) {
      alert(ex.message || 'No se pudo cambiar la contraseña');
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('POST', 'usuarios', newUser);
      setNewUser({ nombre: '', email: '', password: '', rol: 'operador' });
      await loadUsuarios();
    } catch (ex: any) {
      alert(ex.message || 'No se pudo crear el usuario');
    }
  };

  return (
    <div className="space-y-3">
      {/* Subnavegación */}
      <div className="flex flex-wrap gap-1.5 rounded border border-slate-200 bg-white p-2">
        <button
          type="button"
          onClick={() => setTab('PERIODOS')}
          className={`rounded px-3 py-1.5 text-xs font-semibold ${
            tab === 'PERIODOS'
              ? 'bg-[#0F172A] text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Períodos y Cierre Mensual / Anual
        </button>
        <button
          type="button"
          onClick={() => setTab('APERTURA')}
          className={`rounded px-3 py-1.5 text-xs font-semibold ${
            tab === 'APERTURA'
              ? 'bg-[#0F172A] text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Apertura e Importar Saldos Excel
        </button>
        <button
          type="button"
          onClick={() => setTab('ARCA')}
          className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold ${
            tab === 'ARCA'
              ? 'bg-[#0F172A] text-white'
              : 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Facturación Electrónica ARCA
        </button>
        <button
          type="button"
          onClick={() => setTab('USUARIOS')}
          className={`rounded px-3 py-1.5 text-xs font-semibold ${
            tab === 'USUARIOS'
              ? 'bg-[#0F172A] text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Usuarios y Seguridad
        </button>
      </div>

      {/* TAB 1: PERIODOS */}
      {tab === 'PERIODOS' && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-900">Control de Períodos Contables</h3>
            <p className="text-xs text-slate-500">
              Cada mes inicia su vista de caja en $0,00 mientras las cuentas corrientes de clientes arrastran su saldo continuamente mes a mes y año a año.
            </p>
          </div>
          <table className="ledger-table">
            <thead>
              <tr>
                <th className="text-left">Período</th>
                <th className="text-center">Movimientos</th>
                <th className="text-right">Entradas Mes</th>
                <th className="text-right">Salidas Mes</th>
                <th className="text-right">Caja Real Acum.</th>
                <th className="text-right">Total Clientes</th>
                <th className="text-center">Estado</th>
                {isAdmin && <th className="text-right">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <tr key={`${p.anio}-${p.mes}`}>
                  <td className="text-xs font-bold text-slate-900">{p.nombre}</td>
                  <td className="num text-center text-xs text-slate-600">{p.cantidad}</td>
                  <td className="num text-right text-xs text-[#15803D]">{fmtARS(p.entradas)}</td>
                  <td className="num text-right text-xs text-[#DC2626]">{fmtARS(p.salidas)}</td>
                  <td className="num text-right text-xs font-semibold">{fmtARS(p.caja_fin)}</td>
                  <td className="num text-right text-xs font-semibold">{fmtARS(p.clientes_fin)}</td>
                  <td className="text-center">
                    {p.cerrado ? (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                        <Lock className="h-3 w-3" /> CERRADO
                      </span>
                    ) : (
                      <span className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                        ABIERTO
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => togglePeriodo(p)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        {p.cerrado ? (
                          <>
                            <LockOpen className="h-3 w-3" /> Reabrir
                          </>
                        ) : (
                          <>
                            <Lock className="h-3 w-3" />{' '}
                            {p.mes === 12 ? 'Cerrar Año' : 'Cerrar Mes'}
                          </>
                        )}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: APERTURA E IMPORTADOR */}
      {tab === 'APERTURA' && (
        <div className="space-y-4">
          <form
            onSubmit={saveAperturaBase}
            className="grid grid-cols-1 gap-3 rounded border border-slate-200 bg-white p-4 md:grid-cols-12 md:items-end"
          >
            <div className="md:col-span-4">
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Nombre del Estudio (Membrete Recibos)
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={nombreEstudio}
                onChange={(e) => setNombreEstudio(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <div className="md:col-span-4">
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Subtítulo / Profesional en Recibos (opcional)
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={subtituloEstudio}
                onChange={(e) => setSubtituloEstudio(e.target.value)}
                placeholder="Ej: Asesoramiento Contable e Impositivo"
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <div className="md:col-span-4">
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Dirección / Teléfono en Recibos (opcional)
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={contactoEstudio}
                onChange={(e) => setContactoEstudio(e.target.value)}
                placeholder="Ej: San Martín 123 · Tel: 381-..."
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Inicio Operativo (día 01)
              </label>
              <input
                type="date"
                disabled={!isAdmin}
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="num h-9 w-full rounded border border-slate-300 px-2 text-xs"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Efectivo Inicial ($)
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={efInicial}
                onChange={(e) => setEfInicial(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2 text-right text-sm"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Banco Inicial ($)
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={bcoInicial}
                onChange={(e) => setBcoInicial(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2 text-right text-sm"
              />
            </div>
            {isAdmin && (
              <div className="md:col-span-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="h-9 w-full rounded bg-[#0F172A] px-3 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
                >
                  Guardar Base y Membrete
                </button>
              </div>
            )}
          </form>

          {isAdmin && (
            <div className="space-y-3 rounded border border-slate-300 bg-white p-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Importador Rápido de Saldos Iniciales desde Excel
                </h3>
                <p className="text-xs text-slate-500">
                  Copiá y pegá directamente las 2 o 3 columnas finales de tu Excel:{' '}
                  <code className="rounded bg-slate-100 px-1 font-mono">
                    CLIENTE &nbsp;|&nbsp; SALDO &nbsp;|&nbsp; NOTA DE REVISIÓN
                  </code>{' '}
                  (acepta saldos negativos en rojo como <code className="font-mono">-21.596,14</code> o{' '}
                  <code className="font-mono">- 21,596.14</code>). Se registran al corte{' '}
                  <strong>{fmtDate(ap?.fecha_apertura)}</strong>.
                </p>
              </div>

              <textarea
                rows={6}
                value={textoExcel}
                onChange={(e) => setTextoExcel(e.target.value)}
                placeholder={
                  'ACOSTA JORGE\t-21596,14\tVER Y REVISAR GRUPO\nBIGLIARDO JUAN\t176930,56\nARAOZ JESSICA\t-25485,20\tDIF POR SEOC'
                }
                className="num w-full rounded border border-slate-300 p-2.5 text-xs"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !textoExcel.trim()}
                  onClick={() => runImport(true)}
                  className="rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-50"
                >
                  1. Previsualizar lectura
                </button>
                <button
                  type="button"
                  disabled={busy || !textoExcel.trim()}
                  onClick={() => runImport(false)}
                  className="inline-flex items-center gap-1.5 rounded bg-[#0F172A] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1E3A8A] disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" /> 2. Importar y aplicar saldos
                </button>
              </div>

              {preview && (
                <div className="space-y-2 rounded border border-blue-200 bg-blue-50/50 p-3 text-xs">
                  <div className="flex flex-wrap gap-4 font-semibold">
                    <span>Filas leídas: {preview.filas.length}</span>
                    <span>Clientes nuevos: {preview.creados.length}</span>
                    <span>Existentes a actualizar: {preview.actualizados.length}</span>
                    <span className="num">Suma total: {fmtARS(preview.total)}</span>
                  </div>
                  {preview.errores.length > 0 && (
                    <div className="rounded bg-red-100 p-2 text-red-800">
                      {preview.errores.map((er, i) => (
                        <div key={i}>{er}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tabla de saldos iniciales actualmente cargados */}
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs">
              <span className="font-bold uppercase text-slate-600">
                Saldos Iniciales Cargados al {fmtDate(ap?.fecha_apertura)} (
                {ap?.clientes.length || 0} con saldo ≠ $0)
              </span>
              <span className="num font-bold text-slate-900">
                Total apertura clientes: {fmtARS(ap?.total_clientes)}
              </span>
            </div>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th className="text-left">Cliente</th>
                  <th className="text-right">Saldo Inicial</th>
                  <th className="text-left">Nota</th>
                </tr>
              </thead>
              <tbody>
                {(ap?.clientes || []).map((c) => (
                  <tr key={c.id}>
                    <td className="text-xs font-semibold">{c.nombre}</td>
                    <td
                      className={`num text-right text-xs font-bold ${
                        c.saldo < 0 ? 'text-[#DC2626]' : 'text-[#15803D]'
                      }`}
                    >
                      {fmtARS(c.saldo)}
                    </td>
                    <td className="text-xs text-amber-800">{c.nota_revision || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: FACTURACION ELECTRONICA ARCA */}
      {tab === 'ARCA' && (
        <div className="space-y-4">
          {/* Estado general del certificado y Web Service */}
          <div
            className={`rounded border p-3.5 text-xs ${
              arcaCfg?.configurado
                ? 'border-emerald-300 bg-emerald-50/80 text-emerald-950'
                : 'border-amber-300 bg-amber-50/80 text-amber-950'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {arcaCfg?.configurado ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                )}
                <div>
                  <div className="font-bold">
                    {arcaCfg?.configurado
                      ? `Web Service ARCA Configurado (${arcaCfg.entorno === 'produccion' ? 'PRODUCCIÓN FISCAL' : 'HOMOLOGACIÓN / PRUEBAS'})`
                      : 'Configuración ARCA pendiente de completar'}
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-90">
                    {arcaCfg?.cert_info?.valido ? (
                      <>
                        Certificado digital: <strong>{arcaCfg.cert_info.serial_subject || arcaCfg.cert_info.cn}</strong>
                        {arcaCfg.cert_info.valido_hasta && (
                          <> · Vence: <strong>{arcaCfg.cert_info.valido_hasta.slice(0, 10)}</strong> ({arcaCfg.cert_info.dias_restantes} días)</>
                        )}
                        {arcaCfg.cert_info.coincide_clave === false && (
                          <strong className="ml-2 text-[#DC2626]">
                            · ¡No coincide con la Clave Privada!
                          </strong>
                        )}
                      </>
                    ) : (
                      <>
                        Clave Privada (.key):{' '}
                        <strong>{arcaCfg?.tiene_key ? 'Cargada ✓' : 'Pendiente'}</strong> ·
                        Certificado (.crt):{' '}
                        <strong>{arcaCfg?.tiene_cert ? 'Cargado ✓' : 'Pendiente'}</strong>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {isAdmin && (
                <button
                  type="button"
                  disabled={arcaTesting}
                  onClick={handleProbarArca}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 shadow-2xs hover:bg-slate-100 disabled:opacity-50"
                >
                  {arcaTesting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1E3A8A]" />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5 text-[#1E3A8A]" />
                  )}
                  {arcaTesting ? 'Probando WSAA + WSFEv1...' : 'Probar Conexión con ARCA'}
                </button>
              )}
            </div>
          </div>

          {arcaMsg && (
            <div
              role="status"
              className={`rounded border px-3.5 py-2.5 text-xs font-medium ${
                arcaMsg.ok
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {arcaMsg.text}
            </div>
          )}

          <form
            onSubmit={saveArcaConfig}
            className="space-y-4 rounded border border-slate-200 bg-white p-4"
          >
            <div className="border-b border-slate-200 pb-2.5">
              <h3 className="text-sm font-bold text-slate-900">
                1. Datos Fiscales del Emisor (Responsable Inscripto — Factura A y B)
              </h3>
              <p className="text-xs text-slate-500">
                Solo se ofrecerá el botón <strong>Facturar ARCA</strong> en los cobros de{' '}
                <strong>HONORARIOS</strong> ingresados por <strong>Transferencia</strong>, de manera manual en los que usted elija.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                  Entorno ARCA
                </label>
                <select
                  disabled={!isAdmin}
                  value={arcaEntorno}
                  onChange={(e) =>
                    setArcaEntorno(e.target.value as 'homologacion' | 'produccion')
                  }
                  className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-bold"
                >
                  <option value="homologacion">Homologación (Pruebas)</option>
                  <option value="produccion">Producción (Validez Fiscal Real)</option>
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="mb-0.5 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>CUIT del Emisor *</span>
                  {cleanDigits(arcaCuit).length === 11 && isValidCuitAR(arcaCuit) && (
                    <span className="text-[10px] font-bold text-[#15803D]">
                      {formatCuitDisplay(arcaCuit)} ✓
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={arcaCuit}
                  onChange={(e) => setArcaCuit(e.target.value)}
                  placeholder="Ej: 27284567893"
                  className="num h-9 w-full rounded border border-slate-300 px-2.5 text-sm font-semibold"
                />
              </div>

              <div className="md:col-span-4">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                  Razón Social / Titular en Factura *
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={arcaRazon}
                  onChange={(e) => setArcaRazon(e.target.value)}
                  placeholder="Apellido y Nombre o Razón Social"
                  className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm uppercase"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                  Pto. Venta WS *
                </label>
                <input
                  type="number"
                  min={1}
                  max={99999}
                  disabled={!isAdmin}
                  value={arcaPtoVta}
                  onChange={(e) => setArcaPtoVta(e.target.value)}
                  className="num h-9 w-full rounded border border-slate-300 px-2.5 text-sm font-bold"
                />
              </div>

              <div className="md:col-span-6">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                  Domicilio Comercial (impreso en Factura PDF)
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={arcaDomicilio}
                  onChange={(e) => setArcaDomicilio(e.target.value)}
                  placeholder="Ej: San Martín 450 - San Miguel de Tucumán"
                  className="h-9 w-full rounded border border-slate-300 px-2.5 text-xs"
                />
              </div>

              <div className="md:col-span-3">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                  Nº Ingresos Brutos
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={arcaIibb}
                  onChange={(e) => setArcaIibb(e.target.value)}
                  placeholder="Ej: 924-..."
                  className="num h-9 w-full rounded border border-slate-300 px-2.5 text-xs"
                />
              </div>

              <div className="md:col-span-3">
                <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                  Inicio de Actividades
                </label>
                <input
                  type="date"
                  disabled={!isAdmin}
                  value={arcaInicioAct}
                  onChange={(e) => setArcaInicioAct(e.target.value)}
                  className="num h-9 w-full rounded border border-slate-300 px-2 text-xs"
                />
              </div>
            </div>

            {isAdmin && (
              <>
                <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 lg:grid-cols-12">
                  {/* Paso A: Generar CSR */}
                  <div className="space-y-2.5 rounded border border-slate-200 bg-slate-50 p-3.5 lg:col-span-5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      <FileKey2 className="h-4 w-4 text-[#1E3A8A]" />
                      2. Generar Solicitud de Certificado (.csr)
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-600">
                      Si todavía no tiene certificado para Web Services, haga clic abajo: el sistema genera y guarda automáticamente la Clave Privada RSA 2048 y descarga el archivo <code>.csr</code> listo para subir en ARCA.
                    </p>
                    <button
                      type="button"
                      disabled={arcaBusy}
                      onClick={handleGenerarCsr}
                      className="inline-flex items-center gap-1.5 rounded border border-[#1E3A8A] bg-white px-3 py-1.5 text-xs font-bold text-[#1E3A8A] hover:bg-blue-50 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Generar Clave + Descargar .CSR
                    </button>
                    <ol className="list-decimal space-y-1 pl-4 text-[11px] text-slate-600">
                      <li>
                        En ARCA ingrese a <strong>Administración de Certificados Digitales</strong> (o WSASS si prueba Homologación), agregue alias y suba el <code>.csr</code> para descargar su <code>.crt</code>.
                      </li>
                      <li>
                        En <strong>Administrador de Relaciones</strong> → Nueva Relación → ARCA → WebServices → <strong>Facturación Electrónica</strong> y asócielo al computador fiscal creado.
                      </li>
                      <li>
                        Verifique tener habilitado un Punto de Venta tipo <strong>RECE / Web Services</strong> (distinto al de Comprobantes en Línea).
                      </li>
                    </ol>
                  </div>

                  {/* Paso B: Subir .crt (y .key opcional) */}
                  <div className="space-y-2.5 rounded border border-slate-200 bg-slate-50 p-3.5 lg:col-span-7">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        3. Cargar Certificado Digital devuelto por ARCA (.crt)
                      </span>
                      <label className="cursor-pointer rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100">
                        Seleccionar archivo .crt
                        <input
                          type="file"
                          accept=".crt,.cer,.pem,.txt"
                          className="hidden"
                          onChange={(e) => readPemFile(e.target.files?.[0], setArcaCertDraft)}
                        />
                      </label>
                    </div>
                    <textarea
                      rows={4}
                      value={arcaCertDraft}
                      onChange={(e) => setArcaCertDraft(e.target.value)}
                      placeholder={
                        arcaCfg?.tiene_cert
                          ? 'Certificado .crt ya guardado en base de datos. Pegue o seleccione uno nuevo solo si desea reemplazarlo...'
                          : '-----BEGIN CERTIFICATE-----\nPegue aquí el contenido de su archivo .crt descargado de ARCA...\n-----END CERTIFICATE-----'
                      }
                      className="num w-full rounded border border-slate-300 bg-white p-2 text-[11px]"
                    />

                    <div>
                      <button
                        type="button"
                        onClick={() => setShowKeyManual((s) => !s)}
                        className="text-[11px] font-semibold text-[#1E3A8A] hover:underline"
                      >
                        {showKeyManual
                          ? 'Ocultar carga manual de Clave Privada (.key)'
                          : '¿Generó el certificado fuera del sistema? Subir Clave Privada (.key) propia'}
                      </button>

                      {showKeyManual && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex justify-end">
                            <label className="cursor-pointer rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100">
                              Seleccionar archivo .key
                              <input
                                type="file"
                                accept=".key,.pem,.txt"
                                className="hidden"
                                onChange={(e) => readPemFile(e.target.files?.[0], setArcaKeyDraft)}
                              />
                            </label>
                          </div>
                          <textarea
                            rows={3}
                            value={arcaKeyDraft}
                            onChange={(e) => setArcaKeyDraft(e.target.value)}
                            placeholder="-----BEGIN PRIVATE KEY----- ..."
                            className="num w-full rounded border border-slate-300 bg-white p-2 text-[11px]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-slate-200 pt-3">
                  <button
                    type="submit"
                    disabled={arcaBusy}
                    className="inline-flex items-center gap-1.5 rounded bg-[#0F172A] px-5 py-2 text-xs font-bold text-white hover:bg-[#1E3A8A] disabled:opacity-50"
                  >
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    {arcaBusy ? 'Guardando...' : 'Guardar Configuración ARCA'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}

      {/* TAB 4: USUARIOS Y CONTRASEÑA */}
      {tab === 'USUARIOS' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <form
            onSubmit={changePassword}
            className="space-y-3 rounded border border-slate-200 bg-white p-4 lg:col-span-5"
          >
            <h3 className="text-sm font-bold text-slate-900">Cambiar mi contraseña</h3>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Contraseña actual
              </label>
              <input
                type="password"
                required
                value={passActual}
                onChange={(e) => setPassActual(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Nueva contraseña (mín. 8 caracteres)
              </label>
              <input
                type="password"
                minLength={8}
                required
                value={passNueva}
                onChange={(e) => setPassNueva(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
            >
              Actualizar contraseña
            </button>
          </form>

          {isAdmin && (
            <div className="space-y-3 rounded border border-slate-200 bg-white p-4 lg:col-span-7">
              <h3 className="text-sm font-bold text-slate-900">Usuarios del Estudio</h3>
              <form onSubmit={createUser} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <input
                  type="text"
                  required
                  placeholder="Nombre"
                  value={newUser.nombre}
                  onChange={(e) => setNewUser({ ...newUser, nombre: e.target.value })}
                  className="h-9 rounded border border-slate-300 px-2.5 text-xs"
                />
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="h-9 rounded border border-slate-300 px-2.5 text-xs"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Clave inicial (8+)"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="h-9 rounded border border-slate-300 px-2.5 text-xs"
                />
                <div className="flex gap-1.5">
                  <select
                    value={newUser.rol}
                    onChange={(e) =>
                      setNewUser({ ...newUser, rol: e.target.value as 'admin' | 'operador' })
                    }
                    className="h-9 flex-1 rounded border border-slate-300 px-2 text-xs"
                  >
                    <option value="operador">Operador</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1 rounded bg-[#0F172A] px-3 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Crear
                  </button>
                </div>
              </form>

              <table className="ledger-table">
                <thead>
                  <tr>
                    <th className="text-left">Nombre</th>
                    <th className="text-left">Email</th>
                    <th className="text-left">Rol</th>
                    <th className="text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id}>
                      <td className="text-xs font-semibold">{u.nombre}</td>
                      <td className="text-xs text-slate-600">{u.email}</td>
                      <td className="text-xs uppercase">{u.rol}</td>
                      <td className="text-center text-xs">
                        {u.activo ? 'Activo' : 'Desactivado'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

