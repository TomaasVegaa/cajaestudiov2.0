import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Printer, Save } from 'lucide-react';
import { api, ArqueoRow, fmtARS, fmtDate, parseLocalAmount, TeoricoArqueo } from '../lib/api';

interface Props {
  hoy: string;
}

export function ArqueoView({ hoy }: Props) {
  const [fecha, setFecha] = useState(hoy);
  const [teo, setTeo] = useState<TeoricoArqueo | null>(null);
  const [historial, setHistorial] = useState<ArqueoRow[]>([]);
  const [tengo, setTengo] = useState('');
  const [bancoHoy, setBancoHoy] = useState('');
  const [bancoCalle, setBancoCalle] = useState('');
  const [calleErika, setCalleErika] = useState('');
  const [meDeben, setMeDeben] = useState('');
  const [otros, setOtros] = useState('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const load = useCallback(async () => {
    const [t, h] = await Promise.all([
      api<TeoricoArqueo>('GET', `arqueos/teorico?fecha=${fecha}`),
      api<ArqueoRow[]>('GET', 'arqueos'),
    ]);
    setTeo(t);
    setHistorial(h);
  }, [fecha]);

  useEffect(() => {
    load();
  }, [load]);

  const vTengo = parseLocalAmount(tengo);
  const vBanco = parseLocalAmount(bancoHoy);
  const vBancoCalle = parseLocalAmount(bancoCalle);
  const vCalleErika = parseLocalAmount(calleErika);
  const vMeDeben = parseLocalAmount(meDeben);
  const vOtros = parseLocalAmount(otros);

  const totalReal = vTengo + vBanco + vBancoCalle + vCalleErika + vMeDeben + vOtros;
  const difCaja = totalReal - (teo?.caja_total || 0);
  const difEfectivo = vTengo + vCalleErika - (teo?.teorico_efectivo || 0);
  const difBanco = vBanco + vBancoCalle - (teo?.teorico_banco || 0);

  const prefillFromLast = (row: ArqueoRow) => {
    setTengo(row.tengo ? String(row.tengo) : '');
    setBancoHoy(row.banco_hoy ? String(row.banco_hoy) : '');
    setBancoCalle(row.banco_calle ? String(row.banco_calle) : '');
    setCalleErika(row.calle_erika ? String(row.calle_erika) : '');
    setMeDeben(row.me_deben ? String(row.me_deben) : '');
    setOtros(row.otros ? String(row.otros) : '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('POST', 'arqueos', {
        fecha,
        tengo: vTengo,
        banco_hoy: vBanco,
        banco_calle: vBancoCalle,
        calle_erika: vCalleErika,
        me_deben: vMeDeben,
        otros: vOtros,
        observaciones: obs || null,
      });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 3000);
      await load();
    } catch (ex: any) {
      alert(ex.message || 'No se pudo guardar el arqueo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="print-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-4 py-2.5">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
            Cuadro de Control y Arqueo de Caja
          </h2>
          <p className="text-xs text-slate-500">
            Compara los saldos contables calculados contra la existencia física en efectivo, bancos y pendientes.
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Fecha control:</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="num h-8 rounded border border-slate-300 px-2 text-xs font-semibold"
          />
          {historial[0] && (
            <button
              type="button"
              onClick={() => prefillFromLast(historial[0])}
              className="rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Traer último recuento
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <Printer className="h-3.5 w-3.5" /> Imprimir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Columna izquierda: Saldos Contables del Sistema */}
        <div className="space-y-3 rounded border border-slate-300 bg-white p-4 lg:col-span-5">
          <h3 className="border-b border-slate-200 pb-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            1. Según Sistema (Automático al {fmtDate(fecha)})
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-600">Saldos clientes a favor (custodia)</span>
              <span className="num font-semibold text-[#15803D]">
                {fmtARS(teo?.clientes_a_favor)}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-600">
                Clientes en rojo ({teo?.cant_clientes_rojo || 0} me deben)
              </span>
              <span className="num font-semibold text-[#DC2626]">
                {fmtARS(teo?.clientes_en_rojo)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded bg-slate-100 px-2.5 py-2 font-bold text-slate-900">
              <span>TOTAL P/CONTROL (Σ Clientes)</span>
              <span className="num text-sm">{fmtARS(teo?.total_clientes)}</span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-slate-600">
                + Fondos propios estudio en caja (sin pasar a LORE)
              </span>
              <span className="num font-semibold text-slate-800">
                {fmtARS(teo?.fondos_propios)}
              </span>
            </div>

            <div className="mt-2 rounded border border-slate-800 bg-slate-900 p-3 text-white">
              <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-300">
                <span>Caja Teórica Total</span>
                <span className="num text-base font-bold text-white">
                  {fmtARS(teo?.caja_total)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-700 pt-2 text-[11px]">
                <div>
                  <span className="text-slate-400">Efectivo teórico:</span>
                  <div className="num font-semibold">{fmtARS(teo?.teorico_efectivo)}</div>
                </div>
                <div>
                  <span className="text-slate-400">Banco teórico:</span>
                  <div className="num font-semibold">{fmtARS(teo?.teorico_banco)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Columna derecha: Cuadro Físico del Estudio (TENGO, BCO HOY, CALLE...) */}
        <form
          onSubmit={handleSave}
          className="space-y-3 rounded border border-slate-300 bg-white p-4 lg:col-span-7"
        >
          <h3 className="border-b border-slate-200 pb-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            2. Recuento Real del Estudio
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-0.5 block text-xs font-bold text-slate-800">
                TENGO (Efectivo físico en caja)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={tengo}
                onChange={(e) => setTengo(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-right text-sm font-semibold"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-bold text-slate-800">
                BCO HOY (Saldo real cuenta bancaria)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={bancoHoy}
                onChange={(e) => setBancoHoy(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-right text-sm font-semibold"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                BANCO CALLE (Transf. pendientes)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={bancoCalle}
                onChange={(e) => setBancoCalle(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-right text-sm"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                CALLE ERIKA (Efectivo en tránsito)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={calleErika}
                onChange={(e) => setCalleErika(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-right text-sm"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                ME DEBEN (Fuera de cta. cte.)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={meDeben}
                onChange={(e) => setMeDeben(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-right text-sm"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                OTROS VALORES
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={otros}
                onChange={(e) => setOtros(e.target.value)}
                placeholder="0,00"
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-right text-sm"
              />
            </div>
          </div>

          {/* Resultado en vivo */}
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>TOTAL PESOS RECONTADOS</span>
              <span className="num text-base font-bold text-slate-900">{fmtARS(totalReal)}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
              <div>
                Dif. Efectivo:{' '}
                <strong className={`num ${difEfectivo < -0.01 ? 'text-[#DC2626]' : 'text-slate-700'}`}>
                  {fmtARS(difEfectivo)}
                </strong>
              </div>
              <div>
                Dif. Banco:{' '}
                <strong className={`num ${difBanco < -0.01 ? 'text-[#DC2626]' : 'text-slate-700'}`}>
                  {fmtARS(difBanco)}
                </strong>
              </div>
            </div>

            <div
              className={`mt-2.5 flex items-center justify-between rounded border px-3 py-2 ${
                Math.abs(difCaja) < 0.01
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : difCaja > 0
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-red-300 bg-red-50 text-red-900'
              }`}
            >
              <span className="text-xs font-bold uppercase tracking-wide">
                {Math.abs(difCaja) < 0.01
                  ? 'CAJA CUADRADA EXACTA'
                  : difCaja > 0
                    ? 'SOBRA EN CAJA'
                    : 'FALTANTE EN CAJA'}
              </span>
              <span className="num text-lg font-bold">{fmtARS(difCaja)}</span>
            </div>
          </div>

          <div className="no-print flex flex-wrap items-center gap-2 pt-1">
            <input
              type="text"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Observación del arqueo (opcional)..."
              className="h-9 flex-1 rounded border border-slate-300 px-2.5 text-xs"
            />
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0F172A] px-4 text-xs font-semibold text-white hover:bg-[#1E3A8A] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Guardando...' : 'Guardar Arqueo'}
            </button>
            {savedMsg && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D]">
                <CheckCircle2 className="h-4 w-4" /> Guardado
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Historial de Arqueos */}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
          Historial de Arqueos Guardados
        </div>
        <table className="ledger-table">
          <thead>
            <tr>
              <th className="text-left">Fecha</th>
              <th className="text-right">Total P/Control</th>
              <th className="text-right">Caja Teórica</th>
              <th className="text-right">Tengo (Ef.)</th>
              <th className="text-right">Banco Hoy</th>
              <th className="text-right">Calle / Deben</th>
              <th className="text-right">Diferencia</th>
              <th className="text-left">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {historial.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-xs text-slate-500">
                  Aún no hay arqueos guardados.
                </td>
              </tr>
            )}
            {historial.map((a) => {
              const calle = a.banco_calle + a.calle_erika + a.me_deben + a.otros;
              const cajaTeo = a.teorico_efectivo + a.teorico_banco;
              return (
                <tr key={a.id}>
                  <td className="num text-xs font-semibold">{fmtDate(a.fecha)}</td>
                  <td className="num text-right text-xs">{fmtARS(a.total_clientes)}</td>
                  <td className="num text-right text-xs">{fmtARS(cajaTeo)}</td>
                  <td className="num text-right text-xs">{fmtARS(a.tengo)}</td>
                  <td className="num text-right text-xs">{fmtARS(a.banco_hoy)}</td>
                  <td className="num text-right text-xs">{fmtARS(calle)}</td>
                  <td
                    className={`num text-right text-xs font-bold ${
                      a.diferencia < -0.01
                        ? 'text-[#DC2626]'
                        : a.diferencia > 0.01
                          ? 'text-amber-700'
                          : 'text-[#15803D]'
                    }`}
                  >
                    {fmtARS(a.diferencia)}
                  </td>
                  <td className="text-xs text-slate-600">{a.observaciones || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

