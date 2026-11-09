export interface User {
  id: number;
  nombre: string;
  email: string;
  rol: 'admin' | 'operador';
}

export interface AppConfig {
  fecha_inicio: string;
  nombre_estudio: string;
  subtitulo_estudio?: string;
  datos_contacto_estudio?: string;
  hoy: string;
}

export interface ReciboApiResponse {
  cliente: {
    id: number;
    nombre: string;
    cuit?: string | null;
    telefono?: string | null;
  };
  movimientos_operacion: Movimiento[];
  otros_mismo_dia: Movimiento[];
  estudio: {
    nombre_estudio: string;
    subtitulo_estudio?: string;
    datos_contacto_estudio?: string;
  };
}

export interface Cliente {
  id: number;
  nombre: string;
  cuit?: string | null;
  telefono?: string | null;
  es_interno: boolean;
  nota_revision?: string | null;
  aliases?: string[];
}

export interface ClienteSaldo {
  id: number;
  nombre: string;
  telefono?: string | null;
  nota_revision?: string | null;
  saldo: number;
  ultimo_mov?: string | null;
}

export type CodConce = 'E' | 'C' | 'T';
export type Medio = 'EFECTIVO' | 'BANCO';
export type TipoValor =
  | 'IMPUESTOS'
  | 'HONORARIOS'
  | 'UTILES'
  | 'RETIRO'
  | 'GASTO_ESTUDIO'
  | 'AJUSTE'
  | 'APERTURA';

export interface Movimiento {
  id: number;
  fecha: string;
  cod_conce: CodConce;
  medio: Medio;
  cliente_id: number;
  cliente: string;
  es_interno: boolean;
  tipo_valor: TipoValor;
  detalle: string;
  entrada: number;
  salida: number;
  afecta_caja: boolean;
  afecta_cliente: boolean;
  movimiento_padre_id: number | null;
  grupo: string | null;
  creado_por: string | null;
  saldo_caja?: number;
  saldo_cliente?: number | null;
}

export interface MovimientosResponse {
  anio: number;
  mes: number;
  desde: string;
  hasta: string;
  cerrado: boolean;
  movimientos: Movimiento[];
  resumen: {
    entradas_mes: number;
    salidas_mes: number;
    saldo_mes: number;
    saldo_real_inicio: { efectivo: number; banco: number; total: number };
    saldo_real_fin: { efectivo: number; banco: number; total: number };
  };
  cliente_saldo_anterior?: number;
  cliente_saldo_fin?: number;
}

export interface EstadoCuentaResponse {
  cliente: Cliente;
  desde: string;
  hasta: string;
  saldo_anterior: number;
  saldo_final: number;
  saldo_hoy: number;
  totales: {
    entregas: number;
    impuestos: number;
    utiles: number;
    honorarios_saldo: number;
    honorarios_directo: number;
    ajustes: number;
    apertura: number;
  };
  movimientos: Movimiento[];
}

export interface TeoricoArqueo {
  fecha: string;
  teorico_efectivo: number;
  teorico_banco: number;
  caja_total: number;
  total_clientes: number;
  clientes_a_favor: number;
  clientes_en_rojo: number;
  cant_clientes_rojo: number;
  fondos_propios: number;
}

export interface ArqueoRow extends TeoricoArqueo {
  id: number;
  tengo: number;
  banco_hoy: number;
  banco_calle: number;
  calle_erika: number;
  me_deben: number;
  otros: number;
  diferencia: number;
  observaciones?: string | null;
  usuario?: string | null;
  created_at: string;
}

export interface PeriodoItem {
  anio: number;
  mes: number;
  nombre: string;
  cerrado: boolean;
  fecha_cierre: string | null;
  cerrado_por: string | null;
  entradas: number;
  salidas: number;
  cantidad: number;
  caja_fin: number;
  clientes_fin: number;
}

export class ApiHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const API_BASE = import.meta.env.DEV ? '/api/index.php?r=' : '../api/index.php?r=';

export function exportUrl(route: string, params: Record<string, string | number | undefined> = {}): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${API_BASE}${route}${qs ? '&' + qs : ''}`;
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  body?: unknown,
): Promise<T> {
  const cleanRoute = route.replace(/\?/g, '&');
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(API_BASE + cleanRoute, {
    method,
    credentials: 'include',
    headers,
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiHttpError('Respuesta inválida del servidor', res.status || 500);
  }
  if (!res.ok) {
    if (res.status === 401 && !cleanRoute.startsWith('auth/login')) {
      window.dispatchEvent(new CustomEvent('caja:unauthorized'));
    }
    const fallback =
      res.status === 403
        ? 'No tiene permisos suficientes (requiere rol Administrador).'
        : `Error HTTP ${res.status}`;
    throw new ApiHttpError(data?.error || fallback, res.status);
  }
  return data as T;
}

const arsFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0,00';
  const clean = Math.abs(n) < 0.005 ? 0 : n;
  return arsFormatter.format(clean);
}

export function fmtARS(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '$ 0,00';
  const clean = Math.abs(n) < 0.005 ? 0 : n;
  return (clean < 0 ? '-$ ' : '$ ') + arsFormatter.format(Math.abs(clean));
}

export function estadoSaldoLabel(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || Math.abs(n) <= 0.005) {
    return 'Sin saldo';
  }
  return n < 0 ? 'Debe al estudio' : 'A favor';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

export interface ParsedAmount {
  ok: boolean;
  empty: boolean;
  value: number;
  error?: string;
}

/**
 * Valida estrictamente un importe escrito por el usuario sin convertir errores de tipeo en 0.
 * Acepta formatos argentinos ("1.234,56", "1234,56") e ingleses ("1,234.56", "1234.56").
 */
export function parseStrictAmount(
  s: string,
  opts: { allowNegative?: boolean; label?: string } = {},
): ParsedAmount {
  const label = opts.label || 'Importe';
  const raw = s.trim().replace(/\$/g, '').replace(/\s+/g, '');
  if (raw === '') return { ok: true, empty: true, value: 0 };

  const neg = raw.startsWith('-');
  if (neg && !opts.allowNegative) {
    return { ok: false, empty: false, value: 0, error: `${label}: no ingrese signo negativo` };
  }
  const clean = raw.replace(/^[+-]/, '');
  if (!clean || !/^[0-9.,]+$/.test(clean)) {
    return { ok: false, empty: false, value: 0, error: `${label}: formato numérico inválido` };
  }

  const commas = (clean.match(/,/g) || []).length;
  const dots = (clean.match(/\./g) || []).length;
  if (commas > 1 && dots > 1) {
    return { ok: false, empty: false, value: 0, error: `${label}: separadores inválidos` };
  }

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  let normalized = clean;

  if (lastComma > lastDot) {
    if (commas > 1) {
      return { ok: false, empty: false, value: 0, error: `${label}: demasiadas comas decimales` };
    }
    const decPart = clean.slice(lastComma + 1);
    if (decPart.length > 2) {
      return { ok: false, empty: false, value: 0, error: `${label}: máximo 2 decimales` };
    }
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    const decLen = clean.length - lastDot - 1;
    if (dots === 1 && decLen <= 2) {
      normalized = clean.replace(/,/g, '');
    } else if (commas === 0 && /^\d{1,3}(\.\d{3})+$/.test(clean)) {
      normalized = clean.replace(/\./g, '');
    } else {
      return { ok: false, empty: false, value: 0, error: `${label}: revise puntos y decimales` };
    }
  }

  const num = Number(normalized);
  if (!Number.isFinite(num) || num > 999999999999) {
    return { ok: false, empty: false, value: 0, error: `${label}: importe fuera de rango` };
  }
  const value = Math.round(num * 100) / 100;
  return { ok: true, empty: false, value: neg ? -value : value };
}

export function parseLocalAmount(s: string): number {
  const p = parseStrictAmount(s, { allowNegative: true });
  return p.ok ? p.value : 0;
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const MESES_NOMBRES = [
  '',
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const COD_LABELS: Record<CodConce, string> = {
  C: 'CLIENTES',
  E: 'ESTUDIO',
  T: 'TRANSF.',
};
