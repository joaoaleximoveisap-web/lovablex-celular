import { useEffect, useRef } from "react";
import { Button } from "./ui/button";

/** Carrega o próximo bloco ao chegar perto do fim (com botão como alternativa). */
export function LoadMore({ hasMore, loading, onMore }: { hasMore: boolean; loading: boolean; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || !ref.current || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && !loading && onMore(), { rootMargin: "600px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [hasMore, loading, onMore]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex justify-center py-6">
      <Button variant="outline" loading={loading} onClick={onMore}>Ver mais anúncios</Button>
    </div>
  );
}
