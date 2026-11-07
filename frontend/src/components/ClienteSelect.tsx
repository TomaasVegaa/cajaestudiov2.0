import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { api, Cliente } from '../lib/api';

interface Props {
  clientes: Cliente[];
  value: number | null;
  onChange: (cliente: Cliente | null) => void;
  onCreated?: (cliente: Cliente) => void;
  includeInternos?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  compact?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}

export function ClienteSelect({
  clientes,
  value,
  onChange,
  onCreated,
  includeInternos = false,
  placeholder = 'Buscar cliente (nombre o alias)...',
  allowClear = true,
  compact = false,
  inputRef,
}: Props) {
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = inputRef || internalRef;
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => clientes.find((c) => c.id === value) || null,
    [clientes, value],
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [creating, setCreating] = useState(false);

  const pool = useMemo(
    () => (includeInternos ? clientes : clientes.filter((c) => !c.es_interno)),
    [clientes, includeInternos],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return pool.slice(0, 60);
    const words = q.split(/\s+/);
    return pool
      .filter((c) => {
        const hay = `${c.nombre} ${(c.aliases || []).join(' ')}`.toUpperCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 40);
  }, [pool, query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selectItem = (c: Cliente) => {
    onChange(c);
    setOpen(false);
    setQuery('');
  };

  const handleQuickCreate = async () => {
    const nombre = query.trim().toUpperCase();
    if (!nombre || creating) return;
    setCreating(true);
    try {
      const created = await api<Cliente>('POST', 'clientes', { nombre });
      onCreated?.(created);
      selectItem(created);
    } catch (err: any) {
      alert(err.message || 'No se pudo crear el cliente');
    } finally {
      setCreating(false);
    }
  };

  const canQuickCreate =
    Boolean(onCreated) &&
    query.trim().length >= 3 &&
    !pool.some((c) => c.nombre.toUpperCase() === query.trim().toUpperCase());

  const hClass = compact ? 'h-8 text-xs' : 'h-9 text-sm';

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          ref={ref}
          type="text"
          value={open ? query : selected?.nombre || ''}
          placeholder={selected ? selected.nombre : placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setHighlight(0);
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
              setOpen(true);
              return;
            }
            if (!open) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              if (filtered[highlight]) {
                e.preventDefault();
                selectItem(filtered[highlight]);
              } else if (canQuickCreate) {
                e.preventDefault();
                handleQuickCreate();
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
          className={`w-full rounded border border-slate-300 bg-white pl-8 pr-7 font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-[#1E3A8A] ${hClass}`}
        />
        {allowClear && selected && !open && (
          <button
            type="button"
            tabIndex={-1}
            title="Quitar selección"
            onClick={() => onChange(null)}
            className="absolute right-1.5 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto rounded border border-slate-300 bg-white shadow-lg">
          {filtered.length === 0 && !canQuickCreate && (
            <div className="px-3 py-2 text-xs text-slate-500">Sin coincidencias</div>
          )}
          {filtered.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectItem(c);
              }}
              onMouseEnter={() => setHighlight(idx)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                idx === highlight ? 'bg-[#1E3A8A] text-white' : 'text-slate-800 hover:bg-slate-100'
              }`}
            >
              <span className="truncate font-medium">
                {c.nombre}
                {c.es_interno && (
                  <span
                    className={`ml-1.5 rounded px-1 py-0.5 text-[10px] uppercase ${
                      idx === highlight ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    Interno
                  </span>
                )}
              </span>
              {c.nota_revision && (
                <span
                  className={`ml-2 max-w-[160px] truncate text-[11px] ${
                    idx === highlight ? 'text-amber-200' : 'text-amber-700'
                  }`}
                >
                  {c.nota_revision}
                </span>
              )}
            </button>
          ))}
          {canQuickCreate && (
            <button
              type="button"
              disabled={creating}
              onMouseDown={(e) => {
                e.preventDefault();
                handleQuickCreate();
              }}
              className="flex w-full items-center gap-1.5 border-t border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-[#1E3A8A] hover:bg-blue-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {creating ? 'Creando...' : `Crear cliente "${query.trim().toUpperCase()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
