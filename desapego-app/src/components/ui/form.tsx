import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { maskBRLInput } from "@/lib/money";

const base =
  "w-full rounded-xl border border-line bg-white px-3.5 text-[16px] text-ink placeholder:text-muted/70 transition-colors focus:border-action focus:outline-none focus:ring-2 focus:ring-action/15 disabled:bg-page disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(base, "h-12", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, "min-h-[110px] py-3 leading-relaxed", className)} {...p} />;
});

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(base, "h-12 appearance-none bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23737B76' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...p}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, htmlFor, optional }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-bold text-ink">
        {label} {optional && <span className="font-medium text-muted">(opcional)</span>}
      </label>
      {children}
      {error ? <p className="text-sm font-medium text-danger">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

/** Campo de valor em reais: a pessoa digita só números. */
export function MoneyInput({ cents, onChange, id, placeholder = "0,00", autoFocus, disabled }: { cents: number | null; onChange: (c: number | null) => void; id?: string; placeholder?: string; autoFocus?: boolean; disabled?: boolean }) {
  const text = cents == null ? "" : maskBRLInput(String(cents)).text;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] font-bold text-muted">R$</span>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        className={cn(base, "h-12 pl-11 text-lg font-bold")}
        placeholder={placeholder}
        value={text}
        onChange={(e) => onChange(maskBRLInput(e.target.value).cents)}
      />
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-white px-4 py-3.5">
      <span>
        <span className="block text-[15px] font-bold text-ink">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-line transition-colors peer-checked:bg-action peer-focus-visible:ring-2 peer-focus-visible:ring-action/40" />
        <span className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function ChoiceGroup<T extends string>({ value, onChange, options, columns = 3 }: { value: T | null; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[]; columns?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-12 rounded-xl border px-2 py-2 text-[15px] font-bold transition-colors",
            value === o.value ? "border-action bg-action-soft text-action" : "border-line bg-white text-ink hover:bg-page",
          )}
        >
          {o.label}
          {o.hint && <span className="block text-xs font-medium text-muted">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}
