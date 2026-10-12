import { LogoMark } from "@/components/Logo";

/** Aparece enquanto o app ainda não foi ligado a um projeto Supabase (config.js vazio). */
export function SetupPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page p-5">
      <div className="w-full max-w-lg rounded-card border border-line bg-white p-6 shadow-card md:p-8">
        <LogoMark className="h-12 w-12" />
        <h1 className="mt-4 text-2xl font-extrabold text-brand">Desapego da Família</h1>
        <p className="mt-2 text-[15px] text-muted">O aplicativo está instalado, mas ainda não foi conectado ao banco de dados.</p>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-[15px] text-ink">
          <li>Crie um projeto gratuito no Supabase e aplique as migrações da pasta <code className="rounded bg-page px-1">supabase/migrations</code>.</li>
          <li>Abra o arquivo <code className="rounded bg-page px-1">config.js</code> do app publicado.</li>
          <li>Preencha <b>supabaseUrl</b> e <b>supabaseAnonKey</b> (Project Settings → API).</li>
          <li>Recarregue esta página.</li>
        </ol>
        <p className="mt-5 rounded-xl bg-warn-soft p-3 text-sm text-warn">Nunca use a chave <b>service_role</b> no aplicativo.</p>
      </div>
    </div>
  );
}
