import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Shield } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Avatar, LinkTabs } from "@/components/ui/misc";
import { useAuth } from "@/auth/AuthProvider";
import { MyListingsTab, FavoritesTab } from "./ListingsTabs";
import { OffersTab, PurchasesTab, SalesTab } from "./DealsTabs";
import { CommissionsTab } from "./CommissionsTab";
import { AccountTab } from "./AccountTab";

const TABS = [
  { id: "anuncios", label: "Meus anúncios" },
  { id: "favoritos", label: "Favoritos" },
  { id: "propostas", label: "Propostas" },
  { id: "vendas", label: "Minhas vendas" },
  { id: "compras", label: "Compras" },
  { id: "comissoes", label: "Comissões" },
  { id: "conta", label: "Conta" },
];

export function ProfilePage() {
  const { tab = "anuncios" } = useParams();
  const { profile, isAdmin } = useAuth();
  if (!profile) return null;
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={profile.name} path={profile.avatar_url} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold tracking-tight">{profile.name}</h1>
            <p className="text-sm text-muted">Na família desde {new Date(profile.created_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}{profile.location ? ` · ${profile.location}` : ""}</p>
          </div>
          {isAdmin && (
            <Link to="/admin" className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-sm font-bold text-white lg:hidden"><Shield className="h-4 w-4" /> Painel</Link>
          )}
        </div>
        <LinkTabs active={`/perfil/${tab}`} items={TABS.map((t) => ({ to: `/perfil/${t.id}`, label: t.label }))} />
        {tab === "anuncios" && <MyListingsTab />}
        {tab === "favoritos" && <FavoritesTab />}
        {tab === "propostas" && <OffersTab />}
        {tab === "vendas" && <SalesTab />}
        {tab === "compras" && <PurchasesTab />}
        {tab === "comissoes" && <CommissionsTab />}
        {tab === "conta" && <AccountTab />}
      </div>
    </AppShell>
  );
}
