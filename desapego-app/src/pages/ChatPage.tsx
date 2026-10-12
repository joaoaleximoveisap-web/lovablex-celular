import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, Ban, CircleDollarSign, Flag, HandCoins, MoreVertical, Phone, Send } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { ConfirmSheet, OfferSheet, ReportSheet, SellSheet } from "@/components/Negotiation";
import { Avatar, ErrorBox, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/AuthProvider";
import { publicUrl, supabase, errorMessage } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";
import { LISTING_STATUS_LABEL, OFFER_STATUS_LABEL } from "@/lib/labels";
import type { Listing, Message, Offer, Profile } from "@/lib/types";
import { cn, formatDate, formatTime, uuid } from "@/lib/utils";

const QUICK = ["Ainda está disponível?", "Aceita uma proposta?", "Podemos combinar a retirada?", "Tenho interesse."];

type Conv = {
  id: string; listing_id: string; buyer_id: string; seller_id: string;
  listing: Listing;
  buyer: Pick<Profile, "id" | "name" | "avatar_url">;
  seller: Pick<Profile, "id" | "name" | "avatar_url">;
};
type LocalMessage = Message & { _pending?: boolean; _failed?: boolean };

function waLink(phone: string) {
  const d = phone.replace(/\D/g, "");
  return `https://wa.me/${d.length <= 11 ? "55" + d : d}`;
}

export function ChatPage() {
  const { id } = useParams();
  const convId = id!;
  const { userId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [offerOpen, setOfferOpen] = useState<null | { title: string; initial?: number; counterOf?: string }>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [report, setReport] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const conv = useQuery({
    queryKey: ["conversation", convId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, listing:listings(*), buyer:profiles!conversations_buyer_id_fkey(id, name, avatar_url), seller:profiles!conversations_seller_id_fkey(id, name, avatar_url)")
        .eq("id", convId)
        .maybeSingle();
      if (error) throw error;
      return data as Conv | null;
    },
  });

  const messages = useQuery({
    queryKey: ["messages", convId],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("*").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return (data as Message[]).reverse();
    },
    staleTime: Infinity, // novas mensagens chegam pelo tempo real
    refetchOnWindowFocus: true,
  });

  const offers = useQuery({
    queryKey: ["offers", "conversation", convId],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").eq("conversation_id", convId).order("created_at");
      if (error) throw error;
      return data as Offer[];
    },
  });

  const blocked = useQuery({
    queryKey: ["blocks", userId],
    queryFn: async () => new Set(((await supabase.from("user_blocks").select("blocked_id")).data ?? []).map((r) => r.blocked_id as string)),
  });

  const list = (messages.data ?? []) as LocalMessage[];
  const lastId = list[list.length - 1]?.id;

  // marca como lida quando chega mensagem da outra pessoa
  useEffect(() => {
    if (!list.length) return;
    if (list.some((m) => m.sender_id !== userId && !m.read_at)) {
      supabase.rpc("mark_conversation_read", { p_conversation: convId }).then(() => {
        qc.invalidateQueries({ queryKey: ["unread"] });
        qc.invalidateQueries({ queryKey: ["conversations"] });
      });
    }
  }, [lastId, convId, userId, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  if (conv.isLoading || messages.isLoading) return <AppShell hideMobileHeader hideBottomNav><Spinner /></AppShell>;
  if (conv.isError || !conv.data) return <AppShell><ErrorBox error={conv.error ?? { message: "Conversa não encontrada." }} /></AppShell>;
  const c = conv.data;
  const l = c.listing;
  const iAmSeller = c.seller_id === userId;
  const other = iAmSeller ? c.buyer : c.seller;
  const isBlocked = blocked.data?.has(other.id) ?? false;
  const closed = ["deleted", "suspended"].includes(l.status);
  const offerById = new Map((offers.data ?? []).map((o) => [o.id, o]));
  const accepted = (offers.data ?? []).find((o) => o.status === "accepted");

  async function send(content: string) {
    const body = content.trim();
    if (!body) return;
    const clientId = uuid();
    const temp: LocalMessage = { id: clientId, conversation_id: convId, sender_id: userId!, kind: "text", content: body, metadata: {}, client_id: clientId, created_at: new Date().toISOString(), read_at: null, _pending: true };
    qc.setQueryData<LocalMessage[]>(["messages", convId], (old) => [...(old ?? []), temp]);
    setText("");
    const { data, error } = await supabase.from("messages").insert({ conversation_id: convId, content: body, client_id: clientId }).select("*").single();
    qc.setQueryData<LocalMessage[]>(["messages", convId], (old) =>
      (old ?? []).map((m) => (m.client_id === clientId ? (error ? { ...m, _pending: false, _failed: true } : (data as Message)) : m)),
    );
    if (error) toast(errorMessage(error), "error");
  }

  async function retry(m: LocalMessage) {
    qc.setQueryData<LocalMessage[]>(["messages", convId], (old) => (old ?? []).filter((x) => x.id !== m.id));
    await send(m.content);
  }

  async function respond(offer: Offer, action: "accept" | "reject") {
    const { error } = await supabase.rpc("respond_offer", { p_offer: offer.id, p_action: action });
    if (error) return toast(errorMessage(error), "error");
    toast(action === "accept" ? "Proposta aceita. Combinem retirada e pagamento." : "Proposta recusada.");
    qc.invalidateQueries({ queryKey: ["offers"] });
  }

  async function cancelOffer(offer: Offer) {
    const { error } = await supabase.rpc("cancel_offer", { p_offer: offer.id });
    if (error) return toast(errorMessage(error), "error");
    qc.invalidateQueries({ queryKey: ["offers"] });
  }

  async function shareWhatsapp() {
    setMenu(false);
    const { error } = await supabase.rpc("share_whatsapp", { p_conversation: convId });
    if (error) return toast(errorMessage(error), "error");
    toast("Seu WhatsApp foi enviado nesta conversa.");
  }

  async function toggleBlock() {
    const r = isBlocked
      ? await supabase.from("user_blocks").delete().eq("blocked_id", other.id).eq("blocker_id", userId!)
      : await supabase.from("user_blocks").insert({ blocked_id: other.id });
    if (r.error) return toast(errorMessage(r.error), "error");
    toast(isBlocked ? "Membro desbloqueado." : "Membro bloqueado. Vocês não poderão mais trocar mensagens.");
    qc.invalidateQueries({ queryKey: ["blocks"] });
    setBlockOpen(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  let lastDay = "";
  return (
    <AppShell hideMobileHeader hideBottomNav>
      <div className="mx-auto -mt-4 flex min-h-[calc(100dvh-2rem)] max-w-3xl flex-col md:mt-0 md:min-h-[70vh] md:overflow-hidden md:rounded-card md:border md:border-line/70 md:bg-white md:shadow-card">
        {/* topo: pessoa + produto sempre visíveis */}
        <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-white/95 backdrop-blur md:mx-0">
          <div className="flex items-center gap-2 px-2 py-2">
            <button onClick={() => (window.history.length > 1 ? nav(-1) : nav("/conversas"))} className="rounded-full p-2.5 hover:bg-black/[0.04]" aria-label="Voltar">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <Link to={`/membro/${other.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
              <Avatar name={other.name} path={other.avatar_url} size={38} />
              <span className="min-w-0">
                <span className="block truncate font-extrabold">{other.name}</span>
                <span className="block text-xs text-muted">{iAmSeller ? "Interessado(a)" : "Vendedor(a)"}</span>
              </span>
            </Link>
            <button onClick={() => setMenu(true)} className="rounded-full p-2.5 hover:bg-black/[0.04]" aria-label="Mais opções"><MoreVertical className="h-5 w-5" /></button>
          </div>
          <Link to={`/anuncio/${l.id}`} className="flex items-center gap-3 border-t border-line bg-page/60 px-4 py-2.5">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[#EEF1EE]">{l.cover_thumb_path && <img src={publicUrl(l.cover_thumb_path)!} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{l.title}</p>
              <p className="text-sm"><b className="text-brand">{l.listing_type === "doacao" ? "Doação" : formatBRL(l.asking_price_cents)}</b>{l.status !== "active" && <span className="text-muted"> · {LISTING_STATUS_LABEL[l.status]}</span>}</p>
            </div>
            {iAmSeller && ["active", "paused", "reserved"].includes(l.status) && (
              <button onClick={(e) => { e.preventDefault(); setSellOpen(true); }} className="shrink-0 rounded-xl bg-action px-3 py-2 text-xs font-bold text-white">Vendido?</button>
            )}
          </Link>
          {accepted && (
            <div className="border-t border-line bg-action-soft px-4 py-2 text-sm font-semibold text-brand">
              Proposta aceita: {formatBRL(accepted.amount_cents)}. Combinem retirada e pagamento diretamente.
            </div>
          )}
        </div>

        {/* mensagens */}
        <div className="flex-1 space-y-2 py-4 md:px-4" aria-live="polite">
          {list.length === 0 && <p className="py-8 text-center text-[15px] text-muted">Comece a conversa. Seja gentil e combine tudo por aqui. 🙂</p>}
          {list.map((m) => {
            const day = formatDate(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            const mine = m.sender_id === userId;
            const offer = m.metadata?.offer_id ? offerById.get(m.metadata.offer_id as string) : undefined;
            return (
              <div key={m.id}>
                {showDay && <p className="my-3 text-center text-xs font-bold text-muted">{day}</p>}
                {m.kind === "system" || m.kind === "sale" ? (
                  <div className="mx-auto my-2 max-w-[85%] rounded-xl bg-brand-soft px-3.5 py-2 text-center text-sm font-semibold text-brand">
                    {m.content}
                    {m.kind === "sale" && !iAmSeller && <Link to="/perfil/compras" className="mt-1 block font-bold underline">Confirmar compra</Link>}
                  </div>
                ) : m.kind === "offer" ? (
                  <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div className="w-[78%] max-w-xs rounded-2xl border border-line bg-white p-3.5 shadow-sm">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted"><HandCoins className="h-4 w-4 text-action" />{m.metadata?.counter ? "Contraproposta" : "Proposta"}</p>
                      <p className="mt-1 text-2xl font-extrabold text-brand">{formatBRL(Number(m.metadata?.amount_cents ?? 0))}</p>
                      {offer && <p className="text-sm font-semibold text-muted">{offer.status === "pending" ? (offer.proposed_by === userId ? "Aguardando resposta" : "Aguardando sua resposta") : OFFER_STATUS_LABEL[offer.status]}</p>}
                      {offer?.status === "pending" && offer.proposed_by !== userId && !closed && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Button size="sm" onClick={() => respond(offer, "accept")}>Aceitar</Button>
                          <Button size="sm" variant="outline" onClick={() => respond(offer, "reject")}>Recusar</Button>
                          <Button size="sm" variant="soft" className="col-span-2" onClick={() => setOfferOpen({ title: "Contraproposta", counterOf: offer.id })}>Fazer contraproposta</Button>
                        </div>
                      )}
                      {offer?.status === "pending" && offer.proposed_by === userId && (
                        <button onClick={() => cancelOffer(offer)} className="mt-2 text-sm font-bold text-muted underline">Cancelar proposta</button>
                      )}
                      <p className="mt-1 text-right text-[11px] text-muted">{formatTime(m.created_at)}</p>
                    </div>
                  </div>
                ) : (
                  <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-[15.5px] leading-snug shadow-sm", mine ? "rounded-br-md bg-action text-white" : "rounded-bl-md bg-white text-ink", m._pending && "opacity-70")}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      {m.kind === "whatsapp" && typeof m.metadata?.phone === "string" && (
                        <a href={waLink(m.metadata.phone)} target="_blank" rel="noopener noreferrer" className={cn("mt-2 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold", mine ? "bg-white/20" : "bg-action text-white")}>
                          <Phone className="h-4 w-4" /> Abrir WhatsApp
                        </a>
                      )}
                      <p className={cn("mt-0.5 text-right text-[11px]", mine ? "text-white/75" : "text-muted")}>
                        {m._pending ? "enviando…" : formatTime(m.created_at)}
                      </p>
                    </div>
                    {m._failed && (
                      <button onClick={() => retry(m)} className="ml-1 self-center text-danger" aria-label="Não enviada. Tentar de novo"><AlertCircle className="h-5 w-5" /></button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottom} />
        </div>

        {/* envio */}
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-white/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur md:mx-0">
          {closed || isBlocked ? (
            <p className="py-2 text-center text-sm font-semibold text-muted">{isBlocked ? "Você bloqueou este membro." : "Este anúncio foi encerrado."}</p>
          ) : (
            <>
              {list.filter((m) => m.kind === "text").length < 3 && (
                <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
                  {QUICK.map((q) => <button key={q} onClick={() => send(q)} className="shrink-0 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink">{q}</button>)}
                </div>
              )}
              <form onSubmit={onSubmit} className="flex items-end gap-2">
                {!iAmSeller && l.accepts_offers && l.listing_type === "venda" && l.status === "active" && (
                  <button type="button" onClick={() => setOfferOpen({ title: "Fazer proposta" })} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-action-soft text-action" aria-label="Fazer proposta">
                    <CircleDollarSign className="h-6 w-6" />
                  </button>
                )}
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 768px)").matches) { e.preventDefault(); void send(text); } }}
                  rows={1}
                  maxLength={2000}
                  placeholder="Escreva uma mensagem"
                  aria-label="Mensagem"
                  className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-line bg-page px-3.5 py-3 text-[16px] focus:border-action focus:outline-none"
                />
                <button type="submit" disabled={!text.trim()} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-action text-white disabled:opacity-40" aria-label="Enviar">
                  <Send className="h-5 w-5" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title="Opções">
        <div className="space-y-2">
          {iAmSeller && !isBlocked && (
            <button onClick={shareWhatsapp} className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3.5 text-left font-bold"><Phone className="h-5 w-5 text-action" /> Enviar meu WhatsApp para {other.name.split(" ")[0]}</button>
          )}
          <Link to={`/anuncio/${l.id}`} className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3.5 font-bold"><HandCoins className="h-5 w-5 text-action" /> Ver anúncio</Link>
          <button onClick={() => { setMenu(false); setBlockOpen(true); }} className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3.5 text-left font-bold"><Ban className="h-5 w-5 text-danger" /> {isBlocked ? "Desbloquear" : "Bloquear"} {other.name.split(" ")[0]}</button>
          <button onClick={() => { setMenu(false); setReport(true); }} className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3.5 text-left font-bold"><Flag className="h-5 w-5 text-danger" /> Denunciar</button>
        </div>
        <p className="mt-4 text-sm text-muted">Suas mensagens são privadas: só você e {other.name.split(" ")[0]} conseguem ler.</p>
      </Sheet>

      <ConfirmSheet open={blockOpen} onClose={() => setBlockOpen(false)} title={isBlocked ? "Desbloquear membro?" : "Bloquear membro?"} danger={!isBlocked}
        confirmLabel={isBlocked ? "Desbloquear" : "Bloquear"} text={isBlocked ? "Vocês poderão voltar a conversar." : "Vocês não poderão trocar mensagens nem propostas. Você pode desfazer depois."} onConfirm={toggleBlock} />
      <ReportSheet open={report} onClose={() => setReport(false)} targetType="user" targetId={other.id} />
      {offerOpen && (
        <OfferSheet open onClose={() => setOfferOpen(null)} title={offerOpen.title} listing={l}
          onSent={() => { setOfferOpen(null); qc.invalidateQueries({ queryKey: ["offers"] }); }}
          {...(offerOpen.counterOf ? { counterOf: offerOpen.counterOf } : {})} />
      )}
      {sellOpen && <SellSheet open onClose={() => { setSellOpen(false); qc.invalidateQueries({ queryKey: ["conversation", convId] }); }} listing={l} />}
    </AppShell>
  );
}
