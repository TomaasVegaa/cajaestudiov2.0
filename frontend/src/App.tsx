import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Lock, LogOut, Settings, Users } from 'lucide-react';
import { api, AppConfig, Cliente, User } from './lib/api';
import { CajaView } from './views/CajaView';
import { ClientesView } from './views/ClientesView';
import { ConfigView } from './views/ConfigView';

type NavTab = 'CAJA' | 'CLIENTES' | 'CONFIG';

export function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);

  const [tab, setTab] = useState<NavTab>('CAJA');
  const [selectedClienteId, setSelectedClienteId] = useState<number | null>(null);
  const [preselectedCajaCliente, setPreselectedCajaCliente] = useState<number | null>(null);

  // Login / Re-login form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const loadClientes = useCallback(async () => {
    const list = await api<Cliente[]>('GET', 'clientes?internos=1');
    setClientes(list);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const me = await api<{ user: User | null; config: AppConfig | null }>('GET', 'auth/me');
      setUser(me.user);
      setConfig(me.config);
      if (me.user) {
        setEmail(me.user.email);
        await loadClientes();
      }
    } finally {
      setBooting(false);
    }
  }, [loadClientes]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const onUnauth = () => {
      if (user) {
        setEmail(user.email);
        setPassword('');
        setLoginErr(null);
        setSessionExpired(true);
      }
    };
    window.addEventListener('caja:unauthorized', onUnauth);
    return () => window.removeEventListener('caja:unauthorized', onUnauth);
  }, [user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginErr(null);
    try {
      const res = await api<{ user: User; config: AppConfig }>('POST', 'auth/login', {
        email,
        password,
      });
      setUser(res.user);
      setConfig(res.config);
      setPassword('');
      setSessionExpired(false);
      await loadClientes();
    } catch (ex: any) {
      setLoginErr(ex.message || 'Credenciales inválidas');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api('POST', 'auth/logout');
    } catch {
      // ignore if already expired
    }
    setSessionExpired(false);
    setUser(null);
    setClientes([]);
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs font-medium text-slate-500">
        Iniciando sistema contable...
      </div>
    );
  }

  if (!user || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4">
        <div className="w-full max-w-sm rounded border border-slate-300 bg-white p-6 shadow-xs">
          <div className="mb-5 border-b border-slate-200 pb-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#1E3A8A]">
              Sistema Contable
            </div>
            <h1 className="mt-0.5 text-lg font-bold text-slate-900">
              Caja Diaria y Cuentas Corrientes
            </h1>
          </div>

          {loginErr && (
            <div
              role="alert"
              className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
            >
              {loginErr}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Email</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@estudio.com"
                className="h-9 w-full rounded border border-slate-300 px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Contraseña</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loggingIn}
              className="mt-2 h-9 w-full rounded bg-[#0F172A] text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#1E3A8A] disabled:opacity-50"
            >
              {loggingIn ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const navItems: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'CAJA', label: 'Caja Diaria', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'CLIENTES', label: 'Clientes y Saldos', icon: <Users className="h-4 w-4" /> },
    { id: 'CONFIG', label: 'Períodos y Apertura', icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen pb-16 md:pb-6">
      <header className="no-print sticky top-0 z-30 border-b border-slate-800 bg-[#0F172A] text-white">
        <div className="mx-auto flex h-12 max-w-[1440px] items-center justify-between px-3 sm:px-5">
          <div className="flex items-center gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold tracking-tight">{config.nombre_estudio}</span>
              <span className="hidden text-[11px] font-medium text-slate-400 sm:inline">
                Caja & Cuentas Corrientes
              </span>
            </div>

            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => {
                    setTab(it.id);
                    if (it.id === 'CLIENTES') setSelectedClienteId(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                    tab === it.id
                      ? 'bg-white text-[#0F172A]'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {it.icon}
                  {it.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden text-slate-300 sm:inline">
              {user.nombre}{' '}
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                {user.rol}
              </span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              title="Cerrar sesión"
              className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-3 pt-3 sm:px-5">
        {tab === 'CAJA' && (
          <CajaView
            user={user}
            hoy={config.hoy}
            clientes={clientes}
            preselectedClienteId={preselectedCajaCliente}
            onConsumePreselected={() => setPreselectedCajaCliente(null)}
            onClienteCreated={(nuevo) =>
              setClientes((prev) =>
                [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)),
              )
            }
            onOpenCliente={(id) => {
              setSelectedClienteId(id);
              setTab('CLIENTES');
            }}
          />
        )}

        {tab === 'CLIENTES' && (
          <ClientesView
            hoy={config.hoy}
            selectedId={selectedClienteId}
            onSelectId={setSelectedClienteId}
            onClientesChanged={loadClientes}
            onCargarParaCliente={(id) => {
              setPreselectedCajaCliente(id);
              setTab('CAJA');
            }}
          />
        )}

        {tab === 'CONFIG' && (
          <ConfigView
            user={user}
            onDataChanged={() => {
              refreshSession();
            }}
          />
        )}
      </main>

      <nav className="no-print fixed bottom-0 left-0 right-0 z-30 grid grid-cols-3 border-t border-slate-300 bg-white md:hidden">
        {navItems.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => {
              setTab(it.id);
              if (it.id === 'CLIENTES') setSelectedClienteId(null);
            }}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold ${
              tab === it.id ? 'text-[#1E3A8A]' : 'text-slate-500'
            }`}
          >
            {it.icon}
            <span>{it.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>

      {/* Modal no destructivo de reconexión si expira la sesión (conserva borradores en pantalla) */}
      {sessionExpired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form
            onSubmit={handleLogin}
            className="w-full max-w-sm space-y-3 rounded border border-slate-300 bg-white p-5 shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
              <Lock className="h-4 w-4 text-amber-700" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">Sesión expirada</h3>
                <p className="text-[11px] text-slate-500">
                  Vuelva a ingresar para continuar sin perder los datos escritos en pantalla.
                </p>
              </div>
            </div>
            {loginErr && (
              <div
                role="alert"
                className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800"
              >
                {loginErr}
              </div>
            )}
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-semibold text-slate-700">
                Contraseña
              </label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded border border-slate-300 px-2.5 text-sm"
              />
            </div>
            <div className="flex justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleLogout}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cambiar usuario
              </button>
              <button
                type="submit"
                disabled={loggingIn}
                className="rounded bg-[#0F172A] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#1E3A8A] disabled:opacity-50"
              >
                {loggingIn ? 'Validando...' : 'Continuar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
