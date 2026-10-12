import { memo, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, ImageOff, MapPin } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatBRL } from "@/lib/money";
import { CONDITION_LABEL } from "@/lib/labels";
import { publicUrl, supabase, errorMessage } from "@/lib/supabase";
import type { ListingCardData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFavorites } from "@/lib/queries";
import { useAuth } from "@/auth/AuthProvider";
import { useToast } from "./ui/toast";

function isNew(iso: string | null) {
  return iso ? Date.now() - new Date(iso).getTime() < 3 * 86400_000 : false;
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ id, fav }: { id: string; fav: boolean }) => {
      const r = fav
        ? await supabase.from("favorites").delete().eq("listing_id", id).eq("user_id", userId!)
        : await supabase.from("favorites").insert({ listing_id: id });
      if (r.error && !/duplicate key/.test(r.error.message)) throw r.error;
    },
    onMutate: async ({ id, fav }) => {
      const key = ["favorites", userId];
      const prev = qc.getQueryData<Set<string>>(key);
      const next = new Set(prev);
      if (fav) next.delete(id);
      else next.add(id);
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(["favorites", userId], ctx?.prev);
      toast(errorMessage(e), "error");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites-list"] }),
  });
}

export function FavoriteButton({ id, className, size = "sm" }: { id: string; className?: string; size?: "sm" | "lg" }) {
  const favs = useFavorites();
  const toggle = useToggleFavorite();
  const fav = favs.data?.has(id) ?? false;
  return (
    <button
      type="button"
      aria-label={fav ? "Remover dos favoritos" : "Salvar nos favoritos"}
      aria-pressed={fav}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate({ id, fav });
      }}
      className={cn(
        "flex items-center justify-center rounded-full bg-white/95 text-ink shadow-sm backdrop-blur transition-transform active:scale-90",
        size === "sm" ? "h-9 w-9" : "h-11 w-11 border border-line",
        className,
      )}
    >
      <Heart className={cn(size === "sm" ? "h-[18px] w-[18px]" : "h-5 w-5", fav && "fill-danger text-danger")} />
    </button>
  );
}

export const ListingCard = memo(function ListingCard({ item, showFavorite = true }: { item: ListingCardData; showFavorite?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const img = publicUrl(item.cover_thumb_path);
  const donation = item.listing_type === "doacao";
  return (
    <Link to={`/anuncio/${item.id}`} className="group block min-w-0 overflow-hidden rounded-card border border-line/70 bg-white shadow-card transition-shadow hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/40">
      <div className="relative aspect-[4/5] overflow-hidden bg-[#EEF1EE]">
        {img && !failed ? (
          <img
            src={img}
            alt={item.title}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn("h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]", loaded ? "opacity-100" : "opacity-0")}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted/60"><ImageOff className="h-8 w-8" /></div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {item.status === "reserved" && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">Reservado</span>}
          {item.status === "active" && isNew(item.published_at) && <span className="rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold text-brand">Novo</span>}
          {donation && <span className="rounded-full bg-action px-2 py-0.5 text-[11px] font-bold text-white">Doação</span>}
        </div>
        {showFavorite && <FavoriteButton id={item.id} className="absolute right-2 top-2" />}
      </div>
      <div className="space-y-1 p-3">
        <p className="text-[17px] font-extrabold leading-tight text-ink">{donation ? "Grátis" : formatBRL(item.asking_price_cents)}</p>
        <h3 className="line-clamp-2 min-h-[2.5em] text-[14px] font-semibold leading-snug text-ink/90">{item.title}</h3>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted">
          <span>{CONDITION_LABEL[item.condition]}</span>
          {item.accepts_offers && !donation && <><span aria-hidden>·</span><span className="text-action">Negociável</span></>}
          {item.accepts_trade && <><span aria-hidden>·</span><span>Troca</span></>}
        </div>
        <div className="flex items-center gap-1 truncate pt-0.5 text-[12.5px] text-muted">
          <span className="truncate font-semibold text-ink/70">{item.seller_name.split(" ")[0]}</span>
          {item.location && (
            <>
              <MapPin className="ml-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{item.location}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
});

export function ListingGrid({ items, className }: { items: ListingCardData[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5", className)}>
      {items.map((it) => <ListingCard key={it.id} item={it} />)}
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-line/70 bg-white">
          <div className="aspect-[4/5] animate-pulse bg-[#EEF1EE]" />
          <div className="space-y-2 p-3">
            <div className="h-4 w-20 animate-pulse rounded bg-[#EEF1EE]" />
            <div className="h-3 w-full animate-pulse rounded bg-[#EEF1EE]" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-[#EEF1EE]" />
          </div>
        </div>
      ))}
    </div>
  );
}
