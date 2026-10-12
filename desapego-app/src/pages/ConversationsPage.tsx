import { useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Avatar, EmptyState, ErrorBox, PageTitle, Spinner, Tabs } from "@/components/ui/misc";
import { useConversations } from "@/lib/queries";
import { publicUrl } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";
import { LISTING_STATUS_LABEL } from "@/lib/labels";
import { cn, timeAgo } from "@/lib/utils";

export function ConversationsPage() {
  const q = useConversations();
  const [tab, setTab] = useState<"all" | "buying" | "selling">("all");
  const all = q.data ?? [];
  const rows = all.filter((c) => (tab === "all" ? true : tab === "selling" ? c.i_am_seller : !c.i_am_seller));
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <PageTitle title="Conversas" />
        <Tabs value={tab} onChange={setTab} items={[
          { value: "all", label: "Todas", count: all.reduce((s, c) => s + Number(c.unread), 0) },
          { value: "buying", label: "Comprando" },
          { value: "selling", label: "Vendendo" },
        ]} />
        {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
          <EmptyState icon={<MessageCircle className="h-7 w-7" />} title="Nenhuma conversa ainda" text="Quando você conversar sobre um anúncio, a conversa aparece aqui."
            action={<Link to="/" className="font-bold text-action">Ver a vitrine</Link>} />
        ) : (
          <ul className="overflow-hidden rounded-card border border-line/70 bg-white shadow-card">
            {rows.map((c) => (
              <li key={c.id} className="border-b border-line last:border-0">
                <Link to={`/conversas/${c.id}`} className="flex items-center gap-3 p-3.5 hover:bg-page">
                  <div className="relative shrink-0">
                    <div className="h-14 w-14 overflow-hidden rounded-xl bg-[#EEF1EE]">
                      {c.listing_thumb && <img src={publicUrl(c.listing_thumb)!} alt="" className="h-full w-full object-cover" loading="lazy" />}
                    </div>
                    <Avatar name={c.other_name} path={c.other_avatar} size={26} className="absolute -bottom-1 -right-1 ring-2 ring-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-extrabold text-ink">{c.other_name}</p>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(c.last_message_at)}</span>
                    </div>
                    <p className="truncate text-sm font-semibold text-ink/70">
                      {c.listing_title} · {formatBRL(c.listing_price_cents)}
                      {c.listing_status !== "active" && <span className="text-muted"> · {LISTING_STATUS_LABEL[c.listing_status]}</span>}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("truncate text-sm", c.unread > 0 ? "font-bold text-ink" : "text-muted")}>{c.last_message_preview ?? "Conversa iniciada"}</p>
                      {c.unread > 0 && <span className="min-w-[22px] rounded-full bg-action px-1.5 text-center text-xs font-extrabold leading-[22px] text-white">{c.unread}</span>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
