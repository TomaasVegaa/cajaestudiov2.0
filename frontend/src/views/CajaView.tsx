import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Link2,
  Lock,
  LockOpen,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  ApiHttpError,
  AppConfig,
  Cliente,
  COD_LABELS,
  CodConce,
  estadoSaldoLabel,
  EstadoCuentaResponse,
  exportUrl,
  fmtARS,
  fmtDate,
  fmtNum,
  Medio,
  MESES_NOMBRES,
  Movimiento,
  MovimientosResponse,
  parseStrictAmount,
  uid,
  User,
} from '../lib/api';
import { ClienteSelect } from '../components/ClienteSelect';
import { FacturaArcaModal } from '../components/FacturaArcaModal';
import { ReciboModal, ReciboSeed } from '../components/ReciboModal';
import {
  buildReciboComputed,
  downloadReciboPdf,
  openReciboWhatsapp,
} from '../lib/reciboPdf';

interface Props {
  user?: User | null;
  config?: AppConfig | null;
  hoy: string;
  clientes: Cliente[];
  onClienteCreated: (c: Cliente) => void;
  onClientePhoneUpdated?: (clienteId: number, telefono: string | null) => void;
  onClientesChanged?: () => void;
  onGoToConfigArca?: () => void;
  onOpenCliente: (clienteId: number) => void;
  preselectedClienteId?: number | null;
  onConsumePreselected?: () => void;
}

type TipoCarga = 'IMPUESTOS' | 'HONORARIOS' | 'GASTO_ESTUDIO' | 'RETIRO' | 'AJUSTE';

const TIPO_BADGE: Record<string, string> = {
  IMPUESTOS: 'bg-blue-50 text-[#1E3A8A] border-blue-200',
  HONORARIOS: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  UTILES: 'bg-amber-50 text-amber-800 border-amber-200',
  RETIRO: 'bg-slate-100 text-slate-700 border-slate-300',
  GASTO_ESTUDIO: 'bg-rose-50 text-rose-800 border-rose-200',
  AJUSTE: 'bg-purple-50 text-purple-800 border-purple-200',
  APERTURA: 'bg-slate-200 text-slate-800 border-slate-300',
};

export function CajaView({
  user,
  config,
  hoy,
  clientes,
  onClienteCreated,
  onClientePhoneUpdated,
  onClientesChanged,
  onGoToConfigArca,
  onOpenCliente,
  preselectedClienteId,
  onConsumePreselected,
}: Props) {
  const isAdmin = user?.rol === 'admin';
  const initYm = hoy.slice(0, 7).split('-').map(Number);
  const [anio, setAnio] = useState(initYm[0] || 2026);
  const [mes, setMes] = useState(initYm[1] || 11);
  const [ordenDesc, setOrdenDesc] = useState(true);
  const [reabriendo, setReabriendo] = useState(false);
  const [reciboModalSeed, setReciboModalSeed] = useState<ReciboSeed | null>(null);
  const [facturaModalMovId, setFacturaModalMovId] = useState<number | null>(null);
  const [lastRecibo, setLastRecibo] = useState<{
    cliente: Cliente;
    movimientos: Movimiento[];
  } | null>(null);
  const [lastHonorarioArca, setLastHonorarioArca] = useState<{
    cliente: Cliente;
    movimiento: Movimiento;
  } | null>(null);

  const [data, setData] = useState<MovimientosResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Filtros
  const [fCliente, setFCliente] = useState<number | null>(null);
  const [fMedio, setFMedio] = useState('');
  const [fTipo, setFTipo] = useState('');
  const [fQ, setFQ] = useState('');

  // Carga rápida (con clave de idempotencia persistente por borrador lógico)
  const clienteInputRef = useRef<HTMLInputElement>(null);
  const [idemKey, setIdemKey] = useState(() => uid());
  const [fecha, setFecha] = useState(hoy);
  const [tipo, setTipo] = useState<TipoCarga>('IMPUESTOS');
  const [cod, setCod] = useState<CodConce>('E');
  const [medio, setMedio] = useState<Medio>('EFECTIVO');
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [clienteSaldoHoy, setClienteSaldoHoy] = useState<number | null>(null);
  const [detalle, setDetalle] = useState('');
  const [entrada, setEntrada] = useState('');
  const [salida, setSalida] = useState('');
  const [showExtras, setShowExtras] = useState(false);
  const [detalleSalida, setDetalleSalida] = useState('');
  const [utiles, setUtiles] = useState('');
  const [honorariosSaldo, setHonorariosSaldo] = useState('');
  const [detalleHon, setDetalleHon] = useState('');
  const [paseLore, setPaseLore] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const [mobileSheet, setMobileSheet] = useState(false);

  // Edición inline
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    fecha: string;
    cod_conce: CodConce;
    medio: Medio;
    cliente_id: number;
    detalle: string;
    entrada: string;
    salida: string;
  } | null>(null);

  const markDraftEdited = useCallback(() => {
    setIdemKey(uid());
  }, []);

  useEffect(() => {
    if (preselectedClienteId) {
      setClienteId(preselectedClienteId);
      setIdemKey(uid());
      onConsumePreselected?.();
      setTimeout(() => clienteInputRef.current?.focus(), 60);
    }
  }, [preselectedClienteId, onConsumePreselected]);

  // Traer saldo actual del cliente seleccionado en Carga Rápida para tenerlo a la vista sin sumar a mano
  useEffect(() => {
    const cli = clientes.find((c) => c.id === clienteId);
    if (!cli || cli.es_interno) {
      setClienteSaldoHoy(null);
      return;
    }
    let cancelled = false;
    api<EstadoCuentaResponse>('GET', `clientes/${cli.id}/estado-cuenta?desde=${hoy}&hasta=${hoy}`)
      .then((r) => {
        if (!cancelled) setClienteSaldoHoy(r.saldo_hoy);
      })
      .catch(() => {
        if (!cancelled) setClienteSaldoHoy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clienteId, clientes, hoy]);

  const changePeriod = (nextY: number, nextM: number) => {
    setAnio(nextY);
    setMes(nextM);
    const targetYm = `${nextY}-${String(nextM).padStart(2, '0')}`;
    if (!fecha.startsWith(targetYm)) {
      setFecha(hoy.startsWith(targetYm) ? hoy : `${targetYm}-01`);
      markDraftEdited();
    }
  };

  const stepMonth = (delta: number) => {
    let m = mes + delta;
    let y = anio;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    changePeriod(y, m);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({
        anio: String(anio),
        mes: String(mes),
        orden: ordenDesc ? 'desc' : 'asc',
      });
      if (fCliente) qs.set('cliente_id', String(fCliente));
      if (fMedio) qs.set('medio', fMedio);
      if (fTipo) qs.set('tipo', fTipo);
      if (fQ.trim()) qs.set('q', fQ.trim());
      const res = await api<MovimientosResponse>('GET', `movimientos?${qs.toString()}`);
      setData(res);
    } catch (e: any) {
      setErr(e.message || 'Error al cargar caja');
    } finally {
      setLoading(false);
    }
  }, [anio, mes, ordenDesc, fCliente, fMedio, fTipo, fQ]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReabrirMes = async () => {
    if (reabriendo) return;
    const confirmMsg = `¿Reabrir el mes de ${MESES_NOMBRES[mes]} ${anio} para permitir cargar o modificar movimientos?`;
    if (!window.confirm(confirmMsg)) return;
    setReabriendo(true);
    setErr(null);
    try {
      await api('POST', 'periodos/reabrir', { anio, mes });
      setFlashMsg(`Mes ${MESES_NOMBRES[mes]} ${anio} reabierto. Ya podés registrar movimientos.`);
      setTimeout(() => setFlashMsg(null), 5000);
      await load();
    } catch (ex: any) {
      setErr(ex.message || 'No se pudo reabrir el período');
    } finally {
      setReabriendo(false);
    }
  };

  const handleMedioSelect = (next: Medio) => {
    setMedio(next);
    setCod(next === 'BANCO' ? 'T' : 'E');
    markDraftEdited();
  };

  const handleTipoChange = (next: TipoCarga) => {
    setTipo(next);
    if (next === 'HONORARIOS') {
      setSalida('');
    } else if (next === 'GASTO_ESTUDIO' || next === 'RETIRO') {
      setEntrada('');
    }
    markDraftEdited();
  };

  // Validaciones estrictas en vivo de los campos numéricos
  const pEntrada = useMemo(() => parseStrictAmount(entrada, { label: 'Entrada' }), [entrada]);
  const pSalida = useMemo(() => parseStrictAmount(salida, { label: 'Salida' }), [salida]);
  const pUtiles = useMemo(() => parseStrictAmount(utiles, { label: 'Útiles' }), [utiles]);
  const pHonSaldo = useMemo(
    () => parseStrictAmount(honorariosSaldo, { label: 'Honorarios desde saldo' }),
    [honorariosSaldo],
  );

  const amountErrors = useMemo(() => {
    const list: string[] = [];
    if (!pEntrada.ok && pEntrada.error) list.push(pEntrada.error);
    if (!pSalida.ok && pSalida.error) list.push(pSalida.error);
    if (tipo === 'IMPUESTOS') {
      if (!pUtiles.ok && pUtiles.error) list.push(pUtiles.error);
      if (!pHonSaldo.ok && pHonSaldo.error) list.push(pHonSaldo.error);
    }
    return list;
  }, [pEntrada, pSalida, pUtiles, pHonSaldo, tipo]);

  const previewSummary = useMemo(() => {
    if (amountErrors.length > 0) return null;
    const e = pEntrada.value;
    const s = pSalida.value;
    const u = tipo === 'IMPUESTOS' ? pUtiles.value : 0;
    const h = tipo === 'IMPUESTOS' ? pHonSaldo.value : 0;
    if (tipo === 'IMPUESTOS') {
      if (e + s + u + h === 0) return null;
      const efectoCliente = e - s - u - h;
      const retiroLore = paseLore ? u + h : 0;
      const efectoCaja = e - s - retiroLore;
      return { efectoCliente, efectoCaja };
    }
    if (tipo === 'HONORARIOS' && e > 0) {
      return { efectoCliente: null, efectoCaja: paseLore ? 0 : e };
    }
    return null;
  }, [amountErrors.length, pEntrada.value, pSalida.value, pUtiles.value, pHonSaldo.value, tipo, paseLore]);

  const submitCarga = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || data?.cerrado) return;
    if (amountErrors.length > 0) {
      setErr(amountErrors.join(' · '));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        fecha,
        cod_conce: cod,
        medio,
        cliente_id: clienteId || 0,
        tipo_valor: tipo,
        detalle,
        detalle_salida: detalleSalida,
        entrada: pEntrada.value,
        salida: pSalida.value,
        utiles: tipo === 'IMPUESTOS' ? pUtiles.value : 0,
        honorarios: tipo === 'IMPUESTOS' ? pHonSaldo.value : 0,
        detalle_honorarios: detalleHon,
        pase_lore: paseLore,
        pase_lore_utiles: paseLore,
        idempotency_key: idemKey,
      };
      const res = await api<{
        duplicado?: boolean;
        movimientos: Movimiento[];
        saldo_cliente?: number;
      }>('POST', 'movimientos/carga-rapida', payload);

      // Confirmado en servidor: renovamos clave de idempotencia y limpiamos importes
      setIdemKey(uid());
      setDetalle('');
      setDetalleSalida('');
      setEntrada('');
      setSalida('');
      setUtiles('');
      setHonorariosSaldo('');
      setDetalleHon('');
      setMobileSheet(false);

      if (res.saldo_cliente !== undefined) {
        setClienteSaldoHoy(res.saldo_cliente);
      }

      const movsImpuestos = (res.movimientos || []).filter((m) => m.tipo_valor === 'IMPUESTOS');
      const movHonBanco = (res.movimientos || []).find(
        (m) => m.tipo_valor === 'HONORARIOS' && m.medio === 'BANCO' && m.entrada > 0,
      );
      const cliSeleccionado = clientes.find((c) => c.id === clienteId);
      if (tipo === 'IMPUESTOS' && movsImpuestos.length > 0 && cliSeleccionado && !cliSeleccionado.es_interno) {
        setLastRecibo({
          cliente: cliSeleccionado,
          movimientos: movsImpuestos,
        });
        setLastHonorarioArca(null);
      } else if (tipo === 'HONORARIOS' && movHonBanco && cliSeleccionado && !cliSeleccionado.es_interno) {
        setLastRecibo(null);
        setLastHonorarioArca({
          cliente: cliSeleccionado,
          movimiento: movHonBanco,
        });
      } else {
        setLastRecibo(null);
        setLastHonorarioArca(null);
      }

      const cliMsg =
        res.saldo_cliente !== undefined
          ? ` · Saldo cliente: ${fmtARS(res.saldo_cliente)} (${estadoSaldoLabel(res.saldo_cliente)})`
          : '';
      setFlashMsg(
        `${res.duplicado ? 'Ya estaba registrado' : 'Guardado'} (${res.movimientos.length} renglón/es)${cliMsg}`,
      );
      setTimeout(() => setFlashMsg(null), 4500);

      const [fy, fm] = fecha.split('-').map(Number);
      if (fy !== anio || fm !== mes) {
        setAnio(fy);
        setMes(fm);
      } else {
        await load();
      }
      setTimeout(() => clienteInputRef.current?.focus(), 40);
    } catch (ex: any) {
      if (ex instanceof ApiHttpError && ex.status === 409) {
        await load();
      }
      setErr(ex.message || 'No se pudo registrar el movimiento');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (m: Movimiento) => {
    if (data?.cerrado || m.tipo_valor === 'APERTURA' || m.movimiento_padre_id !== null) return;
    setEditId(m.id);
    setEditForm({
      fecha: m.fecha,
      cod_conce: m.cod_conce,
      medio: m.medio,
      cliente_id: m.cliente_id,
      detalle: m.detalle,
      entrada: m.entrada > 0 ? String(m.entrada) : '',
      salida: m.salida > 0 ? String(m.salida) : '',
    });
  };

  const saveEdit = async () => {
    if (!editId || !editForm) return;
    const pe = parseStrictAmount(editForm.entrada, { label: 'Entrada' });
    const ps = parseStrictAmount(editForm.salida, { label: 'Salida' });
    if (!pe.ok || !ps.ok) {
      alert(pe.error || ps.error || 'Importe inválido');
      return;
    }
    try {
      await api('PUT', `movimientos/${editId}`, {
        fecha: editForm.fecha,
        cod_conce: editForm.cod_conce,
        medio: editForm.medio,
        cliente_id: editForm.cliente_id,
        detalle: editForm.detalle,
        entrada: pe.value,
        salida: ps.value,
      });
      setEditId(null);
      setEditForm(null);
      await load();
    } catch (ex: any) {
      if (ex instanceof ApiHttpError && ex.status === 409) {
        await load();
      }
      alert(ex.message || 'Error al guardar cambios');
    }
  };

  const removeRow = async (m: Movimiento) => {
    if (data?.cerrado || m.movimiento_padre_id !== null) return;
    const msg =
      m.tipo_valor === 'HONORARIOS' || m.tipo_valor === 'UTILES'
        ? `¿Eliminar "${m.detalle}" (${fmtARS(m.entrada || m.salida)}) y su pase asociado a LORE?`
        : `¿Eliminar renglón de ${m.cliente} por ${fmtARS(m.entrada || m.salida)}?`;
    if (!confirm(msg)) return;
    try {
      await api('DELETE', `movimientos/${m.id}`);
      await load();
    } catch (ex: any) {
      if (ex instanceof ApiHttpError && ex.status === 409) {
        await load();
      }
      alert(ex.message || 'No se pudo eliminar');
    }
  };

  const needsClient = tipo === 'IMPUESTOS' || tipo === 'HONORARIOS' || tipo === 'AJUSTE';
  const hasFilters = Boolean(fCliente || fMedio || fTipo || fQ.trim());

  const renderQuickForm = (isMobile = false) => (
    <form onSubmit={submitCarga} className="space-y-2.5">
      {/* Primera línea: Fecha | Cliente (con saldo en vivo) | Operación | Cód / Medio */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
        <div className="md:col-span-2">
          <label className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Fecha
          </label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => {
              const val = e.target.value;
              setFecha(val);
              markDraftEdited();
              if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                const [fy, fm] = val.split('-').map(Number);
                if (fy && fm && (fy !== anio || fm !== mes)) {
                  setAnio(fy);
                  setMes(fm);
                }
              }
            }}
            required
            className="num h-9 w-full rounded border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900"
          />
        </div>

        <div className="md:col-span-5">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {needsClient ? 'Cliente *' : 'Cuenta / Entidad'}
            </label>
            {clienteId && clienteSaldoHoy !== null && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onOpenCliente(clienteId)}
                className={`num text-[11px] font-semibold hover:underline ${
                  clienteSaldoHoy < -0.005
                    ? 'text-[#DC2626]'
                    : clienteSaldoHoy > 0.005
                      ? 'text-[#15803D]'
                      : 'text-slate-500'
                }`}
                title="Abrir estado de cuenta del cliente"
              >
                Saldo hoy: {fmtARS(clienteSaldoHoy)} ({estadoSaldoLabel(clienteSaldoHoy)})
              </button>
            )}
          </div>
          <ClienteSelect
            inputRef={isMobile ? undefined : clienteInputRef}
            clientes={clientes}
            value={clienteId}
            includeInternos={!needsClient}
            placeholder={
              needsClient
                ? 'Buscar apellido o nombre (+ Enter para crear)...'
                : tipo === 'RETIRO'
                  ? 'Por defecto: LORE'
                  : 'Por defecto: ESTUDIO'
            }
            onChange={(c) => {
              setClienteId(c ? c.id : null);
              markDraftEdited();
            }}
            onCreated={onClienteCreated}
          />
        </div>

        <div className="md:col-span-3">
          <label className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Operación
          </label>
          <select
            value={tipo}
            onChange={(e) => handleTipoChange(e.target.value as TipoCarga)}
            className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-900"
          >
            <option value="IMPUESTOS">IMPUESTOS (Custodia)</option>
            <option value="HONORARIOS">HONORARIOS (Cobro)</option>
            <option value="GASTO_ESTUDIO">GASTO ESTUDIO</option>
            <option value="RETIRO">RETIRO (LORE)</option>
            <option value="AJUSTE">AJUSTE SALDO CTE</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Cód. / Medio
          </label>
          <select
            value={medio}
            onChange={(e) => handleMedioSelect(e.target.value as Medio)}
            className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-900"
          >
            <option value="EFECTIVO">E · Efectivo</option>
            <option value="BANCO">T · Transferencia</option>
          </select>
        </div>
      </div>

      {/* Segunda línea limpia: Detalle | Entrada | Salida | Opciones + Guardar */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-end">
        <div className="md:col-span-5">
          <label className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Detalle / Concepto
          </label>
          <input
            type="text"
            value={detalle}
            onChange={(e) => {
              setDetalle(e.target.value);
              markDraftEdited();
            }}
            placeholder={
              tipo === 'HONORARIOS'
                ? 'Ej: DE HONORARIOS OCTUBRE'
                : tipo === 'IMPUESTOS'
                  ? 'Ej: MONO 10/26 - IIBB - TEM'
                  : 'Detalle del movimiento...'
            }
            className="h-9 w-full rounded border border-slate-300 bg-white px-2.5 text-sm uppercase text-slate-900 placeholder:normal-case placeholder:text-slate-400"
          />
        </div>

        {tipo !== 'RETIRO' && (
          <div className={tipo === 'HONORARIOS' ? 'md:col-span-3' : 'md:col-span-2'}>
            <label className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-[#15803D]">
              {tipo === 'HONORARIOS'
                ? 'Honorarios Cobrados ($)'
                : tipo === 'AJUSTE'
                  ? 'A Favor Cliente ($)'
                  : 'Entrada ($)'}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={entrada}
              onChange={(e) => {
                setEntrada(e.target.value);
                markDraftEdited();
              }}
              placeholder="0,00"
              aria-invalid={!pEntrada.ok}
              className={`num h-9 w-full rounded border bg-white px-2.5 text-right text-sm font-semibold text-[#15803D] placeholder:font-normal placeholder:text-slate-300 ${
                !pEntrada.ok ? 'border-[#DC2626] bg-red-50/40' : 'border-slate-300'
              }`}
            />
          </div>
        )}

        {tipo !== 'HONORARIOS' && (
          <div className={tipo === 'RETIRO' ? 'md:col-span-4' : 'md:col-span-2'}>
            <label className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-[#DC2626]">
              {tipo === 'IMPUESTOS'
                ? 'Salida Impuestos ($)'
                : tipo === 'AJUSTE'
                  ? 'En Contra Cliente ($)'
                  : 'Salida ($)'}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={salida}
              onChange={(e) => {
                setSalida(e.target.value);
                markDraftEdited();
              }}
              placeholder="0,00"
              aria-invalid={!pSalida.ok}
              className={`num h-9 w-full rounded border bg-white px-2.5 text-right text-sm font-semibold text-[#DC2626] placeholder:font-normal placeholder:text-slate-300 ${
                !pSalida.ok ? 'border-[#DC2626] bg-red-50/40' : 'border-slate-300'
              }`}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 md:col-span-3 md:justify-end">
          {(tipo === 'HONORARIOS' || showExtras) && (
            <label className="flex select-none items-center gap-1.5 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={paseLore}
                onChange={(e) => {
                  setPaseLore(e.target.checked);
                  markDraftEdited();
                }}
                className="h-4 w-4 rounded border-slate-300 accent-[#1E3A8A]"
              />
              Pase a LORE
            </label>
          )}

          {tipo === 'IMPUESTOS' && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowExtras((s) => !s)}
              className={`rounded border px-2 py-2 text-xs font-medium ${
                showExtras || utiles || honorariosSaldo || detalleSalida
                  ? 'border-amber-400 bg-amber-50 text-amber-900'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Descontar útiles, honorarios desde saldo o detallar salida por separado"
            >
              + Opciones
            </button>
          )}

          <button
            type="submit"
            disabled={saving || data?.cerrado || amountErrors.length > 0}
            className="flex h-9 items-center gap-1.5 rounded bg-[#0F172A] px-4 text-xs font-semibold text-white hover:bg-[#1E3A8A] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {saving ? 'Guardando...' : 'Registrar'}
          </button>
        </div>
      </div>

      {/* Opciones combinadas: útiles desde saldo, honorarios desde saldo o detalle de salida separado */}
      {tipo === 'IMPUESTOS' && showExtras && (
        <div className="grid grid-cols-1 gap-2 rounded border border-amber-200 bg-amber-50/60 p-2.5 md:grid-cols-12">
          <div className="md:col-span-2">
            <label className="mb-0.5 block text-[11px] font-semibold uppercase text-amber-900">
              Útiles desde saldo ($)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={utiles}
              onChange={(e) => {
                setUtiles(e.target.value);
                markDraftEdited();
              }}
              placeholder="0,00"
              aria-invalid={!pUtiles.ok}
              className={`num h-8 w-full rounded border bg-white px-2 text-right text-xs font-semibold text-amber-900 ${
                !pUtiles.ok ? 'border-[#DC2626]' : 'border-amber-300'
              }`}
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-0.5 block text-[11px] font-semibold uppercase text-emerald-900">
              Honor. desde saldo ($)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={honorariosSaldo}
              onChange={(e) => {
                setHonorariosSaldo(e.target.value);
                markDraftEdited();
              }}
              placeholder="0,00"
              aria-invalid={!pHonSaldo.ok}
              className={`num h-8 w-full rounded border bg-white px-2 text-right text-xs font-semibold text-emerald-900 ${
                !pHonSaldo.ok ? 'border-[#DC2626]' : 'border-emerald-300'
              }`}
            />
          </div>
          <div className="md:col-span-4">
            <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
              Detalle Honorarios (opcional)
            </label>
            <input
              type="text"
              value={detalleHon}
              onChange={(e) => {
                setDetalleHon(e.target.value);
                markDraftEdited();
              }}
              placeholder="Ej: HONORARIOS NOVIEMBRE"
              className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs uppercase"
            />
          </div>
          <div className="md:col-span-4">
            <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
              Detalle distinto para la Salida (opcional)
            </label>
            <input
              type="text"
              value={detalleSalida}
              onChange={(e) => {
                setDetalleSalida(e.target.value);
                markDraftEdited();
              }}
              placeholder="Si difiere del detalle de entrada..."
              className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs uppercase"
            />
          </div>
        </div>
      )}

      {amountErrors.length > 0 && (
        <div role="alert" className="text-xs font-semibold text-[#DC2626]">
          {amountErrors.join(' · ')}
        </div>
      )}

      {previewSummary && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            {previewSummary.efectoCliente !== null && (
              <span>
                Efecto en cliente:{' '}
                <strong
                  className={`num ${
                    previewSummary.efectoCliente < 0
                      ? 'text-[#DC2626]'
                      : previewSummary.efectoCliente > 0
                        ? 'text-[#15803D]'
                        : 'text-slate-800'
                  }`}
                >
                  {fmtARS(previewSummary.efectoCliente)}
                </strong>
              </span>
            )}
            <span>
              Efecto en caja:{' '}
              <strong
                className={`num ${
                  previewSummary.efectoCaja < 0
                    ? 'text-[#DC2626]'
                    : previewSummary.efectoCaja > 0
                      ? 'text-[#15803D]'
                      : 'text-slate-800'
                }`}
              >
                {fmtARS(previewSummary.efectoCaja)}
              </strong>
            </span>
          </div>
          <span className="hidden text-[11px] text-slate-400 md:inline">
            Tab para avanzar · Enter para registrar
          </span>
        </div>
      )}
    </form>
  );

  return (
    <div className="space-y-3">
      {/* Barra de Período y KPIs */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
        <div className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2.5 lg:col-span-4">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
              title="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              <select
                value={mes}
                onChange={(e) => changePeriod(anio, Number(e.target.value))}
                className="h-8 rounded border border-slate-200 bg-slate-50 px-2 text-sm font-bold text-slate-900"
              >
                {MESES_NOMBRES.slice(1).map((n, idx) => (
                  <option key={idx + 1} value={idx + 1}>
                    {n}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={anio}
                onChange={(e) => changePeriod(Number(e.target.value) || 2026, mes)}
                className="num h-8 w-20 rounded border border-slate-200 bg-slate-50 px-2 text-sm font-bold text-slate-900"
              />
            </div>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
              title="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {data?.cerrado ? (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                <Lock className="h-3 w-3" /> MES CERRADO
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleReabrirMes}
                  disabled={reabriendo}
                  className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 hover:bg-amber-200"
                  title="Reabrir este período para permitir cargar"
                >
                  {reabriendo ? '...' : 'Reabrir'}
                </button>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              MES ABIERTO
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:col-span-8">
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Entradas Mes
            </div>
            <div className="num mt-0.5 text-base font-semibold text-[#15803D]">
              {fmtARS(data?.resumen.entradas_mes)}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Salidas Mes
            </div>
            <div className="num mt-0.5 text-base font-semibold text-[#DC2626]">
              {fmtARS(data?.resumen.salidas_mes)}
            </div>
          </div>
          <div className="rounded border border-slate-300 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Resultado del Mes (desde $0)
            </div>
            <div
              className={`num mt-0.5 text-base font-bold ${
                (data?.resumen.saldo_mes || 0) < 0 ? 'text-[#DC2626]' : 'text-slate-900'
              }`}
            >
              {fmtARS(data?.resumen.saldo_mes)}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-900 px-3 py-2 text-white">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
              Saldo Efectivo / Transf.
            </div>
            <div className="num mt-1 flex items-center justify-between gap-2 text-xs font-semibold">
              <span>Ef: {fmtNum(data?.resumen.saldo_real_fin.efectivo)}</span>
              <span className="text-slate-400">·</span>
              <span>Tr: {fmtNum(data?.resumen.saldo_real_fin.banco)}</span>
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div
          role="alert"
          className="flex items-center justify-between rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
        >
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="text-red-600 hover:text-red-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {flashMsg && (
        <div
          role="status"
          aria-live="polite"
          className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900"
        >
          {flashMsg}
        </div>
      )}

      {lastRecibo && (() => {
        const liveCli = clientes.find((c) => c.id === lastRecibo.cliente.id) || lastRecibo.cliente;
        const fastRecibo = buildReciboComputed({
          cliente: liveCli,
          movimientos: lastRecibo.movimientos,
          estudio: {
            nombre_estudio: config?.nombre_estudio || 'Estudio Contable',
            subtitulo_estudio: config?.subtitulo_estudio || '',
            datos_contacto_estudio: config?.datos_contacto_estudio || '',
          },
          operador: user?.nombre,
        });
        return (
          <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded border border-[#1E3A8A]/30 bg-blue-50/80 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-slate-900">
              <FileText className="h-4 w-4 shrink-0 text-[#1E3A8A]" />
              <span>
                <strong>Recibo Nº {fastRecibo.numero}</strong> listo para{' '}
                <strong>{liveCli.nombre}</strong>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => downloadReciboPdf(fastRecibo)}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
              >
                <Download className="h-3.5 w-3.5" /> Descargar PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  downloadReciboPdf(fastRecibo);
                  openReciboWhatsapp(fastRecibo, liveCli.telefono);
                }}
                className="inline-flex items-center gap-1 rounded bg-[#15803D] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#166534]"
              >
                <MessageCircle className="h-3.5 w-3.5" /> PDF + WhatsApp
              </button>
              <button
                type="button"
                onClick={() =>
                  setReciboModalSeed({
                    movimientoId: lastRecibo.movimientos[0].id,
                    cliente: liveCli,
                    movimientosIniciales: lastRecibo.movimientos,
                  })
                }
                className="rounded border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-[#1E3A8A] hover:bg-blue-50"
              >
                Vista previa / Tel.
              </button>
              <button
                type="button"
                onClick={() => setLastRecibo(null)}
                className="rounded p-1 text-slate-400 hover:bg-blue-100 hover:text-slate-700"
                title="Ocultar aviso de recibo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })()}

      {lastHonorarioArca && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-300 bg-emerald-50/80 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#15803D]" />
            <span>
              Honorarios por Transferencia (<strong>{fmtARS(lastHonorarioArca.movimiento.entrada)}</strong>) de{' '}
              <strong>{lastHonorarioArca.cliente.nombre}</strong>. ¿Desea emitir Factura Electrónica ARCA?
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setFacturaModalMovId(lastHonorarioArca.movimiento.id);
                setLastHonorarioArca(null);
              }}
              className="inline-flex items-center gap-1 rounded bg-[#0F172A] px-3 py-1 text-xs font-bold text-white hover:bg-[#1E3A8A]"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Facturar en ARCA
            </button>
            <button
              type="button"
              onClick={() => setLastHonorarioArca(null)}
              className="rounded p-1 text-slate-400 hover:bg-emerald-100 hover:text-slate-700"
              title="No facturar ahora"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Panel de Carga Rápida (Escritorio) o Banner de Mes Cerrado */}
      {data?.cerrado ? (
        <div className="no-print rounded border border-amber-300 bg-amber-50 p-3.5 text-amber-950 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="text-xs font-bold">
                  El período de {MESES_NOMBRES[mes]} {anio} está cerrado (modo solo lectura).
                </p>
                <p className="text-[11px] text-amber-800">
                  Los registros de este período están protegidos. Para cargar o corregir movimientos en este mes, debe reabrirlo.
                </p>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={handleReabrirMes}
                disabled={reabriendo}
                className="inline-flex items-center gap-1.5 rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 shadow-xs transition"
              >
                <LockOpen className="h-3.5 w-3.5 text-amber-700" />
                {reabriendo ? 'Reabriendo mes...' : 'Reabrir mes ahora'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="no-print hidden rounded border border-slate-300 bg-white p-3 shadow-2xs md:block">
          {renderQuickForm(false)}
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="no-print rounded border border-slate-200 bg-white p-2.5">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500 md:col-span-1">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtrar
          </div>
          <div className="md:col-span-4">
            <ClienteSelect
              compact
              clientes={clientes}
              value={fCliente}
              includeInternos
              placeholder="Filtrar por cliente o cuenta..."
              onChange={(c) => setFCliente(c ? c.id : null)}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5 md:col-span-3">
            <select
              value={fMedio}
              onChange={(e) => setFMedio(e.target.value)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="">Cód: Todos</option>
              <option value="EFECTIVO">E · Efectivo</option>
              <option value="BANCO">T · Transferencia</option>
            </select>
            <select
              value={fTipo}
              onChange={(e) => setFTipo(e.target.value)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-xs"
            >
              <option value="">Tipo: Todos</option>
              <option value="IMPUESTOS">Impuestos</option>
              <option value="HONORARIOS">Honorarios</option>
              <option value="UTILES">Útiles</option>
              <option value="RETIRO">Retiros LORE</option>
              <option value="GASTO_ESTUDIO">Gastos Estudio</option>
              <option value="AJUSTE">Ajustes</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 md:col-span-4">
            <input
              type="search"
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              placeholder="Texto en detalle..."
              className="h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs"
            />
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setFCliente(null);
                  setFMedio('');
                  setFTipo('');
                  setFQ('');
                }}
                className="h-8 shrink-0 rounded border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-100"
              >
                Limpiar
              </button>
            )}
            <a
              href={exportUrl('export/movimientos', {
                anio,
                mes,
                orden: ordenDesc ? 'desc' : 'asc',
                cliente_id: fCliente || undefined,
                medio: fMedio || undefined,
                tipo: fTipo || undefined,
                q: fQ.trim() || undefined,
              })}
              className="flex h-8 shrink-0 items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              title="Exportar vista actual a CSV"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
          </div>
        </div>

        {/* Banner contextual cuando se filtra por un cliente */}
        {fCliente && data && data.cliente_saldo_fin !== undefined && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span>
                Saldo arrastrado al 01/{String(mes).padStart(2, '0')}:{' '}
                <strong
                  className={`num ${
                    (data.cliente_saldo_anterior || 0) < 0 ? 'text-[#DC2626]' : 'text-slate-900'
                  }`}
                >
                  {fmtARS(data.cliente_saldo_anterior)}
                </strong>
              </span>
              <span>
                Saldo al {fmtDate(data.hasta)}:{' '}
                <strong
                  className={`num text-sm ${
                    data.cliente_saldo_fin < -0.005 ? 'text-[#DC2626]' : 'text-[#15803D]'
                  }`}
                >
                  {fmtARS(data.cliente_saldo_fin)} ({estadoSaldoLabel(data.cliente_saldo_fin)})
                </strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenCliente(fCliente)}
              className="inline-flex items-center gap-1 font-semibold text-[#1E3A8A] hover:underline"
            >
              Abrir ficha completa e historial anual <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Tabla principal (Escritorio) */}
      <div className="hidden overflow-x-auto rounded border border-slate-200 bg-white md:block">
        <table className="ledger-table">
          <thead>
            <tr>
              <th
                className="w-36 cursor-pointer select-none text-left hover:text-slate-900"
                onClick={() => setOrdenDesc(!ordenDesc)}
                title="Haga clic para alternar el orden (más nuevo arriba / más viejo arriba)"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-bold">Fecha</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 border border-slate-200">
                    {ordenDesc ? '↓ Nuevo arriba' : '↑ Viejo arriba'}
                  </span>
                </div>
              </th>
              <th className="w-32 text-left">Cód / Medio</th>
              <th className="text-left">Cliente / Cuenta</th>
              <th className="w-28 text-left">Tipo</th>
              <th className="text-left">Detalle</th>
              <th className="w-32 text-right">Entradas</th>
              <th className="w-32 text-right">Salidas</th>
              {fCliente && <th className="w-36 text-right">Saldo Cliente</th>}
              <th className="w-36 text-right">Saldo Caja Mes</th>
              <th className="no-print w-36 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-xs text-slate-500">
                  Cargando movimientos...
                </td>
              </tr>
            )}
            {data && data.movimientos.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-xs text-slate-500">
                  Sin movimientos en este período con los filtros seleccionados.
                </td>
              </tr>
            )}
            {data?.movimientos.map((m) => {
              const isEditing = editId === m.id && editForm;
              const isAutoMirror = m.movimiento_padre_id !== null;

              if (isEditing) {
                return (
                  <tr key={m.id} className="bg-blue-50/60">
                    <td>
                      <input
                        type="date"
                        value={editForm.fecha}
                        onChange={(e) => setEditForm({ ...editForm, fecha: e.target.value })}
                        className="num h-7 w-28 rounded border border-slate-300 bg-white px-1 text-xs"
                      />
                    </td>
                    <td>
                      <select
                        value={editForm.medio}
                        onChange={(e) => {
                          const med = e.target.value as Medio;
                          setEditForm({
                            ...editForm,
                            medio: med,
                            cod_conce: med === 'BANCO' ? 'T' : 'E',
                          });
                        }}
                        className="h-7 rounded border border-slate-300 bg-white px-1.5 text-xs font-semibold"
                      >
                        <option value="EFECTIVO">E · Efectivo</option>
                        <option value="BANCO">T · Transferencia</option>
                      </select>
                    </td>
                    <td>
                      <ClienteSelect
                        compact
                        allowClear={false}
                        includeInternos={!m.afecta_cliente}
                        clientes={clientes}
                        value={editForm.cliente_id}
                        onChange={(c) => c && setEditForm({ ...editForm, cliente_id: c.id })}
                      />
                    </td>
                    <td className="text-xs font-medium text-slate-500">{m.tipo_valor}</td>
                    <td>
                      <input
                        type="text"
                        value={editForm.detalle}
                        onChange={(e) => setEditForm({ ...editForm, detalle: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') setEditId(null);
                        }}
                        className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-xs uppercase"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={editForm.entrada}
                        disabled={m.salida > 0}
                        onChange={(e) =>
                          setEditForm({ ...editForm, entrada: e.target.value, salida: '' })
                        }
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                        placeholder="0,00"
                        className="num h-7 w-28 rounded border border-slate-300 bg-white px-1.5 text-right text-xs text-[#15803D] disabled:bg-slate-100"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={editForm.salida}
                        disabled={m.entrada > 0}
                        onChange={(e) =>
                          setEditForm({ ...editForm, salida: e.target.value, entrada: '' })
                        }
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                        placeholder="0,00"
                        className="num h-7 w-28 rounded border border-slate-300 bg-white px-1.5 text-right text-xs text-[#DC2626] disabled:bg-slate-100"
                      />
                    </td>
                    {fCliente && <td className="text-right text-xs text-slate-400">—</td>}
                    <td className="text-right text-xs text-slate-400">—</td>
                    <td className="no-print text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="rounded bg-[#15803D] p-1 text-white hover:bg-emerald-800"
                          title="Guardar (Enter)"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          className="rounded bg-slate-200 p-1 text-slate-700 hover:bg-slate-300"
                          title="Cancelar (Esc)"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={m.id}
                  onDoubleClick={() => startEdit(m)}
                  className={m.es_interno ? 'bg-slate-50/60 text-slate-600' : 'text-slate-900'}
                >
                  <td className="num whitespace-nowrap text-xs text-slate-600">
                    {fmtDate(m.fecha)}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                      <strong className="num">{m.medio === 'BANCO' ? 'T' : 'E'}</strong>
                      <span>· {m.medio === 'BANCO' ? 'Transf.' : 'Efectivo'}</span>
                    </span>
                  </td>
                  <td className="max-w-[220px] truncate text-xs font-semibold">
                    {!m.es_interno ? (
                      <button
                        type="button"
                        onClick={() => onOpenCliente(m.cliente_id)}
                        className="truncate text-left hover:text-[#1E3A8A] hover:underline"
                        title="Abrir cuenta corriente del cliente"
                      >
                        {m.cliente}
                      </button>
                    ) : (
                      <span className="text-slate-500">{m.cliente}</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        TIPO_BADGE[m.tipo_valor] || 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {m.tipo_valor}
                    </span>
                  </td>
                  <td className="max-w-[340px] truncate text-xs" title={m.detalle}>
                    {m.detalle}
                    {!m.afecta_caja && m.tipo_valor !== 'APERTURA' && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                        desde saldo
                      </span>
                    )}
                    {m.factura_arca && (
                      <button
                        type="button"
                        onClick={() => setFacturaModalMovId(m.id)}
                        className={`num ml-1.5 inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold hover:underline ${
                          m.factura_arca.entorno === 'produccion'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-amber-300 bg-amber-50 text-amber-900'
                        }`}
                        title={`CAE: ${m.factura_arca.cae} — Clic para abrir PDF / WhatsApp`}
                      >
                        FC {m.factura_arca.cbte_letra} {m.factura_arca.numero_formateado}
                      </button>
                    )}
                  </td>
                  <td className="num whitespace-nowrap text-right text-xs font-semibold text-[#15803D]">
                    {m.entrada > 0 ? fmtARS(m.entrada) : '—'}
                  </td>
                  <td className="num whitespace-nowrap text-right text-xs font-semibold text-[#DC2626]">
                    {m.salida > 0 ? fmtARS(m.salida) : '—'}
                  </td>
                  {fCliente && (
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
                        ? '—'
                        : fmtARS(m.saldo_cliente)}
                    </td>
                  )}
                  <td
                    className={`num whitespace-nowrap text-right text-xs font-semibold ${
                      (m.saldo_caja || 0) < -0.005 ? 'text-[#DC2626]' : 'text-slate-700'
                    }`}
                  >
                    {m.saldo_caja === undefined ? '—' : fmtARS(m.saldo_caja)}
                  </td>
                  <td className="no-print whitespace-nowrap text-center">
                    <div className="flex items-center justify-center gap-1">
                      {m.tipo_valor === 'IMPUESTOS' && !m.es_interno && (
                        <button
                          type="button"
                          onClick={() => setReciboModalSeed({ movimientoId: m.id })}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50/70 px-1.5 py-0.5 text-[10px] font-semibold text-[#1E3A8A] hover:bg-blue-100"
                          title="Descargar recibo PDF o enviar por WhatsApp"
                        >
                          <FileText className="h-3 w-3" /> Recibo
                        </button>
                      )}
                      {m.factura_arca ? (
                        <button
                          type="button"
                          onClick={() => setFacturaModalMovId(m.id)}
                          className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-[#15803D] hover:bg-emerald-100"
                          title="Descargar Factura Electrónica ARCA (PDF) o enviar por WhatsApp"
                        >
                          <ShieldCheck className="h-3 w-3" /> Factura
                        </button>
                      ) : (
                        m.tipo_valor === 'HONORARIOS' &&
                        m.medio === 'BANCO' &&
                        m.entrada > 0 &&
                        !m.es_interno && (
                          <button
                            type="button"
                            onClick={() => setFacturaModalMovId(m.id)}
                            className="inline-flex items-center gap-1 rounded bg-[#0F172A] px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-[#1E3A8A]"
                            title="Emitir Factura Electrónica en ARCA para esta transferencia"
                          >
                            <ShieldCheck className="h-3 w-3 text-emerald-400" /> Facturar ARCA
                          </button>
                        )
                      )}
                      {!data?.cerrado &&
                        (isAutoMirror ? (
                          <span
                            title="Pase automático vinculado al movimiento superior. Edite o elimine el movimiento origen."
                            className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                          >
                            <Link2 className="h-3 w-3" /> Auto
                          </span>
                        ) : m.tipo_valor !== 'APERTURA' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(m)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800"
                              title="Editar fila (o doble clic)"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {!m.factura_arca && (
                              <button
                                type="button"
                                onClick={() => removeRow(m)}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-[#DC2626]"
                                title="Eliminar fila"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        ) : null)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Vista de Tarjetas (Móvil < 768px) */}
      <div className="space-y-2 md:hidden">
        {data?.movimientos.length === 0 && (
          <div className="rounded border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
            Sin movimientos en este período.
          </div>
        )}
        {data?.movimientos.map((m) => (
          <div key={m.id} className="rounded border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <button
                  type="button"
                  disabled={m.es_interno}
                  onClick={() => !m.es_interno && onOpenCliente(m.cliente_id)}
                  className="truncate text-left text-sm font-bold text-slate-900"
                >
                  {m.cliente}
                </button>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="num">{fmtDate(m.fecha)}</span>
                  <span>·</span>
                  <span>{m.medio === 'BANCO' ? 'T · Transferencia' : 'E · Efectivo'}</span>
                  <span
                    className={`rounded border px-1 py-0.2 text-[10px] font-semibold ${
                      TIPO_BADGE[m.tipo_valor] || ''
                    }`}
                  >
                    {m.tipo_valor}
                  </span>
                  {m.factura_arca && (
                    <span className="num rounded border border-emerald-300 bg-emerald-50 px-1 py-0.2 text-[10px] font-bold text-[#15803D]">
                      FC {m.factura_arca.cbte_letra} {m.factura_arca.numero_formateado}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                {m.entrada > 0 && (
                  <div className="num text-sm font-bold text-[#15803D]">+{fmtARS(m.entrada)}</div>
                )}
                {m.salida > 0 && (
                  <div className="num text-sm font-bold text-[#DC2626]">-{fmtARS(m.salida)}</div>
                )}
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-xs text-slate-700">
              <span className="truncate">{m.detalle}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                {m.tipo_valor === 'IMPUESTOS' && !m.es_interno && (
                  <button
                    type="button"
                    onClick={() => setReciboModalSeed({ movimientoId: m.id })}
                    className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-[#1E3A8A]"
                  >
                    <FileText className="h-3.5 w-3.5" /> Recibo
                  </button>
                )}
                {m.factura_arca ? (
                  <button
                    type="button"
                    onClick={() => setFacturaModalMovId(m.id)}
                    className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-[#15803D]"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Factura
                  </button>
                ) : (
                  m.tipo_valor === 'HONORARIOS' &&
                  m.medio === 'BANCO' &&
                  m.entrada > 0 &&
                  !m.es_interno && (
                    <button
                      type="button"
                      onClick={() => setFacturaModalMovId(m.id)}
                      className="inline-flex items-center gap-1 rounded bg-[#0F172A] px-2 py-1 text-[11px] font-semibold text-white"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Facturar ARCA
                    </button>
                  )
                )}
                {!data?.cerrado &&
                  m.tipo_valor !== 'APERTURA' &&
                  m.movimiento_padre_id === null &&
                  !m.factura_arca && (
                    <button
                      type="button"
                      onClick={() => removeRow(m)}
                      className="rounded p-1 text-slate-400 hover:text-[#DC2626]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Botón flotante Móvil */}
      {!data?.cerrado && (
        <button
          type="button"
          onClick={() => setMobileSheet(true)}
          className="no-print fixed bottom-20 right-4 z-30 flex h-12 items-center gap-1.5 rounded-full bg-[#0F172A] px-4 text-sm font-semibold text-white shadow-lg md:hidden"
        >
          <Plus className="h-5 w-5" /> Cargar
        </button>
      )}

      {/* Bottom sheet de carga en Móvil */}
      {mobileSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/50 md:hidden">
          <div className="max-h-[90vh] overflow-y-auto rounded-t-xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900">Nuevo Movimiento de Caja</h3>
              <button
                type="button"
                onClick={() => setMobileSheet(false)}
                className="rounded p-1 text-slate-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {err && (
              <div className="mb-2 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                {err}
              </div>
            )}
            {renderQuickForm(true)}
          </div>
        </div>
      )}

      {reciboModalSeed && (
        <ReciboModal
          seed={reciboModalSeed}
          config={config || null}
          operadorNombre={user?.nombre}
          onClose={() => setReciboModalSeed(null)}
          onClientePhoneUpdated={onClientePhoneUpdated}
        />
      )}

      {facturaModalMovId !== null && (
        <FacturaArcaModal
          movimientoId={facturaModalMovId}
          onClose={() => setFacturaModalMovId(null)}
          onFacturaEmitida={() => {
            void load();
          }}
          onClienteUpdated={() => {
            onClientesChanged?.();
          }}
          onGoToConfigArca={
            onGoToConfigArca
              ? () => {
                  setFacturaModalMovId(null);
                  onGoToConfigArca();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
