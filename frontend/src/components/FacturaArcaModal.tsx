import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileCheck2,
  Loader2,
  MessageCircle,
  Phone,
  Settings,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  api,
  CondicionIvaKey,
  FacturaArcaCompleta,
  FacturaPrepResponse,
  fmtARS,
  fmtDate,
  fmtNum,
} from '../lib/api';
import {
  cleanDigits,
  downloadFacturaPdf,
  formatCuitDisplay,
  getQrMatrix,
  isValidCuitAR,
  openFacturaWhatsapp,
  shareFacturaPdfNative,
} from '../lib/facturaPdf';
import { canNativeSharePdf } from '../lib/reciboPdf';

interface Props {
  movimientoId: number;
  onClose: () => void;
  onFacturaEmitida?: (factura: FacturaArcaCompleta) => void;
  onClienteUpdated?: () => void;
  onGoToConfigArca?: () => void;
}

const CONDICIONES_IVA_OPTS: {
  key: CondicionIvaKey;
  label: string;
  letra: 'A' | 'B';
  requiereCuit: boolean;
}[] = [
  { key: 'RI', label: 'IVA Responsable Inscripto', letra: 'A', requiereCuit: true },
  { key: 'MONOTRIBUTO', label: 'Responsable Monotributo (Ley 27.618)', letra: 'A', requiereCuit: true },
  { key: 'EXENTO', label: 'IVA Sujeto Exento', letra: 'B', requiereCuit: true },
  { key: 'CF', label: 'Consumidor Final', letra: 'B', requiereCuit: false },
];

const ALICUOTAS_OPTS: { key: '21' | '10.5' | '27' | '0'; pct: number; label: string }[] = [
  { key: '21', pct: 21, label: '21% (General)' },
  { key: '10.5', pct: 10.5, label: '10,5%' },
  { key: '27', pct: 27, label: '27%' },
  { key: '0', pct: 0, label: '0%' },
];

export function FacturaArcaModal({
  movimientoId,
  onClose,
  onFacturaEmitida,
  onClienteUpdated,
  onGoToConfigArca,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [prep, setPrep] = useState<FacturaPrepResponse | null>(null);
  const [factura, setFactura] = useState<FacturaArcaCompleta | null>(null);

  // Campos editables pre-emisión
  const [condicionIva, setCondicionIva] = useState<CondicionIvaKey>('RI');
  const [docNro, setDocNro] = useState('');
  const [receptorNombre, setReceptorNombre] = useState('');
  const [receptorDomicilio, setReceptorDomicilio] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [cbteFecha, setCbteFecha] = useState('');
  const [servDesde, setServDesde] = useState('');
  const [servHasta, setServHasta] = useState('');
  const [vtoPago, setVtoPago] = useState('');
  const [alicIva, setAlicIva] = useState<'21' | '10.5' | '27' | '0'>('21');

  // WhatsApp y estado de emisión
  const [telefono, setTelefono] = useState('');
  const [initialTelefono, setInitialTelefono] = useState('');
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const supportsNativeShare = useMemo(() => canNativeSharePdf(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api<FacturaPrepResponse>('GET', `movimientos/${movimientoId}/factura-prep`)
      .then((res) => {
        if (cancelled) return;
        setPrep(res);
        const tel = res.cliente.telefono || '';
        setTelefono(tel);
        setInitialTelefono(tel);

        if (res.emitida && res.factura) {
          setFactura(res.factura);
        } else if (res.sugerido) {
          setCondicionIva(res.sugerido.condicion_iva);
          setDocNro(res.cliente.cuit || '');
          setReceptorNombre(res.cliente.nombre || '');
          setReceptorDomicilio(res.cliente.domicilio || '');
          setDescripcion(res.sugerido.descripcion);
          setCbteFecha(res.sugerido.cbte_fecha);
          setServDesde(res.sugerido.fch_serv_desde);
          setServHasta(res.sugerido.fch_serv_hasta);
          setVtoPago(res.sugerido.fch_vto_pago);
          setAlicIva(res.sugerido.alic_iva);
        }
      })
      .catch((e: any) => {
        if (!cancelled) setErr(e.message || 'No se pudo cargar la preparación de factura ARCA.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movimientoId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !emitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, emitting]);

  const condMeta = useMemo(
    () => CONDICIONES_IVA_OPTS.find((c) => c.key === condicionIva) || CONDICIONES_IVA_OPTS[0],
    [condicionIva],
  );

  const docDigits = useMemo(() => cleanDigits(docNro), [docNro]);
  const cuitValido = useMemo(() => isValidCuitAR(docDigits), [docDigits]);

  const docValidationError = useMemo(() => {
    if (condMeta.requiereCuit) {
      if (!docDigits) return 'Ingrese el CUIT de 11 dígitos del receptor.';
      if (docDigits.length !== 11 || !cuitValido) {
        return 'El CUIT ingresado no es válido (verifique los 11 dígitos).';
      }
      return null;
    }
    // Consumidor Final
    if (!docDigits) return null;
    if (docDigits.length === 11) {
      return cuitValido ? null : 'El CUIT/CUIL ingresado tiene dígito verificador inválido.';
    }
    if (docDigits.length >= 7 && docDigits.length <= 8) return null;
    return 'Ingrese CUIT (11 dígitos), DNI (7-8 dígitos) o deje vacío.';
  }, [condMeta.requiereCuit, docDigits, cuitValido]);

  const importesCalc = useMemo(() => {
    const total = Math.round((prep?.movimiento.entrada || 0) * 100) / 100;
    const pct = ALICUOTAS_OPTS.find((a) => a.key === alicIva)?.pct ?? 21;
    if (pct > 0) {
      const neto = Math.round((total / (1 + pct / 100)) * 100) / 100;
      const iva = Math.round((total - neto) * 100) / 100;
      return { pct, neto, iva, total };
    }
    return { pct: 0, neto: total, iva: 0, total };
  }, [prep?.movimiento.entrada, alicIva]);

  const proximoNroFmt = useMemo(() => {
    if (!prep?.emisor) return null;
    const pto = String(prep.emisor.punto_venta).padStart(5, '0');
    const nro =
      condMeta.letra === 'A'
        ? prep.proximos_numeros?.factura_a
        : prep.proximos_numeros?.factura_b;
    return nro ? `${pto}-${String(nro).padStart(8, '0')}` : `Pto. Vta. ${pto}`;
  }, [prep, condMeta.letra]);

  const qrSvgMatrix = useMemo(() => {
    if (!factura?.qr_url) return null;
    return getQrMatrix(factura.qr_url);
  }, [factura?.qr_url]);

  const persistPhoneIfChanged = async () => {
    const clienteId = prep?.cliente.id || factura?.cliente_id;
    if (!clienteId) return;
    const trimmed = telefono.trim();
    if (trimmed === initialTelefono.trim()) return;
    try {
      const res = await api<{ ok: boolean; telefono: string | null }>(
        'PATCH',
        `clientes/${clienteId}/telefono`,
        { telefono: trimmed },
      );
      setInitialTelefono(res.telefono || '');
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 2500);
      onClienteUpdated?.();
    } catch {
      // No bloquear descarga si falla actualización auxiliar
    }
  };

  const handleEmitirArca = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emitting || !prep?.emisor.configurado) return;
    if (docValidationError) {
      setErr(docValidationError);
      return;
    }

    const msgConfirm = `¿Confirmás solicitar CAE en ARCA (${prep.emisor.entorno.toUpperCase()}) para emitir FACTURA ${condMeta.letra} por ${fmtARS(importesCalc.total)} a nombre de ${receptorNombre.trim().toUpperCase()}?`;
    if (!window.confirm(msgConfirm)) return;

    setEmitting(true);
    setErr(null);
    try {
      const res = await api<{
        emitida: boolean;
        duplicado?: boolean;
        factura: FacturaArcaCompleta;
      }>('POST', `movimientos/${movimientoId}/facturar`, {
        condicion_iva: condicionIva,
        doc_nro: docDigits,
        receptor_nombre: receptorNombre,
        receptor_domicilio: receptorDomicilio,
        descripcion,
        cbte_fecha: cbteFecha,
        fch_serv_desde: servDesde,
        fch_serv_hasta: servHasta,
        fch_vto_pago: vtoPago,
        alic_iva: alicIva,
        telefono: telefono.trim(),
      });

      setFactura(res.factura);
      setInitialTelefono(telefono.trim());
      setStatusHint(
        `¡CAE autorizado por ARCA! Factura ${res.factura.cbte_letra} Nº ${res.factura.numero_formateado} lista para descargar o enviar por WhatsApp.`,
      );
      onFacturaEmitida?.(res.factura);
      onClienteUpdated?.();
    } catch (ex: any) {
      setErr(ex.message || 'No se pudo autorizar el comprobante en ARCA.');
    } finally {
      setEmitting(false);
    }
  };

  const handleDownloadOnly = () => {
    if (!factura) return;
    const fname = downloadFacturaPdf(factura);
    setStatusHint(`PDF descargado (${fname}).`);
    void persistPhoneIfChanged();
  };

  const handleDownloadAndWhatsapp = () => {
    if (!factura) return;
    const fname = downloadFacturaPdf(factura);
    openFacturaWhatsapp(factura, telefono);
    setStatusHint(
      `PDF "${fname}" descargado. Arrastralo desde tu barra de descargas al chat de WhatsApp recién abierto.`,
    );
    void persistPhoneIfChanged();
  };

  const handleNativeShare = async () => {
    if (!factura) return;
    void persistPhoneIfChanged();
    try {
      await shareFacturaPdfNative(factura);
    } catch {
      // Cancelado por usuario
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3"
      onClick={() => !emitting && onClose()}
    >
      <div
        className="flex max-h-[93vh] w-full max-w-2xl flex-col overflow-hidden rounded border border-slate-300 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera Institucional */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0F172A] px-4 py-2.5 text-white">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold tracking-tight">
              {factura
                ? `Factura Electrónica ARCA · ${factura.cbte_letra} ${factura.numero_formateado}`
                : 'Emitir Factura Electrónica ARCA (Honorarios · Transferencia)'}
            </h3>
          </div>
          <button
            type="button"
            disabled={emitting}
            onClick={onClose}
            className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40"
            title="Cerrar (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Contenido Principal */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-xs font-medium text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-[#1E3A8A]" />
              Consultando datos fiscales y estado en ARCA...
            </div>
          )}

          {err && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-xs font-medium text-red-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{err}</span>
            </div>
          )}

          {/* ================= MODO 1: PRE-EMISIÓN (FORMULARIO Y VISTA PREVIA) ================= */}
          {!loading && !factura && prep && (
            <form id="form-emitir-arca" onSubmit={handleEmitirArca} className="space-y-3">
              {!prep.emisor.configurado && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="font-bold">
                        Falta completar la configuración del Web Service de ARCA
                      </div>
                      <div className="text-[11px] text-amber-800">
                        Cargue el CUIT del estudio, el Punto de Venta y el Certificado Digital (.crt) en Configuración para habilitar la emisión de CAE.
                      </div>
                    </div>
                    {onGoToConfigArca && (
                      <button
                        type="button"
                        onClick={onGoToConfigArca}
                        className="inline-flex items-center gap-1 rounded bg-[#0F172A] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1E3A8A]"
                      >
                        <Settings className="h-3.5 w-3.5" /> Configurar ARCA
                      </button>
                    )}
                  </div>
                </div>
              )}

              {prep.aviso_ws && (
                <div className="rounded border border-amber-300 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
                  <strong>Aviso conexión ARCA:</strong> {prep.aviso_ws}
                </div>
              )}

              {/* Resumen Superior del Comprobante a Emitir */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-300 bg-slate-50 px-3.5 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 flex-col items-center justify-center rounded border-2 border-[#0F172A] bg-white">
                    <span className="text-lg font-extrabold leading-none text-[#0F172A]">
                      {condMeta.letra}
                    </span>
                    <span className="text-[9px] font-bold text-slate-500">
                      COD.{condMeta.letra === 'A' ? '001' : '006'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        FACTURA {condMeta.letra}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          prep.emisor.entorno === 'produccion'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : 'border-amber-300 bg-amber-100 text-amber-900'
                        }`}
                      >
                        {prep.emisor.entorno === 'produccion'
                          ? 'Producción Fiscal'
                          : 'Homologación (Prueba)'}
                      </span>
                    </div>
                    <div className="num text-xs text-slate-600">
                      Emisor: <strong>{prep.emisor.razon_social}</strong> ·{' '}
                      {proximoNroFmt ? `Próximo Nº ${proximoNroFmt}` : ''}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">
                    Total Cobrado (Transf.)
                  </div>
                  <div className="num text-base font-bold text-[#15803D]">
                    {fmtARS(importesCalc.total)}
                  </div>
                </div>
              </div>

              {/* Datos Fiscales del Receptor */}
              <div className="grid grid-cols-1 gap-2.5 rounded border border-slate-200 bg-white p-3 sm:grid-cols-12">
                <div className="sm:col-span-6">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Condición frente al IVA del Cliente *
                  </label>
                  <select
                    value={condicionIva}
                    onChange={(e) => setCondicionIva(e.target.value as CondicionIvaKey)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-900"
                  >
                    {CONDICIONES_IVA_OPTS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label} → Factura {opt.letra}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-6">
                  <label className="mb-0.5 flex items-center justify-between text-[11px] font-semibold uppercase text-slate-600">
                    <span>{condMeta.requiereCuit ? 'CUIT del Receptor *' : 'CUIT / DNI'}</span>
                    {docDigits.length === 11 && cuitValido && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#15803D]">
                        <Check className="h-3 w-3" /> CUIT válido
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required={condMeta.requiereCuit}
                    value={docNro}
                    onChange={(e) => setDocNro(e.target.value)}
                    placeholder={
                      condMeta.requiereCuit ? 'Ej: 20-31444555-9' : 'CUIT, DNI o vacío'
                    }
                    className={`num h-8 w-full rounded border px-2.5 text-xs font-semibold ${
                      docDigits && docValidationError
                        ? 'border-[#DC2626] bg-red-50/40'
                        : 'border-slate-300 bg-white'
                    }`}
                  />
                  {docDigits && docValidationError && (
                    <div className="mt-0.5 text-[10px] font-semibold text-[#DC2626]">
                      {docValidationError}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-6">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Apellido y Nombre / Razón Social *
                  </label>
                  <input
                    type="text"
                    required
                    value={receptorNombre}
                    onChange={(e) => setReceptorNombre(e.target.value)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs font-semibold uppercase"
                  />
                </div>

                <div className="sm:col-span-6">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Domicilio Fiscal / Comercial (opcional)
                  </label>
                  <input
                    type="text"
                    value={receptorDomicilio}
                    onChange={(e) => setReceptorDomicilio(e.target.value)}
                    placeholder="Se guarda en la ficha del cliente..."
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs"
                  />
                </div>
              </div>

              {/* Concepto, Fechas de Servicio y Alícuota IVA */}
              <div className="grid grid-cols-1 gap-2.5 rounded border border-slate-200 bg-white p-3 sm:grid-cols-12">
                <div className="sm:col-span-9">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Concepto / Descripción en la Factura *
                  </label>
                  <input
                    type="text"
                    required
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs font-semibold uppercase"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Alícuota IVA
                  </label>
                  <select
                    value={alicIva}
                    onChange={(e) => setAlicIva(e.target.value as '21' | '10.5' | '27' | '0')}
                    className="num h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold"
                  >
                    {ALICUOTAS_OPTS.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Fecha Factura
                  </label>
                  <input
                    type="date"
                    required
                    value={cbteFecha}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCbteFecha(v);
                      if (v && vtoPago < v) setVtoPago(v);
                    }}
                    className="num h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Período Desde
                  </label>
                  <input
                    type="date"
                    required
                    value={servDesde}
                    onChange={(e) => setServDesde(e.target.value)}
                    className="num h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Período Hasta
                  </label>
                  <input
                    type="date"
                    required
                    value={servHasta}
                    onChange={(e) => setServHasta(e.target.value)}
                    className="num h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Vto. de Pago
                  </label>
                  <input
                    type="date"
                    required
                    value={vtoPago}
                    onChange={(e) => setVtoPago(e.target.value)}
                    className="num h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                  />
                </div>
              </div>

              {/* Desglose Fiscal Exacto + Teléfono WhatsApp */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                <div className="rounded border border-slate-200 bg-slate-50 p-3 sm:col-span-6">
                  <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-slate-600">
                    <Phone className="h-3 w-3" /> WhatsApp del cliente (para envío luego del CAE)
                  </label>
                  <input
                    type="tel"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="Ej: 3815551234"
                    className="num h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    Los datos fiscales y el teléfono quedarán guardados en la ficha del cliente.
                  </p>
                </div>

                <div className="space-y-1 rounded border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs sm:col-span-6">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Importe Neto Gravado:</span>
                    <strong className="num text-slate-900">{fmtARS(importesCalc.neto)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">
                      {condMeta.letra === 'A'
                        ? `IVA Discriminado (${fmtNum(importesCalc.pct)}%):`
                        : `IVA Contenido Ley 27.743 (${fmtNum(importesCalc.pct)}%):`}
                    </span>
                    <strong className="num text-slate-900">{fmtARS(importesCalc.iva)}</strong>
                  </div>
                  <div className="flex justify-between border-t border-slate-300 pt-1.5 text-sm font-bold">
                    <span className="text-slate-900">IMPORTE TOTAL:</span>
                    <span className="num text-[#15803D]">{fmtARS(importesCalc.total)}</span>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ================= MODO 2: FACTURA EMITIDA CON CAE Y QR ================= */}
          {!loading && factura && (
            <>
              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3.5 py-2.5 text-xs ${
                  factura.entorno === 'produccion'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                    : 'border-amber-300 bg-amber-50 text-amber-950'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#15803D]" />
                  <div>
                    <div className="font-bold">
                      Comprobante Autorizado por ARCA · CAE Nº{' '}
                      <span className="num">{factura.cae}</span>
                    </div>
                    <div className="text-[11px] opacity-85">
                      Vencimiento CAE: <strong className="num">{fmtDate(factura.cae_vto)}</strong>
                      {factura.entorno === 'homologacion' &&
                        ' · Emitido en entorno Homologación (Prueba)'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Vista Previa de la Factura Electrónica */}
              <div className="rounded border border-slate-300 bg-white p-4 shadow-2xs">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                  <div className="max-w-[42%]">
                    <div className="text-sm font-bold uppercase text-slate-900">
                      {factura.razon_social_emisor}
                    </div>
                    {factura.domicilio_emisor && (
                      <div className="text-[11px] text-slate-600">{factura.domicilio_emisor}</div>
                    )}
                    <div className="mt-0.5 text-[11px] font-semibold text-slate-700">
                      IVA Responsable Inscripto
                    </div>
                  </div>

                  <div className="flex flex-col items-center">
                    <div className="flex h-10 w-10 flex-col items-center justify-center rounded-xs border-2 border-slate-900 bg-slate-50">
                      <span className="text-base font-extrabold leading-none text-slate-900">
                        {factura.cbte_letra}
                      </span>
                      <span className="text-[8px] font-bold text-slate-500">
                        COD. {String(factura.cbte_tipo).padStart(3, '0')}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold uppercase text-[#1E3A8A]">
                      {factura.cbte_nombre}
                    </div>
                    <div className="num text-sm font-bold text-slate-900">
                      Nº {factura.numero_formateado}
                    </div>
                    <div className="num text-[11px] text-slate-600">
                      Fecha: {fmtDate(factura.cbte_fecha)}
                    </div>
                    <div className="num text-[10px] text-slate-500">
                      CUIT: {formatCuitDisplay(factura.cuit_emisor)}
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-1 gap-1 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-[10px] font-semibold uppercase text-slate-500">
                      Receptor:{' '}
                    </span>
                    <strong className="text-slate-900">{factura.receptor_nombre}</strong>
                  </div>
                  <div className="sm:text-right">
                    <span className="text-[10px] font-semibold uppercase text-slate-500">
                      {factura.doc_tipo === 80 ? 'CUIT' : 'Doc.'}:{' '}
                    </span>
                    <strong className="num text-slate-900">
                      {factura.doc_tipo === 80
                        ? formatCuitDisplay(factura.doc_nro)
                        : factura.doc_nro !== '0'
                          ? factura.doc_nro
                          : 'Sin identificar'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase text-slate-500">
                      IVA:{' '}
                    </span>
                    <span className="font-medium text-slate-800">
                      {factura.condicion_iva_receptor}
                    </span>
                  </div>
                  <div className="num sm:text-right text-[11px] text-slate-600">
                    Período: {fmtDate(factura.fch_serv_desde)} al {fmtDate(factura.fch_serv_hasta)}
                  </div>
                </div>

                {/* Concepto facturado */}
                <div className="mt-2.5 overflow-hidden rounded border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-[#0F172A] text-[10px] uppercase text-white">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left font-semibold">
                          Producto / Servicio
                        </th>
                        {factura.cbte_tipo === 1 && (
                          <>
                            <th className="px-2 py-1.5 text-right font-semibold">Neto</th>
                            <th className="px-2 py-1.5 text-right font-semibold">IVA</th>
                          </>
                        )}
                        <th className="px-2.5 py-1.5 text-right font-semibold text-emerald-300">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-white">
                        <td className="px-2.5 py-2 font-semibold text-slate-900">
                          {factura.descripcion}
                        </td>
                        {factura.cbte_tipo === 1 && (
                          <>
                            <td className="num whitespace-nowrap px-2 py-2 text-right text-slate-700">
                              {fmtARS(factura.imp_neto)}
                            </td>
                            <td className="num whitespace-nowrap px-2 py-2 text-right text-slate-700">
                              {fmtARS(factura.imp_iva)} ({fmtNum(factura.alic_iva_pct)}%)
                            </td>
                          </>
                        )}
                        <td className="num whitespace-nowrap px-2.5 py-2 text-right font-bold text-[#0F172A]">
                          {fmtARS(factura.imp_total)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Pie de vista previa con QR SVG en vivo + CAE */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                  <div className="flex items-center gap-3">
                    {qrSvgMatrix && (
                      <svg
                        viewBox={`0 0 ${qrSvgMatrix.size + 4} ${qrSvgMatrix.size + 4}`}
                        className="h-16 w-16 shrink-0 rounded border border-slate-300 bg-white p-0.5"
                        aria-label="Código QR Oficial ARCA"
                      >
                        <rect
                          width={qrSvgMatrix.size + 4}
                          height={qrSvgMatrix.size + 4}
                          fill="#FFFFFF"
                        />
                        {qrSvgMatrix.rows.map((row, rIdx) =>
                          row.map((cell, cIdx) =>
                            cell ? (
                              <rect
                                key={`${rIdx}-${cIdx}`}
                                x={cIdx + 2}
                                y={rIdx + 2}
                                width={1.04}
                                height={1.04}
                                fill="#000000"
                              />
                            ) : null,
                          ),
                        )}
                      </svg>
                    )}
                    <div>
                      <div className="text-xs font-extrabold tracking-tight text-slate-900">
                        ARCA · Comprobante Autorizado
                      </div>
                      <div className="num text-[11px] font-semibold text-slate-700">
                        CAE Nº: {factura.cae}
                      </div>
                      <div className="num text-[11px] text-slate-500">
                        Vto. CAE: {fmtDate(factura.cae_vto)}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    {factura.cbte_tipo === 6 && (
                      <div className="num text-[10px] text-slate-500">
                        IVA Contenido (Ley 27.743): {fmtARS(factura.imp_iva)}
                      </div>
                    )}
                    <div className="text-[10px] font-bold uppercase text-slate-500">
                      Importe Total
                    </div>
                    <div className="num text-lg font-extrabold text-[#15803D]">
                      {fmtARS(factura.imp_total)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Teléfono WhatsApp para envío rápido */}
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <label className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" /> WhatsApp del cliente
                  </span>
                  {phoneSaved && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#15803D]">
                      <Check className="h-3 w-3" /> Guardado
                    </span>
                  )}
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="tel"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    onBlur={() => void persistPhoneIfChanged()}
                    placeholder="Ej: 3815551234"
                    className="num h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs"
                  />
                  {telefono.trim() !== initialTelefono.trim() && (
                    <button
                      type="button"
                      onClick={() => void persistPhoneIfChanged()}
                      className="shrink-0 rounded border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Guardar
                    </button>
                  )}
                </div>
              </div>

              {statusHint && (
                <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                  {statusHint}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pie de Acciones */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <button
            type="button"
            disabled={emitting}
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cerrar
          </button>

          {!factura ? (
            <button
              type="submit"
              form="form-emitir-arca"
              disabled={
                loading ||
                emitting ||
                !prep?.emisor.configurado ||
                Boolean(docValidationError)
              }
              className="inline-flex items-center gap-1.5 rounded bg-[#0F172A] px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[#1E3A8A] disabled:opacity-50"
            >
              {emitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Solicitando CAE en ARCA...
                </>
              ) : (
                <>
                  <FileCheck2 className="h-3.5 w-3.5 text-emerald-400" />
                  Emitir Factura {condMeta.letra} en ARCA (Obtener CAE)
                </>
              )}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {supportsNativeShare && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <Share2 className="h-3.5 w-3.5" /> Compartir PDF
                </button>
              )}

              <button
                type="button"
                onClick={handleDownloadOnly}
                className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
              >
                <Download className="h-3.5 w-3.5" /> Solo Descargar PDF
              </button>

              <button
                type="button"
                onClick={handleDownloadAndWhatsapp}
                className="inline-flex items-center gap-1.5 rounded bg-[#15803D] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[#166534]"
              >
                <MessageCircle className="h-3.5 w-3.5" /> Descargar PDF + Abrir WhatsApp
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
