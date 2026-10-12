import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, ChevronRight, Download, FileText, HelpCircle, LogOut, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ConfirmSheet } from "@/components/Negotiation";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/AuthProvider";
import { compressImage, extFor } from "@/lib/image";
import { supabase, errorMessage } from "@/lib/supabase";
import { uuid } from "@/lib/utils";

export function AccountTab() {
  const { profile, userId, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.name ?? "");
  const [location, setLocation] = useState(profile?.location ?? "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const priv = useQuery({
    queryKey: ["private", userId],
    queryFn: async () => (await supabase.from("profile_private").select("phone").eq("user_id", userId!).maybeSingle()).data,
  });
  useEffect(() => setPhone(priv.data?.phone ?? ""), [priv.data]);

  async function save() {
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update({ name: name.trim(), location: location.trim() || null }).eq("id", userId!);
      if (error) throw error;
      const r = await supabase.rpc("update_my_private", { p_phone: phone });
      if (r.error) throw r.error;
      refreshProfile();
      toast("Dados salvos.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(f: File | undefined) {
    if (!f) return;
    try {
      const img = await compressImage(f, 400, 0.85);
      const path = `${userId}/avatar-${uuid()}.${extFor(img.type)}`;
      const up = await supabase.storage.from("media").upload(path, img.blob, { contentType: img.type, cacheControl: "31536000" });
      if (up.error) throw up.error;
      const old = profile?.avatar_url;
      const { error } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", userId!);
      if (error) throw error;
      if (old && !old.startsWith("http")) await supabase.storage.from("media").remove([old]);
      refreshProfile();
      toast("Foto atualizada.");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const links = [
    { to: "/ajuda", label: "Ajuda e como instalar o app", icon: HelpCircle },
    { to: "/termos", label: "Termos de utilização", icon: FileText },
    { to: "/privacidade", label: "Privacidade e seus dados", icon: Shield },
  ];

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-4">
          <Avatar name={profile?.name ?? ""} path={profile?.avatar_url} size={72} />
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { void uploadAvatar(e.target.files?.[0]); e.target.value = ""; }} />
          <Button variant="outline" onClick={() => file.current?.click()}><Camera className="h-4 w-4" /> Trocar foto</Button>
        </div>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="Cidade ou bairro" optional><Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={80} /></Field>
        <Field label="Telefone / WhatsApp" optional hint="Privado. Só é enviado numa conversa se você tocar em “Enviar meu WhatsApp”.">
          <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </Field>
        <Button className="w-full" loading={busy} onClick={save}>Salvar</Button>
      </Card>
      <div className="space-y-5">
        <Card className="divide-y divide-line">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="flex items-center gap-3 p-4 font-bold"><l.icon className="h-5 w-5 text-action" /><span className="flex-1">{l.label}</span><ChevronRight className="h-5 w-5 text-muted" /></Link>
          ))}
          <InstallRow />
        </Card>
        <Button variant="outline" className="w-full" onClick={signOut}><LogOut className="h-4 w-4" /> Sair da conta</Button>
        <button onClick={() => setDel(true)} className="w-full py-2 text-sm font-bold text-danger">Excluir minha conta</button>
      </div>
      <ConfirmSheet open={del} onClose={() => setDel(false)} title="Excluir sua conta?" danger confirmLabel="Excluir conta"
        text="Seus anúncios saem da vitrine, seus dados pessoais são apagados e o perfil fica anônimo. Registros de vendas e comissões são mantidos pelo prazo legal, sem seus dados de contato. Não é possível desfazer."
        onConfirm={async () => {
          const { error } = await supabase.rpc("delete_my_account");
          if (error) return toast(errorMessage(error), "error");
          await signOut();
        }} />
    </div>
  );
}

type BIPEvent = Event & { prompt: () => Promise<void> };
let deferred: BIPEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as BIPEvent;
});

function InstallRow() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  if (standalone) return null;
  return (
    <button
      onClick={async () => {
        if (deferred) {
          await deferred.prompt();
          deferred = null;
        } else window.location.hash = "#/ajuda";
      }}
      className="flex w-full items-center gap-3 p-4 text-left font-bold"
    >
      <Download className="h-5 w-5 text-action" /><span className="flex-1">Instalar na tela inicial</span><ChevronRight className="h-5 w-5 text-muted" />
    </button>
  );
}
