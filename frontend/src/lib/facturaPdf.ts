import * as QRCode from 'qrcode';
import { FacturaArcaCompleta, fmtARS, fmtDate, fmtNum } from './api';
import { canNativeSharePdf, formatWhatsappPhoneAR, numeroALetrasARS } from './reciboPdf';

// ---------------- Validación y formato de CUIT (Módulo 11 ARCA) ----------------

export function cleanDigits(raw?: string | null): string {
  return (raw || '').replace(/\D+/g, '');
}

export function isValidCuitAR(raw?: string | null): boolean {
  const cuit = cleanDigits(raw);
  if (cuit.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(cuit[i]) * weights[i];
  }
  let mod = 11 - (sum % 11);
  if (mod === 11) mod = 0;
  else if (mod === 10) mod = 9;
  return mod === Number(cuit[10]);
}

export function formatCuitDisplay(raw?: string | null): string {
  const d = cleanDigits(raw);
  if (d.length === 11) {
    return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  }
  return (raw || '').trim() || '—';
}

export function getQrMatrix(qrUrl: string): { size: number; rows: boolean[][] } {
  const qr = QRCode.create(qrUrl || 'https://www.afip.gob.ar/fe/qr/', {
    errorCorrectionLevel: 'M',
  });
  const size = qr.modules.size;
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const line: boolean[] = [];
    for (let c = 0; c < size; c++) {
      line.push(Boolean(qr.modules.get(r, c)));
    }
    rows.push(line);
  }
  return { size, rows };
}

// ---------------- Motor Vectorial PDF 1.4 A4 (Factura Electrónica ARCA) ----------------

type PdfFont = 'F1' | 'F2' | 'F3'; // F1: Helvetica, F2: Helvetica-Bold, F3: Courier-Bold

const WIN1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
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
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
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
    let byte = 0x3f;
    if (code >= 0x20 && code <= 0x7e) {
      byte = code;
    } else if (code >= 0xa0 && code <= 0xff) {
      byte = code;
    } else if (WIN1252_EXTRA[code] !== undefined) {
      byte = WIN1252_EXTRA[code];
    } else if (code < 0x20) {
      byte = 0x20;
    }

    if (byte === 0x28) out += '\\(';
    else if (byte === 0x29) out += '\\)';
    else if (byte === 0x5c) out += '\\\\';
    else if (byte >= 0x20 && byte <= 0x7e) out += String.fromCharCode(byte);
    else out += '\\' + byte.toString(8).padStart(3, '0');
  }
  out += ')';
  return out;
}

const PT_PER_MM = 72 / 25.4;
const pt = (mm: number): number => Math.round(mm * PT_PER_MM * 100) / 100;
const fmtPt = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

function charWidthUnits(ch: string, font: PdfFont): number {
  if (font === 'F3') return 600;
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
  return ((units / 1000) * fontSizePt) / PT_PER_MM;
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

export function buildFacturaPdfBytes(factura: FacturaArcaCompleta): Uint8Array {
  const W = 210; // A4 estándar oficial
  const H = 297;
  const MARGIN = 10;
  const INNER_W = W - MARGIN * 2; // 190 mm
  const rightEdge = W - MARGIN; // 200 mm
  const midX = W / 2; // 105 mm

  const esFacturaA = factura.cbte_tipo === 1;
  const codStr = `COD. ${String(factura.cbte_tipo).padStart(3, '0')}`;
  const ptoStr = String(factura.punto_venta).padStart(5, '0');
  const nroStr = String(factura.cbte_numero).padStart(8, '0');

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
      ops.push(
        `${fmtPt(lineWidthPt)} w`,
        rgbFill(fillHex),
        rgbStroke(strokeHex),
        `${xPt} ${yPt} ${wPt} ${hPt} re B`,
      );
    } else if (fillHex) {
      ops.push(rgbFill(fillHex), `${xPt} ${yPt} ${wPt} ${hPt} re f`);
    } else if (strokeHex) {
      ops.push(`${fmtPt(lineWidthPt)} w`, rgbStroke(strokeHex), `${xPt} ${yPt} ${wPt} ${hPt} re S`);
    }
  };

  const drawLine = (
    x1: number,
    y1Top: number,
    x2: number,
    y2Top: number,
    strokeHex: string,
    lineWidthPt = 0.6,
  ) => {
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

  // Fondo general A4
  drawBox(0, 0, W, H, '#FFFFFF');
  // Marco general exterior del comprobante
  drawBox(MARGIN, MARGIN, INNER_W, H - MARGIN * 2, '#FFFFFF', '#94A3B8', 0.8);

  // 1. Franja Superior: ORIGINAL (o aviso Homologación)
  if (factura.entorno === 'homologacion') {
    drawBox(MARGIN, 10, INNER_W, 8, '#FEF3C7', '#94A3B8', 0.8);
    drawText(
      'ORIGINAL  ·  ENTORNO DE PRUEBA (HOMOLOGACIÓN) - SIN VALIDEZ FISCAL',
      midX,
      15.3,
      'F2',
      8.5,
      '#92400E',
      'center',
    );
  } else {
    drawBox(MARGIN, 10, INNER_W, 8, '#F8FAFC', '#94A3B8', 0.8);
    drawText('ORIGINAL', midX, 15.4, 'F2', 9.5, '#0F172A', 'center');
  }

  // 2. Cabecera Dividida: Emisor (Izquierda) | Letra [A/B] | Factura (Derecha)
  drawBox(MARGIN, 18, INNER_W, 46, '#FFFFFF', '#94A3B8', 0.8);
  // Divisor vertical debajo del recuadro de letra
  drawLine(midX, 36, midX, 64, '#94A3B8', 0.7);

  // Casilla central [ A ] / [ B ]
  drawBox(midX - 9, 18, 18, 18, '#F8FAFC', '#0F172A', 1.1);
  drawText(factura.cbte_letra, midX, 29.5, 'F2', 22, '#0F172A', 'center');
  drawText(codStr, midX, 34.4, 'F2', 6.8, '#475569', 'center');

  // Columna Izquierda: Emisor
  const emisorLines = wrapTextMm(
    (factura.razon_social_emisor || 'ESTUDIO CONTABLE').toUpperCase(),
    78,
    'F2',
    11.5,
  ).slice(0, 2);
  emisorLines.forEach((ln, idx) => {
    drawText(ln, 14, 25.5 + idx * 4.6, 'F2', 11.5, '#0F172A');
  });

  drawText('Domicilio Comercial:', 14, 42, 'F2', 7.5, '#475569');
  const domEmisorLines = wrapTextMm(factura.domicilio_emisor || '—', 78, 'F1', 8).slice(0, 2);
  domEmisorLines.forEach((ln, idx) => {
    drawText(ln, 14, 46 + idx * 3.8, 'F1', 8, '#0F172A');
  });

  drawText('Condición frente al IVA:', 14, 59.5, 'F2', 7.5, '#475569');
  drawText('IVA Responsable Inscripto', 47, 59.5, 'F2', 8.2, '#0F172A');

  // Columna Derecha: Datos de la Factura
  drawText('FACTURA', 118, 26, 'F2', 15, '#0F172A');

  drawText('Punto de Venta:', 118, 33.5, 'F2', 7.8, '#475569');
  drawText(ptoStr, 141.5, 33.6, 'F3', 9.5, '#0F172A');
  drawText('Comp. Nro:', 156, 33.5, 'F2', 7.8, '#475569');
  drawText(nroStr, 173, 33.6, 'F3', 9.5, '#0F172A');

  drawText('Fecha de Emisión:', 118, 40.5, 'F2', 8, '#475569');
  drawText(fmtDate(factura.cbte_fecha), 146, 40.6, 'F2', 9, '#0F172A');

  drawText('CUIT:', 118, 48, 'F2', 7.8, '#475569');
  drawText(formatCuitDisplay(factura.cuit_emisor), 128, 48, 'F3', 8.8, '#0F172A');

  drawText('Ingresos Brutos:', 118, 53.5, 'F2', 7.5, '#475569');
  const iibbTxt = wrapTextMm(factura.iibb_emisor || '—', 52, 'F1', 8)[0];
  drawText(iibbTxt, 142, 53.5, 'F1', 8, '#0F172A');

  drawText('Fecha de Inicio de Actividades:', 118, 59.5, 'F2', 7.5, '#475569');
  drawText(
    factura.inicio_act_emisor ? fmtDate(factura.inicio_act_emisor) : '—',
    161,
    59.5,
    'F1',
    8,
    '#0F172A',
  );

  // 3. Franja de Período Facturado (Servicios)
  drawBox(MARGIN, 64, INNER_W, 9, '#F8FAFC', '#94A3B8', 0.7);
  drawText('Período Facturado Desde:', 14, 69.8, 'F2', 7.8, '#475569');
  drawText(fmtDate(factura.fch_serv_desde), 50.5, 69.8, 'F2', 8.3, '#0F172A');

  drawText('Hasta:', 84, 69.8, 'F2', 7.8, '#475569');
  drawText(fmtDate(factura.fch_serv_hasta), 94.5, 69.8, 'F2', 8.3, '#0F172A');

  drawText(
    `Fecha de Vto. para el pago: ${fmtDate(factura.fch_vto_pago)}`,
    rightEdge - 4,
    69.8,
    'F2',
    8,
    '#0F172A',
    'right',
  );

  // 4. Datos del Receptor
  drawBox(MARGIN, 73, INNER_W, 24, '#FFFFFF', '#94A3B8', 0.7);

  const docTipoLabel =
    factura.doc_tipo === 80 ? 'CUIT' : factura.doc_tipo === 96 ? 'DNI' : 'Doc.';
  const docValStr =
    factura.doc_tipo === 80
      ? formatCuitDisplay(factura.doc_nro)
      : factura.doc_nro && factura.doc_nro !== '0'
        ? factura.doc_nro
        : 'Sin identificar';

  drawText(`${docTipoLabel}:`, 14, 79.5, 'F2', 8, '#475569');
  drawText(docValStr, 25, 79.6, 'F3', 8.8, '#0F172A');

  drawText('Apellido y Nombre / Razón Social:', 68, 79.5, 'F2', 8, '#475569');
  const recNameLine = wrapTextMm(factura.receptor_nombre, 78, 'F2', 8.6)[0];
  drawText(recNameLine, 118, 79.5, 'F2', 8.6, '#0F172A');

  drawText('Condición frente al IVA:', 14, 87, 'F2', 8, '#475569');
  drawText(factura.condicion_iva_receptor, 49.5, 87, 'F2', 8.3, '#0F172A');

  drawText('Domicilio:', 112, 87, 'F2', 8, '#475569');
  const recDomLine = wrapTextMm(factura.receptor_domicilio || '—', 68, 'F1', 8)[0];
  drawText(recDomLine, 128, 87, 'F1', 8, '#0F172A');

  drawText('Condición de venta:', 14, 94, 'F2', 8, '#475569');
  drawText('Transferencia Bancaria', 44, 94, 'F2', 8.3, '#0F172A');

  // 5. Tabla de Conceptos / Honorarios
  const tableY = 100.5;
  drawBox(MARGIN, tableY, INNER_W, 7.5, '#0F172A');

  if (esFacturaA) {
    drawText('Código', 13, tableY + 5, 'F2', 7.3, '#FFFFFF');
    drawText('Producto / Servicio', 28, tableY + 5, 'F2', 7.3, '#FFFFFF');
    drawText('Cant.', 121, tableY + 5, 'F2', 7.3, '#CBD5E1', 'right');
    drawText('Precio Unit. Neto', 150, tableY + 5, 'F2', 7.3, '#CBD5E1', 'right');
    drawText('Alíc. IVA', 169, tableY + 5, 'F2', 7.3, '#CBD5E1', 'right');
    drawText('Subtotal c/IVA', 197, tableY + 5, 'F2', 7.3, '#86EFAC', 'right');

    const descLines = wrapTextMm(factura.descripcion, 78, 'F2', 8.5).slice(0, 8);
    const rowH = Math.max(12, 5.5 + descLines.length * 4);
    const rowY = tableY + 7.5;
    drawBox(MARGIN, rowY, INNER_W, rowH, '#F8FAFC', '#E2E8F0', 0.5);

    drawText('001', 13, rowY + 6.8, 'F3', 8.2, '#475569');
    descLines.forEach((ln, idx) => {
      drawText(ln, 28, rowY + 6.8 + idx * 4, 'F2', 8.5, '#0F172A');
    });
    drawText('1,00', 121, rowY + 6.8, 'F3', 8.5, '#334155', 'right');
    drawText(fmtARS(factura.imp_neto), 150, rowY + 6.8, 'F3', 8.5, '#0F172A', 'right');
    drawText(`${fmtNum(factura.alic_iva_pct)}%`, 169, rowY + 6.8, 'F3', 8.2, '#334155', 'right');
    drawText(fmtARS(factura.imp_total), 197, rowY + 6.8, 'F3', 9, '#0F172A', 'right');
  } else {
    // Factura B (Precio Unitario y Subtotal finales con IVA incluido)
    drawText('Código', 13, tableY + 5, 'F2', 7.3, '#FFFFFF');
    drawText('Producto / Servicio', 29, tableY + 5, 'F2', 7.3, '#FFFFFF');
    drawText('Cant.', 136, tableY + 5, 'F2', 7.3, '#CBD5E1', 'right');
    drawText('Precio Unit.', 166, tableY + 5, 'F2', 7.3, '#CBD5E1', 'right');
    drawText('Subtotal', 197, tableY + 5, 'F2', 7.3, '#86EFAC', 'right');

    const descLines = wrapTextMm(factura.descripcion, 90, 'F2', 8.5).slice(0, 8);
    const rowH = Math.max(12, 5.5 + descLines.length * 4);
    const rowY = tableY + 7.5;
    drawBox(MARGIN, rowY, INNER_W, rowH, '#F8FAFC', '#E2E8F0', 0.5);

    drawText('001', 13, rowY + 6.8, 'F3', 8.2, '#475569');
    descLines.forEach((ln, idx) => {
      drawText(ln, 29, rowY + 6.8 + idx * 4, 'F2', 8.5, '#0F172A');
    });
    drawText('1,00', 136, rowY + 6.8, 'F3', 8.5, '#334155', 'right');
    drawText(fmtARS(factura.imp_total), 166, rowY + 6.8, 'F3', 8.5, '#0F172A', 'right');
    drawText(fmtARS(factura.imp_total), 197, rowY + 6.8, 'F3', 9, '#0F172A', 'right');
  }

  // 6. Sección Inferior de Importes, Leyendas Fiscales (Ley 27.743 / Ley 27.618) y Totales
  const secY = 198;
  drawLine(MARGIN, secY, rightEdge, secY, '#94A3B8', 0.7);

  // Izquierda: Importe en letras + Leyenda Fiscal Obligatoria
  const letrasStr = `Son pesos: ${numeroALetrasARS(factura.imp_total)}.`;
  const letrasLines = wrapTextMm(letrasStr, 92, 'F1', 7.8).slice(0, 3);
  const letrasBoxH = 6.5 + letrasLines.length * 3.8;
  drawBox(13, secY + 3.5, 96, letrasBoxH, '#F8FAFC', '#CBD5E1', 0.5);
  letrasLines.forEach((ln, idx) => {
    drawText(ln, 16, secY + 8.2 + idx * 3.8, 'F1', 7.8, '#334155');
  });

  const legendTop = secY + 3.5 + letrasBoxH + 3;
  if (!esFacturaA) {
    // Factura B: Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)
    drawBox(13, legendTop, 96, 18.5, '#F8FAFC', '#94A3B8', 0.6);
    drawText(
      'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)',
      16,
      legendTop + 5,
      'F2',
      7.1,
      '#0F172A',
    );
    drawLine(15, legendTop + 7, 107, legendTop + 7, '#CBD5E1', 0.4);
    drawText('IVA Contenido:', 16, legendTop + 11.8, 'F2', 8, '#334155');
    drawText(fmtARS(factura.imp_iva), 106, legendTop + 11.9, 'F3', 8.5, '#0F172A', 'right');
    drawText('Otros Impuestos Nacionales Indirectos:', 16, legendTop + 16.3, 'F1', 7.2, '#64748B');
    drawText('$ 0,00', 106, legendTop + 16.3, 'F3', 7.8, '#64748B', 'right');
  } else if (factura.condicion_iva_receptor_id === 6) {
    // Factura A emitida a Responsable Monotributo: Leyenda obligatoria Ley 27.618
    const monoLeg = wrapTextMm(
      'El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618.',
      90,
      'F1',
      7.1,
    );
    const monoH = 5.5 + monoLeg.length * 3.5;
    drawBox(13, legendTop, 96, monoH, '#FFFBEB', '#FCD34D', 0.5);
    monoLeg.forEach((ln, idx) => {
      drawText(ln, 16, legendTop + 4.5 + idx * 3.5, 'F1', 7.1, '#78350F');
    });
  }

  // Derecha: Cuadro de Subtotales e IMPORTE TOTAL
  const totX = 113;
  const totW = 84;
  drawBox(totX, secY + 3.5, totW, 34, '#F8FAFC', '#94A3B8', 0.7);

  if (esFacturaA) {
    drawText('Importe Neto Gravado:', totX + 3.5, secY + 9.5, 'F2', 8, '#334155');
    drawText(fmtARS(factura.imp_neto), totX + totW - 3.5, secY + 9.6, 'F3', 9, '#0F172A', 'right');

    drawText(
      `IVA ${fmtNum(factura.alic_iva_pct)}%:`,
      totX + 3.5,
      secY + 15.8,
      'F2',
      8,
      '#334155',
    );
    drawText(fmtARS(factura.imp_iva), totX + totW - 3.5, secY + 15.9, 'F3', 9, '#0F172A', 'right');

    drawText('Importe Otros Tributos:', totX + 3.5, secY + 22.1, 'F1', 7.8, '#64748B');
    drawText('$ 0,00', totX + totW - 3.5, secY + 22.2, 'F3', 8.5, '#64748B', 'right');
  } else {
    drawText('Subtotal:', totX + 3.5, secY + 11.5, 'F2', 8.2, '#334155');
    drawText(
      fmtARS(factura.imp_total),
      totX + totW - 3.5,
      secY + 11.6,
      'F3',
      9.2,
      '#0F172A',
      'right',
    );

    drawText('Importe Otros Tributos:', totX + 3.5, secY + 19.5, 'F1', 7.8, '#64748B');
    drawText('$ 0,00', totX + totW - 3.5, secY + 19.6, 'F3', 8.5, '#64748B', 'right');
  }

  // Barra final oscura de IMPORTE TOTAL
  drawBox(totX, secY + 27.5, totW, 10, '#0F172A');
  drawText('IMPORTE TOTAL:', totX + 3.5, secY + 34, 'F2', 9, '#FFFFFF');
  drawText(
    fmtARS(factura.imp_total),
    totX + totW - 3.5,
    secY + 34.2,
    'F3',
    11,
    '#86EFAC',
    'right',
  );

  // 7. Pie Oficial: Código QR Vectorial RG 4892 + Sello ARCA + CAE y Vto. CAE
  const footY = 243;
  drawLine(MARGIN, footY, rightEdge, footY, '#94A3B8', 0.7);

  // Código QR Vectorial (34mm x 34mm con zona silenciosa de 2mm)
  const qrBoxX = 13;
  const qrBoxY = footY + 4;
  const qrBoxSize = 34;
  drawBox(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, '#FFFFFF', '#CBD5E1', 0.5);

  const qrMatrix = getQrMatrix(factura.qr_url);
  const quietMm = 2.2;
  const modArea = qrBoxSize - quietMm * 2;
  const modMm = modArea / qrMatrix.size;

  ops.push(rgbFill('#000000'));
  for (let r = 0; r < qrMatrix.size; r++) {
    const row = qrMatrix.rows[r];
    let c = 0;
    while (c < qrMatrix.size) {
      if (!row[c]) {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < qrMatrix.size && row[end]) {
        end++;
      }
      const rx = qrBoxX + quietMm + c * modMm;
      const ryTop = qrBoxY + quietMm + r * modMm;
      const rw = (end - c) * modMm + 0.03; // +0.03mm evita micro-líneas blancas entre filas
      const rh = modMm + 0.03;
      ops.push(
        `${fmtPt(pt(rx))} ${fmtPt(pt(H - ryTop - rh))} ${fmtPt(pt(rw))} ${fmtPt(pt(rh))} re f`,
      );
      c = end;
    }
  }

  // Sello Institucional ARCA
  const sealX = 51;
  drawText('ARCA', sealX, footY + 11.5, 'F2', 15, '#0F172A');
  drawText(
    'AGENCIA DE RECAUDACIÓN Y CONTROL ADUANERO',
    sealX,
    footY + 15.8,
    'F2',
    6.4,
    '#475569',
  );
  drawText('Comprobante Autorizado', sealX, footY + 22.5, 'F2', 9.5, '#15803D');

  const disclaimerLines = wrapTextMm(
    'Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación.',
    76,
    'F1',
    6.8,
  );
  disclaimerLines.forEach((ln, idx) => {
    drawText(ln, sealX, footY + 28 + idx * 3.4, 'F1', 6.8, '#64748B');
  });

  // Cuadro de CAE y Vencimiento de CAE
  const caeBoxX = 131;
  const caeBoxW = 66;
  drawBox(caeBoxX, footY + 6, caeBoxW, 25, '#F8FAFC', '#94A3B8', 0.7);
  drawText('CAE Nº:', caeBoxX + 3.5, footY + 15, 'F2', 8.3, '#334155');
  drawText(factura.cae, caeBoxX + caeBoxW - 3.5, footY + 15.2, 'F3', 9.8, '#0F172A', 'right');

  drawLine(caeBoxX + 3, footY + 18.8, caeBoxX + caeBoxW - 3, footY + 18.8, '#CBD5E1', 0.5);

  drawText('Fecha de Vto. de CAE:', caeBoxX + 3.5, footY + 25.5, 'F2', 7.8, '#334155');
  drawText(
    fmtDate(factura.cae_vto),
    caeBoxX + caeBoxW - 3.5,
    footY + 25.7,
    'F3',
    9.5,
    '#0F172A',
    'right',
  );

  drawText('Pág. 1/1', midX, 283.5, 'F1', 7, '#64748B', 'center');

  // Ensamblar objetos PDF 1.4 puros
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

// ---------------- Descarga, Share Móvil y WhatsApp ----------------

export function getFacturaFilename(factura: FacturaArcaCompleta): string {
  const safeName = factura.receptor_nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return `Factura_${factura.cbte_letra}_${factura.numero_formateado}_${safeName || 'Cliente'}.pdf`;
}

export function createFacturaPdfBlob(factura: FacturaArcaCompleta): Blob {
  const bytes = buildFacturaPdfBytes(factura);
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

export function downloadFacturaPdf(factura: FacturaArcaCompleta): string {
  const filename = getFacturaFilename(factura);
  const blob = createFacturaPdfBlob(factura);
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

export async function shareFacturaPdfNative(factura: FacturaArcaCompleta): Promise<boolean> {
  if (!canNativeSharePdf()) return false;
  const filename = getFacturaFilename(factura);
  const blob = createFacturaPdfBlob(factura);
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      title: `Factura ${factura.cbte_letra} ${factura.numero_formateado} - ${factura.receptor_nombre}`,
      text: buildFacturaWhatsappText(factura),
      files: [file],
    });
    return true;
  }
  return false;
}

export function buildFacturaWhatsappText(factura: FacturaArcaCompleta): string {
  const lines: string[] = [
    `Hola *${factura.receptor_nombre}*, te enviamos la *Factura ${factura.cbte_letra} Nº ${factura.numero_formateado}* correspondiente a honorarios profesionales:`,
    '',
    `• *Fecha:* ${fmtDate(factura.cbte_fecha)}`,
    `• *Concepto:* ${factura.descripcion}`,
    `• *Importe Total:* ${fmtARS(factura.imp_total)}`,
    `• *CAE Nº:* ${factura.cae} (Vto: ${fmtDate(factura.cae_vto)})`,
    '',
    '📎 _Adjuntamos la factura electrónica en PDF a continuación._',
    `*${factura.razon_social_emisor}*`,
  ];
  return lines.join('\n');
}

export function openFacturaWhatsapp(factura: FacturaArcaCompleta, rawPhone?: string | null): void {
  const txt = encodeURIComponent(buildFacturaWhatsappText(factura));
  const phone = formatWhatsappPhoneAR(rawPhone);
  const url = phone ? `https://wa.me/${phone}?text=${txt}` : `https://wa.me/?text=${txt}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
