import { useQuery } from "@tanstack/react-query";
import { Card, ErrorBox, Spinner } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";

interface Log { id: number; action: string; resource_type: string; resource_id: string | null; metadata: Record<string, unknown>; created_at: string; actor: { name: string } | null }

const ACTIONS: Record<string, string> = {
  "settings.update": "Alterou configuração", "settings.access_code": "Alterou código de acesso", "invite.created": "Criou convite", "invite.revoked": "Revogou convite",
  "user.status": "Alterou situação de membro", "user.role": "Alterou papel de membro", "listing.approve": "Aprovou anúncio", "listing.suspend": "Suspendeu anúncio",
  "listing.restore": "Reativou anúncio", "listing.remove": "Removeu anúncio", "commission.confirm_paid": "Confirmou recebimento", "commission.start_review": "Iniciou conferência",
  "commission.reject_report": "Recusou pagamento informado", "commission.waive": "Concedeu isenção", "commission.adjust": "Ajustou comissão", "commission.cancel": "Cancelou cobrança",
  "commission.refund": "Estornou comissão", "commission.reminder": "Enviou lembrete", "sale.cancelled": "Cancelou venda", "report.resolved": "Resolveu denúncia",
  "report.dismissed": "Arquivou denúncia", "category.upsert": "Salvou categoria", "account.deleted_by_user": "Membro excluiu a conta",
};

export function AuditAdmin() {
  const q = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_logs").select("*, actor:profiles!audit_logs_actor_id_fkey(name)").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data as Log[];
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} />;
  return (
    <Card className="divide-y divide-line">
      {q.data?.length === 0 && <p className="p-4 text-sm text-muted">Nenhum registro ainda.</p>}
      {q.data?.map((l) => (
        <div key={l.id} className="p-3.5 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><b>{l.actor?.name ?? "Sistema"} · {ACTIONS[l.action] ?? l.action}</b><span className="text-muted">{formatDateTime(l.created_at)}</span></div>
          <p className="mt-0.5 break-all text-xs text-muted">{l.resource_type} {l.resource_id?.slice(0, 40)} {Object.keys(l.metadata ?? {}).length ? `· ${JSON.stringify(l.metadata)}` : ""}</p>
        </div>
      ))}
    </Card>
  );
}
