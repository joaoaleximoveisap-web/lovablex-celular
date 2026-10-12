import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Copy, FileUp, Info, QrCode } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { AppShell, BackHeader } from "@/components/AppShell";
import { Badge, Card, ErrorBox, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/AuthProvider";
import { supabase, errorMessage } from "@/lib/supabase";
import { formatBRL, formatRate } from "@/lib/money";
import { buildPixPayload, pixConfigured } from "@/lib/pix";
import { COMMISSION_STATUS, SALE_TYPE_LABEL } from "@/lib/labels";
import { compressImage, extFor } from "@/lib/image";
import type { CommissionView, PaymentReport } from "@/lib/types";
import { formatDate, formatDateTime, shortId, uuid } from "@/lib/utils";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export default function CommissionPayPage() {
  const { id } = useParams();
  const { settings, userId } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(uuid());

  const q = useQuery({
    queryKey: ["commission", id],
    queryFn: async () => {
      const [c, r] = await Promise.all([
        supabase.from("commissions_view").select("*").eq("id", id!).maybeSingle(),
        supabase.from("payment_reports").select("*").eq("commission_id", id!).order("created_at", { ascending: false }),
      ]);
      if (c.error) throw c.error;
      return { c: c.data as CommissionView | null, reports: (r.data ?? []) as PaymentReport[] };
    },
  });
  const c = q.data?.c;
  const payable = c && c.status === "awaiting_payment";
  const pix = (() => {
    if (!c || !pixConfigured(settings)) return null;
    try {
      return buildPixPayload({ key: settings.pix_key, name: settings.pix_receiver_name, city: settings.pix_city, amountCents: c.amount_cents, txid: `COM${shortId(c.id)}` });
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (pix && payable) QRCode.toDataURL(pix, { margin: 1, width: 480, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [pix, payable]);

  async function report() {
    setBusy(true);
    try {
      let receiptPath: string | null = null;
      if (file) {
        let blob: Blob = file;
        let ext = file.type === "application/pdf" ? "pdf" : "jpg";
        if (file.type.startsWith("image/")) {
          const img = await compressImage(file, 1800, 0.85);
          blob = img.blob;
          ext = extFor(img.type);
        } else if (file.type !== "application/pdf") throw new Error("Envie uma imagem ou PDF.");
        if (blob.size > 5 * 1024 * 1024) throw new Error("Comprovante maior que 5 MB.");
        receiptPath = `${userId}/${id}/${uuid()}.${ext}`;
        const up = await supabase.storage.from("receipts").upload(receiptPath, blob, { contentType: blob.type || (ext === "pdf" ? "application/pdf" : "image/jpeg") });
        if (up.error) throw up.error;
      }
      const { error } = await supabase.rpc("report_payment", { p_commission: id, p_receipt_path: receiptPath, p_note: note.trim() || null, p_client_id: requestId.current });
      if (error) throw error;
      toast("Pagamento informado. O administrador vai conferir o recebimento.");
      qc.invalidateQueries({ queryKey: ["commission", id] });
      qc.invalidateQueries({ queryKey: ["commissions"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <AppShell><Spinner /></AppShell>;
  if (q.isError || !c) return <AppShell><ErrorBox error={q.error ?? { message: "Comissão não encontrada." }} /></AppShell>;
  const st = COMMISSION_STATUS[c.effective_status];

  return (
    <AppShell hideMobileHeader>
      <div className="mx-auto max-w-2xl">
        <BackHeader title="Pagamento de comissão" />
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-muted">Produto vendido</p>
              <p className="text-lg font-extrabold">{c.listing_title}</p>
            </div>
            <Badge tone={st.tone === "ok" ? "ok" : st.tone === "danger" ? "danger" : st.tone === "warn" ? "warn" : st.tone === "info" ? "info" : "neutral"}>{st.label}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
            <div><dt className="text-sm text-muted">Valor informado</dt><dd className="font-bold">{formatBRL(c.base_cents)}</dd></div>
            <div><dt className="text-sm text-muted">Percentual aplicado</dt><dd className="font-bold">{formatRate(c.rate_bps)}</dd></div>
            <div><dt className="text-sm text-muted">Tipo</dt><dd className="font-bold">{SALE_TYPE_LABEL[c.sale_type]} em {formatDate(c.completed_at)}</dd></div>
            <div><dt className="text-sm text-muted">Prazo para pagamento</dt><dd className={c.effective_status === "overdue" ? "font-bold text-danger" : "font-bold"}>{formatDate(c.due_at)}</dd></div>
          </dl>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-action-soft px-4 py-3">
            <span className="font-bold text-brand">Comissão devida</span>
            <span className="text-2xl font-extrabold text-brand">{formatBRL(c.amount_cents)}</span>
          </div>
          {c.original_amount_cents !== c.amount_cents && <p className="mt-2 text-sm text-muted">Valor ajustado pelo administrador (original: {formatBRL(c.original_amount_cents)}).</p>}
          {c.admin_note && <p className="mt-2 rounded-xl bg-page p-3 text-sm text-ink/80"><b>Observação:</b> {c.admin_note}</p>}
        </Card>

        {payable && (
          <Card className="mt-4 p-5">
            <h2 className="flex items-center gap-2 text-lg font-extrabold"><QrCode className="h-5 w-5 text-action" /> Pagar com Pix</h2>
            {!pixConfigured(settings) ? (
              <p className="mt-3 rounded-xl bg-warn-soft p-3 text-sm text-warn">O administrador ainda não cadastrou a chave Pix. Você será avisado quando estiver disponível.</p>
            ) : (
              <>
                <div className="mt-3 rounded-xl border border-line p-3.5">
                  <p className="text-sm text-muted">Chave Pix do administrador</p>
                  <p className="break-all font-bold">{settings.pix_key}</p>
                  <p className="text-sm text-muted">{settings.pix_receiver_name} · {settings.pix_city}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={async () => toast((await copy(settings.pix_key)) ? "Chave Pix copiada." : "Não foi possível copiar.")}><Copy className="h-4 w-4" /> Copiar chave</Button>
                  {pix && <Button onClick={async () => toast((await copy(pix)) ? "Pix copia e cola copiado. Cole no app do seu banco." : "Não foi possível copiar.")}><Copy className="h-4 w-4" /> Copiar Pix</Button>}
                </div>
                {qr && (
                  <div className="mt-4 flex flex-col items-center">
                    <img src={qr} alt="QR Code Pix" className="h-56 w-56 rounded-xl border border-line" />
                    <p className="mt-2 text-center text-sm text-muted">Leia com o app do banco. Já vem com o valor de {formatBRL(c.amount_cents)}.</p>
                  </div>
                )}
              </>
            )}
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="font-extrabold">Depois de pagar, avise aqui</h3>
              <p className="mt-1 text-sm text-muted">O pagamento só fica como “Pago” quando o administrador conferir o recebimento.</p>
              <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => fileInput.current?.click()} className="mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3.5 text-left">
                <FileUp className="h-5 w-5 text-action" />
                <span className="flex-1 truncate text-[15px] font-semibold">{file ? file.name : "Anexar comprovante (opcional)"}</span>
              </button>
              <p className="mt-2 flex gap-1.5 text-xs text-muted"><Info className="h-4 w-4 shrink-0" /> Se possível, corte do print o saldo e dados bancários que não são necessários. Só você e o administrador veem o comprovante.</p>
              <div className="mt-3"><Field label="Observação" optional><Textarea className="min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ex.: Pix feito hoje às 10h" /></Field></div>
              <Button size="lg" className="mt-4 w-full" loading={busy} onClick={report}><CheckCircle2 className="h-5 w-5" /> Já paguei — informar pagamento</Button>
            </div>
          </Card>
        )}

        {(c.status === "payment_reported" || c.status === "under_review") && (
          <Card className="mt-4 p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-action" />
            <p className="mt-2 font-extrabold">Pagamento informado</p>
            <p className="text-sm text-muted">Aguardando o administrador conferir o recebimento.</p>
          </Card>
        )}

        {q.data!.reports.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 font-extrabold">Histórico</h3>
            <ul className="space-y-2">
              {q.data!.reports.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-white p-3 text-sm">
                  <div className="flex justify-between"><span className="font-bold">Pagamento informado</span><span className="text-muted">{formatDateTime(r.created_at)}</span></div>
                  <p className="text-muted">{r.status === "submitted" ? "Em conferência" : r.status === "accepted" ? "Recebimento confirmado" : `Não localizado${r.review_note ? `: ${r.review_note}` : ""}`}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
