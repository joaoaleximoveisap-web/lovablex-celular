import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Card, ErrorBox, Spinner, Tabs } from "@/components/ui/misc";
import { ConfirmSheet } from "@/components/Negotiation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { supabase, errorMessage } from "@/lib/supabase";
import { REPORT_REASONS } from "@/lib/labels";
import { formatDateTime } from "@/lib/utils";

interface Report { id: string; reporter_id: string; target_type: string; target_id: string; reason: string; details: string | null; status: string; resolution_note: string | null; created_at: string; reporter: { name: string } }
const REASON: Record<string, string> = { ...Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.label])), contestacao: "Comprador contestou a venda" };
const TARGET: Record<string, string> = { listing: "Anúncio", user: "Membro", conversation: "Conversa", sale: "Venda" };

function targetLink(r: Report) {
  if (r.target_type === "listing") return `/anuncio/${r.target_id}`;
  if (r.target_type === "user") return `/membro/${r.target_id}`;
  if (r.target_type === "sale") return "/admin/comissoes";
  return null;
}

export function ReportsAdmin() {
  const [filter, setFilter] = useState<"open" | "resolved" | "dismissed">("open");
  const [resolve, setResolve] = useState<null | { r: Report; status: "resolved" | "dismissed" }>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["admin", "reports", filter],
    queryFn: async () => {
      const { data, error } = await supabase.from("reports").select("*, reporter:profiles!reports_reporter_id_fkey(name)").eq("status", filter).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as Report[];
    },
  });
  return (
    <div>
      <Tabs value={filter} onChange={setFilter} items={[{ value: "open", label: "Em aberto" }, { value: "resolved", label: "Resolvidas" }, { value: "dismissed", label: "Arquivadas" }]} />
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : !q.data?.length ? <p className="text-sm text-muted">Nenhuma denúncia.</p> : (
        <ul className="space-y-3">
          {q.data.map((r) => {
            const link = targetLink(r);
            return (
              <li key={r.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="danger">{REASON[r.reason] ?? r.reason}</Badge>
                    <Badge>{TARGET[r.target_type]}</Badge>
                    <span className="text-xs text-muted">{formatDateTime(r.created_at)} · por {r.reporter.name}</span>
                  </div>
                  {r.details && <p className="mt-2 text-[15px]">{r.details}</p>}
                  {r.resolution_note && <p className="mt-2 text-sm text-muted">Resolução: {r.resolution_note}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {link && <Link to={link} className="inline-flex h-9 items-center rounded-xl border border-line px-3 text-sm font-bold">Ver {TARGET[r.target_type]?.toLowerCase()}</Link>}
                    {r.status === "open" && (
                      <>
                        <Button size="sm" onClick={() => setResolve({ r, status: "resolved" })}>Resolver</Button>
                        <Button size="sm" variant="ghost" onClick={() => setResolve({ r, status: "dismissed" })}>Arquivar</Button>
                      </>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmSheet open={Boolean(resolve)} onClose={() => setResolve(null)} title={resolve?.status === "resolved" ? "Resolver denúncia" : "Arquivar denúncia"} confirmLabel="Confirmar"
        withReason="Anotação (quem denunciou será avisado)" text="Se for preciso, suspenda o anúncio ou a conta pelas abas Anúncios e Usuários."
        onConfirm={async (note) => {
          const { error } = await supabase.rpc("admin_resolve_report", { p_report: resolve!.r.id, p_status: resolve!.status, p_note: note });
          if (error) return toast(errorMessage(error), "error");
          toast("Denúncia atualizada.");
          setResolve(null);
          qc.invalidateQueries({ queryKey: ["admin"] });
        }} />
    </div>
  );
}
