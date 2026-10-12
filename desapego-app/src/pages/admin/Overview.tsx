import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, ErrorBox, Spinner } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";

interface Dash {
  members_active: number; members_pending: number; listings_active: number; listings_pending_review: number; listings_sold: number;
  sales_volume_cents: number; commissions_generated_cents: number; commissions_received_cents: number; commissions_pending_cents: number;
  commissions_overdue_cents: number; commissions_to_review: number; reports_open: number;
  top_sellers: { id: string; name: string; sales: number; volume_cents: number }[];
}

export function useDashboard() {
  return useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_dashboard");
      if (error) throw error;
      return data as Dash;
    },
  });
}

function Stat({ label, value, hint, strong }: { label: string; value: string | number; hint?: string; strong?: boolean }) {
  return (
    <Card className={strong ? "border-brand bg-brand p-4 text-white" : "p-4"}>
      <p className={strong ? "text-sm font-bold text-white/80" : "text-sm font-bold text-muted"}>{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className={strong ? "mt-0.5 text-xs text-white/70" : "mt-0.5 text-xs text-muted"}>{hint}</p>}
    </Card>
  );
}

export function Overview() {
  const q = useDashboard();
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const alerts = [
    d.members_pending > 0 && { to: "/admin/usuarios", text: `${d.members_pending} cadastro(s) aguardando aprovação` },
    d.listings_pending_review > 0 && { to: "/admin/anuncios", text: `${d.listings_pending_review} anúncio(s) aguardando aprovação` },
    d.commissions_to_review > 0 && { to: "/admin/comissoes", text: `${d.commissions_to_review} pagamento(s) informado(s) para conferir` },
    d.commissions_overdue_cents > 0 && { to: "/admin/comissoes", text: `${formatBRL(d.commissions_overdue_cents)} em comissões atrasadas` },
    d.reports_open > 0 && { to: "/admin/denuncias", text: `${d.reports_open} denúncia(s) em aberto` },
  ].filter(Boolean) as { to: string; text: string }[];

  return (
    <div className="space-y-6">
      {alerts.length > 0 && (
        <Card className="divide-y divide-line">
          {alerts.map((a) => (
            <Link key={a.text} to={a.to} className="flex items-center gap-3 p-3.5 font-bold"><AlertTriangle className="h-5 w-5 text-warn" /><span className="flex-1">{a.text}</span><ChevronRight className="h-5 w-5 text-muted" /></Link>
          ))}
        </Card>
      )}
      <section>
        <h2 className="mb-3 font-extrabold">Dinheiro</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat strong label="Recebido de fato" value={formatBRL(d.commissions_received_cents)} hint="Somente comissões com recebimento conferido" />
          <Stat label="A receber" value={formatBRL(d.commissions_pending_cents)} hint="Aguardando, informado ou em conferência" />
          <Stat label="Em atraso" value={formatBRL(d.commissions_overdue_cents)} hint="Vencidas sem pagamento informado" />
          <Stat label="Comissões geradas" value={formatBRL(d.commissions_generated_cents)} hint="Previsto (não é dinheiro em caixa)" />
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-extrabold">Comunidade</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Familiares ativos" value={d.members_active} />
          <Stat label="Anúncios ativos" value={d.listings_active} />
          <Stat label="Vendas concluídas" value={d.listings_sold} />
          <Stat label="Volume declarado" value={formatBRL(d.sales_volume_cents)} hint="Informado pelos vendedores" />
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-extrabold">Vendedores mais ativos</h2>
        {d.top_sellers.length === 0 ? <p className="text-sm text-muted">Nenhuma venda registrada ainda.</p> : (
          <Card className="divide-y divide-line">
            {d.top_sellers.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 p-3.5">
                <span className="w-6 text-center font-extrabold text-muted">{i + 1}</span>
                <span className="flex-1 font-bold">{s.name}</span>
                <span className="text-sm text-muted">{s.sales} venda(s)</span>
                <span className="w-28 text-right font-bold">{formatBRL(s.volume_cents)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
