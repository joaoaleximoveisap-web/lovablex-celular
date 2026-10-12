import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, HandCoins, MessageCircle, Receipt, ShieldAlert, Wallet } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorBox, PageTitle, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { AppNotification } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { useAuth } from "@/auth/AuthProvider";

function iconFor(type: string) {
  if (type === "message") return MessageCircle;
  if (type.startsWith("offer")) return HandCoins;
  if (type.startsWith("sale")) return Receipt;
  if (type.startsWith("commission") || type.startsWith("payment")) return Wallet;
  if (type.startsWith("listing") || type.startsWith("report") || type.startsWith("account")) return ShieldAlert;
  return Bell;
}

export function NotificationsPage() {
  const q = useNotifications();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { userId } = useAuth();
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;

  async function open(n: AppNotification) {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["unread"] });
    }
    if (n.link) nav(n.link);
  }
  async function readAll() {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId!).is("read_at", null);
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["unread"] });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <PageTitle title="Notificações" action={unread > 0 ? <Button size="sm" variant="ghost" onClick={readAll}><CheckCheck className="h-4 w-4" /> Marcar todas como lidas</Button> : undefined} />
        {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <EmptyState icon={<Bell className="h-7 w-7" />} title="Tudo em dia" text="Mensagens, propostas e avisos de vendas aparecem aqui." />
        ) : (
          <ul className="overflow-hidden rounded-card border border-line/70 bg-white shadow-card">
            {q.data.map((n) => {
              const I = iconFor(n.type);
              return (
                <li key={n.id} className="border-b border-line last:border-0">
                  <button onClick={() => open(n)} className={cn("flex w-full items-start gap-3 p-4 text-left hover:bg-page", !n.read_at && "bg-action-soft/40")}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-action-soft text-action"><I className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[15px]", n.read_at ? "font-semibold" : "font-extrabold")}>{n.title}</span>
                      {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-xs text-muted">{timeAgo(n.created_at)}</span>
                    </span>
                    {!n.read_at && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-action" aria-label="Não lida" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
