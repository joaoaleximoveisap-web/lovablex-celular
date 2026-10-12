import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Card, ErrorBox, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { supabase, errorMessage } from "@/lib/supabase";
import { buildPixPayload, normalizePixKey } from "@/lib/pix";
import { calcCommissionCents, formatBRL } from "@/lib/money";

type Values = Record<string, string>;
const NUMERIC = ["commission_rate_bps", "payment_due_days", "overdue_grace_days", "max_photos", "max_active_listings"];

export function SettingsAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("key, value, updated_at").neq("key", "access_code_hash");
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.key, r.value])) as Record<string, string | number>;
    },
  });
  const [v, setV] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    const init: Values = {};
    for (const [k, val] of Object.entries(q.data)) init[k] = k === "commission_rate_bps" ? String(Number(val) / 100).replace(".", ",") : String(val);
    setV(init);
  }, [q.data]);

  const rateBps = Math.round(Number((v.commission_rate_bps ?? "0").replace(",", ".")) * 100);
  let pixPreview: string | null = null;
  try {
    pixPreview = v.pix_key && v.pix_receiver_name && v.pix_city ? buildPixPayload({ key: v.pix_key, name: v.pix_receiver_name, city: v.pix_city, amountCents: 100, txid: "TESTE" }) : null;
  } catch {
    pixPreview = null;
  }
  useEffect(() => {
    if (pixPreview) QRCode.toDataURL(pixPreview, { margin: 1, width: 300 }).then(setQr);
    else setQr(null);
  }, [pixPreview]);

  async function save() {
    if (!q.data) return;
    if (!Number.isFinite(rateBps) || rateBps < 0 || rateBps > 5000) return toast("Comissão entre 0% e 50%.", "error");
    setBusy(true);
    try {
      for (const [k, raw] of Object.entries(v)) {
        const next = k === "commission_rate_bps" ? rateBps : NUMERIC.includes(k) ? Number(raw) : k === "pix_key" ? normalizePixKey(raw) : raw.trim();
        if (String(next) === String(q.data[k])) continue;
        const { error } = await supabase.rpc("admin_update_setting", { p_key: k, p_value: next });
        if (error) throw new Error(`${k}: ${errorMessage(error)}`);
      }
      toast("Configurações salvas e registradas na auditoria.");
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} />;
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h3 className="font-extrabold">Comissão e cobrança</h3>
        <Field label="Percentual de comissão (%)" hint={`Exemplo: venda de R$ 500 → comissão de ${formatBRL(calcCommissionCents(50000, rateBps))}. Vale só para vendas registradas depois da mudança.`}>
          <Input inputMode="decimal" value={v.commission_rate_bps ?? ""} onChange={set("commission_rate_bps")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prazo para pagar (dias)"><Input type="number" min={1} max={90} value={v.payment_due_days ?? ""} onChange={set("payment_due_days")} /></Field>
          <Field label="Tolerância após aviso (dias)" hint="Depois disso, novos anúncios ficam bloqueados."><Input type="number" min={1} max={180} value={v.overdue_grace_days ?? ""} onChange={set("overdue_grace_days")} /></Field>
        </div>
        <Field label="Chave Pix" hint="CPF, CNPJ, e-mail, telefone (+5543999990000) ou chave aleatória."><Input value={v.pix_key ?? ""} onChange={set("pix_key")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome do recebedor" hint="Até 25 letras"><Input value={v.pix_receiver_name ?? ""} onChange={set("pix_receiver_name")} maxLength={25} /></Field>
          <Field label="Cidade" hint="Até 15 letras"><Input value={v.pix_city ?? ""} onChange={set("pix_city")} maxLength={15} /></Field>
        </div>
        {qr && (
          <div className="flex items-center gap-4 rounded-xl bg-page p-3">
            <img src={qr} alt="QR de teste" className="h-28 w-28 rounded-lg" />
            <p className="text-sm text-muted">QR de teste de R$ 1,00. Leia com o app do seu banco para conferir se o nome e a chave aparecem certos antes de divulgar. Não precisa pagar.</p>
          </div>
        )}
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-extrabold">Comunidade</h3>
        <Field label="Nome do aplicativo"><Input value={v.app_name ?? ""} onChange={set("app_name")} maxLength={40} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fotos por anúncio"><Input type="number" min={1} max={10} value={v.max_photos ?? ""} onChange={set("max_photos")} /></Field>
          <Field label="Anúncios ativos por pessoa"><Input type="number" min={1} max={500} value={v.max_active_listings ?? ""} onChange={set("max_active_listings")} /></Field>
        </div>
        <Field label="Moderação de anúncios">
          <ChoiceGroup columns={2} value={(v.moderation_mode as "post" | "pre") ?? "post"} onChange={(x) => setV((s) => ({ ...s, moderation_mode: x }))}
            options={[{ value: "post", label: "Publicar direto", hint: "você remove se precisar" }, { value: "pre", label: "Aprovar antes", hint: "você aprova cada um" }]} />
        </Field>
        <Field label="Política de participação" hint="Aparece nos termos de utilização."><Textarea value={v.participation_policy ?? ""} onChange={set("participation_policy")} maxLength={3000} /></Field>
      </Card>
      <div className="lg:col-span-2">
        <Button size="lg" className="w-full lg:w-auto" loading={busy} onClick={save}>Salvar configurações</Button>
      </div>
    </div>
  );
}
