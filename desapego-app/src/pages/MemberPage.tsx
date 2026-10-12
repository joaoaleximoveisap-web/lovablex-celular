import { useParams } from "react-router-dom";
import { PackageOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, BackHeader } from "@/components/AppShell";
import { GridSkeleton, ListingGrid } from "@/components/ListingCard";
import { Avatar, EmptyState, ErrorBox, Spinner } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { searchListings } from "@/lib/queries";
import type { Profile } from "@/lib/types";

export function MemberPage() {
  const { id } = useParams();
  const p = useQuery({
    queryKey: ["member", id],
    queryFn: async () => (await supabase.from("profiles").select("id, name, avatar_url, location, created_at, account_status").eq("id", id!).maybeSingle()).data as Profile | null,
  });
  const listings = useQuery({ queryKey: ["listings", "member", id], queryFn: () => searchListings({ seller: id }, 60) });
  if (p.isLoading) return <AppShell><Spinner /></AppShell>;
  if (!p.data) return <AppShell><ErrorBox error={{ message: "Membro não encontrado." }} /></AppShell>;
  return (
    <AppShell hideMobileHeader>
      <BackHeader title={p.data.name} />
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={p.data.name} path={p.data.avatar_url} size={72} />
        <div>
          <h1 className="text-2xl font-extrabold">{p.data.name}</h1>
          <p className="text-sm text-muted">Na família desde {new Date(p.data.created_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}{p.data.location ? ` · ${p.data.location}` : ""}</p>
        </div>
      </div>
      <h2 className="mb-3 text-lg font-extrabold">Anúncios disponíveis</h2>
      {listings.isLoading ? <GridSkeleton count={4} /> : listings.isError ? <ErrorBox error={listings.error} /> : listings.data?.length ? <ListingGrid items={listings.data} /> : (
        <EmptyState icon={<PackageOpen className="h-7 w-7" />} title="Nenhum anúncio no momento" />
      )}
    </AppShell>
  );
}
