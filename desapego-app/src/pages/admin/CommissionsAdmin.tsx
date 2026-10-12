import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Card, ErrorBox, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { supabase, errorMessage } from "@/lib/supabase";
import { formatBRL, formatRate } from "@/lib/money";
import { COMMISSION_STATUS, SALE_TYPE_LABEL } from "@/lib/labels";
import type { CommissionView, PaymentReport } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";

const tone = (s: CommissionView["effective_status"]) => {
  const t = COMMISSION_STATUS[s].tone;
  return t === "ok" ? "ok" : t === "danger" ? "danger" : t === "warn" ? "warn" : t === "info" ? "info" : "neutral";
};

function csvCell(v: string | number) {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: CommissionView[]) {
  const head = ["Vendedor", "Produto", "Data da venda", "Valor declarado (R$)", "Percentual", "Comissão (R$)", "Vencimento", "Situação", "Pago em"];
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const lines = rows.map((r) => [r.seller_name, r.listing_title, formatDate(r.completed_at), money(r.base_cents), formatRate(r.rate_bps), money(r.amount_cents), formatDate(r.due_at), COMMISSION_STATUS[r.effective_status].label, r.paid_at ? formatDate(r.paid_at) : ""].map(csvCell).join(";"));
  const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `comissoes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** PDF pelo próprio navegador ("Salvar como PDF" na janela de impressão), sem biblioteca extra. */
function exportPdf(rows: CommissionView[], period: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const sum = (f: (r: CommissionView) => boolean) => formatBRL(rows.filter(f).reduce((s, r) => s + r.amount_cents, 0));
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comissões</title><style>
    body{font:12px/1.4 system-ui,sans-serif;color:#202522;margin:24px} h1{font-size:18px;color:#17352F;margin:0} p{color:#737B76}
    table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border-bottom:1px solid #E6E9E6;padding:6px 4px;text-align:left} th{background:#F8F9F7}
    td.n{text-align:right;white-space:nowrap} .tot{margin-top:12px;font-weight:700}</style></head><body>
    <h1>Desapego da Família — Comissões</h1><p>${esc(period)} · gerado em ${formatDateTime(new Date().toISOString())}</p>
    <table><thead><tr><th>Vendedor</th><th>Produto</th><th>Data</th><th>Valor declarado</th><th>%</th><th>Comissão</th><th>Vencimento</th><th>Situação</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.seller_name)}</td><td>${esc(r.listing_title)}</td><td>${formatDate(r.completed_at)}</td><td class="n">${formatBRL(r.base_cents)}</td><td>${formatRate(r.rate_bps)}</td><td class="n">${formatBRL(r.amount_cents)}</td><td>${formatDate(r.due_at)}</td><td>${COMMISSION_STATUS[r.effective_status].label}</td></tr>`).join("")}
    </tbody></table>
    <p class="tot">Recebido: ${sum((r) => r.status === "paid")} · A receber: ${sum((r) => ["awaiting_payment", "payment_reported", "under_review"].includes(r.status))}</p>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function CommissionSheet({ c, onClose }: { c: CommissionView; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<null | "reject_report" | "waive" | "adjust" | "cancel" | "refund" | "cancel_sale">(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState<number | null>(c.amount_cents);
  const [busy, setBusy] = useState(false);
  const reports = useQuery({
    queryKey: ["admin", "reports-of", c.id],
    queryFn: async () => ((await supabase.from("payment_reports").select("*").eq("commission_id", c.id).order("created_at", { ascending: false })).data ?? []) as PaymentReport[],
  });

  async function act(action: string, extra?: { reason?: string; amount?: number | null }) {
    setBusy(true);
    const { error } = action === "cancel_sale"
      ? await supabase.rpc("cancel_sale", { p_sale: c.sale_id, p_reason: extra?.reason })
      : action === "remind"
        ? await supabase.rpc("admin_send_reminder", { p_commission: c.id })
        : await supabase.rpc("admin_commission_action", { p_commission: c.id, p_action: action, p_reason: extra?.reason ?? null, p_amount_cents: extra?.amount ?? null });
    setBusy(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Registrado.");
    qc.invalidateQueries({ queryKey: ["admin"] });
    onClose();
  }
  async function openReceipt(path: string) {
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 120);
    if (error) return toast(errorMessage(error), "error");
    window.open(data.signedUrl, "_blank", "noopener");
  }
  const open = ["awaiting_payment", "payment_reported", "under_review"].includes(c.status);
  const labels: Record<string, string> = { reject_report: "Pagamento não localizado", waive: "Conceder isenção", adjust: "Ajustar valor", cancel: "Cancelar cobrança", refund: "Estornar", cancel_sale: "Cancelar a venda" };

  return (
    <Sheet open onClose={onClose} title="Comissão" wide>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-lg font-extrabold">{c.listing_title}</p><p className="text-sm text-muted">{c.seller_name} · {SALE_TYPE_LABEL[c.sale_type]} em {formatDate(c.completed_at)}</p></div>
        <Badge tone={tone(c.effective_status)}>{COMMISSION_STATUS[c.effective_status].label}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-4">
        <div><dt className="text-sm text-muted">Valor declarado</dt><dd className="font-bold">{formatBRL(c.base_cents)}</dd></div>
        <div><dt className="text-sm text-muted">Percentual</dt><dd className="font-bold">{formatRate(c.rate_bps)}</dd></div>
        <div><dt className="text-sm text-muted">Comissão</dt><dd className="font-bold">{formatBRL(c.amount_cents)}{c.original_amount_cents !== c.amount_cents && <span className="text-xs text-muted"> (orig. {formatBRL(c.original_amount_cents)})</span>}</dd></div>
        <div><dt className="text-sm text-muted">Vencimento</dt><dd className="font-bold">{formatDate(c.due_at)}</dd></div>
      </dl>
      {c.admin_note && <p className="mt-3 rounded-xl bg-page p-3 text-sm"><b>Notas:</b> {c.admin_note}</p>}

      <h4 className="mb-2 mt-5 font-extrabold">Pagamentos informados</h4>
      {reports.data?.length ? (
        <ul className="space-y-2">
          {reports.data.map((r) => (
            <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex justify-between"><b>{formatDateTime(r.created_at)}</b><span>{r.status === "submitted" ? "A conferir" : r.status === "accepted" ? "Aceito" : "Recusado"}</span></div>
              {r.note && <p className="text-muted">{r.note}</p>}
              {r.receipt_path && <button onClick={() => openReceipt(r.receipt_path!)} className="mt-1 font-bold text-action underline">Abrir comprovante</button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Nenhum pagamento informado.</p>}
      <p className="mt-3 rounded-xl bg-warn-soft p-3 text-sm text-warn">Confirme o recebimento somente depois de conferir o Pix no seu banco. Informar pagamento não significa que o dinheiro chegou.</p>

      {mode ? (
        <div className="mt-4 space-y-3 rounded-xl border border-line p-4">
          <p className="font-extrabold">{labels[mode]}</p>
          {mode === "adjust" && <Field label="Novo valor da comissão"><MoneyInput cents={amount} onChange={setAmount} /></Field>}
          <Field label="Justificativa (fica registrada e o vendedor é avisado)"><Textarea className="min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setMode(null)}>Voltar</Button>
            <Button variant={mode === "adjust" ? "primary" : "danger"} className="flex-1" loading={busy} disabled={reason.trim().length < 3} onClick={() => act(mode, { reason, amount: mode === "adjust" ? amount ?? 0 : null })}>Confirmar</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {c.status === "payment_reported" && <Button variant="outline" loading={busy} onClick={() => act("start_review")}>Marcar “em conferência”</Button>}
          {open && <Button loading={busy} onClick={() => act("confirm_paid")}>Confirmar recebimento</Button>}
          {(c.status === "payment_reported" || c.status === "under_review") && <Button variant="outline" onClick={() => setMode("reject_report")}>Pagamento não localizado</Button>}
          {c.status === "awaiting_payment" && <Button variant="outline" loading={busy} onClick={() => act("remind")}>Enviar lembrete</Button>}
          {open && <Button variant="outline" onClick={() => setMode("adjust")}>Ajustar valor</Button>}
          {open && <Button variant="outline" onClick={() => setMode("waive")}>Conceder isenção</Button>}
          {open && <Button variant="ghost" className="text-danger" onClick={() => setMode("cancel")}>Cancelar cobrança</Button>}
          {c.status === "paid" && <Button variant="ghost" className="text-danger" onClick={() => setMode("refund")}>Estornar</Button>}
          {!["cancelled", "refunded"].includes(c.status) && <Button variant="ghost" className="text-danger" onClick={() => setMode("cancel_sale")}>Cancelar a venda</Button>}
        </div>
      )}
    </Sheet>
  );
}

export function CommissionsAdmin() {
  const [status, setStatus] = useState("abertas");
  const [seller, setSeller] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<CommissionView | null>(null);
  const q = useQuery({
    queryKey: ["admin", "commissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("commissions_view").select("*").order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return data as CommissionView[];
    },
  });
  const sellers = useMemo(() => [...new Map((q.data ?? []).map((c) => [c.seller_id, c.seller_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [q.data]);
  const rows = (q.data ?? []).filter((c) => {
    if (status === "abertas" && !["awaiting_payment", "overdue", "payment_reported", "under_review"].includes(c.effective_status)) return false;
    if (status !== "abertas" && status !== "todas" && c.effective_status !== status) return false;
    if (seller && c.seller_id !== seller) return false;
    if (from && c.completed_at < from) return false;
    if (to && c.completed_at.slice(0, 10) > to) return false;
    return true;
  });
  const total = (f: (c: CommissionView) => boolean) => rows.filter(f).reduce((s, c) => s + c.amount_cents, 0);
  const period = `${from ? formatDate(from) : "início"} a ${to ? formatDate(to + "T12:00:00") : "hoje"}${seller ? ` · ${sellers.find((s) => s[0] === seller)?.[1]}` : ""}`;

  return (
    <div>
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Situação">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="abertas">Em aberto</option>
            <option value="todas">Todas</option>
            {Object.entries(COMMISSION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Vendedor"><Select value={seller} onChange={(e) => setSeller(e.target.value)}><option value="">Todos</option>{sellers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select></Field>
        <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{rows.length} registro(s) · recebido <b className="text-ink">{formatBRL(total((c) => c.status === "paid"))}</b> · a receber <b className="text-ink">{formatBRL(total((c) => ["awaiting_payment", "payment_reported", "under_review"].includes(c.status)))}</b></p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportCsv(rows)}><Download className="h-4 w-4" /> CSV</Button>
          <Button size="sm" variant="outline" onClick={() => exportPdf(rows, period)}><FileText className="h-4 w-4" /> PDF</Button>
        </div>
      </div>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : rows.length === 0 ? <p className="text-sm text-muted">Nenhuma comissão com esses filtros.</p> : (
        <>
          <div className="hidden overflow-x-auto rounded-card border border-line/70 bg-white shadow-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-page text-muted">
                <tr>{["Vendedor", "Produto", "Data", "Valor declarado", "%", "Comissão", "Vencimento", "Situação"].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setOpen(c)} className="cursor-pointer border-t border-line hover:bg-page">
                    <td className="px-3 py-2.5 font-bold">{c.seller_name}</td>
                    <td className="max-w-[220px] truncate px-3 py-2.5">{c.listing_title}</td>
                    <td className="px-3 py-2.5">{formatDate(c.completed_at)}</td>
                    <td className="px-3 py-2.5 text-right">{formatBRL(c.base_cents)}</td>
                    <td className="px-3 py-2.5">{formatRate(c.rate_bps)}</td>
                    <td className="px-3 py-2.5 text-right font-bold">{formatBRL(c.amount_cents)}</td>
                    <td className="px-3 py-2.5">{formatDate(c.due_at)}</td>
                    <td className="px-3 py-2.5"><Badge tone={tone(c.effective_status)}>{COMMISSION_STATUS[c.effective_status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <button onClick={() => setOpen(c)} className="w-full rounded-card border border-line/70 bg-white p-4 text-left shadow-card">
                  <div className="flex justify-between gap-2"><b className="truncate">{c.seller_name}</b><b className="text-brand">{formatBRL(c.amount_cents)}</b></div>
                  <p className="truncate text-sm text-muted">{c.listing_title} · {formatBRL(c.base_cents)} · vence {formatDate(c.due_at)}</p>
                  <Badge className="mt-1.5" tone={tone(c.effective_status)}>{COMMISSION_STATUS[c.effective_status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {open && <CommissionSheet c={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
