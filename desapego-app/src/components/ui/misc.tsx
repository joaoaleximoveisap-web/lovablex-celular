import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { publicUrl } from "@/lib/supabase";

export function Spinner({ className, label = "Carregando" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center py-16 text-muted", className)} role="status">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

const tones = {
  neutral: "bg-black/[0.05] text-ink",
  ok: "bg-action-soft text-action",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-brand-soft text-brand",
  dark: "bg-brand text-white",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold", tones[tone], className)}>{children}</span>;
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-action-soft text-action">{icon}</div>
      <h3 className="text-lg font-extrabold text-ink">{title}</h3>
      {text && <p className="mt-1.5 text-[15px] text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Avatar({ name, path, size = 40, className }: { name: string; path?: string | null; size?: number; className?: string }) {
  const url = path ? (path.startsWith("http") ? path : publicUrl(path)) : null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft font-extrabold text-brand", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : initials(name || "?")}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-card border border-line/70 bg-white shadow-card", className)}>{children}</div>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist">
      {items.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "h-10 shrink-0 rounded-full px-4 text-sm font-bold transition-colors",
            value === t.value ? "bg-brand text-white" : "border border-line bg-white text-ink hover:bg-page",
          )}
        >
          {t.label}
          {t.count ? <span className={cn("ml-1.5 rounded-full px-1.5 text-xs", value === t.value ? "bg-white/20" : "bg-action-soft text-action")}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function LinkTabs({ items, active }: { items: { to: string; label: string; count?: number }[]; active: string }) {
  return (
    <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      {items.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          replace
          className={cn(
            "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-bold transition-colors",
            active === t.to ? "bg-brand text-white" : "border border-line bg-white text-ink hover:bg-page",
          )}
        >
          {t.label}
          {t.count ? <span className={cn("ml-1.5 rounded-full px-1.5 text-xs", active === t.to ? "bg-white/20" : "bg-action-soft text-action")}>{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = (error as { message?: string })?.message ?? "Algo deu errado.";
  return (
    <div className="mx-auto my-10 max-w-md rounded-card border border-danger/20 bg-danger-soft p-5 text-center">
      <p className="font-bold text-danger">Não foi possível carregar.</p>
      <p className="mt-1 text-sm text-ink/80">{navigator.onLine ? msg : "Você está sem internet."}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-bold text-ink shadow-sm">
          Tentar de novo
        </button>
      )}
    </div>
  );
}
