import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Card, ErrorBox, Spinner, Tabs } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmSheet } from "@/components/Negotiation";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_ICONS, CategoryIcon } from "@/components/icons";
import { publicUrl, supabase, errorMessage } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";
import { LISTING_STATUS_LABEL } from "@/lib/labels";
import { useCategories } from "@/lib/queries";
import type { Category, Listing, ListingStatus } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

type Row = Listing & { seller: { name: string } };
const FILTERS: Record<string, ListingStatus[]> = {
  analise: ["pending_review"], ativos: ["active", "reserved"], suspensos: ["suspended", "paused"], vendidos: ["sold"], excluidos: ["deleted"],
};

function CategoriesBox() {
  const cats = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  async function save() {
    if (!edit?.id || !edit.name) return toast("Preencha identificador e nome.", "error");
    const { error } = await supabase.rpc("admin_upsert_category", { p_id: edit.id, p_name: edit.name, p_icon: edit.icon ?? "package", p_sort: edit.sort_order ?? 100, p_active: edit.active ?? true });
    if (error) return toast(errorMessage(error), "error");
    toast("Categoria salva.");
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["categories"] });
  }
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-extrabold">Categorias</h3>
        <Button size="sm" variant="soft" onClick={() => setEdit({ id: "", name: "", icon: "package", sort_order: 110, active: true })}>Nova</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {cats.data?.map((c) => (
          <button key={c.id} onClick={() => setEdit(c)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-bold">
            <CategoryIcon name={c.icon} className="h-4 w-4 text-action" /> {c.name} {!c.active && <span className="text-muted">(inativa)</span>}
          </button>
        ))}
      </div>
      {edit && (
        <Sheet open onClose={() => setEdit(null)} title="Categoria" footer={<Button size="lg" className="w-full" onClick={save}>Salvar</Button>}>
          <div className="space-y-4">
            <Field label="Identificador" hint="Letras minúsculas, sem espaço (ex.: ferramentas). Não muda depois."><Input value={edit.id} disabled={Boolean(cats.data?.some((c) => c.id === edit.id))} onChange={(e) => setEdit({ ...edit, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></Field>
            <Field label="Nome"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={40} /></Field>
            <Field label="Ícone">
              <div className="flex flex-wrap gap-2">
                {Object.keys(CATEGORY_ICONS).filter((k) => k !== "layout-grid").map((k) => (
                  <button key={k} onClick={() => setEdit({ ...edit, icon: k })} className={`flex h-11 w-11 items-center justify-center rounded-xl border ${edit.icon === k ? "border-action bg-action-soft text-action" : "border-line"}`} aria-label={k}>
                    <CategoryIcon name={k} className="h-5 w-5" />
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Ordem"><Input type="number" value={edit.sort_order ?? 100} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></Field>
            <Switch checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativa" description="Categorias inativas não aparecem para novos anúncios." />
          </div>
        </Sheet>
      )}
    </Card>
  );
}

export function ListingsAdmin() {
  const [filter, setFilter] = useState<keyof typeof FILTERS>("ativos");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<null | { row: Row; kind: "suspend" | "remove" }>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["admin", "listings", filter],
    queryFn: async () => {
      const { data, error } = await supabase.from("listings").select("*, seller:profiles!listings_seller_id_fkey(name)").in("status", FILTERS[filter]!).order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as Row[];
    },
  });
  async function moderate(row: Row, kind: string, reason?: string) {
    const { error } = await supabase.rpc("admin_moderate_listing", { p_listing: row.id, p_action: kind, p_reason: reason ?? null });
    if (error) return toast(errorMessage(error), "error");
    toast("Anúncio atualizado. O vendedor foi avisado.");
    setAction(null);
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["listings"] });
  }
  const rows = (q.data ?? []).filter((r) => r.title.toLowerCase().includes(search.toLowerCase()) || r.seller.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-extrabold">Anúncios</h3>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar título ou vendedor" className="h-10 max-w-xs" />
        </div>
        <Tabs value={filter} onChange={setFilter} items={[{ value: "analise", label: "Em análise" }, { value: "ativos", label: "Ativos" }, { value: "suspensos", label: "Suspensos/pausados" }, { value: "vendidos", label: "Vendidos" }, { value: "excluidos", label: "Excluídos" }]} />
        {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : rows.length === 0 ? <p className="text-sm text-muted">Nenhum anúncio.</p> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Card className="flex gap-3 p-3">
                  <Link to={`/anuncio/${r.id}`} className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[#EEF1EE]">{r.cover_thumb_path && <img src={publicUrl(r.cover_thumb_path)!} alt="" className="h-full w-full object-cover" loading="lazy" />}</Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/anuncio/${r.id}`} className="block truncate font-extrabold">{r.title}</Link>
                    <p className="text-sm text-muted">{r.seller.name} · {formatBRL(r.asking_price_cents)} · {timeAgo(r.updated_at)}</p>
                    <Badge className="mt-1">{LISTING_STATUS_LABEL[r.status]}</Badge>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.status === "pending_review" && <Button size="sm" onClick={() => moderate(r, "approve")}>Aprovar</Button>}
                      {["active", "reserved", "paused", "pending_review"].includes(r.status) && <Button size="sm" variant="outline" onClick={() => setAction({ row: r, kind: "suspend" })}>Suspender</Button>}
                      {r.status === "suspended" && <Button size="sm" variant="outline" onClick={() => moderate(r, "restore")}>Reativar</Button>}
                      {!["sold", "deleted"].includes(r.status) && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setAction({ row: r, kind: "remove" })}>Remover</Button>}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <CategoriesBox />
      <ConfirmSheet open={Boolean(action)} onClose={() => setAction(null)} danger title={action?.kind === "remove" ? "Remover anúncio?" : "Suspender anúncio?"} confirmLabel={action?.kind === "remove" ? "Remover" : "Suspender"}
        withReason="Motivo (o vendedor verá)" text={action?.kind === "remove" ? "O anúncio sai da vitrine definitivamente." : "O anúncio sai da vitrine até você reativar."}
        onConfirm={(reason) => moderate(action!.row, action!.kind, reason)} />
    </div>
  );
}
