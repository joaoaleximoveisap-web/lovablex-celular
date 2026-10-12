import { useCategories } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "./icons";

export function CategoryChips({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const cats = useCategories();
  const items = [{ id: null as string | null, name: "Tudo", icon: "layout-grid" }, ...(cats.data ?? []).filter((c) => c.active)];
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="tablist" aria-label="Categorias">
      {items.map((c) => {
        const active = value === c.id;
        return (
          <button
            key={c.id ?? "all"}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(c.id)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-colors",
              active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-action/40",
            )}
          >
            <CategoryIcon name={c.icon} className={cn("h-4 w-4", active ? "text-white" : "text-action")} />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
