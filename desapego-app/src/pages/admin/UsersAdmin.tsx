import { useState } from "react";
import { Copy, KeyRound, Send, UserPlus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Badge, Card, ErrorBox, Spinner, Tabs } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ConfirmSheet } from "@/components/Negotiation";
import { supabase, errorMessage } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";
import type { Profile } from "@/lib/types";
import { appUrl, formatDate } from "@/lib/utils";
import { useAuth } from "@/auth/AuthProvider";

interface Invite { id: string; label: string | null; grants_role: string; expires_at: string; max_uses: number; use_count: number; revoked_at: string | null; created_at: string }
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  active: { label: "Ativo", tone: "ok" }, pending: { label: "Aguardando aprovação", tone: "warn" }, suspended: { label: "Suspenso", tone: "danger" }, deleted: { label: "Excluído", tone: "neutral" },
};

function InviteBox() {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [uses, setUses] = useState("1");
  const [days, setDays] = useState("7");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState("");
  const invites = useQuery({
    queryKey: ["admin", "invites"],
    queryFn: async () => ((await supabase.from("invites").select("*").order("created_at", { ascending: false }).limit(30)).data ?? []) as Invite[],
  });
  const link = code ? appUrl(`/cadastro?convite=${code}`) : "";
  async function create() {
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_create_invite", { p_label: label || null, p_max_uses: Number(uses), p_days: Number(days) });
    setBusy(false);
    if (error) return toast(errorMessage(error), "error");
    setCode(data);
    setLabel("");
    qc.invalidateQueries({ queryKey: ["admin", "invites"] });
  }
  async function revoke(id: string) {
    const { error } = await supabase.rpc("admin_revoke_invite", { p_invite: id });
    if (error) return toast(errorMessage(error), "error");
    qc.invalidateQueries({ queryKey: ["admin", "invites"] });
  }
  async function saveAccess(v: string | null) {
    const { error } = await supabase.rpc("admin_set_access_code", { p_code: v });
    if (error) return toast(errorMessage(error), "error");
    toast(v ? "Código de acesso definido. Quem usar entra como pendente, para você aprovar." : "Código de acesso desativado.");
    setAccess("");
  }
  const msg = `Você foi convidado(a) para o Desapego da Família! Crie sua conta: ${link}`;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h3 className="flex items-center gap-2 font-extrabold"><UserPlus className="h-5 w-5 text-action" /> Convidar familiar</h3>
        <Field label="Para quem?" optional><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Tia Maria" maxLength={80} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantas pessoas"><Select value={uses} onChange={(e) => setUses(e.target.value)}>{[1, 2, 5, 10, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          <Field label="Validade"><Select value={days} onChange={(e) => setDays(e.target.value)}>{[1, 3, 7, 15, 30].map((n) => <option key={n} value={n}>{n} dia(s)</option>)}</Select></Field>
        </div>
        <Button className="w-full" loading={busy} onClick={create}>Gerar convite</Button>
        {code && (
          <div className="rounded-xl bg-action-soft p-3.5">
            <p className="text-sm font-bold text-brand">Código (mostrado só agora):</p>
            <p className="my-1 text-2xl font-extrabold tracking-widest text-brand">{code}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(msg); toast("Convite copiado."); }}><Copy className="h-4 w-4" /> Copiar</Button>
              <a className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-action px-3 text-sm font-bold text-white" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"><Send className="h-4 w-4" /> WhatsApp</a>
            </div>
          </div>
        )}
        <div className="border-t border-line pt-3">
          <h4 className="flex items-center gap-2 font-bold"><KeyRound className="h-4 w-4 text-action" /> Código geral da família</h4>
          <p className="mb-2 text-sm text-muted">Opcional. Quem entrar com ele fica aguardando sua aprovação.</p>
          <div className="flex gap-2">
            <Input value={access} onChange={(e) => setAccess(e.target.value)} placeholder="Novo código (mín. 6)" />
            <Button variant="outline" disabled={access.trim().length < 6} onClick={() => saveAccess(access.trim())}>Salvar</Button>
          </div>
          <button onClick={() => saveAccess(null)} className="mt-2 text-sm font-bold text-muted underline">Desativar código geral</button>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 font-extrabold">Convites recentes</h3>
        {invites.isLoading ? <Spinner className="py-6" /> : (
          <ul className="divide-y divide-line">
            {invites.data?.map((i) => {
              const valid = !i.revoked_at && new Date(i.expires_at) > new Date() && i.use_count < i.max_uses;
              return (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <p className="font-bold">{i.label ?? "Sem nome"}{i.grants_role === "admin" && " · administrador"}</p>
                    <p className="text-muted">{i.use_count}/{i.max_uses} uso(s) · até {formatDate(i.expires_at)}</p>
                  </div>
                  {valid ? <Button size="sm" variant="ghost" className="text-danger" onClick={() => revoke(i.id)}>Revogar</Button> : <Badge>{i.revoked_at ? "Revogado" : "Encerrado"}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MemberSheet({ member, onClose }: { member: Profile; onClose: () => void }) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | "suspend">(null);
  const s = useQuery({
    queryKey: ["admin", "user", member.id],
    queryFn: async () => (await supabase.rpc("admin_user_summary", { p_user: member.id })).data as Record<string, number | string | boolean | null>,
  });
  async function status(st: "active" | "suspended", reason?: string) {
    const { error } = await supabase.rpc("admin_set_user_status", { p_user: member.id, p_status: st, p_reason: reason ?? null });
    if (error) return toast(errorMessage(error), "error");
    toast(st === "active" ? "Membro ativo." : "Membro suspenso.");
    qc.invalidateQueries({ queryKey: ["admin"] });
    onClose();
  }
  async function role(r: "admin" | "member") {
    const { error } = await supabase.rpc("admin_set_user_role", { p_user: member.id, p_role: r });
    if (error) return toast(errorMessage(error), "error");
    toast("Papel atualizado.");
    qc.invalidateQueries({ queryKey: ["admin"] });
    onClose();
  }
  const d = s.data;
  return (
    <Sheet open onClose={onClose} title={member.name}>
      <div className="flex items-center gap-3">
        <Avatar name={member.name} path={member.avatar_url} size={56} />
        <div>
          <Badge tone={STATUS[member.account_status]!.tone}>{STATUS[member.account_status]!.label}</Badge>
          <p className="mt-1 text-sm text-muted">{member.role === "admin" ? "Administrador" : "Membro"} · desde {formatDate(member.created_at)}</p>
        </div>
      </div>
      {d && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted">Telefone</dt><dd className="font-bold">{(d.phone as string) || "—"}</dd></div>
          <div><dt className="text-muted">Anúncios ativos</dt><dd className="font-bold">{d.listings_active as number}</dd></div>
          <div><dt className="text-muted">Vendas</dt><dd className="font-bold">{d.sales as number} · {formatBRL(d.sales_volume_cents as number)}</dd></div>
          <div><dt className="text-muted">Compras</dt><dd className="font-bold">{d.purchases as number}</dd></div>
          <div><dt className="text-muted">Comissões pagas</dt><dd className="font-bold">{formatBRL(d.commissions_paid_cents as number)}</dd></div>
          <div><dt className="text-muted">Em aberto</dt><dd className="font-bold">{formatBRL(d.commissions_open_cents as number)}</dd></div>
          {d.restricted && <div className="col-span-2"><Badge tone="danger">Novos anúncios bloqueados por atraso</Badge></div>}
        </dl>
      )}
      <div className="mt-5 grid gap-2">
        {member.account_status === "pending" && <Button onClick={() => status("active")}>Aprovar cadastro</Button>}
        {member.account_status === "suspended" && <Button onClick={() => status("active")}>Reativar conta</Button>}
        {member.account_status === "active" && member.id !== userId && <Button variant="outline" className="text-danger" onClick={() => setConfirm("suspend")}>Suspender conta</Button>}
        {member.account_status === "active" && member.role !== "admin" && <Button variant="outline" onClick={() => role("admin")}>Tornar administrador</Button>}
        {member.account_status === "active" && member.role === "admin" && member.id !== userId && <Button variant="outline" onClick={() => role("member")}>Remover de administrador</Button>}
      </div>
      <ConfirmSheet open={confirm === "suspend"} onClose={() => setConfirm(null)} title="Suspender conta?" danger confirmLabel="Suspender" withReason="Motivo (o membro verá)"
        text="Os anúncios ativos serão pausados e a pessoa não conseguirá usar o app até ser reativada." onConfirm={(r) => status("suspended", r)} />
    </Sheet>
  );
}

export function UsersAdmin() {
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "suspended">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Profile | null>(null);
  const q = useQuery({
    queryKey: ["admin", "members"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").neq("account_status", "deleted").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Profile[];
    },
  });
  const rows = (q.data ?? []).filter((p) => (filter === "all" || p.account_status === filter) && p.name.toLowerCase().includes(search.toLowerCase()));
  const pending = (q.data ?? []).filter((p) => p.account_status === "pending").length;
  return (
    <div className="space-y-6">
      <InviteBox />
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-extrabold">Familiares</h3>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome" className="h-10 max-w-xs" />
        </div>
        <Tabs value={filter} onChange={setFilter} items={[{ value: "all", label: "Todos" }, { value: "pending", label: "Pendentes", count: pending }, { value: "active", label: "Ativos" }, { value: "suspended", label: "Suspensos" }]} />
        {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} /> : (
          <Card className="divide-y divide-line">
            {rows.map((p) => (
              <button key={p.id} onClick={() => setOpen(p)} className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-page">
                <Avatar name={p.name} path={p.avatar_url} size={40} />
                <span className="min-w-0 flex-1"><span className="block truncate font-bold">{p.name}</span><span className="text-sm text-muted">{p.role === "admin" ? "Administrador · " : ""}desde {formatDate(p.created_at)}</span></span>
                <Badge tone={STATUS[p.account_status]!.tone}>{STATUS[p.account_status]!.label}</Badge>
              </button>
            ))}
            {rows.length === 0 && <p className="p-4 text-sm text-muted">Ninguém encontrado.</p>}
          </Card>
        )}
      </section>
      {open && <MemberSheet member={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
