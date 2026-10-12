import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/** Versão nova do app: a pessoa decide quando atualizar (nada é trocado no meio de uma digitação). */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<null | (() => void)>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
    import("virtual:pwa-register").then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => () => updateSW(true)),
        onRegisteredSW: (_url, reg) => {
          if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
        },
      });
    });
  }, []);
  if (!update) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center p-3">
      <div className="flex items-center gap-3 rounded-2xl bg-brand px-4 py-3 text-[15px] font-semibold text-white shadow-float">
        Nova versão disponível
        <button onClick={update} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-sm font-bold text-brand">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>
    </div>
  );
}
