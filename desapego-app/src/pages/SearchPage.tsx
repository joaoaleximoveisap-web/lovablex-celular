import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SearchX, SlidersHorizontal, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CategoryChips } from "@/components/CategoryChips";
import { GridSkeleton, ListingGrid } from "@/components/ListingCard";
import { LoadMore } from "@/components/LoadMore";
import { Badge, EmptyState, ErrorBox } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select } from "@/components/ui/form";
import { useListingFeed, type SearchParams } from "@/lib/queries";
import { CONDITION_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Sort = NonNullable<SearchParams["sort"]>;
const SORTS: { value: Sort; label: string }[] = [
  { value: "relevance", label: "Relevância" },
  { value: "recent", label: "Mais recentes" },
  { value: "price_asc", label: "Menor preço" },
  { value: "price_desc", label: "Maior preço" },
];

function num(v: string | null) {
  return v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
}

export function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(false);
  const q = sp.get("q") ?? "";

  const params: SearchParams = useMemo(
    () => ({
      query: q,
      category: sp.get("cat"),
      minCents: num(sp.get("min")),
      maxCents: num(sp.get("max")),
      conditions: sp.get("cond")?.split(",").filter(Boolean) ?? [],
      location: sp.get("local") ?? "",
      acceptsOffers: sp.get("proposta") === "1" ? true : null,
      acceptsTrade: sp.get("troca") === "1" ? true : null,
      donation: sp.get("doacao") === "1" ? true : null,
      sinceDays: num(sp.get("dias")),
      includeReserved: sp.get("disp") !== "1",
      sort: (sp.get("ordem") as Sort) || (q ? "relevance" : "recent"),
    }),
    [sp, q],
  );
  const feed = useListingFeed(params);
  const items = feed.data?.pages.flat() ?? [];

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (params.minCents != null || params.maxCents != null)
    chips.push({ key: "preco", label: `${params.minCents != null ? formatBRL(params.minCents) : "R$ 0"} – ${params.maxCents != null ? formatBRL(params.maxCents) : "∞"}`, clear: { min: null, max: null } });
  if (params.conditions?.length) chips.push({ key: "cond", label: params.conditions.map((c) => CONDITION_LABEL[c as keyof typeof CONDITION_LABEL]).join(", "), clear: { cond: null } });
  if (params.location) chips.push({ key: "local", label: params.location, clear: { local: null } });
  if (params.acceptsOffers) chips.push({ key: "proposta", label: "Aceita proposta", clear: { proposta: null } });
  if (params.acceptsTrade) chips.push({ key: "troca", label: "Aceita troca", clear: { troca: null } });
  if (params.donation) chips.push({ key: "doacao", label: "Doações", clear: { doacao: null } });
  if (params.sinceDays) chips.push({ key: "dias", label: `Últimos ${params.sinceDays} dias`, clear: { dias: null } });
  if (!params.includeReserved) chips.push({ key: "disp", label: "Só disponíveis", clear: { disp: null } });

  return (
    <AppShell>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{q ? `“${q}”` : "Buscar"}</h1>
          <p className="text-sm text-muted">{feed.isLoading ? "Procurando…" : `${items.length}${feed.hasNextPage ? "+" : ""} anúncio${items.length === 1 ? "" : "s"}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select aria-label="Ordenar" value={params.sort} onChange={(e) => set({ ordem: e.target.value })} className="h-11 w-auto min-w-[150px] text-sm font-bold">
            {SORTS.filter((s) => s.value !== "relevance" || q).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Button variant="outline" onClick={() => setOpen(true)} aria-label="Filtros" className="relative">
            <SlidersHorizontal className="h-5 w-5" /> <span className="hidden sm:inline">Filtros</span>
            {chips.length > 0 && <span className="absolute -right-1.5 -top-1.5 h-5 min-w-5 rounded-full bg-action px-1 text-xs leading-5 text-white">{chips.length}</span>}
          </Button>
        </div>
      </div>

      <CategoryChips value={params.category ?? null} onChange={(c) => set({ cat: c })} />

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c.key} onClick={() => set(c.clear)} className="inline-flex items-center gap-1 rounded-full bg-action-soft px-3 py-1.5 text-sm font-bold text-action">
              {c.label} <X className="h-3.5 w-3.5" />
            </button>
          ))}
          <button onClick={() => setSp(q ? { q } : {}, { replace: true })} className="px-2 text-sm font-bold text-muted underline">Limpar tudo</button>
        </div>
      )}

      <div className="mt-5">
        {feed.isLoading ? (
          <GridSkeleton />
        ) : feed.isError ? (
          <ErrorBox error={feed.error} onRetry={() => feed.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<SearchX className="h-7 w-7" />} title="Nenhum anúncio encontrado" text="Tente outras palavras ou remova alguns filtros. Tem algo parecido para desapegar?"
            action={<Link to="/anunciar" className="inline-flex h-12 items-center rounded-xl bg-action px-6 font-bold text-white">Anunciar</Link>} />
        ) : (
          <>
            <ListingGrid items={items} />
            <LoadMore hasMore={Boolean(feed.hasNextPage)} loading={feed.isFetchingNextPage} onMore={() => feed.fetchNextPage()} />
          </>
        )}
      </div>

      <FiltersSheet key={open ? "aberto" : sp.toString()} open={open} onClose={() => setOpen(false)} params={params} onApply={(patch) => { set(patch); setOpen(false); }} />
    </AppShell>
  );
}

function FiltersSheet({ open, onClose, params, onApply }: { open: boolean; onClose: () => void; params: SearchParams; onApply: (p: Record<string, string | null>) => void }) {
  const [min, setMin] = useState<number | null>(params.minCents ?? null);
  const [max, setMax] = useState<number | null>(params.maxCents ?? null);
  const [cond, setCond] = useState<string[]>(params.conditions ?? []);
  const [local, setLocal] = useState(params.location ?? "");
  const [offers, setOffers] = useState(Boolean(params.acceptsOffers));
  const [trade, setTrade] = useState(Boolean(params.acceptsTrade));
  const [donation, setDonation] = useState(Boolean(params.donation));
  const [days, setDays] = useState(params.sinceDays ? String(params.sinceDays) : "");
  const [onlyAvailable, setOnlyAvailable] = useState(!params.includeReserved);

  const toggle = (c: string) => setCond((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const Check = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => (
    <button type="button" onClick={() => set(!on)} aria-pressed={on} className={cn("rounded-full border px-4 py-2 text-sm font-bold", on ? "border-action bg-action-soft text-action" : "border-line bg-white text-ink")}>{label}</button>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Filtros"
      footer={<Button size="lg" className="w-full" onClick={() => onApply({
        min: min != null ? String(min) : null, max: max != null ? String(max) : null, cond: cond.join(",") || null, local: local.trim() || null,
        proposta: offers ? "1" : null, troca: trade ? "1" : null, doacao: donation ? "1" : null, dias: days || null, disp: onlyAvailable ? "1" : null,
      })}>Ver resultados</Button>}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço mínimo"><MoneyInput cents={min} onChange={setMin} /></Field>
          <Field label="Preço máximo"><MoneyInput cents={max} onChange={setMax} /></Field>
        </div>
        <Field label="Condição">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CONDITION_LABEL) as (keyof typeof CONDITION_LABEL)[]).map((c) => <Check key={c} on={cond.includes(c)} set={() => toggle(c)} label={CONDITION_LABEL[c]} />)}
          </div>
        </Field>
        <Field label="Cidade ou bairro"><Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Ex.: Centro" /></Field>
        <Field label="Negociação">
          <div className="flex flex-wrap gap-2">
            <Check on={offers} set={setOffers} label="Aceita proposta" />
            <Check on={trade} set={setTrade} label="Aceita troca" />
            <Check on={donation} set={setDonation} label="Doação" />
          </div>
        </Field>
        <Field label="Publicado">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">Qualquer data</option>
            <option value="1">Últimas 24 horas</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </Select>
        </Field>
        <Field label="Disponibilidade">
          <div className="flex flex-wrap gap-2"><Check on={onlyAvailable} set={setOnlyAvailable} label="Esconder reservados" /></div>
        </Field>
        <Badge tone="info">Os filtros usam somente dados reais dos anúncios.</Badge>
      </div>
    </Sheet>
  );
}
