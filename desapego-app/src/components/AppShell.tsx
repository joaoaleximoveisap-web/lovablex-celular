import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Bell, Home, MessageCircle, Plus, Search, Shield, User, WifiOff } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useUnread } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui/misc";
import { Logo } from "./Logo";

function Dot({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-1.5 -top-1 min-w-[18px] rounded-full bg-danger px-1 text-center text-[11px] font-extrabold leading-[18px] text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function HeaderSearch() {
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState(new URLSearchParams(loc.search).get("q") ?? "");
  return (
    <form
      role="search"
      className="relative flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        nav(`/buscar?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        enterKeyHint="search"
        placeholder="O que você procura?"
        aria-label="O que você procura?"
        className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-[16px] text-ink placeholder:text-muted/80 focus:border-action focus:outline-none focus:ring-2 focus:ring-action/15"
      />
    </form>
  );
}

const tabs = [
  { to: "/", label: "Início", icon: Home, end: true },
  { to: "/buscar", label: "Buscar", icon: Search },
  { to: "/anunciar", label: "Anunciar", icon: Plus, accent: true },
  { to: "/conversas", label: "Conversas", icon: MessageCircle, badge: "messages" as const },
  { to: "/perfil", label: "Perfil", icon: User },
];

export function AppShell({ children, hideMobileHeader, hideBottomNav }: { children: ReactNode; hideMobileHeader?: boolean; hideBottomNav?: boolean }) {
  const { profile, isAdmin, settings } = useAuth();
  const unread = useUnread();
  const online = useOnline();
  const loc = useLocation();
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);

  return (
    <div className="min-h-dvh bg-page">
      {!online && (
        <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-warn px-4 py-2 text-sm font-bold text-white">
          <WifiOff className="h-4 w-4" /> Sem internet — nada será enviado até a conexão voltar.
        </div>
      )}
      <header className={cn("sticky top-0 z-30 border-b border-line/70 bg-page/95 backdrop-blur", hideMobileHeader && "hidden md:block")}>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:h-[72px] md:gap-6 md:px-6">
          <Link to="/" aria-label="Início" className="shrink-0">
            <span className="md:hidden"><Logo compact /></span>
            <span className="hidden md:block"><Logo name={settings.app_name} /></span>
          </Link>
          <HeaderSearch />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Principal">
            <NavLink to="/conversas" className={({ isActive }) => cn("relative rounded-xl px-3 py-2 text-[15px] font-bold", isActive ? "text-action" : "text-ink hover:bg-black/[0.04]")}>
              <span className="inline-flex items-center gap-1.5">Conversas{unread.data?.messages ? <span className="min-w-[18px] rounded-full bg-danger px-1 text-center text-[11px] font-extrabold leading-[18px] text-white">{unread.data.messages}</span> : null}</span>
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" className={({ isActive }) => cn("flex items-center gap-1.5 rounded-xl px-3 py-2 text-[15px] font-bold", isActive ? "text-action" : "text-ink hover:bg-black/[0.04]")}>
                <Shield className="h-4 w-4" /> Painel
              </NavLink>
            )}
            <Link to="/anunciar" className="ml-2 inline-flex h-11 items-center gap-2 rounded-xl bg-action px-4 text-[15px] font-bold text-white shadow-sm hover:bg-action-hover">
              <Plus className="h-5 w-5" /> Anunciar
            </Link>
          </nav>
          <Link to="/notificacoes" className="relative rounded-full p-2 text-ink hover:bg-black/[0.04]" aria-label="Notificações">
            <Bell className="h-[22px] w-[22px]" />
            <Dot n={unread.data?.notifications} />
          </Link>
          <Link to="/perfil" aria-label="Meu perfil" className="hidden shrink-0 lg:block">
            <Avatar name={profile?.name ?? ""} path={profile?.avatar_url} size={38} />
          </Link>
          <Link to="/perfil" aria-label="Meu perfil" className="shrink-0 lg:hidden">
            <Avatar name={profile?.name ?? ""} path={profile?.avatar_url} size={34} />
          </Link>
        </div>
      </header>

      <main className={cn("mx-auto max-w-7xl px-4 pt-4 md:px-6 md:pt-6 lg:pb-16", hideBottomNav ? "pb-8" : "pb-[calc(96px+env(safe-area-inset-bottom))]")}>
        {children}
      </main>

      {!hideBottomNav && (
        <nav
          aria-label="Navegação"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          <div className="mx-auto grid h-[68px] max-w-lg grid-cols-5">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) => cn("flex flex-col items-center justify-center gap-1 text-[11.5px] font-bold", isActive ? "text-action" : "text-muted")}
              >
                {({ isActive }) =>
                  t.accent ? (
                    <>
                      <span className="flex h-10 w-12 items-center justify-center rounded-2xl bg-action text-white shadow-sm">
                        <t.icon className="h-6 w-6" strokeWidth={2.4} />
                      </span>
                      <span className={isActive ? "text-action" : "text-ink"}>{t.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="relative">
                        <t.icon className="h-6 w-6" strokeWidth={isActive ? 2.4 : 2} />
                        {t.badge && <Dot n={unread.data?.messages} />}
                      </span>
                      {t.label}
                    </>
                  )
                }
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

/** Topo simples com "voltar" para telas internas no celular. */
export function BackHeader({ title, right }: { title: string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="sticky top-0 z-30 -mx-4 -mt-4 mb-3 flex h-14 items-center gap-2 border-b border-line/70 bg-page/95 px-2 backdrop-blur md:static md:mx-0 md:mt-0 md:mb-4 md:h-auto md:border-0 md:bg-transparent md:px-0">
      <button onClick={() => (window.history.length > 1 ? nav(-1) : nav("/"))} className="rounded-full p-2.5 text-ink hover:bg-black/[0.04]" aria-label="Voltar">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <h1 className="flex-1 truncate text-lg font-extrabold text-ink md:text-2xl">{title}</h1>
      {right}
    </div>
  );
}
