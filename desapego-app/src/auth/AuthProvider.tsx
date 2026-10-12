import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isConfigured, supabase } from "@/lib/supabase";
import { DEFAULT_SETTINGS, type Message, type Profile, type Settings } from "@/lib/types";

interface AuthState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  profileLoading: boolean;
  isAdmin: boolean;
  isActive: boolean;
  settings: Settings;
  recovering: boolean;
  setRecovering: (v: boolean) => void;
  refreshProfile: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isConfigured);
  const [recovering, setRecovering] = useState(false);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") qc.clear();
    });
    // depois do link de e-mail (?code=...), limpa o endereço
    if (window.location.search.includes("code=")) {
      const clean = window.location.href.split("?")[0]!.split("#")[0]! + (window.location.hash || "#/");
      setTimeout(() => window.history.replaceState(null, "", clean), 1500);
    }
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const profileQ = useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
    staleTime: 60_000,
  });
  const profile = profileQ.data ?? null;
  const isActive = profile?.account_status === "active";

  const settingsQ = useQuery({
    queryKey: ["settings"],
    enabled: Boolean(userId) && isActive,
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("key, value");
      if (error) throw error;
      const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const row of data ?? []) if (row.key in DEFAULT_SETTINGS) s[row.key] = row.value;
      return s as unknown as Settings;
    },
    staleTime: 5 * 60_000,
  });

  // tempo real: um único canal por pessoa para avisos e mensagens (sem ficar consultando o servidor)
  const reminded = useRef(false);
  useEffect(() => {
    if (!userId || !isActive) return;
    if (!reminded.current) {
      reminded.current = true;
      supabase.rpc("sync_my_reminders").then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
    }
    const ch = supabase
      .channel(`me-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["unread"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as Message;
        // a mensagem chega pronta: entra direto na conversa aberta, sem nova consulta
        qc.setQueryData<Message[]>(["messages", m.conversation_id], (list) =>
          list ? (list.some((x) => x.id === m.id || (m.client_id && x.client_id === m.client_id)) ? list.map((x) => (x.client_id && x.client_id === m.client_id ? m : x)) : [...list, m]) : list,
        );
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["unread"] });
        if (m.kind !== "text") qc.invalidateQueries({ queryKey: ["offers", "conversation", m.conversation_id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, isActive, qc]);

  const value = useMemo<AuthState>(
    () => ({
      // isPending cobre também o instante antes da consulta do perfil começar (evita piscar "perfil não encontrado")
      ready: ready && (!userId || !profileQ.isPending || profileQ.isError),
      session,
      userId,
      profile,
      profileLoading: profileQ.isFetching,
      isAdmin: isActive && profile?.role === "admin",
      isActive,
      settings: settingsQ.data ?? DEFAULT_SETTINGS,
      recovering,
      setRecovering,
      refreshProfile: () => qc.invalidateQueries({ queryKey: ["profile", userId] }),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [ready, session, userId, profile, profileQ.isPending, profileQ.isError, profileQ.isFetching, isActive, settingsQ.data, recovering, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fora do AuthProvider");
  return v;
}
