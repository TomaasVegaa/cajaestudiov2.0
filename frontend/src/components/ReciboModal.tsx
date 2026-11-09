import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  FileText,
  MessageCircle,
  Phone,
  Share2,
  X,
} from 'lucide-react';
import {
  api,
  AppConfig,
  fmtARS,
  fmtDate,
  Movimiento,
  ReciboApiResponse,
} from '../lib/api';
import {
  buildReciboComputed,
  canNativeSharePdf,
  downloadReciboPdf,
  openReciboWhatsapp,
  ReciboClienteInfo,
  shareReciboPdfNative,
} from '../lib/reciboPdf';
import { FIRMA_SELLO_IMAGE, FIRMA_SELLO_INFO } from '../lib/firmaSelloAsset';

export interface ReciboSeed {
  movimientoId: number;
  cliente?: ReciboClienteInfo;
  movimientosIniciales?: Movimiento[];
}

interface Props {
  seed: ReciboSeed;
  config: AppConfig | null;
  operadorNombre?: string | null;
  onClose: () => void;
  onClientePhoneUpdated?: (clienteId: number, telefono: string | null) => void;
}

export function ReciboModal({
  seed,
  config,
  operadorNombre,
  onClose,
  onClientePhoneUpdated,
}: Props) {
  const [loading, setLoading] = useState(!seed.movimientosIniciales?.length);
  const [err, setErr] = useState<string | null>(null);

  const [cliente, setCliente] = useState<ReciboClienteInfo | null>(seed.cliente || null);
  const [opMovs, setOpMovs] = useState<Movimiento[]>(seed.movimientosIniciales || []);
  const [otrosDia, setOtrosDia] = useState<Movimiento[]>([]);
  const [selectedExtraIds, setSelectedExtraIds] = useState<number[]>([]);

  const [estudio, setEstudio] = useState({
    nombre_estudio: config?.nombre_estudio || 'Estudio Contable',
    subtitulo_estudio: config?.subtitulo_estudio || '',
    datos_contacto_estudio: config?.datos_contacto_estudio || '',
  });

  const [telefono, setTelefono] = useState(seed.cliente?.telefono || '');
  const [initialTelefono, setInitialTelefono] = useState(seed.cliente?.telefono || '');
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);

  const [observacion, setObservacion] = useState('');
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const supportsNativeShare = useMemo(() => canNativeSharePdf(), []);

  useEffect(() => {
    let cancelled = false;
    api<ReciboApiResponse>('GET', `movimientos/${seed.movimientoId}/recibo`)
      .then((res) => {
        if (cancelled) return;
        setCliente(res.cliente);
        setOpMovs(res.movimientos_operacion);
        setOtrosDia(res.otros_mismo_dia || []);
        setEstudio({
          nombre_estudio: res.estudio.nombre_estudio || 'Estudio Contable',
          subtitulo_estudio: res.estudio.subtitulo_estudio || '',
          datos_contacto_estudio: res.estudio.datos_contacto_estudio || '',
        });
        const tel = res.cliente.telefono || '';
        setTelefono(tel);
        setInitialTelefono(tel);
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        if (!seed.movimientosIniciales?.length) {
          setErr(e.message || 'No se pudo obtener la información del recibo');
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seed.movimientoId, seed.movimientosIniciales]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeMovs = useMemo(() => {
    const extras = otrosDia.filter((m) => selectedExtraIds.includes(m.id));
    return [...opMovs, ...extras];
  }, [opMovs, otrosDia, selectedExtraIds]);

  const recibo = useMemo(() => {
    if (!cliente || activeMovs.length === 0) return null;
    return buildReciboComputed({
      cliente: { ...cliente, telefono },
      movimientos: activeMovs,
      estudio,
      observacion,
      operador: operadorNombre,
    });
  }, [cliente, telefono, activeMovs, estudio, observacion, operadorNombre]);

  const persistPhoneIfChanged = async () => {
    if (!cliente) return;
    const trimmed = telefono.trim();
    if (trimmed === initialTelefono.trim()) return;
    setSavingPhone(true);
    try {
      const res = await api<{ ok: boolean; telefono: string | null }>(
        'PATCH',
        `clientes/${cliente.id}/telefono`,
        { telefono: trimmed },
      );
      setInitialTelefono(res.telefono || '');
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 2500);
      onClientePhoneUpdated?.(cliente.id, res.telefono);
    } catch {
      // No bloquear la descarga/envío si falla el guardado auxiliar del teléfono
    } finally {
      setSavingPhone(false);
    }
  };

  const handleDownloadOnly = () => {
    if (!recibo) return;
    const fname = downloadReciboPdf(recibo);
    setStatusHint(`PDF descargado (${fname}).`);
    void persistPhoneIfChanged();
  };

  const handleDownloadAndWhatsapp = () => {
    if (!recibo) return;
    // Ejecutar ambos de forma 100% sincrónica en el evento de clic para evitar bloqueadores de popups
    const fname = downloadReciboPdf(recibo);
    openReciboWhatsapp(recibo, telefono);
    setStatusHint(
      `PDF "${fname}" descargado. Arrastralo desde la barra de descargas al chat de WhatsApp recién abierto.`,
    );
    void persistPhoneIfChanged();
  };

  const handleNativeShare = async () => {
    if (!recibo) return;
    void persistPhoneIfChanged();
    try {
      await shareReciboPdfNative(recibo);
    } catch {
      // Usuario canceló menú nativo
    }
  };

  const toggleExtra = (id: number) => {
    setSelectedExtraIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded border border-slate-300 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F172A] px-4 py-2.5 text-white">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold tracking-tight">
              Recibo Digital de Impuestos {recibo ? `· Nº ${recibo.numero}` : ''}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
            title="Cerrar (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Cuerpo scrolleable */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading && (
            <div className="py-10 text-center text-xs text-slate-500">
              Preparando comprobante...
            </div>
          )}

          {err && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
              {err}
            </div>
          )}

          {recibo && (
            <>
              {/* Selector opcional si existen otros movimientos del mismo cliente en el mismo día */}
              {otrosDia.length > 0 && (
                <div className="rounded border border-blue-200 bg-blue-50/70 p-2.5 text-xs">
                  <div className="mb-1.5 font-semibold text-[#1E3A8A]">
                    Otros movimientos de Impuestos de {recibo.cliente.nombre} el {recibo.fechaFmt}:
                  </div>
                  <div className="space-y-1">
                    {otrosDia.map((om) => {
                      const checked = selectedExtraIds.includes(om.id);
                      return (
                        <label
                          key={om.id}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded border border-blue-200/80 bg-white px-2.5 py-1.5 hover:bg-blue-50/50"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleExtra(om.id)}
                              className="h-3.5 w-3.5 accent-[#1E3A8A]"
                            />
                            <span className="font-medium text-slate-800">
                              {om.entrada > 0 ? 'Entrada' : 'Salida'} (
                              {om.medio === 'BANCO' ? 'Transf.' : 'Efectivo'}): {om.detalle}
                            </span>
                          </span>
                          <span
                            className={`num font-bold ${
                              om.entrada > 0 ? 'text-[#15803D]' : 'text-[#DC2626]'
                            }`}
                          >
                            {om.entrada > 0 ? `+${fmtARS(om.entrada)}` : `-${fmtARS(om.salida)}`}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Vista previa fiel del talonario / recibo */}
              <div className="rounded border border-slate-300 bg-white p-4 shadow-2xs">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                  <div>
                    <div className="text-sm font-bold uppercase text-slate-900">
                      {recibo.estudio.nombre_estudio}
                    </div>
                    {recibo.estudio.subtitulo_estudio && (
                      <div className="text-[11px] text-slate-600">
                        {recibo.estudio.subtitulo_estudio}
                      </div>
                    )}
                    {recibo.estudio.datos_contacto_estudio && (
                      <div className="text-[11px] text-slate-500">
                        {recibo.estudio.datos_contacto_estudio}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xs border border-slate-900 bg-slate-50 text-sm font-bold text-slate-900">
                      X
                    </div>
                    <span className="mt-0.5 text-[9px] font-semibold uppercase text-slate-400">
                      No válido c/ factura
                    </span>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold uppercase text-[#1E3A8A]">
                      Recibo de Impuestos
                    </div>
                    <div className="num text-sm font-bold text-slate-900">Nº {recibo.numero}</div>
                    <div className="num text-[11px] font-medium text-slate-600">
                      Fecha: {recibo.fechaFmt}
                    </div>
                  </div>
                </div>

                {/* Datos del cliente */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <div>
                    <span className="text-[10px] font-semibold uppercase text-slate-500">
                      Cliente:{' '}
                    </span>
                    <strong className="text-slate-900">{recibo.cliente.nombre}</strong>
                    {recibo.cliente.cuit && (
                      <span className="num ml-2 text-slate-600">CUIT: {recibo.cliente.cuit}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase text-slate-500">
                      Modalidad:{' '}
                    </span>
                    <strong className="text-slate-900">{recibo.mediosResumen}</strong>
                  </div>
                </div>

                {/* Franja monto recibido en letras */}
                {recibo.totalRecibido > 0 && (
                  <div className="mt-2.5 rounded border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase text-emerald-900">
                        Recibimos conforme la suma de:
                      </span>
                      <span className="num text-sm font-bold text-[#15803D]">
                        {fmtARS(recibo.totalRecibido)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-700">
                      Son pesos: {recibo.importeEnLetras}.
                    </div>
                  </div>
                )}

                {/* Tabla de conceptos de la operación puntual */}
                <div className="mt-2.5 overflow-hidden rounded border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-[#0F172A] text-[10px] uppercase text-white">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left font-semibold">
                          Detalle / Conceptos de la operación
                        </th>
                        <th className="px-2 py-1.5 text-left font-semibold">Medio</th>
                        <th className="px-2.5 py-1.5 text-right font-semibold text-emerald-300">
                          Recibido
                        </th>
                        <th className="px-2.5 py-1.5 text-right font-semibold text-rose-300">
                          Pagado
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {recibo.items.map((it) => (
                        <tr key={it.id} className="bg-white">
                          <td className="px-2.5 py-1.5">
                            <div
                              className={`text-[10px] font-bold ${
                                it.entrada > 0 ? 'text-[#15803D]' : 'text-[#1E3A8A]'
                              }`}
                            >
                              {it.etiqueta}
                            </div>
                            <div className="font-semibold text-slate-900">{it.concepto}</div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                            {it.medioLabel}
                          </td>
                          <td className="num whitespace-nowrap px-2.5 py-1.5 text-right font-semibold text-[#15803D]">
                            {it.entrada > 0 ? fmtARS(it.entrada) : '—'}
                          </td>
                          <td className="num whitespace-nowrap px-2.5 py-1.5 text-right font-semibold text-[#DC2626]">
                            {it.salida > 0 ? fmtARS(it.salida) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Resumen de la Operación y Certificación Profesional */}
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                  {/* Tarjeta de Certificación Oficial de la Contadora (Firma + Sello) */}
                  <div className="flex flex-col justify-between rounded border border-slate-300 bg-slate-50 p-2.5 sm:col-span-5">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A8A]">
                        Certificación Profesional
                      </span>
                      <span className="text-[9px] font-semibold text-slate-500">
                        {FIRMA_SELLO_INFO.matricula}
                      </span>
                    </div>

                    <div className="my-1.5 flex items-center justify-center py-0.5">
                      <img
                        src={FIRMA_SELLO_IMAGE.pngDataUrl}
                        alt="Firma y Sello C.P.N. Lorena Jerez"
                        className="h-16 w-auto object-contain"
                      />
                    </div>

                    <div className="border-t border-slate-200 pt-1 text-center text-[10px] text-slate-600">
                      Firma y Sello Digital · <strong>{FIRMA_SELLO_INFO.nombre}</strong> (CUIT{' '}
                      {FIRMA_SELLO_INFO.cuit})
                    </div>
                  </div>

                  {/* Resumen exclusivo de esta operación (sin saldos anteriores) */}
                  <div className="flex flex-col justify-between space-y-1 rounded border border-slate-300 bg-slate-50 p-2.5 text-xs sm:col-span-7">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Total recibido del cliente:</span>
                        <strong className="num text-[#15803D]">
                          {fmtARS(recibo.totalRecibido)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Total impuestos abonados:</span>
                        <strong
                          className={`num ${
                            recibo.totalPagado > 0 ? 'text-[#DC2626]' : 'text-slate-500'
                          }`}
                        >
                          {fmtARS(recibo.totalPagado)}
                        </strong>
                      </div>
                      {recibo.tieneAmbos && (
                        <div className="flex justify-between border-t border-slate-300 pt-1 font-bold">
                          <span className="text-slate-900">
                            {Math.abs(recibo.diferenciaOperacion) < 0.005
                              ? 'Resultado (cubierto exacto):'
                              : recibo.diferenciaOperacion > 0
                                ? 'Excedente de esta operación:'
                                : 'Diferencia a cubrir de hoy:'}
                          </span>
                          <span
                            className={`num ${
                              recibo.diferenciaOperacion < -0.005
                                ? 'text-[#DC2626]'
                                : recibo.diferenciaOperacion > 0.005
                                  ? 'text-[#15803D]'
                                  : 'text-slate-900'
                            }`}
                          >
                            {fmtARS(recibo.diferenciaOperacion)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-200 pt-1 text-[10px] text-slate-500">
                      * Fondos en custodia aplicados al pago tributario por cuenta y orden del cliente.
                    </div>
                  </div>
                </div>
              </div>

              {/* Configuración rápida de envío: Teléfono WhatsApp + Observación opcional */}
              <div className="grid grid-cols-1 gap-2.5 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <label className="mb-0.5 flex items-center justify-between text-[11px] font-semibold uppercase text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> WhatsApp del cliente
                    </span>
                    {phoneSaved && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#15803D]">
                        <Check className="h-3 w-3" /> Guardado
                      </span>
                    )}
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="tel"
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                      onBlur={() => void persistPhoneIfChanged()}
                      placeholder="Ej: 3815551234"
                      className="num h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
                    />
                    {telefono.trim() !== initialTelefono.trim() && (
                      <button
                        type="button"
                        disabled={savingPhone}
                        onClick={() => void persistPhoneIfChanged()}
                        className="shrink-0 rounded border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Guardar
                      </button>
                    )}
                  </div>
                </div>

                <div className="sm:col-span-7">
                  <label className="mb-0.5 block text-[11px] font-semibold uppercase text-slate-600">
                    Observación opcional en el PDF
                  </label>
                  <input
                    type="text"
                    value={observacion}
                    onChange={(e) => setObservacion(e.target.value)}
                    placeholder="Ej: Comprobantes VEP adjuntos / Sujeto a acreditación..."
                    maxLength={140}
                    className="h-8 w-full rounded border border-slate-300 bg-white px-2.5 text-xs"
                  />
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

        {/* Botonera de Acciones */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cerrar
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {supportsNativeShare && (
              <button
                type="button"
                disabled={!recibo}
                onClick={handleNativeShare}
                className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5" /> Compartir PDF
              </button>
            )}

            <button
              type="button"
              disabled={!recibo}
              onClick={handleDownloadOnly}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Solo Descargar PDF
            </button>

            <button
              type="button"
              disabled={!recibo}
              onClick={handleDownloadAndWhatsapp}
              className="inline-flex items-center gap-1.5 rounded bg-[#15803D] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[#166534] disabled:opacity-50"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Descargar PDF + Abrir WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

