import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#17352F" />
      <path d="M20 27.5 32 18l12 9.5V44a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V27.5Z" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinejoin="round" />
      <path d="M32 40.5s-6.5-3.9-6.5-8.3a3.6 3.6 0 0 1 6.5-2.2 3.6 3.6 0 0 1 6.5 2.2c0 4.4-6.5 8.3-6.5 8.3Z" fill="#7FD1B1" />
    </svg>
  );
}

export function Logo({ name = "Desapego da Família", compact }: { name?: string; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && <span className="text-[17px] font-extrabold leading-tight tracking-tight text-brand">{name}</span>}
    </span>
  );
}
