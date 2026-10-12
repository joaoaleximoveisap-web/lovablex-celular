import { useState } from "react";
import { Link } from "react-router-dom";
import { HandCoins, Receipt, ShoppingBag } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Card, EmptyState, ErrorBox, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/Negotiation";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/AuthProvider";
import { supabase, errorMessage } from "@/lib/supabase";
import { formatBRL, formatRate } from "@/lib/money";
import { OFFER_STATUS_LABEL, SALE_TYPE_LABEL } from "@/lib/labels";
import type { Offer, Sale } from "@/lib/types";
import { formatDate, timeAgo } from "@/lib/utils";

type OfferRow = Offer & { listing: { title: string } | null; buyer: { name: string }; seller: { name: string } };

export function OffersTab() {
  const { userId } = useAuth();
  const q = useQuery({
    queryKey: ["offers", "mine", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offers")
        .select("*, listing:listings(title), buyer:profiles!offers_buyer_id_fkey(name), seller:profiles!offers_seller_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as OfferRow[];
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon={<HandCoins className="h-7 w-7" />} title="Nenhuma proposta" text="As propostas que você enviar ou receber aparecem aqui." />;
  return (
    <ul className="space-y-2">
      {q.data.map((o) => {
        const sent = o.proposed_by === userId;
        const tone = o.status === "accepted" ? "ok" : o.status === "pending" ? "warn" : "neutral";
        return (
          <li key={o.id}>
            <Link to={o.conversation_id ? `/conversas/${o.conversation_id}` : `/anuncio/${o.listing_id}`} className="flex items-center justify-between gap-3 rounded-card border border-line/70 bg-white p-4 shadow-card">
              <div className="min-w-0">
                <p className="truncate font-extrabold">{o.listing?.title ?? "Anúncio removido"}</p>
                <p className="text-sm text-muted">{sent ? "Você propôs" : `${o.buyer_id === userId ? o.seller.name : o.buyer.name} propôs`} · {timeAgo(o.created_at)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-extrabold text-brand">{formatBRL(o.amount_cents)}</p>
                <Badge tone={tone}>{OFFER_STATUS_LABEL[o.status]}</Badge>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type SaleRow = Sale & { listing: { title: string } | null; buyer: { name: string } | null; seller: { name: string }; commission: { id: string; status: string; amount_cents: number } | null };

function useSales(role: "seller" | "buyer") {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ["sales", role, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, listing:listings(title), buyer:profiles!sales_buyer_id_fkey(name), seller:profiles!sales_seller_id_fkey(name), commission:commissions(id, status, amount_cents)")
        .eq(role === "seller" ? "seller_id" : "buyer_id", userId!)
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return data as unknown as SaleRow[];
    },
  });
}

const CONFIRM_LABEL = { not_applicable: null, pending: "Aguardando confirmação do comprador", confirmed: "Comprador confirmou", disputed: "Comprador contestou" } as const;

export function SalesTab() {
  const q = useSales("seller");
  const qc = useQueryClient();
  const toast = useToast();
  const [cancel, setCancel] = useState<SaleRow | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon={<Receipt className="h-7 w-7" />} title="Nenhuma venda ainda" text="Quando vender algo, use “Marcar como vendido” no anúncio." />;
  return (
    <>
      <ul className="space-y-3">
        {q.data.map((s) => (
          <li key={s.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/anuncio/${s.listing_id}`} className="block truncate font-extrabold">{s.listing?.title}</Link>
                  <p className="text-sm text-muted">{SALE_TYPE_LABEL[s.sale_type]} · {formatDate(s.completed_at)} · {s.buyer?.name ?? s.buyer_external_name ?? "comprador não informado"}</p>
                </div>
                <p className="shrink-0 text-lg font-extrabold text-brand">{formatBRL(s.final_price_cents)}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {s.completion_status === "cancelled" ? <Badge tone="neutral">Venda cancelada</Badge> : (
                  <>
                    {CONFIRM_LABEL[s.buyer_confirmation] && <Badge tone={s.buyer_confirmation === "confirmed" ? "ok" : s.buyer_confirmation === "disputed" ? "danger" : "warn"}>{CONFIRM_LABEL[s.buyer_confirmation]}</Badge>}
                    {s.commission_cents > 0 ? <Badge tone="info">Comissão {formatBRL(s.commission_cents)} ({formatRate(s.commission_rate_snapshot)})</Badge> : <Badge>Sem comissão</Badge>}
                  </>
                )}
              </div>
              {s.completion_status === "completed" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.commission && <Link to={`/comissoes/${s.commission.id}`} className="inline-flex h-9 items-center rounded-xl bg-action-soft px-3 text-sm font-bold text-action">Ver comissão</Link>}
                  {(!s.commission || s.commission.status === "awaiting_payment") && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setCancel(s)}>Cancelar venda</Button>}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <ConfirmSheet open={Boolean(cancel)} onClose={() => setCancel(null)} title="Cancelar venda?" danger confirmLabel="Cancelar venda" withReason="Motivo do cancelamento"
        text="Use apenas se a venda não aconteceu de fato. O anúncio volta para a vitrine, a comissão é cancelada e o administrador é avisado."
        onConfirm={async (reason) => {
          const { error } = await supabase.rpc("cancel_sale", { p_sale: cancel!.id, p_reason: reason });
          if (error) return toast(errorMessage(error), "error");
          toast("Venda cancelada.");
          setCancel(null);
          qc.invalidateQueries();
        }} />
    </>
  );
}

export function PurchasesTab() {
  const q = useSales("buyer");
  const qc = useQueryClient();
  const toast = useToast();
  const [dispute, setDispute] = useState<SaleRow | null>(null);
  async function confirm(s: SaleRow, ok: boolean, note?: string) {
    const { error } = await supabase.rpc("confirm_purchase", { p_sale: s.id, p_confirmed: ok, p_note: note ?? null });
    if (error) return toast(errorMessage(error), "error");
    toast(ok ? "Compra confirmada. Obrigado!" : "Contestação enviada ao administrador.");
    setDispute(null);
    qc.invalidateQueries({ queryKey: ["sales"] });
  }
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon={<ShoppingBag className="h-7 w-7" />} title="Nenhuma compra registrada" text="Quando um vendedor registrar uma venda para você, ela aparece aqui para confirmar." />;
  return (
    <>
      <ul className="space-y-3">
        {q.data.map((s) => (
          <li key={s.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/anuncio/${s.listing_id}`} className="block truncate font-extrabold">{s.listing?.title}</Link>
                  <p className="text-sm text-muted">{SALE_TYPE_LABEL[s.sale_type]} de {s.seller.name} · {formatDate(s.completed_at)}</p>
                </div>
                <p className="shrink-0 text-lg font-extrabold text-brand">{formatBRL(s.final_price_cents)}</p>
              </div>
              {s.completion_status === "cancelled" ? <Badge className="mt-3">Venda cancelada</Badge> : s.buyer_confirmation === "pending" ? (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-ink/80">O vendedor registrou esta venda. Está tudo certo?</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => confirm(s, true)}>Sim, confirmo</Button>
                    <Button size="sm" variant="outline" onClick={() => setDispute(s)}>Não reconheço</Button>
                  </div>
                </div>
              ) : <Badge className="mt-3" tone={s.buyer_confirmation === "confirmed" ? "ok" : "danger"}>{s.buyer_confirmation === "confirmed" ? "Você confirmou" : "Você contestou"}</Badge>}
            </Card>
          </li>
        ))}
      </ul>
      <ConfirmSheet open={Boolean(dispute)} onClose={() => setDispute(null)} title="Contestar venda" danger confirmLabel="Enviar" withReason="O que aconteceu?"
        text="O administrador vai analisar. A confirmação do comprador ajuda na conferência, mas não substitui o combinado entre vocês."
        onConfirm={(reason) => confirm(dispute!, false, reason)} />
    </>
  );
}
