import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  interface Window {
    DESAPEGO_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string };
  }
}

const cfg = window.DESAPEGO_CONFIG ?? {};
export const SUPABASE_URL = (cfg.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON_KEY = cfg.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const isConfigured = Boolean(SUPABASE_URL && ANON_KEY);

export const supabase: SupabaseClient = createClient(SUPABASE_URL || "http://localhost", ANON_KEY || "anon", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  realtime: { params: { eventsPerSecond: 5 } },
});

export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Mensagem de erro em português para a pessoa (o servidor já responde em português). */
export function errorMessage(e: unknown): string {
  if (!navigator.onLine) return "Sem conexão com a internet. Nada foi enviado — tente de novo quando a conexão voltar.";
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Não foi possível falar com o servidor. Verifique a internet e tente de novo.";
  if (/Invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(msg)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (/User already registered/i.test(msg)) return "Este e-mail já tem cadastro. Use \"Entrar\".";
  if (/Database error saving new user/i.test(msg)) return "Convite inválido ou expirado. Peça um novo ao administrador.";
  if (/Password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 8 caracteres.";
  if (/rate limit/i.test(msg)) return "Muitas tentativas. Aguarde alguns minutos.";
  if (/row-level security|permission denied/i.test(msg)) return "Você não tem permissão para fazer isso.";
  if (/duplicate key/i.test(msg)) return "Isso já foi registrado.";
  if (/The object exceeded the maximum allowed size|Payload too large/i.test(msg)) return "Arquivo grande demais.";
  return msg.replace(/^.*?ERROR:\s*/, "");
}
