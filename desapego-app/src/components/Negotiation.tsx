import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Flag } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, errorMessage } from "@/lib/supabase";
import { calcCommissionCents, formatBRL, formatRate } from "@/lib/money";
import { REPORT_REASONS } from "@/lib/labels";
import type { Listing, SaleType } from "@/lib/types";
import { uuid } from "@/lib/utils";
import { useAuth } from "@/auth/AuthProvider";
import { Sheet } from "./ui/sheet";
import { Button } from "./ui/button";
import { ChoiceGroup, Field, Input, MoneyInput, Select, Textarea } from "./ui/form";
import { useToast } from "./ui/toast";

export function OfferSheet({ open, onClose, listing, onSent, title = "Fazer proposta", initial, counterOf }: {
  open: boolean; onClose: () => void; listing: Pick<Listing, "id" | "asking_price_cents" | "title">; onSent: (conversationId: string | null) => void; title?: string; initial?: number;
  /** quando preenchido, responde a uma proposta com uma contraproposta */
  counterOf?: string;
}) {
  const [cents, setCents] = useState<number | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const requestId = useRef(uuid());
  const qc = useQueryClient();
  const suggestions = [0.9, 0.85, 0.8].map((f) => Math.round((listing.asking_price_cents * f) / 100) * 100).filter((v) => v > 0);

  async function send() {
    if (!cents) return setErr("Informe o valor da proposta.");
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = counterOf
        ? await supabase.rpc("respond_offer", { p_offer: counterOf, p_action: "counter", p_counter_cents: cents })
        : await supabase.rpc("make_offer", { p_listing: listing.id, p_amount_cents: cents, p_client_id: requestId.current });
      if (error) throw error;
      const { data: o } = await supabase.from("offers").select("conversation_id").eq("id", data).maybeSingle();
      requestId.current = uuid();
      qc.invalidateQueries({ queryKey: ["offers"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      onSent(o?.conversation_id ?? null);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} footer={<Button size="lg" className="w-full" loading={busy} onClick={send}>{counterOf ? "Enviar contraproposta" : "Enviar proposta"}</Button>}>
      <p className="mb-4 text-[15px] text-muted">{listing.title} · anunciado por <b className="text-ink">{formatBRL(listing.asking_price_cents)}</b></p>
      <Field label="Sua proposta" error={err}>
        <MoneyInput cents={cents} onChange={setCents} autoFocus />
      </Field>
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} onClick={() => setCents(s)} className="rounded-full border border-line px-3.5 py-2 text-sm font-bold text-ink hover:border-action">{formatBRL(s)}</button>
          ))}
        </div>
      )}
      <p className="mt-4 text-sm text-muted">A proposta fica registrada na conversa. Aceitar uma proposta não conclui a venda: vocês combinam retirada e pagamento diretamente.</p>
    </Sheet>
  );
}

interface BuyerOption { id: string; name: string; offerId?: string; offerCents?: number }

export function SellSheet({ open, onClose, listing, onDone }: { open: boolean; onClose: () => void; listing: Listing; onDone?: () => void }) {
  const { settings } = useAuth();
  const qc = useQueryClient();
  const requestId = useRef(uuid());
  const donation = listing.listing_type === "doacao";
  const [type, setType] = useState<SaleType>(donation ? "doacao" : "venda");
  const [buyer, setBuyer] = useState<string>("");
  const [external, setExternal] = useState("");
  const [cents, setCents] = useState<number | null>(listing.asking_price_cents || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | { commission: number }>(null);

  const buyers = useQuery({
    queryKey: ["sell-buyers", listing.id],
    enabled: open,
    queryFn: async () => {
      const [convs, offers] = await Promise.all([
        supabase.from("conversations").select("buyer_id, buyer:profiles!conversations_buyer_id_fkey(name)").eq("listing_id", listing.id),
        supabase.from("offers").select("id, buyer_id, amount_cents").eq("listing_id", listing.id).eq("status", "accepted").order("created_at", { ascending: false }),
      ]);
      const map = new Map<string, BuyerOption>();
      for (const c of (convs.data ?? []) as unknown as { buyer_id: string; buyer: { name: string } | null }[]) map.set(c.buyer_id, { id: c.buyer_id, name: c.buyer?.name ?? "Membro" });
      for (const o of offers.data ?? []) {
        const b = map.get(o.buyer_id);
        if (b && !b.offerId) Object.assign(b, { offerId: o.id, offerCents: o.amount_cents });
      }
      return [...map.values()];
    },
  });

  const selected = buyers.data?.find((b) => b.id === buyer);
  const price = type === "doacao" ? 0 : cents ?? 0;
  const commission = useMemo(() => (type === "venda" ? calcCommissionCents(price, settings.commission_rate_bps) : 0), [type, price, settings.commission_rate_bps]);

  async function confirm() {
    if (type === "venda" && !cents) return setErr("Informe o valor real da venda.");
    setBusy(true);
    setErr(null);
    try {
      const isMember = buyer && buyer !== "__fora" && buyer !== "__nao";
      const { error } = await supabase.rpc("mark_listing_sold", {
        p_listing: listing.id,
        p_final_price_cents: price,
        p_sale_type: type,
        p_buyer: isMember ? buyer : null,
        p_buyer_external_name: buyer === "__fora" ? external.trim() || null : null,
        p_offer: isMember && selected?.offerId && selected.offerCents === price ? selected.offerId : null,
        p_client_request_id: requestId.current,
      });
      if (error) throw error;
      qc.invalidateQueries();
      setDone({ commission });
      onDone?.();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet open={open} onClose={onClose} title="Venda registrada">
        <div className="flex flex-col items-center py-4 text-center">
          <CheckCircle2 className="h-14 w-14 text-action" />
          <p className="mt-3 text-lg font-extrabold">Parabéns pelo desapego!</p>
          {done.commission > 0 ? (
            <>
              <p className="mt-2 text-[15px] text-muted">Comissão gerada: <b className="text-ink">{formatBRL(done.commission)}</b>, com vencimento em {settings.payment_due_days} dias.</p>
              <Link to="/perfil/comissoes" className="mt-5 inline-flex h-12 items-center rounded-xl bg-action px-6 font-bold text-white">Ver como pagar</Link>
            </>
          ) : (
            <p className="mt-2 text-[15px] text-muted">{type === "doacao" ? "Doações" : "Trocas sem pagamento"} não geram comissão.</p>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Marcar como vendido"
      footer={<Button size="lg" className="w-full" loading={busy} onClick={confirm}>Confirmar {type === "venda" ? "venda" : type === "troca" ? "troca" : "doação"}</Button>}>
      <div className="space-y-5">
        {!donation && (
          <Field label="Como foi o desapego?">
            <ChoiceGroup<SaleType> value={type} onChange={setType} options={[{ value: "venda", label: "Venda" }, { value: "troca", label: "Troca" }, { value: "doacao", label: "Doação" }]} />
          </Field>
        )}
        <Field label="Quem ficou com o produto?">
          <Select value={buyer} onChange={(e) => {
            setBuyer(e.target.value);
            const b = buyers.data?.find((x) => x.id === e.target.value);
            if (b?.offerCents && type === "venda") setCents(b.offerCents);
          }}>
            <option value="">Selecione…</option>
            {buyers.data?.map((b) => <option key={b.id} value={b.id}>{b.name}{b.offerCents ? ` · proposta aceita ${formatBRL(b.offerCents)}` : ""}</option>)}
            <option value="__fora">Alguém de fora do app</option>
            <option value="__nao">Prefiro não informar</option>
          </Select>
        </Field>
        {buyer === "__fora" && <Field label="Nome do comprador" optional><Input value={external} onChange={(e) => setExternal(e.target.value)} maxLength={80} /></Field>}
        {type === "venda" && <Field label="Valor real da venda" hint="Informe o valor combinado de fato, mesmo que diferente do anúncio."><MoneyInput cents={cents} onChange={setCents} /></Field>}
        {type === "troca" && <p className="rounded-xl bg-page p-3 text-sm text-muted">Trocas sem pagamento em dinheiro não pagam comissão.</p>}
        {type === "venda" && (
          <div className="rounded-xl border border-line bg-page p-4 text-[15px]">
            <div className="flex justify-between"><span className="text-muted">Valor da venda</span><b>{formatBRL(price)}</b></div>
            <div className="mt-1 flex justify-between"><span className="text-muted">Comissão ({formatRate(settings.commission_rate_bps)})</span><b className="text-brand">{formatBRL(commission)}</b></div>
            <p className="mt-2 text-xs text-muted">A comissão é paga por Pix ao administrador em até {settings.payment_due_days} dias. O valor da venda fica entre você e o comprador.</p>
          </div>
        )}
        {err && <p className="text-sm font-semibold text-danger">{err}</p>}
      </div>
    </Sheet>
  );
}

export function ReportSheet({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: "listing" | "user" | "conversation"; targetId: string }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function send() {
    if (!reason) return toast("Escolha um motivo.", "error");
    setBusy(true);
    const { error } = await supabase.from("reports").insert({ target_type: targetType, target_id: targetId, reason, details: details.trim() || null });
    setBusy(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Denúncia enviada ao administrador. Obrigado!");
    onClose();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Denunciar" footer={<Button size="lg" variant="danger" className="w-full" loading={busy} onClick={send}><Flag className="h-4 w-4" /> Enviar denúncia</Button>}>
      <div className="space-y-2">
        {REPORT_REASONS.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-4 py-3 text-[15px] font-semibold has-[:checked]:border-danger has-[:checked]:bg-danger-soft">
            <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="h-4 w-4 accent-[#B4442F]" />
            {r.label}
          </label>
        ))}
      </div>
      <div className="mt-4"><Field label="Detalhes" optional><Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} /></Field></div>
    </Sheet>
  );
}

export function ConfirmSheet({ open, onClose, title, text, confirmLabel, onConfirm, danger, withReason }: {
  open: boolean; onClose: () => void; title: string; text: string; confirmLabel: string; onConfirm: (reason: string) => Promise<void> | void; danger?: boolean; withReason?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>Voltar</Button>
          <Button variant={danger ? "danger" : "primary"} size="lg" className="flex-1" loading={busy} disabled={Boolean(withReason) && reason.trim().length < 3}
            onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } }}>{confirmLabel}</Button>
        </div>
      }>
      <p className="text-[15px] text-ink/80">{text}</p>
      {withReason && <div className="mt-4"><Field label={withReason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-[80px]" /></Field></div>}
    </Sheet>
  );
}
