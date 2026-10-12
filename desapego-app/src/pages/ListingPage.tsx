import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, MapPin, MessageCircle, Pencil, Share2, Truck, X, ZoomIn, Tag, Repeat, Pause, Play, BookmarkCheck, Trash2, CircleDollarSign } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { AppShell, BackHeader } from "@/components/AppShell";
import { FavoriteButton, ListingCard } from "@/components/ListingCard";
import { ConfirmSheet, OfferSheet, ReportSheet, SellSheet } from "@/components/Negotiation";
import { Avatar, Badge, Card, ErrorBox, Spinner, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CategoryIcon } from "@/components/icons";
import { publicUrl, supabase, errorMessage } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";
import { CONDITION_LABEL, DELIVERY_LABEL, LISTING_STATUS_LABEL, OFFER_STATUS_LABEL } from "@/lib/labels";
import type { Category, Listing, ListingImage, ListingStatus, Offer, Profile } from "@/lib/types";
import { cn, formatDate, timeAgo, appUrl } from "@/lib/utils";
import { searchListings } from "@/lib/queries";
import { useAuth } from "@/auth/AuthProvider";

type FullListing = Listing & { listing_images: ListingImage[]; seller: Pick<Profile, "id" | "name" | "avatar_url" | "location" | "created_at">; category: Pick<Category, "id" | "name" | "icon"> };

export function useListing(id: string | undefined) {
  return useQuery({
    queryKey: ["listing", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("*, listing_images(*), seller:profiles!listings_seller_id_fkey(id, name, avatar_url, location, created_at), category:categories(id, name, icon)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (data) (data as FullListing).listing_images.sort((a, b) => a.display_order - b.display_order);
      return data as FullListing | null;
    },
  });
}

function Gallery({ images, title }: { images: ListingImage[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const go = (i: number) => {
    const n = Math.max(0, Math.min(images.length - 1, i));
    track.current?.scrollTo({ left: n * (track.current?.clientWidth ?? 0), behavior: "smooth" });
  };
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
      if (e.key === "ArrowRight") setIndex((i) => Math.min(images.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom, images.length]);

  if (images.length === 0) {
    return <div className="flex aspect-square items-center justify-center rounded-card bg-[#EEF1EE] text-muted md:aspect-[4/3]">Sem fotos</div>;
  }
  return (
    <div>
      <div className="relative overflow-hidden rounded-card bg-[#EEF1EE]">
        <div
          ref={track}
          className="no-scrollbar flex aspect-square snap-x snap-mandatory overflow-x-auto md:aspect-[4/3]"
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        >
          {images.map((img, i) => (
            <button key={img.id} className="relative h-full w-full shrink-0 snap-center" onClick={() => { setIndex(i); setZoom(true); }} aria-label={`Ampliar foto ${i + 1}`}>
              <img src={publicUrl(img.storage_path)!} alt={`${title} — foto ${i + 1}`} className="h-full w-full object-contain" loading={i === 0 ? "eager" : "lazy"} decoding="async" />
            </button>
          ))}
        </div>
        {images.length > 1 && (
          <>
            <button onClick={() => go(index - 1)} disabled={index === 0} className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow disabled:opacity-0 md:flex" aria-label="Foto anterior"><ChevronLeft className="h-5 w-5" /></button>
            <button onClick={() => go(index + 1)} disabled={index === images.length - 1} className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow disabled:opacity-0 md:flex" aria-label="Próxima foto"><ChevronRight className="h-5 w-5" /></button>
            <span className="absolute bottom-3 right-3 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-bold text-white">{index + 1}/{images.length}</span>
          </>
        )}
        <span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-ink"><ZoomIn className="h-3.5 w-3.5" /> Toque para ampliar</span>
      </div>
      {images.length > 1 && (
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button key={img.id} onClick={() => go(i)} className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2", i === index ? "border-action" : "border-transparent opacity-70")} aria-label={`Ver foto ${i + 1}`}>
              <img src={publicUrl(img.thumb_path)!} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {zoom &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex flex-col bg-black" role="dialog" aria-label="Fotos ampliadas">
            <div className="flex items-center justify-between p-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
              <span className="text-sm font-bold">{index + 1} de {images.length}</span>
              <button onClick={() => setZoom(false)} className="rounded-full bg-white/15 p-2.5" aria-label="Fechar"><X className="h-6 w-6" /></button>
            </div>
            <div className="relative flex flex-1 items-center justify-center overflow-auto">
              <img src={publicUrl(images[index]!.storage_path)!} alt={title} className="max-h-full max-w-full touch-pinch-zoom object-contain" />
              {index > 0 && <button onClick={() => setIndex(index - 1)} className="absolute left-2 rounded-full bg-white/15 p-3 text-white" aria-label="Anterior"><ChevronLeft className="h-6 w-6" /></button>}
              {index < images.length - 1 && <button onClick={() => setIndex(index + 1)} className="absolute right-2 rounded-full bg-white/15 p-3 text-white" aria-label="Próxima"><ChevronRight className="h-6 w-6" /></button>}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function statusTone(s: ListingStatus) {
  return s === "active" ? "ok" : s === "reserved" ? "dark" : s === "sold" ? "info" : s === "suspended" || s === "deleted" ? "danger" : "warn";
}

function OwnerPanel({ listing }: { listing: FullListing }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [sell, setSell] = useState(false);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const editable = !["sold", "deleted", "suspended"].includes(listing.status);

  async function setStatus(status: ListingStatus, msg: string) {
    setBusy(status);
    const { error } = await supabase.from("listings").update({ status }).eq("id", listing.id);
    setBusy(null);
    if (error) return toast(errorMessage(error), "error");
    toast(msg);
    qc.invalidateQueries({ queryKey: ["listing", listing.id] });
    qc.invalidateQueries({ queryKey: ["listings"] });
    qc.invalidateQueries({ queryKey: ["my-listings"] });
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold text-muted">Seu anúncio</span>
        <Badge tone={statusTone(listing.status)}>{LISTING_STATUS_LABEL[listing.status]}</Badge>
      </div>
      {listing.status === "pending_review" && <p className="mb-3 rounded-xl bg-warn-soft p-3 text-sm text-warn">Aguardando aprovação do administrador antes de aparecer na vitrine.</p>}
      {listing.status === "suspended" && <p className="mb-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">Suspenso pela administração. Veja suas notificações ou fale com o administrador.</p>}
      {listing.status === "sold" && <p className="mb-3 rounded-xl bg-action-soft p-3 text-sm text-action">Vendido em {formatDate(listing.sold_at)}. Veja em <Link to="/perfil/vendas" className="font-bold underline">Minhas vendas</Link>.</p>}
      {editable && (
        <div className="grid grid-cols-2 gap-2">
          {listing.status !== "draft" && listing.status !== "pending_review" && (
            <Button size="lg" className="col-span-2" onClick={() => setSell(true)}><CircleDollarSign className="h-5 w-5" /> Marcar como vendido</Button>
          )}
          {listing.status === "draft" && <Button size="lg" className="col-span-2" loading={busy === "active"} onClick={() => setStatus("active", "Anúncio publicado!")}>Publicar anúncio</Button>}
          <Button variant="outline" onClick={() => nav(`/anuncio/${listing.id}/editar`)}><Pencil className="h-4 w-4" /> Editar</Button>
          {listing.status === "active" && <Button variant="outline" loading={busy === "reserved"} onClick={() => setStatus("reserved", "Marcado como reservado")}><BookmarkCheck className="h-4 w-4" /> Reservar</Button>}
          {listing.status === "reserved" && <Button variant="outline" loading={busy === "active"} onClick={() => setStatus("active", "Disponível novamente")}><Play className="h-4 w-4" /> Liberar reserva</Button>}
          {listing.status === "active" && <Button variant="outline" loading={busy === "paused"} onClick={() => setStatus("paused", "Anúncio pausado")}><Pause className="h-4 w-4" /> Pausar</Button>}
          {listing.status === "paused" && <Button variant="outline" loading={busy === "active"} onClick={() => setStatus("active", "Anúncio reativado")}><Play className="h-4 w-4" /> Reativar</Button>}
          <Button variant="ghost" className="text-danger" onClick={() => setDel(true)}><Trash2 className="h-4 w-4" /> Excluir</Button>
        </div>
      )}
      {sell && <SellSheet open onClose={() => setSell(false)} listing={listing} />}
      <ConfirmSheet open={del} onClose={() => setDel(false)} title="Excluir anúncio?" danger confirmLabel="Excluir"
        text="O anúncio sai da vitrine e propostas em aberto são encerradas. Esta ação não pode ser desfeita."
        onConfirm={async () => { await setStatus("deleted", "Anúncio excluído"); setDel(false); nav("/perfil/anuncios"); }} />
    </Card>
  );
}

function OffersReceived({ listing }: { listing: FullListing }) {
  const offers = useQuery({
    queryKey: ["offers", "listing", listing.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*, buyer:profiles!offers_buyer_id_fkey(name)").eq("listing_id", listing.id).in("status", ["pending", "accepted"]).order("created_at", { ascending: false });
      if (error) throw error;
      return data as (Offer & { buyer: { name: string } | null })[];
    },
  });
  if (!offers.data?.length) return null;
  return (
    <Card className="p-4">
      <h3 className="mb-3 font-extrabold">Propostas</h3>
      <ul className="divide-y divide-line">
        {offers.data.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
            <div>
              <p className="font-bold">{formatBRL(o.amount_cents)}</p>
              <p className="text-sm text-muted">{o.buyer?.name ?? "Membro"} · {o.proposed_by === listing.seller_id ? "sua contraproposta" : OFFER_STATUS_LABEL[o.status].toLowerCase()}</p>
            </div>
            {o.conversation_id && <Link to={`/conversas/${o.conversation_id}`} className="rounded-xl bg-action-soft px-3 py-2 text-sm font-bold text-action">Responder</Link>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ListingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { userId } = useAuth();
  const q = useListing(id);
  const [offer, setOffer] = useState(false);
  const [report, setReport] = useState(false);
  const [starting, setStarting] = useState(false);
  const l = q.data;

  const similar = useQuery({
    queryKey: ["listings", "similar", id, l?.category_id],
    enabled: Boolean(l && l.status !== "deleted"),
    queryFn: () => searchListings({ category: l!.category_id, exclude: l!.id, includeReserved: false }, 8),
    staleTime: 5 * 60_000,
  });

  if (q.isLoading) return <AppShell><Spinner /></AppShell>;
  if (q.isError) return <AppShell><ErrorBox error={q.error} onRetry={() => q.refetch()} /></AppShell>;
  if (!l) return <AppShell><EmptyState icon={<Tag className="h-7 w-7" />} title="Anúncio indisponível" text="Ele pode ter sido excluído ou ainda não foi publicado." action={<Link to="/" className="font-bold text-action">Voltar para a vitrine</Link>} /></AppShell>;

  const mine = l.seller_id === userId;
  const donation = l.listing_type === "doacao";
  const canNegotiate = !mine && (l.status === "active" || l.status === "reserved");

  async function startChat() {
    setStarting(true);
    const { data, error } = await supabase.rpc("start_conversation", { p_listing: l!.id });
    setStarting(false);
    if (error) return toast(errorMessage(error), "error");
    nav(`/conversas/${data}`);
  }

  async function share() {
    const url = appUrl(`/anuncio/${l!.id}`);
    const text = `${l!.title} — ${donation ? "Doação" : formatBRL(l!.asking_price_cents)}`;
    try {
      if (navigator.share) await navigator.share({ title: l!.title, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast("Link copiado. Só membros da família conseguem abrir.");
      }
    } catch {
      /* compartilhamento cancelado */
    }
  }

  return (
    <AppShell hideMobileHeader hideBottomNav={canNegotiate}>
      <BackHeader title={l.title} right={<div className="flex gap-1">
        <button onClick={share} className="rounded-full p-2.5 hover:bg-black/[0.04]" aria-label="Compartilhar"><Share2 className="h-5 w-5" /></button>
        {!mine && <FavoriteButton id={l.id} size="lg" className="border-0 shadow-none" />}
      </div>} />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:gap-8">
        <Gallery images={l.listing_images} title={l.title} />

        <div className="space-y-4">
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {l.status !== "active" && <Badge tone={statusTone(l.status)}>{LISTING_STATUS_LABEL[l.status]}</Badge>}
              <Badge>{CONDITION_LABEL[l.condition]}</Badge>
              {donation && <Badge tone="ok">Doação</Badge>}
              {l.accepts_offers && !donation && <Badge tone="ok">Negociável</Badge>}
              {l.accepts_trade && <Badge tone="info"><Repeat className="h-3 w-3" /> Aceita troca</Badge>}
            </div>
            <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-ink md:text-[26px]">{l.title}</h1>
            <p className="mt-2 text-[30px] font-extrabold tracking-tight text-brand">{donation ? "Grátis" : formatBRL(l.asking_price_cents)}</p>
          </div>

          {mine ? (
            <>
              <OwnerPanel listing={l} />
              <OffersReceived listing={l} />
            </>
          ) : canNegotiate ? (
            <div className="hidden gap-2 md:flex">
              <Button size="lg" className="flex-1" loading={starting} onClick={startChat}><MessageCircle className="h-5 w-5" /> Conversar com vendedor</Button>
              {l.accepts_offers && !donation && l.status === "active" && <Button size="lg" variant="outline" className="flex-1" onClick={() => setOffer(true)}>Fazer proposta</Button>}
            </div>
          ) : (
            <p className="rounded-xl bg-page p-3 text-[15px] font-semibold text-muted">{l.status === "sold" ? "Este produto já foi vendido." : "Este anúncio não está disponível no momento."}</p>
          )}

          <Link to={mine ? "/perfil" : `/membro/${l.seller.id}`} className="flex items-center gap-3 rounded-card border border-line/70 bg-white p-3.5 shadow-card">
            <Avatar name={l.seller.name} path={l.seller.avatar_url} size={46} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-extrabold">{l.seller.name}</p>
              <p className="text-sm text-muted">Na família desde {new Date(l.seller.created_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted" />
          </Link>

          <Card className="divide-y divide-line">
            <div className="flex items-center gap-3 p-3.5"><CategoryIcon name={l.category.icon} className="h-5 w-5 text-action" /><span className="text-[15px]">{l.category.name}</span></div>
            {l.location && <div className="flex items-center gap-3 p-3.5"><MapPin className="h-5 w-5 text-action" /><span className="text-[15px]">{l.location}</span></div>}
            <div className="flex items-center gap-3 p-3.5"><Truck className="h-5 w-5 text-action" /><span className="text-[15px]">{l.delivery_options.map((d) => DELIVERY_LABEL[d] ?? d).join(" · ")}</span></div>
            <div className="flex items-center gap-3 p-3.5"><CalendarDays className="h-5 w-5 text-action" /><span className="text-[15px]">Publicado {timeAgo(l.published_at ?? l.created_at)}</span></div>
          </Card>

          {l.description && (
            <div>
              <h2 className="mb-1.5 text-lg font-extrabold">Descrição</h2>
              <p className="whitespace-pre-line text-[15.5px] leading-relaxed text-ink/90">{l.description}</p>
            </div>
          )}
          {l.notes && (
            <div>
              <h2 className="mb-1.5 text-lg font-extrabold">Observações</h2>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink/80">{l.notes}</p>
            </div>
          )}
          {!mine && (
            <button onClick={() => setReport(true)} className="flex items-center gap-1.5 text-sm font-bold text-muted hover:text-danger"><Flag className="h-4 w-4" /> Denunciar anúncio</button>
          )}
        </div>
      </div>

      {similar.data && similar.data.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-extrabold">Produtos semelhantes</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {similar.data.slice(0, 4).map((it) => <ListingCard key={it.id} item={it} />)}
          </div>
        </section>
      )}

      {canNegotiate && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
          <Button size="lg" className="flex-1" loading={starting} onClick={startChat}><MessageCircle className="h-5 w-5" /> Conversar</Button>
          {l.accepts_offers && !donation && l.status === "active" && <Button size="lg" variant="outline" className="flex-1" onClick={() => setOffer(true)}>Fazer proposta</Button>}
        </div>
      )}
      {canNegotiate && <div className="h-20 md:hidden" />}

      {offer && <OfferSheet open onClose={() => setOffer(false)} listing={l} onSent={(conv) => { setOffer(false); toast("Proposta enviada!"); if (conv) nav(`/conversas/${conv}`); }} />}
      <ReportSheet open={report} onClose={() => setReport(false)} targetType="listing" targetId={l.id} />
    </AppShell>
  );
}
