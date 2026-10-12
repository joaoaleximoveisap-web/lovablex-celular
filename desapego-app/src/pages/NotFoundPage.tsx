import { Link } from "react-router-dom";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page">
      <EmptyState icon={<SearchX className="h-7 w-7" />} title="Página não encontrada" text="O endereço pode estar errado ou o conteúdo foi removido."
        action={<Link to="/" className="inline-flex h-11 items-center rounded-xl bg-action px-5 font-bold text-white">Ir para o início</Link>} />
    </div>
  );
}
