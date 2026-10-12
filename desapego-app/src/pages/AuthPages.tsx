import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, MailCheck, ShieldAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase, errorMessage } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { LogoMark } from "@/components/Logo";
import { Navigate } from "react-router-dom";

export const TERMS_VERSION = "1";

function appBaseUrl() {
  return window.location.origin + window.location.pathname;
}

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const branding = useQuery({
    queryKey: ["branding"],
    queryFn: async () => (await supabase.rpc("public_branding")).data as { app_name?: string } | null,
    staleTime: Infinity,
  });
  const name = branding.data?.app_name || "Desapego da Família";
  return (
    <div className="flex min-h-dvh flex-col bg-page md:items-center md:justify-center md:p-6">
      <div className="w-full bg-white px-5 pb-10 pt-[max(32px,env(safe-area-inset-top))] md:max-w-[440px] md:rounded-[24px] md:border md:border-line md:p-9 md:shadow-card">
        <div className="mb-7 flex items-center gap-3">
          <LogoMark className="h-11 w-11" />
          <span className="text-lg font-extrabold leading-tight text-brand">{name}</span>
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-center text-[15px] text-muted">{footer}</div>}
      </div>
      <p className="px-5 py-5 text-center text-xs text-muted">
        <Link to="/termos" className="underline">Termos</Link> · <Link to="/privacidade" className="underline">Privacidade</Link> · <Link to="/ajuda" className="underline">Ajuda</Link>
      </p>
    </div>
  );
}

function Alert({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  return (
    <div role="alert" className={tone === "error" ? "rounded-xl bg-danger-soft px-4 py-3 text-[15px] font-semibold text-danger" : "rounded-xl bg-action-soft px-4 py-3 text-[15px] font-semibold text-action"}>
      {children}
    </div>
  );
}

export function LoginPage() {
  const { session, ready } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  if (ready && session) return <Navigate to="/" replace />;
  const invite = params.get("convite");
  if (invite) return <Navigate to={`/cadastro?convite=${encodeURIComponent(invite)}`} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      if (forgot) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appBaseUrl() });
        if (error) throw error;
        setInfo("Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={forgot ? "Recuperar senha" : "Entrar"}
      subtitle={forgot ? "Enviaremos um link para o seu e-mail." : "Bem-vindo(a) de volta à vitrine da família."}
      footer={<>Recebeu um convite? <Link to="/cadastro" className="font-bold text-action">Criar conta</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        {info && <Alert tone="ok">{info}</Alert>}
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {!forgot && (
          <Field label="Senha" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>{forgot ? "Enviar link" : "Entrar"}</Button>
        <button type="button" onClick={() => { setForgot(!forgot); setErr(null); setInfo(null); }} className="w-full py-2 text-[15px] font-bold text-action">
          {forgot ? "Voltar para o login" : "Esqueci minha senha"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { session, ready } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("convite") ?? "");
  const [checked, setChecked] = useState<null | { valid: boolean; kind?: string; label?: string }>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | "confirm" | "ok">(null);

  useEffect(() => {
    const c = params.get("convite");
    if (c) void verify(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (ready && session && !done) return <Navigate to="/" replace />;

  async function verify(c = code) {
    setErr(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("check_invite", { p_code: c.trim() });
      if (error) throw error;
      setChecked(data);
      if (!data?.valid) setErr("Convite inválido ou expirado. Confira o código ou peça um novo ao administrador.");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!checked?.valid) return verify();
    if (!accept) return setErr("Para continuar, aceite os termos de utilização.");
    if (password.length < 8) return setErr("A senha precisa ter pelo menos 8 caracteres.");
    setErr(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: appBaseUrl(),
          data: { name: name.trim(), invite_code: code.trim(), accepted_terms: "true", terms_version: TERMS_VERSION, phone: phone.trim() },
        },
      });
      if (error) throw error;
      if (data.session) {
        setDone("ok");
        nav("/", { replace: true });
      } else setDone("confirm");
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  if (done === "confirm") {
    return (
      <AuthLayout title="Confirme seu e-mail" subtitle={`Enviamos um link para ${email}. Abra-o neste aparelho para entrar.`}>
        <div className="flex justify-center py-6 text-action"><MailCheck className="h-16 w-16" /></div>
        <Link to="/entrar" className="block text-center font-bold text-action">Voltar para o login</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Criar conta"
      subtitle={checked?.valid ? (checked.kind === "access_code" ? "Código da família aceito. Seu cadastro será aprovado pelo administrador." : `Convite válido${checked.label ? ` · ${checked.label}` : ""}. Falta pouco!`) : "A comunidade é fechada: use o convite que você recebeu."}
      footer={<>Já tem conta? <Link to="/entrar" className="font-bold text-action">Entrar</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Código do convite" htmlFor="code">
          <div className="flex gap-2">
            <Input id="code" autoCapitalize="characters" autoComplete="off" required value={code}
              onChange={(e) => { setCode(e.target.value); setChecked(null); }} placeholder="XXXX-XXXX-XXXX" className="uppercase tracking-wider" />
            {checked?.valid && <CheckCircle2 className="h-12 w-8 shrink-0 text-action" aria-label="Convite válido" />}
          </div>
        </Field>
        {checked?.valid ? (
          <>
            <Field label="Seu nome" htmlFor="name">
              <Input id="name" autoComplete="name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="E-mail" htmlFor="email">
              <Input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Senha" htmlFor="pw" hint="Mínimo de 8 caracteres.">
              <Input id="pw" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Telefone / WhatsApp" htmlFor="phone" optional hint="Fica privado. Só aparece para alguém se você decidir compartilhar numa conversa.">
              <Input id="phone" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(43) 99999-0000" />
            </Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3.5 text-[15px]">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#37866B]" />
              <span>
                Li e aceito os <Link to="/termos" target="_blank" className="font-bold text-action underline">termos de utilização</Link>, incluindo a comissão sobre vendas concluídas, e a <Link to="/privacidade" target="_blank" className="font-bold text-action underline">política de privacidade</Link>.
              </span>
            </label>
            <Button type="submit" size="lg" className="w-full" loading={busy}>Criar minha conta</Button>
          </>
        ) : (
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!code.trim()}>Validar convite</Button>
        )}
      </form>
    </AuthLayout>
  );
}

export function PendingPage() {
  const { profile, signOut, refreshProfile, profileLoading } = useAuth();
  const status = profile?.account_status;
  const content =
    status === "pending"
      ? { icon: <Clock className="h-14 w-14" />, title: "Cadastro em análise", text: "O administrador precisa aprovar sua entrada. Você recebe acesso assim que ele confirmar." }
      : status === "suspended"
        ? { icon: <ShieldAlert className="h-14 w-14" />, title: "Conta suspensa", text: "Seu acesso está suspenso. Fale com o administrador da família para entender o motivo." }
        : status === "deleted"
          ? { icon: <ShieldAlert className="h-14 w-14" />, title: "Conta excluída", text: "Esta conta foi encerrada a seu pedido." }
          : { icon: <ShieldAlert className="h-14 w-14" />, title: "Perfil não encontrado", text: "Não encontramos seu cadastro. Use um convite válido para criar a conta." };
  return (
    <AuthLayout title={content.title} subtitle={content.text}>
      <div className="flex justify-center py-4 text-action">{content.icon}</div>
      <div className="space-y-2">
        <Button className="w-full" variant="outline" loading={profileLoading} onClick={refreshProfile}>Verificar novamente</Button>
        <Button className="w-full" variant="ghost" onClick={signOut}>Sair</Button>
      </div>
    </AuthLayout>
  );
}

export function NewPasswordPage() {
  const { setRecovering } = useAuth();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setErr("A senha precisa ter pelo menos 8 caracteres.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(errorMessage(error));
    setRecovering(false);
  }
  return (
    <AuthLayout title="Nova senha" subtitle="Escolha uma senha nova para sua conta.">
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Nova senha" htmlFor="npw">
          <Input id="npw" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Salvar senha</Button>
      </form>
    </AuthLayout>
  );
}
