import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  FileSpreadsheet,
  FileText,
  Pencil,
  Plus,
  Printer,
  Search,
  Share2,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  api,
  AppConfig,
  Cliente,
  ClienteSaldo,
  CondicionIvaKey,
  estadoSaldoLabel,
  EstadoCuentaResponse,
  exportUrl,
  fmtARS,
  fmtDate,
  User,
} from '../lib/api';
import { FacturaArcaModal } from '../components/FacturaArcaModal';
import { ReciboModal, ReciboSeed } from '../components/ReciboModal';

interface Props {
  user?: User | null;
  config?: AppConfig | null;
  hoy: string;
  selectedId: number | null;
  onSelectId: (id: number | null) => void;
  onCargarParaCliente: (clienteId: number) => void;
  onClientesChanged: () => void;
  onGoToConfigArca?: () => void;
}

type FiltroSaldo = 'TODOS' | 'ROJO' | 'FAVOR' | 'NOTA' | 'CERO';

const COND_IVA_SHORT: Record<CondicionIvaKey, string> = {
  RI: 'Resp. Inscripto (FC A)',
  MONOTRIBUTO: 'Monotributo (FC A)',
  EXENTO: 'IVA Exento (FC B)',
  CF: 'Consumidor Final (FC B)',
};

export function ClientesView({
  user,
  config,
  hoy,
  selectedId,
  onSelectId,
  onCargarParaCliente,
  onClientesChanged,
  onGoToConfigArca,
}: Props) {
  // Directorio
  const [fechaCorte, setFechaCorte] = useState(hoy);
  const [padron, setPadron] = useState<ClienteSaldo[]>([]);
  const [totales, setTotales] = useState({ total: 0, a_favor: 0, en_rojo: 0, cant_rojo: 0 });
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<FiltroSaldo>('TODOS');
  const [editingNotaId, setEditingNotaId] = useState<number | null>(null);
  const [notaDraft, setNotaDraft] = useState('');

  // Modal crear/editar cliente
  const [modalCliente, setModalCliente] = useState<{
    id?: number;
    nombre: string;
    cuit: string;
    condicion_iva: '' | CondicionIvaKey;
    domicilio: string;
    telefono: string;
    nota_revision: string;
    aliases: string;
  } | null>(null);

  // Detalle / Estado de cuenta
  const [desde, setDesde] = useState(`${hoy.slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(hoy);
  const [estado, setEstado] = useState<EstadoCuentaResponse | null>(null);
  const [loadingEstado, setLoadingEstado] = useState(false);
  const [tabDet, setTabDet] = useState<'CTA_CTE' | 'HONORARIOS' | 'TODO'>('CTA_CTE');
  const [copied, setCopied] = useState(false);
  const [reciboSeed, setReciboSeed] = useState<ReciboSeed | null>(null);
  const [facturaMovId, setFacturaMovId] = useState<number | null>(null);

  const loadPadron = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{
        clientes: ClienteSaldo[];
        totales: { total: number; a_favor: number; en_rojo: number; cant_rojo: number };
      }>('GET', `clientes/saldos?fecha=${encodeURIComponent(fechaCorte)}`);
      setPadron(res.clientes);
      setTotales(res.totales);
    } finally {
      setLoading(false);
    }
  }, [fechaCorte]);

  useEffect(() => {
    if (!selectedId) loadPadron();
  }, [selectedId, loadPadron]);

  const loadEstado = useCallback(async () => {
    if (!selectedId) return;
    setLoadingEstado(true);
    try {
      const res = await api<EstadoCuentaResponse>(
        'GET',
        `clientes/${selectedId}/estado-cuenta?desde=${desde}&hasta=${hasta}`,
      );
      setEstado(res);
    } finally {
      setLoadingEstado(false);
    }
  }, [selectedId, desde, hasta]);

  useEffect(() => {
    if (selectedId) loadEstado();
  }, [selectedId, loadEstado]);

  const saveNota = async (id: number, nota: string) => {
    await api('PATCH', `clientes/${id}/nota`, { nota });
    setEditingNotaId(null);
    if (selectedId === id) {
      loadEstado();
    } else {
      setPadron((prev) =>
        prev.map((c) => (c.id === id ? { ...c, nota_revision: nota || null } : c)),
      );
    }
    onClientesChanged();
  };

  const saveModalCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalCliente) return;
    const payload = {
      nombre: modalCliente.nombre,
      cuit: modalCliente.cuit || null,
      condicion_iva: modalCliente.condicion_iva || null,
      domicilio: modalCliente.domicilio || null,
      telefono: modalCliente.telefono || null,
      nota_revision: modalCliente.nota_revision || null,
      aliases: modalCliente.aliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      if (modalCliente.id) {
        await api('PUT', `clientes/${modalCliente.id}`, payload);
      } else {
        await api<Cliente>('POST', 'clientes', payload);
      }
      setModalCliente(null);
      onClientesChanged();
      if (selectedId) loadEstado();
      else loadPadron();
    } catch (ex: any) {
      alert(ex.message || 'No se pudo guardar el cliente');
    }
  };

  const filtrados = useMemo(() => {
    const term = q.trim().toUpperCase();
    return padron.filter((c) => {
      if (
        term &&
        !c.nombre.toUpperCase().includes(term) &&
        !(c.nota_revision || '').toUpperCase().includes(term)
      ) {
        return false;
      }
      if (filtro === 'ROJO') return c.saldo < -0.005;
      if (filtro === 'FAVOR') return c.saldo > 0.005;
      if (filtro === 'NOTA') return Boolean(c.nota_revision);
      if (filtro === 'CERO') return Math.abs(c.saldo) <= 0.005;
      return true;
    });
  }, [padron, q, filtro]);

  // ---------- VISTA FICHA DEL CLIENTE ----------
  if (selectedId) {
    const movsVisibles = (estado?.movimientos || []).filter((m) => {
      if (tabDet === 'CTA_CTE') return m.afecta_cliente;
      if (tabDet === 'HONORARIOS') return m.tipo_valor === 'HONORARIOS';
      return true;
    });

    const buildWhatsappText = () => {
      if (!estado) return '';
      const lines = [
        `*ESTADO DE CUENTA — ${estado.cliente.nombre}*`,
        `Período: ${fmtDate(estado.desde)} al ${fmtDate(estado.hasta)}`,
        `Saldo anterior: ${fmtARS(estado.saldo_anterior)}`,
        `Entregas: +${fmtARS(estado.totales.entregas)}`,
        `Impuestos pagados: -${fmtARS(estado.totales.impuestos)}`,
      ];
      if (estado.totales.utiles > 0) lines.push(`Gastos útiles: -${fmtARS(estado.totales.utiles)}`);
      if (estado.totales.honorarios_saldo > 0)
        lines.push(`Honorarios desc. saldo: -${fmtARS(estado.totales.honorarios_saldo)}`);
      lines.push(
        `*SALDO (${estadoSaldoLabel(estado.saldo_final).toUpperCase()}): ${fmtARS(estado.saldo_final)}*`,
      );
      return lines.join('\n');
    };

    const copyWhatsapp = async () => {
      await navigator.clipboard.writeText(buildWhatsappText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    };

    const openWhatsappLink = () => {
      const txt = encodeURIComponent(buildWhatsappText());
      const phone = (estado?.cliente.telefono || '').replace(/\D/g, '');
      window.open(
        phone ? `https://wa.me/${phone}?text=${txt}` : `https://wa.me/?text=${txt}`,
        '_blank',
      );
    };

    return (
      <div className="print-full space-y-3">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectId(null)}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Volver al directorio de saldos
          </button>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onCargarParaCliente(selectedId)}
              className="inline-flex items-center gap-1 rounded bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
            >
              <Plus className="h-3.5 w-3.5" /> Cargar movimiento
            </button>
            <button
              type="button"
              onClick={copyWhatsapp}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <Copy className="h-3.5 w-3.5" /> {copied ? 'Copiado' : 'Copiar resumen'}
            </button>
            <button
              type="button"
              onClick={openWhatsappLink}
              className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Share2 className="h-3.5 w-3.5" /> WhatsApp
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
            </button>
          </div>
        </div>

        {estado && (
          <div className="rounded border border-slate-300 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{estado.cliente.nombre}</h2>
                  <button
                    type="button"
                    onClick={() =>
                      setModalCliente({
                        id: estado.cliente.id,
                        nombre: estado.cliente.nombre,
                        cuit: estado.cliente.cuit || '',
                        condicion_iva: estado.cliente.condicion_iva || '',
                        domicilio: estado.cliente.domicilio || '',
                        telefono: estado.cliente.telefono || '',
                        nota_revision: estado.cliente.nota_revision || '',
                        aliases: (estado.cliente.aliases || []).join(', '),
                      })
                    }
                    className="no-print rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                    title="Editar datos fiscales, teléfono y alias del cliente"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>
                    Período consultado: <strong className="num">{fmtDate(estado.desde)}</strong> al{' '}
                    <strong className="num">{fmtDate(estado.hasta)}</strong>
                  </span>
                  <span>· Emitido: {fmtDate(hoy)}</span>
                  {estado.cliente.cuit && <span className="num">· CUIT: {estado.cliente.cuit}</span>}
                  {estado.cliente.condicion_iva && (
                    <span className="font-medium text-slate-700">
                      · {COND_IVA_SHORT[estado.cliente.condicion_iva]}
                    </span>
                  )}
                  {estado.cliente.telefono && (
                    <span className="num">· Tel: {estado.cliente.telefono}</span>
                  )}
                </div>
              </div>

              <div className="no-print w-full sm:w-80">
                <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  Nota de Revisión (ej. DIF POR SEOC)
                </label>
                <input
                  type="text"
                  defaultValue={estado.cliente.nota_revision || ''}
                  key={estado.cliente.nota_revision || 'empty'}
                  placeholder="Sin nota de revisión..."
                  onBlur={(e) => {
                    if (e.target.value !== (estado.cliente.nota_revision || '')) {
                      saveNota(estado.cliente.id, e.target.value);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  className="h-8 w-full rounded border border-amber-300 bg-amber-50/60 px-2.5 text-xs font-medium text-amber-950 placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[11px] font-medium text-slate-500">
                  Saldo Anterior ({fmtDate(estado.desde)})
                </div>
                <div
                  className={`num mt-0.5 text-sm font-bold ${
                    estado.saldo_anterior < 0 ? 'text-[#DC2626]' : 'text-slate-900'
                  }`}
                >
                  {fmtARS(estado.saldo_anterior)}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[11px] font-medium text-slate-500">+ Entregado Impuestos</div>
                <div className="num mt-0.5 text-sm font-bold text-[#15803D]">
                  {fmtARS(estado.totales.entregas)}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[11px] font-medium text-slate-500">- Impuestos Pagados</div>
                <div className="num mt-0.5 text-sm font-bold text-[#DC2626]">
                  {fmtARS(estado.totales.impuestos)}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[11px] font-medium text-slate-500">- Útiles / Hon. Saldo</div>
                <div className="num mt-0.5 text-sm font-bold text-amber-800">
                  {fmtARS(estado.totales.utiles + estado.totales.honorarios_saldo)}
                </div>
              </div>
              <div
                className={`col-span-2 rounded border p-2.5 sm:col-span-1 ${
                  estado.saldo_final < -0.005
                    ? 'border-red-300 bg-red-50'
                    : 'border-emerald-300 bg-emerald-50/70'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  <span>Saldo al {fmtDate(estado.hasta)}</span>
                  <span>{estadoSaldoLabel(estado.saldo_final)}</span>
                </div>
                <div
                  className={`num mt-0.5 text-lg font-bold ${
                    estado.saldo_final < -0.005 ? 'text-[#DC2626]' : 'text-[#15803D]'
                  }`}
                >
                  {fmtARS(estado.saldo_final)}
                </div>
                {Math.abs(estado.saldo_hoy - estado.saldo_final) > 0.005 && (
                  <div className="num mt-0.5 text-[11px] text-slate-600">
                    Saldo hoy ({fmtDate(hoy)}): <strong>{fmtARS(estado.saldo_hoy)}</strong>
                  </div>
                )}
              </div>
            </div>

            <div className="no-print mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTabDet('CTA_CTE')}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    tabDet === 'CTA_CTE'
                      ? 'bg-[#0F172A] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Cuenta Corriente Impuestos
                </button>
                <button
                  type="button"
                  onClick={() => setTabDet('HONORARIOS')}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    tabDet === 'HONORARIOS'
                      ? 'bg-[#0F172A] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Honorarios Pagados (
                  {fmtARS(estado.totales.honorarios_directo + estado.totales.honorarios_saldo)})
                </button>
                <button
                  type="button"
                  onClick={() => setTabDet('TODO')}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    tabDet === 'TODO'
                      ? 'bg-[#0F172A] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Todos los movimientos
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">Desde</span>
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  className="num h-8 rounded border border-slate-300 px-2 text-xs"
                />
                <span className="text-slate-500">Hasta</span>
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                  className="num h-8 rounded border border-slate-300 px-2 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDesde(`${hoy.slice(0, 4)}-01-01`);
                    setHasta(hoy);
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Año actual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDesde('2020-01-01');
                    setHasta(hoy);
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Todo
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="ledger-table">
            <thead>
              <tr>
                <th className="w-24 text-left">Fecha</th>
                <th className="w-20 text-left">Medio</th>
                <th className="w-28 text-left">Concepto</th>
                <th className="text-left">Detalle (¿Qué pagó / En qué se aplicó?)</th>
                <th className="w-32 text-right">Entregó (+)</th>
                <th className="w-32 text-right">Se Aplicó (-)</th>
                <th className="w-40 text-right">Saldo Cliente</th>
                <th className="no-print w-32 text-center">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {tabDet === 'CTA_CTE' && estado && (
                <tr className="bg-slate-50 font-medium text-slate-700">
                  <td className="num text-xs">{fmtDate(estado.desde)}</td>
                  <td className="text-xs">—</td>
                  <td className="text-xs font-semibold">ARRASTRE</td>
                  <td className="text-xs">Saldo arrastrado anterior al período</td>
                  <td className="text-right text-xs">—</td>
                  <td className="text-right text-xs">—</td>
                  <td
                    className={`num text-right text-xs font-bold ${
                      estado.saldo_anterior < 0 ? 'text-[#DC2626]' : 'text-slate-900'
                    }`}
                  >
                    {fmtARS(estado.saldo_anterior)}
                  </td>
                  <td className="no-print text-center text-xs text-slate-400">—</td>
                </tr>
              )}
              {loadingEstado && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                    Cargando extracto...
                  </td>
                </tr>
              )}
              {!loadingEstado && movsVisibles.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                    Sin movimientos en este rango.
                  </td>
                </tr>
              )}
              {movsVisibles.map((m) => (
                <tr key={m.id}>
                  <td className="num whitespace-nowrap text-xs text-slate-600">
                    {fmtDate(m.fecha)}
                  </td>
                  <td className="text-xs text-slate-500">
                    {m.medio === 'BANCO' ? 'T · Transf.' : 'E · Efectivo'}
                  </td>
                  <td className="text-xs font-semibold text-slate-700">{m.tipo_valor}</td>
                  <td className="text-xs text-slate-900">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{m.detalle}</span>
                      {m.factura_arca && (
                        <button
                          type="button"
                          onClick={() => setFacturaMovId(m.id)}
                          className="num inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-[#15803D] hover:bg-emerald-100"
                          title={`CAE ${m.factura_arca.cae} · Ver o descargar Factura ${m.factura_arca.cbte_letra}`}
                        >
                          <ShieldCheck className="h-3 w-3" /> FC {m.factura_arca.cbte_letra}{' '}
                          {m.factura_arca.numero_formateado}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="num whitespace-nowrap text-right text-xs font-semibold text-[#15803D]">
                    {m.entrada > 0 ? fmtARS(m.entrada) : '—'}
                  </td>
                  <td className="num whitespace-nowrap text-right text-xs font-semibold text-[#DC2626]">
                    {m.salida > 0 ? fmtARS(m.salida) : '—'}
                  </td>
                  <td
                    className={`num whitespace-nowrap text-right text-xs font-bold ${
                      m.saldo_cliente === null || m.saldo_cliente === undefined
                        ? 'text-slate-400'
                        : m.saldo_cliente < -0.005
                          ? 'text-[#DC2626]'
                          : 'text-slate-900'
                    }`}
                  >
                    {m.saldo_cliente === null || m.saldo_cliente === undefined
                      ? 'Honorario directo'
                      : fmtARS(m.saldo_cliente)}
                  </td>
                  <td className="no-print whitespace-nowrap text-center">
                    {m.tipo_valor === 'IMPUESTOS' ? (
                      <button
                        type="button"
                        onClick={() => setReciboSeed({ movimientoId: m.id })}
                        className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50/70 px-1.5 py-0.5 text-[10px] font-semibold text-[#1E3A8A] hover:bg-blue-100"
                        title="Descargar recibo PDF o enviar por WhatsApp"
                      >
                        <FileText className="h-3 w-3" /> Recibo
                      </button>
                    ) : m.factura_arca ? (
                      <button
                        type="button"
                        onClick={() => setFacturaMovId(m.id)}
                        className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-[#15803D] hover:bg-emerald-100"
                        title="Descargar Factura Electrónica ARCA (PDF) o enviar por WhatsApp"
                      >
                        <ShieldCheck className="h-3 w-3" /> Factura
                      </button>
                    ) : m.tipo_valor === 'HONORARIOS' &&
                      m.medio === 'BANCO' &&
                      m.entrada > 0 &&
                      !estado?.cliente.es_interno ? (
                      <button
                        type="button"
                        onClick={() => setFacturaMovId(m.id)}
                        className="inline-flex items-center gap-1 rounded bg-[#0F172A] px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-[#1E3A8A]"
                        title="Emitir Factura Electrónica en ARCA para esta transferencia"
                      >
                        <ShieldCheck className="h-3 w-3 text-emerald-400" /> Facturar ARCA
                      </button>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {modalCliente && renderModalCliente()}
        {reciboSeed && (
          <ReciboModal
            seed={reciboSeed}
            config={config || null}
            operadorNombre={user?.nombre}
            onClose={() => setReciboSeed(null)}
            onClientePhoneUpdated={(_cid, tel) => {
              setEstado((prev) =>
                prev ? { ...prev, cliente: { ...prev.cliente, telefono: tel } } : prev,
              );
              onClientesChanged();
            }}
          />
        )}
        {facturaMovId !== null && (
          <FacturaArcaModal
            movimientoId={facturaMovId}
            onClose={() => setFacturaMovId(null)}
            onFacturaEmitida={() => {
              void loadEstado();
            }}
            onClienteUpdated={() => {
              void loadEstado();
              onClientesChanged();
            }}
            onGoToConfigArca={
              onGoToConfigArca
                ? () => {
                    setFacturaMovId(null);
                    onGoToConfigArca();
                  }
                : undefined
            }
          />
        )}
      </div>
    );
  }

  function renderModalCliente() {
    if (!modalCliente) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <form
          onSubmit={saveModalCliente}
          className="w-full max-w-md space-y-3 rounded border border-slate-300 bg-white p-4 shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold text-slate-900">
              {modalCliente.id ? 'Editar Cliente' : 'Nuevo Cliente'}
            </h3>
            <button
              type="button"
              onClick={() => setModalCliente(null)}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <label className="mb-0.5 block text-xs font-semibold text-slate-700">
              Apellido y Nombre / Razón Social *
            </label>
            <input
              type="text"
              required
              value={modalCliente.nombre}
              onChange={(e) => setModalCliente({ ...modalCliente, nombre: e.target.value })}
              className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm uppercase"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                CUIT / DNI
              </label>
              <input
                type="text"
                value={modalCliente.cuit}
                onChange={(e) => setModalCliente({ ...modalCliente, cuit: e.target.value })}
                placeholder="20301234567"
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-xs"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Condición IVA (ARCA)
              </label>
              <select
                value={modalCliente.condicion_iva}
                onChange={(e) =>
                  setModalCliente({
                    ...modalCliente,
                    condicion_iva: e.target.value as '' | CondicionIvaKey,
                  })
                }
                className="h-9 w-full rounded border border-slate-300 px-2 text-xs"
              >
                <option value="">Sin definir</option>
                <option value="RI">Resp. Inscripto (FC A)</option>
                <option value="MONOTRIBUTO">Monotributo (FC A)</option>
                <option value="EXENTO">IVA Exento (FC B)</option>
                <option value="CF">Consumidor Final (FC B)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Teléfono (WhatsApp)
              </label>
              <input
                type="text"
                value={modalCliente.telefono}
                onChange={(e) => setModalCliente({ ...modalCliente, telefono: e.target.value })}
                placeholder="549381..."
                className="num h-9 w-full rounded border border-slate-300 px-2.5 text-xs"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Domicilio Fiscal
              </label>
              <input
                type="text"
                value={modalCliente.domicilio}
                onChange={(e) => setModalCliente({ ...modalCliente, domicilio: e.target.value })}
                placeholder="Opcional"
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="mb-0.5 block text-xs font-semibold text-slate-700">
              Alias en Excel (separados por coma)
            </label>
            <input
              type="text"
              value={modalCliente.aliases}
              onChange={(e) => setModalCliente({ ...modalCliente, aliases: e.target.value })}
              placeholder="Ej: ORTIZ PATRICIA, ORTIZ P."
              className="h-9 w-full rounded border border-slate-300 px-2.5 text-xs uppercase"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-xs font-semibold text-slate-700">
              Nota de Revisión
            </label>
            <input
              type="text"
              value={modalCliente.nota_revision}
              onChange={(e) =>
                setModalCliente({ ...modalCliente, nota_revision: e.target.value })
              }
              placeholder="Ej: DIF POR SEOC"
              className="h-9 w-full rounded border border-slate-300 px-2.5 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={() => setModalCliente(null)}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded bg-[#0F172A] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ---------- VISTA DIRECTORIO DE SALDOS ----------
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
        <div className="rounded border border-slate-300 bg-slate-900 px-3.5 py-2.5 text-white">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            Saldo Neto Clientes
          </div>
          <div className="num mt-0.5 text-lg font-bold">{fmtARS(totales.total)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-3.5 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Saldos a Favor (Custodia)
          </div>
          <div className="num mt-0.5 text-lg font-bold text-[#15803D]">
            {fmtARS(totales.a_favor)}
          </div>
        </div>
        <div className="rounded border border-red-200 bg-red-50/50 px-3.5 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-red-800">
            Debe al Estudio ({totales.cant_rojo} en rojo)
          </div>
          <div className="num mt-0.5 text-lg font-bold text-[#DC2626]">
            {fmtARS(totales.en_rojo)}
          </div>
        </div>
        <div className="flex items-center justify-between rounded border border-slate-200 bg-white px-3.5 py-2.5">
          <div>
            <div className="text-[11px] font-medium uppercase text-slate-500">Fecha de corte</div>
            <input
              type="date"
              value={fechaCorte}
              onChange={(e) => setFechaCorte(e.target.value)}
              className="num mt-0.5 h-7 rounded border border-slate-300 px-2 text-xs font-semibold"
            />
          </div>
          <a
            href={exportUrl('export/saldos', { fecha: fechaCorte })}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white p-2.5">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente o nota de revisión..."
            className="h-9 w-full rounded border border-slate-300 pl-8 pr-3 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ['TODOS', `Todos (${padron.length})`],
              ['ROJO', `Debe al estudio (${totales.cant_rojo})`],
              ['FAVOR', 'A favor'],
              ['NOTA', 'Con nota'],
              ['CERO', 'Sin saldo'],
            ] as [FiltroSaldo, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFiltro(key)}
              className={`rounded px-2.5 py-1.5 text-xs font-semibold ${
                filtro === key
                  ? key === 'ROJO'
                    ? 'bg-[#DC2626] text-white'
                    : 'bg-[#0F172A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            setModalCliente({
              nombre: '',
              cuit: '',
              condicion_iva: '',
              domicilio: '',
              telefono: '',
              nota_revision: '',
              aliases: '',
            })
          }
          className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0F172A] px-3 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
        >
          <UserPlus className="h-3.5 w-3.5" /> Nuevo Cliente
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="ledger-table">
          <thead>
            <tr>
              <th className="text-left">Cliente</th>
              <th className="w-40 text-right">Saldo Actual</th>
              <th className="w-32 text-left">Estado</th>
              <th className="text-left">Nota de Revisión (clic para editar)</th>
              <th className="w-28 text-center">Último Mov.</th>
              <th className="w-28 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && padron.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  Calculando cuentas corrientes...
                </td>
              </tr>
            )}
            {!loading && filtrados.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  No hay clientes que coincidan con el filtro.
                </td>
              </tr>
            )}
            {filtrados.map((c) => {
              const neg = c.saldo < -0.005;
              const pos = c.saldo > 0.005;
              return (
                <tr key={c.id} className={neg ? 'bg-red-50/30' : ''}>
                  <td className="text-xs font-semibold text-slate-900">
                    <button
                      type="button"
                      onClick={() => onSelectId(c.id)}
                      className="text-left hover:text-[#1E3A8A] hover:underline"
                    >
                      {c.nombre}
                    </button>
                  </td>
                  <td
                    className={`num whitespace-nowrap text-right text-xs font-bold ${
                      neg ? 'text-[#DC2626]' : pos ? 'text-[#15803D]' : 'text-slate-400'
                    }`}
                  >
                    {fmtARS(c.saldo)}
                  </td>
                  <td>
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        neg
                          ? 'bg-red-100 text-red-800'
                          : pos
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {estadoSaldoLabel(c.saldo)}
                    </span>
                  </td>
                  <td className="text-xs">
                    {editingNotaId === c.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={notaDraft}
                        onChange={(e) => setNotaDraft(e.target.value)}
                        onBlur={() => saveNota(c.id, notaDraft)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveNota(c.id, notaDraft);
                          if (e.key === 'Escape') setEditingNotaId(null);
                        }}
                        className="h-7 w-full rounded border border-amber-400 bg-white px-2 text-xs"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNotaId(c.id);
                          setNotaDraft(c.nota_revision || '');
                        }}
                        className={`w-full rounded px-1.5 py-0.5 text-left ${
                          c.nota_revision
                            ? 'bg-amber-50 font-medium text-amber-900 hover:bg-amber-100'
                            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                        }`}
                      >
                        {c.nota_revision || '+ Agregar nota...'}
                      </button>
                    )}
                  </td>
                  <td className="num text-center text-xs text-slate-500">
                    {fmtDate(c.ultimo_mov)}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button
                      type="button"
                      onClick={() => onSelectId(c.id)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      Ver cuenta
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalCliente && renderModalCliente()}
    </div>
  );
}
