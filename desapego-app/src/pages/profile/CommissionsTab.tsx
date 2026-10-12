import { Link } from "react-router-dom";
import { ChevronRight, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, EmptyState, ErrorBox, Spinner } from "@/components/ui/misc";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { formatBRL, formatRate } from "@/lib/money";
import { COMMISSION_STATUS } from "@/lib/labels";
import type { CommissionView } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function useMyCommissions() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ["commissions", "mine", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("commissions_view").select("*").eq("seller_id", userId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data as CommissionView[];
    },
  });
}

export function CommissionsTab() {
  const { settings } = useAuth();
  const q = useMyCommissions();
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  const open = rows.filter((c) => ["awaiting_payment", "overdue", "payment_reported", "under_review"].includes(c.effective_status)).reduce((s, c) => s + c.amount_cents, 0);
  const paid = rows.filter((c) => c.status === "paid").reduce((s, c) => s + c.amount_cents, 0);
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="p-4"><p className="text-sm font-bold text-muted">Em aberto</p><p className="text-2xl font-extrabold text-brand">{formatBRL(open)}</p></Card>
        <Card className="p-4"><p className="text-sm font-bold text-muted">Já pago</p><p className="text-2xl font-extrabold text-ink">{formatBRL(paid)}</p></Card>
      </div>
      <p className="mb-4 rounded-xl bg-page p-3 text-sm text-muted">
        Comissão atual: {formatRate(settings.commission_rate_bps)} sobre vendas concluídas, paga em até {settings.payment_due_days} dias. Doações e trocas sem dinheiro não pagam. Cada venda guarda a taxa vigente no dia em que foi registrada.
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={<Wallet className="h-7 w-7" />} title="Nenhuma comissão" text="Comissões aparecem aqui quando você registra uma venda." />
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const st = COMMISSION_STATUS[c.effective_status];
            return (
              <li key={c.id}>
                <Link to={`/comissoes/${c.id}`} className="flex items-center gap-3 rounded-card border border-line/70 bg-white p-4 shadow-card hover:border-action/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold">{c.listing_title}</p>
                    <p className="text-sm text-muted">Venda de {formatBRL(c.base_cents)} · vence {formatDate(c.due_at)}</p>
                    <Badge tone={st.tone === "ok" ? "ok" : st.tone === "danger" ? "danger" : st.tone === "warn" ? "warn" : st.tone === "info" ? "info" : "neutral"} className="mt-1.5">{st.label}</Badge>
                  </div>
                  <p className="shrink-0 text-lg font-extrabold text-brand">{formatBRL(c.amount_cents)}</p>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
