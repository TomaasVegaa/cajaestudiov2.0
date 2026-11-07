import React, { useCallback, useEffect, useState } from 'react';
import { Lock, LockOpen, Upload, UserPlus } from 'lucide-react';
import { api, fmtARS, fmtDate, parseLocalAmount, PeriodoItem, User } from '../lib/api';

interface Props {
  user: User;
  onDataChanged: () => void;
}

interface AperturaData {
  fecha_inicio: string;
  fecha_apertura: string;
  nombre_estudio: string;
  efectivo: number;
  banco: number;
  clientes: { id: number; nombre: string; nota_revision?: string | null; saldo: number }[];
  total_clientes: number;
}

export function ConfigView({ user, onDataChanged }: Props) {
  const isAdmin = user.rol === 'admin';
  const [tab, setTab] = useState<'PERIODOS' | 'APERTURA' | 'USUARIOS'>('PERIODOS');

  // Períodos
  const [periodos, setPeriodos] = useState<PeriodoItem[]>([]);

  // Apertura e importador Excel
  const [ap, setAp] = useState<AperturaData | null>(null);
  const [nombreEstudio, setNombreEstudio] = useState('');
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
    setFechaInicio(res.fecha_inicio || '2026-11-01');
    setEfInicial(res.efectivo ? String(res.efectivo) : '');
    setBcoInicial(res.banco ? String(res.banco) : '');
  }, []);

  const loadUsuarios = useCallback(async () => {
    if (!isAdmin) return;
    const res = await api<any[]>('GET', 'usuarios');
    setUsuarios(res);
  }, [isAdmin]);

  useEffect(() => {
    if (tab === 'PERIODOS') loadPeriodos();
    if (tab === 'APERTURA') loadApertura();
    if (tab === 'USUARIOS') loadUsuarios();
  }, [tab, loadPeriodos, loadApertura, loadUsuarios]);

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
                Nombre del Estudio
              </label>
              <input
                type="text"
                disabled={!isAdmin}
                value={nombreEstudio}
                onChange={(e) => setNombreEstudio(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <div className="md:col-span-2">
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
            <div className="md:col-span-2">
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
            <div className="md:col-span-2">
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
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="h-9 w-full rounded bg-[#0F172A] px-3 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
                >
                  Guardar Base
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

      {/* TAB 3: USUARIOS Y CONTRASEÑA */}
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

