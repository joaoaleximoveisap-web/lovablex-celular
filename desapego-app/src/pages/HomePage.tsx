import { useState } from "react";
import { Link } from "react-router-dom";
import { Gift, Heart, PackageOpen, Sparkles, Tag } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CategoryChips } from "@/components/CategoryChips";
import { GridSkeleton, ListingGrid } from "@/components/ListingCard";
import { LoadMore } from "@/components/LoadMore";
import { EmptyState, ErrorBox } from "@/components/ui/misc";
import { useListingFeed } from "@/lib/queries";
import { useAuth } from "@/auth/AuthProvider";

const shortcuts = [
  { to: "/buscar?dias=7", label: "Acabaram de chegar", icon: Sparkles },
  { to: "/buscar?max=10000&ordem=price_asc", label: "Até R$ 100", icon: Tag },
  { to: "/buscar?doacao=1", label: "Doações", icon: Gift },
  { to: "/perfil/favoritos", label: "Seus favoritos", icon: Heart },
];

export function HomePage() {
  const { profile } = useAuth();
  const [category, setCategory] = useState<string | null>(null);
  const feed = useListingFeed({ category, sort: "recent" });
  const items = feed.data?.pages.flat() ?? [];

  return (
    <AppShell>
      <section className="mb-5">
        <p className="text-[15px] text-muted">Olá, {profile?.name.split(" ")[0]} 👋</p>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink md:text-[28px]">O que a família está desapegando</h1>
      </section>

      <CategoryChips value={category} onChange={setCategory} />

      {!category && (
        <div className="no-scrollbar -mx-4 mt-4 flex gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:px-0">
          {shortcuts.map((s) => (
            <Link key={s.to} to={s.to} className="flex min-w-[150px] items-center gap-3 rounded-card border border-line/70 bg-white p-3.5 shadow-card hover:border-action/40">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action-soft text-action"><s.icon className="h-5 w-5" /></span>
              <span className="text-[14px] font-bold leading-tight text-ink">{s.label}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3 mt-7 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold text-ink">{category ? "Anúncios da categoria" : "Anúncios recentes"}</h2>
        <Link to="/buscar" className="text-sm font-bold text-action">Filtrar</Link>
      </div>

      {feed.isLoading ? (
        <GridSkeleton />
      ) : feed.isError ? (
        <ErrorBox error={feed.error} onRetry={() => feed.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<PackageOpen className="h-7 w-7" />}
          title={category ? "Nada nesta categoria ainda" : "A vitrine está vazia"}
          text="Que tal ser a primeira pessoa a anunciar? Leva menos de dois minutos."
          action={<Link to="/anunciar" className="inline-flex h-12 items-center rounded-xl bg-action px-6 font-bold text-white">Anunciar agora</Link>}
        />
      ) : (
        <>
          <ListingGrid items={items} />
          <LoadMore hasMore={Boolean(feed.hasNextPage)} loading={feed.isFetchingNextPage} onMore={() => feed.fetchNextPage()} />
        </>
      )}
    </AppShell>
  );
}
