import { useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { LinkTabs, PageTitle } from "@/components/ui/misc";
import { Overview } from "./Overview";
import { UsersAdmin } from "./UsersAdmin";
import { ListingsAdmin } from "./ListingsAdmin";
import { CommissionsAdmin } from "./CommissionsAdmin";
import { ReportsAdmin } from "./ReportsAdmin";
import { SettingsAdmin } from "./SettingsAdmin";
import { AuditAdmin } from "./AuditAdmin";

const TABS = [
  { id: "", label: "Visão geral" },
  { id: "usuarios", label: "Usuários" },
  { id: "anuncios", label: "Anúncios" },
  { id: "comissoes", label: "Comissões" },
  { id: "denuncias", label: "Denúncias" },
  { id: "configuracoes", label: "Configurações" },
  { id: "auditoria", label: "Auditoria" },
];

export default function AdminPage() {
  const { tab = "" } = useParams();
  return (
    <AppShell>
      <PageTitle title="Painel do administrador" subtitle="Comunidade, anúncios, vendas e comissões." />
      <LinkTabs active={tab ? `/admin/${tab}` : "/admin"} items={TABS.map((t) => ({ to: t.id ? `/admin/${t.id}` : "/admin", label: t.label }))} />
      {tab === "" && <Overview />}
      {tab === "usuarios" && <UsersAdmin />}
      {tab === "anuncios" && <ListingsAdmin />}
      {tab === "comissoes" && <CommissionsAdmin />}
      {tab === "denuncias" && <ReportsAdmin />}
      {tab === "configuracoes" && <SettingsAdmin />}
      {tab === "auditoria" && <AuditAdmin />}
    </AppShell>
  );
}
