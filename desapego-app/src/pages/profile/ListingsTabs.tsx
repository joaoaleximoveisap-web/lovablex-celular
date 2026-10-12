import { useState } from "react";
import { Link } from "react-router-dom";
import { Heart, PackageOpen, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ListingGrid } from "@/components/ListingCard";
import { Badge, EmptyState, ErrorBox, Spinner, Tabs } from "@/components/ui/misc";
import { useAuth } from "@/auth/AuthProvider";
import { publicUrl, supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";
import { LISTING_STATUS_LABEL } from "@/lib/labels";
import type { Listing, ListingCardData, ListingStatus } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

const GROUPS: Record<string, ListingStatus[]> = {
  ativos: ["active", "reserved", "pending_review"],
  pausados: ["paused", "suspended"],
  rascunhos: ["draft"],
  vendidos: ["sold"],
};

export function MyListingsTab() {
  const { userId } = useAuth();
  const [group, setGroup] = useState<keyof typeof GROUPS>("ativos");
  const q = useQuery({
    queryKey: ["my-listings", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("listings").select("*").eq("seller_id", userId!).neq("status", "deleted").order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Listing[];
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const all = q.data ?? [];
  const rows = all.filter((l) => GROUPS[group]!.includes(l.status));
  const count = (g: string) => all.filter((l) => GROUPS[g]!.includes(l.status)).length;
  return (
    <>
      <Tabs value={group} onChange={setGroup} items={[
        { value: "ativos", label: "Ativos", count: count("ativos") },
        { value: "pausados", label: "Pausados", count: count("pausados") },
        { value: "rascunhos", label: "Rascunhos", count: count("rascunhos") },
        { value: "vendidos", label: "Vendidos", count: count("vendidos") },
      ]} />
      {rows.length === 0 ? (
        <EmptyState icon={<PackageOpen className="h-7 w-7" />} title="Nada por aqui" text="Fotografe algo parado em casa e transforme em dinheiro."
          action={<Link to="/anunciar" className="inline-flex h-12 items-center gap-2 rounded-xl bg-action px-6 font-bold text-white"><Plus className="h-5 w-5" /> Anunciar</Link>} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((l) => (
            <li key={l.id}>
              <Link to={l.status === "draft" ? `/anuncio/${l.id}/editar` : `/anuncio/${l.id}`} className="flex items-center gap-3 rounded-card border border-line/70 bg-white p-3 shadow-card hover:border-action/40">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[#EEF1EE]">{l.cover_thumb_path && <img src={publicUrl(l.cover_thumb_path)!} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold">{l.title}</p>
                  <p className="font-bold text-brand">{l.listing_type === "doacao" ? "Doação" : formatBRL(l.asking_price_cents)}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge tone={l.status === "active" ? "ok" : l.status === "sold" ? "info" : l.status === "suspended" ? "danger" : "warn"}>{LISTING_STATUS_LABEL[l.status]}</Badge>
                    <span className="text-xs text-muted">{timeAgo(l.updated_at)}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function FavoritesTab() {
  const { userId } = useAuth();
  const q = useQuery({
    queryKey: ["favorites-list", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select("created_at, listing:listings(id, title, asking_price_cents, condition, listing_type, accepts_offers, accepts_trade, location, status, category_id, cover_path, cover_thumb_path, published_at, created_at, seller_id, seller:profiles!listings_seller_id_fkey(name))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      type Row = { listing: (Omit<ListingCardData, "seller_name"> & { seller: { name: string } }) | null };
      return (data as unknown as Row[]).filter((r) => r.listing).map((r) => ({ ...r.listing!, seller_name: r.listing!.seller.name })) as ListingCardData[];
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon={<Heart className="h-7 w-7" />} title="Nenhum favorito" text="Toque no coração de um anúncio para guardá-lo aqui." action={<Link to="/" className="font-bold text-action">Ver a vitrine</Link>} />;
  return <ListingGrid items={q.data} />;
}
