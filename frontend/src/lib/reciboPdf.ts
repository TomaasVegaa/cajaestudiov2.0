import { fmtARS, fmtDate, Movimiento } from './api';

export interface ReciboEstudioInfo {
  nombre_estudio: string;
  subtitulo_estudio?: string;
  datos_contacto_estudio?: string;
}

export interface ReciboClienteInfo {
  id: number;
  nombre: string;
  cuit?: string | null;
  telefono?: string | null;
}

export interface ReciboDataInput {
  cliente: ReciboClienteInfo;
  movimientos: Movimiento[];
  estudio: ReciboEstudioInfo;
  observacion?: string;
  operador?: string | null;
}

export interface ReciboLineItem {
  id: number;
  fecha: string;
  medioLabel: string;
  etiqueta: string;
  concepto: string;
  entrada: number;
  salida: number;
}

export interface ReciboComputed {
  numero: string;
  fechaIso: string;
  fechaFmt: string;
  cliente: ReciboClienteInfo;
  estudio: ReciboEstudioInfo;
  mediosResumen: string;
  items: ReciboLineItem[];
  conceptosResumen: string;
  totalRecibido: number;
  totalPagado: number;
  diferenciaOperacion: number;
  tieneAmbos: boolean;
  importeEnLetras: string;
  observacion: string;
  operador: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------- Conversión de números a letras (Pesos Argentinos) ----------------

const UNIDADES = [
  '',
  'UN',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
  'VEINTE',
  'VEINTIÚN',
  'VEINTIDÓS',
  'VEINTITRÉS',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISÉIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
];

const DECENAS = [
  '',
  'DIEZ',
  'VEINTE',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];

const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

function seccionTresCifras(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const centenaTxt = CENTENAS[c];
  if (resto === 0) return centenaTxt;
  if (resto < 30) {
    return (centenaTxt ? centenaTxt + ' ' : '') + UNIDADES[resto];
  }
  const d = Math.floor(resto / 10);
  const u = resto % 10;
  const decenaTxt = DECENAS[d] + (u > 0 ? ' Y ' + UNIDADES[u] : '');
  return (centenaTxt ? centenaTxt + ' ' : '') + decenaTxt;
}

function enteroALetras(entero: number): string {
  if (entero === 0) return 'CERO';
  if (entero > 999_999_999_999) return String(entero);

  const milesMillones = Math.floor(entero / 1_000_000_000);
  const millones = Math.floor((entero % 1_000_000_000) / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1_000);
  const cientos = entero % 1_000;

  const partes: string[] = [];

  if (milesMillones > 0) {
    partes.push(milesMillones === 1 ? 'MIL' : `${seccionTresCifras(milesMillones)} MIL`);
    if (millones === 0) partes.push('MILLONES');
  }
  if (millones > 0) {
    if (millones === 1 && milesMillones === 0) {
      partes.push('UN MILLÓN');
    } else {
      partes.push(`${seccionTresCifras(millones)} MILLONES`);
    }
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'MIL' : `${seccionTresCifras(miles)} MIL`);
  }
  if (cientos > 0) {
    let txt = seccionTresCifras(cientos);
    if (txt.endsWith('VEINTIÚN')) {
      txt = txt.slice(0, -8) + 'VEINTIUNO';
    } else if (txt === 'UN') {
      txt = 'UNO';
    } else if (txt.endsWith(' UN')) {
      txt = txt + 'O';
    }
    partes.push(txt);
  }

  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

export function numeroALetrasARS(monto: number): string {
  const abs = Math.abs(round2(monto));
  const entero = Math.floor(abs + 1e-6);
  const centavos = Math.round((abs - entero) * 100);
  const centStr = String(centavos).padStart(2, '0');
  return `${enteroALetras(entero)} CON ${centStr}/100`;
}

// ---------------- Normalización de teléfono WhatsApp (Argentina) ----------------

export function formatWhatsappPhoneAR(raw?: string | null): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // Si empieza con 00 (prefijo internacional), quitar 00
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  // Si empieza con 549 y ya tiene 13 dígitos, dejar como está
  if (digits.startsWith('549') && digits.length >= 12) {
    return digits;
  }
  // Si empieza con 54 pero sin 9 y tiene 12 dígitos (54 + 10 dígitos locales)
  if (digits.startsWith('54') && digits.length === 12) {
    return '549' + digits.slice(2);
  }
  // Si empieza con 0 local (ej: 0381 15 5551234 o 011 44445555)
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  // Si tiene 12 dígitos por el "15" intermedio (ej: 381 15 5551234 -> 12 dígitos), remover 15 tras cód. área
  if (digits.length === 12) {
    for (const areaLen of [2, 3, 4]) {
      if (digits.slice(areaLen, areaLen + 2) === '15') {
        digits = digits.slice(0, areaLen) + digits.slice(areaLen + 2);
        break;
      }
    }
  }
  // Si quedaron 10 dígitos argentinos estándar (ej: 3815551234 o 1155551234)
  if (digits.length === 10) {
    return '549' + digits;
  }
  return digits;
}

// ---------------- Armado del modelo de datos del Recibo ----------------

export function buildReciboComputed(input: ReciboDataInput): ReciboComputed {
  const movs = input.movimientos
    .filter((m) => m.tipo_valor === 'IMPUESTOS')
    .slice()
    .sort((a, b) => a.id - b.id);

  const minId = movs.length > 0 ? Math.min(...movs.map((m) => m.id)) : 0;
  const numero = String(minId).padStart(6, '0');
  const fechaIso = movs[0]?.fecha || new Date().toISOString().slice(0, 10);
  const fechaFmt = fmtDate(fechaIso);

  const mediosSet = new Set<string>();
  const conceptosSet = new Set<string>();
  let totalRecibido = 0;
  let totalPagado = 0;

  const items: ReciboLineItem[] = movs.map((m) => {
    const medioLabel = m.medio === 'BANCO' ? 'Transferencia' : 'Efectivo';
    mediosSet.add(medioLabel.toUpperCase());
    const e = round2(m.entrada || 0);
    const s = round2(m.salida || 0);
    totalRecibido = round2(totalRecibido + e);
    totalPagado = round2(totalPagado + s);

    const rawDet = (m.detalle || '').trim();
    const isGeneric =
      rawDet === '' ||
      rawDet === 'ENTREGA PARA IMPUESTOS' ||
      rawDet === 'PAGO DE IMPUESTOS';
    if (!isGeneric) {
      conceptosSet.add(rawDet);
    }

    const etiqueta = e > 0 ? 'FONDOS RECIBIDOS' : 'IMPUESTOS ABONADOS';
    const concepto = rawDet || (e > 0 ? 'ENTREGA PARA IMPUESTOS' : 'PAGO DE IMPUESTOS');

    return {
      id: m.id,
      fecha: fmtDate(m.fecha),
      medioLabel,
      etiqueta,
      concepto,
      entrada: e,
      salida: s,
    };
  });

  const mediosResumen = Array.from(mediosSet).join(' / ') || 'EFECTIVO';
  const conceptosResumen = Array.from(conceptosSet).join(' · ');
  const diferenciaOperacion = round2(totalRecibido - totalPagado);
  const tieneAmbos = totalRecibido > 0 && totalPagado > 0;
  const baseLetras = totalRecibido > 0 ? totalRecibido : totalPagado;
  const operador =
    input.operador || movs.find((m) => m.creado_por)?.creado_por || '';

  return {
    numero,
    fechaIso,
    fechaFmt,
    cliente: input.cliente,
    estudio: {
      nombre_estudio: input.estudio.nombre_estudio || 'Estudio Contable',
      subtitulo_estudio: input.estudio.subtitulo_estudio || '',
      datos_contacto_estudio: input.estudio.datos_contacto_estudio || '',
    },
    mediosResumen,
    items,
    conceptosResumen,
    totalRecibido,
    totalPagado,
    diferenciaOperacion,
    tieneAmbos,
    importeEnLetras: numeroALetrasARS(baseLetras),
    observacion: (input.observacion || '').trim(),
    operador,
  };
}

// ---------------- Motor Vectorial PDF 1.4 (WinAnsiEncoding, 0 dependencias) ----------------

type PdfFont = 'F1' | 'F2' | 'F3'; // F1: Helvetica, F2: Helvetica-Bold, F3: Courier-Bold

const WIN1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85, // …
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function toWinAnsiLiteral(str: string): string {
  let out = '(';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    let byte = 0x3f; // '?'
    if (code >= 0x20 && code <= 0x7e) {
      byte = code;
    } else if (code >= 0xa0 && code <= 0xff) {
      byte = code;
    } else if (WIN1252_EXTRA[code] !== undefined) {
      byte = WIN1252_EXTRA[code];
    } else if (code < 0x20) {
      byte = 0x20;
    }

    if (byte === 0x28) {
      out += '\\(';
    } else if (byte === 0x29) {
      out += '\\)';
    } else if (byte === 0x5c) {
      out += '\\\\';
    } else if (byte >= 0x20 && byte <= 0x7e) {
      out += String.fromCharCode(byte);
    } else {
      out += '\\' + byte.toString(8).padStart(3, '0');
    }
  }
  out += ')';
  return out;
}

const PT_PER_MM = 72 / 25.4;
const pt = (mm: number): number => Math.round(mm * PT_PER_MM * 100) / 100;
const fmtPt = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

// Métrica AFM precisa para Helvetica / Helvetica-Bold / Courier-Bold (unidades / 1000)
function charWidthUnits(ch: string, font: PdfFont): number {
  if (font === 'F3') return 600; // Courier-Bold es 100% monoespaciada exacta (600/1000)
  const bold = font === 'F2';
  if (ch === ' ') return 278;
  if ('iIlj|!.,:;1\'"'.includes(ch)) return bold ? 295 : 260;
  if ('ftrt()-/\\[]'.includes(ch)) return bold ? 360 : 320;
  if ('sckvxyz?'.includes(ch)) return bold ? 540 : 500;
  if ('abdeghnopqu023456789$#+-=~_áéíóúñü'.includes(ch)) {
    if (ch === 'í') return bold ? 295 : 278;
    return bold ? 590 : 556;
  }
  if ('mwMW@%'.includes(ch)) return bold ? 880 : 833;
  if ('ABCDEFGHJKLNOPQRSTUVXYZÁÉÍÓÚÑÜ'.includes(ch)) {
    if (ch === 'I' || ch === 'Í') return 278;
    if (ch === 'J') return bold ? 556 : 500;
    if (ch === 'L') return bold ? 611 : 556;
    return bold ? 700 : 667;
  }
  return bold ? 590 : 556;
}

function measureTextMm(str: string, font: PdfFont, fontSizePt: number): number {
  let units = 0;
  for (let i = 0; i < str.length; i++) {
    units += charWidthUnits(str[i], font);
  }
  const widthPt = (units / 1000) * fontSizePt;
  return widthPt / PT_PER_MM;
}

function wrapTextMm(str: string, maxWidthMm: number, font: PdfFont, fontSizePt: number): string[] {
  const clean = str.replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  if (measureTextMm(clean, font, fontSizePt) <= maxWidthMm) return [clean];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (measureTextMm(candidate, font, fontSizePt) <= maxWidthMm) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // Si una sola palabra excede el ancho, partirla con seguridad
      if (measureTextMm(w, font, fontSizePt) > maxWidthMm) {
        let chunk = '';
        for (const ch of w) {
          if (measureTextMm(chunk + ch, font, fontSizePt) > maxWidthMm && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = w;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function rgbFill(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`;
}

function rgbStroke(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`;
}

export function buildReciboPdfBytes(recibo: ReciboComputed): Uint8Array {
  const W = 178; // ancho mm (formato recibo ejecutivo de alta legibilidad en móvil y A4)
  const MARGIN = 9;
  const INNER_W = W - MARGIN * 2; // 160 mm

  // Precalcular líneas envueltas de cada ítem para altura dinámica exacta
  const preparedItems = recibo.items.map((it) => {
    const conceptLines = wrapTextMm(it.concepto, 66, 'F2', 8.3);
    const rowH = Math.max(10, 5.4 + conceptLines.length * 3.8);
    return { ...it, conceptLines, rowH };
  });

  const letrasLines =
    recibo.totalRecibido > 0
      ? wrapTextMm(`Son pesos: ${recibo.importeEnLetras}.`, INNER_W - 8, 'F1', 8)
      : [];

  const obsLines = recibo.observacion
    ? wrapTextMm(recibo.observacion, INNER_W - 8, 'F1', 8)
    : [];

  // Calcular altura total dinámica para no dejar espacios muertos ni cortar contenido
  let calcY = 9; // margen superior
  calcY += 24; // encabezado estudio + caja [X] + Nº recibo
  calcY += 3;
  calcY += 16.5; // caja datos del cliente
  calcY += 3.5;
  if (recibo.totalRecibido > 0) {
    calcY += 11 + letrasLines.length * 3.6 + 3.5; // franja "Recibimos conforme"
  }
  calcY += 7.5; // cabecera de tabla
  for (const pit of preparedItems) {
    calcY += pit.rowH;
  }
  calcY += 4.5;
  const resumenH = recibo.tieneAmbos ? 23 : 16.5;
  calcY += resumenH;
  if (obsLines.length > 0) {
    calcY += 3.5 + 7 + obsLines.length * 3.6;
  }
  calcY += 14; // pie legal + margen inferior

  const H = Math.max(128, Math.ceil(calcY));

  const ops: string[] = [];

  const drawBox = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    fillHex?: string,
    strokeHex?: string,
    lineWidthPt = 0.6,
  ) => {
    const xPt = fmtPt(pt(x));
    const yPt = fmtPt(pt(H - yTop - h));
    const wPt = fmtPt(pt(w));
    const hPt = fmtPt(pt(h));
    if (fillHex && strokeHex) {
      ops.push(`${fmtPt(lineWidthPt)} w`, rgbFill(fillHex), rgbStroke(strokeHex), `${xPt} ${yPt} ${wPt} ${hPt} re B`);
    } else if (fillHex) {
      ops.push(rgbFill(fillHex), `${xPt} ${yPt} ${wPt} ${hPt} re f`);
    } else if (strokeHex) {
      ops.push(`${fmtPt(lineWidthPt)} w`, rgbStroke(strokeHex), `${xPt} ${yPt} ${wPt} ${hPt} re S`);
    }
  };

  const drawLine = (x1: number, y1Top: number, x2: number, y2Top: number, strokeHex: string, lineWidthPt = 0.5) => {
    ops.push(
      `${fmtPt(lineWidthPt)} w`,
      rgbStroke(strokeHex),
      `${fmtPt(pt(x1))} ${fmtPt(pt(H - y1Top))} m ${fmtPt(pt(x2))} ${fmtPt(pt(H - y2Top))} l S`,
    );
  };

  const drawText = (
    text: string,
    x: number,
    yBaselineTop: number,
    font: PdfFont,
    sizePt: number,
    colorHex = '#0F172A',
    align: 'left' | 'center' | 'right' = 'left',
  ) => {
    if (!text) return;
    let drawX = x;
    if (align !== 'left') {
      const wMm = measureTextMm(text, font, sizePt);
      drawX = align === 'center' ? x - wMm / 2 : x - wMm;
    }
    ops.push(
      'BT',
      rgbFill(colorHex),
      `/${font} ${fmtPt(sizePt)} Tf`,
      `${fmtPt(pt(drawX))} ${fmtPt(pt(H - yBaselineTop))} Td`,
      `${toWinAnsiLiteral(text)} Tj`,
      'ET',
    );
  };

  // 1. Fondo blanco y marco exterior tipo talonario contable suizo
  drawBox(0, 0, W, H, '#FFFFFF');
  drawBox(5.5, 5.5, W - 11, H - 11, '#FFFFFF', '#CBD5E1', 0.8);
  // Barra superior azul noche institucional
  drawBox(5.5, 5.5, W - 11, 2.2, '#0F172A');

  let y = 12;

  // 2. Encabezado: Izquierda (Estudio) | Centro ([X]) | Derecha (Recibo Nº + Fecha)
  const estudioNombre = recibo.estudio.nombre_estudio.toUpperCase();
  const estLines = wrapTextMm(estudioNombre, 58, 'F2', 11.5).slice(0, 2);
  estLines.forEach((ln, i) => {
    drawText(ln, MARGIN, y + 3.5 + i * 4.4, 'F2', 11.5, '#0F172A');
  });
  let leftSubY = y + 3.5 + estLines.length * 4.4;
  if (recibo.estudio.subtitulo_estudio) {
    const sub = wrapTextMm(recibo.estudio.subtitulo_estudio, 60, 'F1', 7.8)[0];
    drawText(sub, MARGIN, leftSubY + 0.5, 'F1', 7.8, '#475569');
    leftSubY += 3.6;
  }
  if (recibo.estudio.datos_contacto_estudio) {
    const cont = wrapTextMm(recibo.estudio.datos_contacto_estudio, 60, 'F1', 7.2)[0];
    drawText(cont, MARGIN, leftSubY + 0.3, 'F1', 7.2, '#64748B');
  }

  // Casilla central [ X ] clásica de recibo provisorio argentino
  const boxX = W / 2 - 5.5;
  drawBox(boxX, y - 0.5, 11, 11, '#F8FAFC', '#0F172A', 0.9);
  drawText('X', W / 2, y + 7.2, 'F2', 15, '#0F172A', 'center');
  drawText('DOC. NO VÁLIDO', W / 2, y + 14.2, 'F2', 5.6, '#64748B', 'center');
  drawText('COMO FACTURA', W / 2, y + 16.8, 'F2', 5.6, '#64748B', 'center');

  // Bloque derecho: Título + Nº + Fecha
  const rightEdge = W - MARGIN;
  drawText('RECIBO DE IMPUESTOS', rightEdge, y + 3.5, 'F2', 10, '#1E3A8A', 'right');
  drawText(`Nº ${recibo.numero}`, rightEdge, y + 9.2, 'F3', 11.5, '#0F172A', 'right');
  drawText(`FECHA: ${recibo.fechaFmt}`, rightEdge, y + 14.2, 'F2', 8.5, '#334155', 'right');

  y += 21.5;
  drawLine(MARGIN, y, rightEdge, y, '#CBD5E1', 0.7);
  y += 3;

  // 3. Caja de Datos del Cliente
  drawBox(MARGIN, y, INNER_W, 15.5, '#F8FAFC', '#E2E8F0', 0.6);
  drawText('CLIENTE / CONTRIBUYENTE', MARGIN + 3.5, y + 4.3, 'F2', 6.8, '#64748B');
  const cliLine = wrapTextMm(recibo.cliente.nombre, 98, 'F2', 10.2)[0];
  drawText(cliLine, MARGIN + 3.5, y + 9.3, 'F2', 10.2, '#0F172A');

  const cuitTxt = recibo.cliente.cuit ? `CUIT: ${recibo.cliente.cuit}` : 'CUIT: —';
  drawText(cuitTxt, MARGIN + 3.5, y + 13.5, 'F1', 8, '#475569');

  drawText('MODALIDAD', rightEdge - 3.5, y + 4.3, 'F2', 6.8, '#64748B', 'right');
  drawText(recibo.mediosResumen, rightEdge - 3.5, y + 9.3, 'F2', 9, '#0F172A', 'right');

  y += 19;

  // 4. Franja "Recibimos del cliente" (si entregó dinero en esta operación)
  if (recibo.totalRecibido > 0) {
    const recBoxH = 9.5 + letrasLines.length * 3.6;
    drawBox(MARGIN, y, INNER_W, recBoxH, '#F0FDF4', '#BBF7D0', 0.6);
    drawText('RECIBIMOS CONFORME LA SUMA DE:', MARGIN + 3.5, y + 5.6, 'F2', 8, '#166534');
    drawText(fmtARS(recibo.totalRecibido), rightEdge - 3.5, y + 6.1, 'F3', 11.5, '#15803D', 'right');

    letrasLines.forEach((ln, idx) => {
      drawText(ln, MARGIN + 3.5, y + 9.8 + idx * 3.6, 'F1', 7.8, '#334155');
    });
    y += recBoxH + 3.5;
  }

  // 5. Tabla de Detalle de la Operación
  const colConceptoX = MARGIN + 3;
  const colMedioX = MARGIN + 73;
  const colRecibidoRight = MARGIN + 123;
  const colPagadoRight = rightEdge - 3;

  drawBox(MARGIN, y, INNER_W, 7, '#0F172A');
  drawText('DETALLE / CONCEPTOS DE LA OPERACIÓN', colConceptoX, y + 4.7, 'F2', 7.2, '#FFFFFF');
  drawText('MEDIO', colMedioX, y + 4.7, 'F2', 7.2, '#CBD5E1');
  drawText('RECIBIDO', colRecibidoRight, y + 4.7, 'F2', 7.2, '#86EFAC', 'right');
  drawText('PAGADO', colPagadoRight, y + 4.7, 'F2', 7.2, '#FCA5A5', 'right');
  y += 7;

  preparedItems.forEach((pit, idx) => {
    const bg = idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
    drawBox(MARGIN, y, INNER_W, pit.rowH, bg, '#E2E8F0', 0.4);

    // Etiqueta superior pequeña (FONDOS RECIBIDOS o IMPUESTOS ABONADOS)
    const tagColor = pit.entrada > 0 ? '#15803D' : '#1E3A8A';
    drawText(pit.etiqueta, colConceptoX, y + 3.6, 'F2', 6.4, tagColor);

    pit.conceptLines.forEach((cl, lIdx) => {
      drawText(cl, colConceptoX, y + 7.2 + lIdx * 3.6, 'F2', 8.5, '#0F172A');
    });

    drawText(pit.medioLabel, colMedioX, y + 6.5, 'F1', 8, '#334155');

    if (pit.entrada > 0) {
      drawText(fmtARS(pit.entrada), colRecibidoRight, y + 6.7, 'F3', 8.8, '#15803D', 'right');
    } else {
      drawText('-', colRecibidoRight, y + 6.7, 'F1', 8.5, '#94A3B8', 'right');
    }

    if (pit.salida > 0) {
      drawText(fmtARS(pit.salida), colPagadoRight, y + 6.7, 'F3', 8.8, '#B91C1C', 'right');
    } else {
      drawText('-', colPagadoRight, y + 6.7, 'F1', 8.5, '#94A3B8', 'right');
    }

    y += pit.rowH;
  });

  y += 4;

  // 6. Cuadro de Resumen de ESTA Operación (sin saldos anteriores)
  const sumW = 96;
  const sumX = rightEdge - sumW;
  drawBox(sumX, y, sumW, resumenH, '#F8FAFC', '#CBD5E1', 0.7);

  drawText('Total recibido del cliente:', sumX + 3.5, y + 5.2, 'F1', 8.2, '#334155');
  drawText(fmtARS(recibo.totalRecibido), rightEdge - 3.5, y + 5.3, 'F3', 9.2, '#15803D', 'right');

  drawText('Total impuestos abonados:', sumX + 3.5, y + 10.6, 'F1', 8.2, '#334155');
  drawText(
    recibo.totalPagado > 0 ? fmtARS(recibo.totalPagado) : '$ 0,00',
    rightEdge - 3.5,
    y + 10.7,
    'F3',
    9.2,
    recibo.totalPagado > 0 ? '#B91C1C' : '#64748B',
    'right',
  );

  if (recibo.tieneAmbos) {
    drawLine(sumX + 3, y + 13.6, rightEdge - 3, y + 13.6, '#CBD5E1', 0.6);
    const dif = recibo.diferenciaOperacion;
    let difLabel = 'Diferencia de la operación:';
    let difColor = '#0F172A';
    if (Math.abs(dif) < 0.005) {
      difLabel = 'Resultado (cubierto exacto):';
      difColor = '#0F172A';
    } else if (dif > 0) {
      difLabel = 'Excedente de esta operación:';
      difColor = '#15803D';
    } else {
      difLabel = 'Diferencia a cubrir de hoy:';
      difColor = '#DC2626';
    }
    drawText(difLabel, sumX + 3.5, y + 18.8, 'F2', 8.2, '#0F172A');
    drawText(fmtARS(dif), rightEdge - 3.5, y + 19, 'F3', 9.8, difColor, 'right');
  } else if (recibo.totalPagado === 0 && recibo.totalRecibido > 0) {
    drawText(
      'Fondos recibidos p/ pago de impuestos',
      sumX + 3.5,
      y + 14.6,
      'F1',
      7.2,
      '#64748B',
    );
  }

  y += resumenH;

  // 7. Observaciones opcionales
  if (obsLines.length > 0) {
    y += 3.5;
    const obsBoxH = 6.5 + obsLines.length * 3.6;
    drawBox(MARGIN, y, INNER_W, obsBoxH, '#FFFBEB', '#FDE68A', 0.5);
    drawText('OBSERVACIONES:', MARGIN + 3, y + 4.2, 'F2', 6.8, '#92400E');
    obsLines.forEach((ln, idx) => {
      drawText(ln, MARGIN + 3, y + 7.8 + idx * 3.6, 'F1', 7.8, '#78350F');
    });
    y += obsBoxH;
  }

  // 8. Pie del comprobante
  const footerY = H - 10.5;
  drawLine(MARGIN, footerY - 3, rightEdge, footerY - 3, '#E2E8F0', 0.5);
  drawText(
    'Constancia de recepción de fondos y pago de impuestos por cuenta y orden del cliente.',
    MARGIN,
    footerY,
    'F1',
    6.8,
    '#64748B',
  );
  if (recibo.operador) {
    drawText(`Atendió: ${recibo.operador}`, rightEdge, footerY, 'F1', 6.8, '#64748B', 'right');
  }

  // Ensamblar objetos PDF 1.4 puros en ASCII exacto
  const streamContent = ops.join('\n');
  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmtPt(pt(W))} ${fmtPt(pt(H))}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>\nendobj`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj`,
    `6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>\nendobj`,
    `7 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

// ---------------- Nombre de archivo, Descarga, Share Móvil y WhatsApp ----------------

export function getReciboFilename(recibo: ReciboComputed): string {
  const safeName = recibo.cliente.nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
  return `Recibo_${recibo.numero}_${safeName || 'Cliente'}_${recibo.fechaIso}.pdf`;
}

export function createReciboPdfBlob(recibo: ReciboComputed): Blob {
  const bytes = buildReciboPdfBytes(recibo);
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

export function downloadReciboPdf(recibo: ReciboComputed): string {
  const filename = getReciboFilename(recibo);
  const blob = createReciboPdfBlob(recibo);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  return filename;
}

export function canNativeSharePdf(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;
    const testFile = new File([new Uint8Array([37, 80, 68, 70])], 'recibo.pdf', {
      type: 'application/pdf',
    });
    return navigator.canShare({ files: [testFile] });
  } catch {
    return false;
  }
}

export async function shareReciboPdfNative(recibo: ReciboComputed): Promise<boolean> {
  const filename = getReciboFilename(recibo);
  const blob = createReciboPdfBlob(recibo);
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      title: `Recibo Nº ${recibo.numero} - ${recibo.cliente.nombre}`,
      text: buildReciboWhatsappText(recibo),
      files: [file],
    });
    return true;
  }
  return false;
}

export function buildReciboWhatsappText(recibo: ReciboComputed): string {
  const lines: string[] = [
    `Hola *${recibo.cliente.nombre}*, te enviamos el comprobante de impuestos del *${recibo.fechaFmt}* (Recibo Nº ${recibo.numero}):`,
    '',
  ];

  if (recibo.totalRecibido > 0) {
    lines.push(`• *Recibido (${recibo.mediosResumen}):* ${fmtARS(recibo.totalRecibido)}`);
  }
  if (recibo.totalPagado > 0) {
    const det = recibo.conceptosResumen ? ` (${recibo.conceptosResumen})` : '';
    lines.push(`• *Impuestos abonados:* ${fmtARS(recibo.totalPagado)}${det}`);
  } else if (recibo.conceptosResumen) {
    lines.push(`• *Concepto / Impuestos:* ${recibo.conceptosResumen}`);
  }

  if (recibo.tieneAmbos) {
    const dif = recibo.diferenciaOperacion;
    if (Math.abs(dif) < 0.005) {
      lines.push(`• *Estado:* Importe exacto cubierto ($ 0,00)`);
    } else if (dif > 0) {
      lines.push(`• *Excedente de la operación (a favor):* ${fmtARS(dif)}`);
    } else {
      lines.push(`• *Diferencia de la operación (a cubrir):* ${fmtARS(dif)}`);
    }
  }

  if (recibo.observacion) {
    lines.push(`• *Nota:* ${recibo.observacion}`);
  }

  lines.push('');
  lines.push('📎 _Adjuntamos el recibo en PDF a continuación._');
  lines.push(`*${recibo.estudio.nombre_estudio}*`);
  return lines.join('\n');
}

export function openReciboWhatsapp(recibo: ReciboComputed, rawPhone?: string | null): void {
  const txt = encodeURIComponent(buildReciboWhatsappText(recibo));
  const phone = formatWhatsappPhoneAR(rawPhone ?? recibo.cliente.telefono);
  const url = phone ? `https://wa.me/${phone}?text=${txt}` : `https://wa.me/?text=${txt}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
