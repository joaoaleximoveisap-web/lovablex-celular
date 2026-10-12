import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Camera, Check, ImagePlus, Loader2, Star, Trash2, MapPin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell, BackHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, Field, Input, MoneyInput, Switch, Textarea } from "@/components/ui/form";
import { ErrorBox, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { CategoryIcon } from "@/components/icons";
import { useAuth } from "@/auth/AuthProvider";
import { useCategories } from "@/lib/queries";
import { compressImage, extFor } from "@/lib/image";
import { publicUrl, supabase, errorMessage } from "@/lib/supabase";
import { formatBRL } from "@/lib/money";
import { CONDITION_LABEL, DELIVERY_LABEL } from "@/lib/labels";
import type { Condition, ListingType } from "@/lib/types";
import { cn, uuid } from "@/lib/utils";
import { useListing } from "./ListingPage";

interface Photo {
  key: string;
  existingId?: string;
  storagePath?: string;
  thumbPath?: string;
  full?: Blob;
  thumb?: Blob;
  type?: string;
  width?: number;
  height?: number;
  preview: string;
  processing?: boolean;
}

interface Form {
  title: string;
  category: string;
  description: string;
  condition: Condition | null;
  type: ListingType;
  price: number | null;
  acceptsOffers: boolean;
  acceptsTrade: boolean;
  location: string;
  delivery: string[];
  notes: string;
}

const EMPTY: Form = { title: "", category: "", description: "", condition: null, type: "venda", price: null, acceptsOffers: true, acceptsTrade: false, location: "", delivery: ["retirada"], notes: "" };

function Steps({ step }: { step: number }) {
  const labels = ["Fotos", "Informações", "Revisão"];
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Etapas">
      {labels.map((l, i) => (
        <li key={l} className="flex flex-1 items-center gap-2">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold", i < step ? "bg-action text-white" : i === step ? "bg-brand text-white" : "bg-line text-muted")}>
            {i < step ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <span className={cn("text-sm font-bold", i === step ? "text-ink" : "text-muted")}>{l}</span>
          {i < 2 && <span className="h-0.5 flex-1 rounded bg-line" />}
        </li>
      ))}
    </ol>
  );
}

export default function ListingEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const existing = useListing(id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { userId, settings } = useAuth();
  const cats = useCategories();
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [removed, setRemoved] = useState<Photo[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<null | string>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const createdId = useRef<string | null>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const maxPhotos = settings.max_photos;

  // carrega o anúncio para edição uma única vez
  useEffect(() => {
    const l = existing.data;
    if (!editing || !l || loadedId === l.id) return;
    setLoadedId(l.id);
    setForm({
      title: l.title, category: l.category_id, description: l.description, condition: l.condition, type: l.listing_type,
      price: l.listing_type === "venda" ? l.asking_price_cents : null, acceptsOffers: l.accepts_offers, acceptsTrade: l.accepts_trade,
      location: l.location ?? "", delivery: l.delivery_options, notes: l.notes ?? "",
    });
    setPhotos(l.listing_images.map((img) => ({ key: img.id, existingId: img.id, storagePath: img.storage_path, thumbPath: img.thumb_path, preview: publicUrl(img.thumb_path)! })));
  }, [editing, existing.data, loadedId]);

  // libera a memória das prévias ao sair
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => p.full && URL.revokeObjectURL(p.preview)), []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = maxPhotos - photos.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) toast(`Máximo de ${maxPhotos} fotos por anúncio.`, "error");
    for (const file of list) {
      const key = uuid();
      setPhotos((p) => [...p, { key, preview: "", processing: true }]);
      try {
        // compressão no aparelho: foto grande (1600 px) e miniatura (600 px) para a vitrine
        const full = await compressImage(file, 1600, 0.82);
        const thumb = await compressImage(full.blob, 600, 0.78);
        const preview = URL.createObjectURL(thumb.blob);
        setPhotos((p) => p.map((x) => (x.key === key ? { key, full: full.blob, thumb: thumb.blob, type: full.type, width: full.width, height: full.height, preview } : x)));
      } catch (e) {
        setPhotos((p) => p.filter((x) => x.key !== key));
        toast(errorMessage(e), "error");
      }
    }
  }

  function move(i: number, dir: -1 | 1) {
    setPhotos((p) => {
      const n = [...p];
      const j = i + dir;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  }
  function makeCover(i: number) {
    setPhotos((p) => [p[i]!, ...p.filter((_, k) => k !== i)]);
  }
  function remove(i: number) {
    setPhotos((p) => {
      const ph = p[i]!;
      if (ph.existingId) setRemoved((r) => [...r, ph]);
      else if (ph.preview) URL.revokeObjectURL(ph.preview);
      return p.filter((_, k) => k !== i);
    });
  }

  function validateInfo(): boolean {
    const e: Record<string, string> = {};
    if (form.title.trim().length < 3) e.title = "Dê um nome ao produto (mínimo 3 letras).";
    if (!form.category) e.category = "Escolha uma categoria.";
    if (!form.condition) e.condition = "Informe o estado do produto.";
    if (form.type === "venda" && !form.price) e.price = "Informe o preço.";
    if (!form.delivery.length) e.delivery = "Escolha pelo menos uma forma de entrega.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save(publish: boolean) {
    if (!validateInfo()) return setStep(1);
    if (photos.some((p) => p.processing)) return toast("Aguarde as fotos terminarem de processar.", "error");
    if (publish && photos.length === 0) {
      setStep(0);
      return toast("Adicione pelo menos uma foto para publicar.", "error");
    }
    setSaving("Salvando anúncio…");
    try {
      const fields = {
        title: form.title.trim(), category_id: form.category, description: form.description.trim(), condition: form.condition!,
        listing_type: form.type, asking_price_cents: form.type === "venda" ? form.price! : 0,
        accepts_offers: form.type === "venda" && form.acceptsOffers, accepts_trade: form.acceptsTrade,
        location: form.location.trim() || null, delivery_options: form.delivery, notes: form.notes.trim() || null,
      };
      let listingId = id ?? createdId.current;
      if (!listingId) {
        const { data, error } = await supabase.from("listings").insert({ ...fields, status: "draft" }).select("id").single();
        if (error) throw error;
        listingId = data.id as string;
        createdId.current = listingId;
      } else {
        const { error } = await supabase.from("listings").update(fields).eq("id", listingId);
        if (error) throw error;
      }

      if (removed.length) {
        const { error } = await supabase.from("listing_images").delete().in("id", removed.map((r) => r.existingId!));
        if (error) throw error;
        await supabase.storage.from("media").remove(removed.flatMap((r) => [r.storagePath!, r.thumbPath!]));
        setRemoved([]);
      }

      const pending = photos.filter((p) => !p.existingId);
      let sent = 0;
      for (const p of photos) {
        const order = photos.indexOf(p);
        if (p.existingId) {
          continue;
        }
        sent++;
        setSaving(`Enviando foto ${sent} de ${pending.length}…`);
        const base = `${userId}/${listingId}/${uuid()}`;
        const ext = extFor(p.type!);
        const fullPath = `${base}.${ext}`;
        const thumbPath = `${base}_t.${ext}`;
        const up1 = await supabase.storage.from("media").upload(fullPath, p.full!, { contentType: p.type, cacheControl: "31536000", upsert: false });
        if (up1.error) throw up1.error;
        const up2 = await supabase.storage.from("media").upload(thumbPath, p.thumb!, { contentType: p.type, cacheControl: "31536000", upsert: false });
        if (up2.error) throw up2.error;
        const { data, error } = await supabase.from("listing_images")
          .insert({ listing_id: listingId, storage_path: fullPath, thumb_path: thumbPath, width: p.width, height: p.height, display_order: order })
          .select("id").single();
        if (error) throw error;
        // marca como já enviada: se algo falhar depois, não reenviamos esta foto
        setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, existingId: data.id, storagePath: fullPath, thumbPath, full: undefined, thumb: undefined } : x)));
        p.existingId = data.id;
      }

      // ordem final (inclui troca de capa)
      const orders = photos.map((p, i) => ({ id: p.existingId!, order: i }));
      for (const o of orders) {
        const before = existing.data?.listing_images.find((x) => x.id === o.id)?.display_order;
        if (before !== undefined && before !== o.order) {
          const { error } = await supabase.from("listing_images").update({ display_order: o.order }).eq("id", o.id);
          if (error) throw error;
        }
      }

      const currentStatus = existing.data?.status ?? "draft";
      if (publish && currentStatus === "draft") {
        setSaving("Publicando…");
        const { data, error } = await supabase.from("listings").update({ status: "active" }).eq("id", listingId).select("status").single();
        if (error) throw error;
        toast(data.status === "pending_review" ? "Enviado! O administrador vai aprovar antes de aparecer na vitrine." : "Anúncio publicado na vitrine!");
      } else {
        toast(publish ? "Alterações salvas." : "Rascunho salvo.");
      }
      qc.invalidateQueries({ queryKey: ["listings"] });
      qc.invalidateQueries({ queryKey: ["listing", listingId] });
      qc.invalidateQueries({ queryKey: ["my-listings"] });
      nav(`/anuncio/${listingId}`, { replace: true });
    } catch (e) {
      toast(errorMessage(e) + (createdId.current && !id ? " Seu anúncio ficou salvo como rascunho em Meus anúncios." : ""), "error");
    } finally {
      setSaving(null);
    }
  }

  if (editing && existing.isLoading) return <AppShell><Spinner /></AppShell>;
  if (editing && existing.isError) return <AppShell><ErrorBox error={existing.error} /></AppShell>;
  if (editing && existing.data && existing.data.seller_id !== userId) return <AppShell><ErrorBox error={{ message: "Você só pode editar seus próprios anúncios." }} /></AppShell>;
  if (editing && existing.data && ["sold", "deleted", "suspended"].includes(existing.data.status))
    return <AppShell><ErrorBox error={{ message: "Este anúncio não pode mais ser editado." }} /></AppShell>;

  const isDraft = !editing || existing.data?.status === "draft";
  const category = cats.data?.find((c) => c.id === form.category);

  return (
    <AppShell hideMobileHeader hideBottomNav>
      <div className="mx-auto max-w-2xl">
        <BackHeader title={editing ? "Editar anúncio" : "Novo anúncio"} />
        <Steps step={step} />

        {step === 0 && (
          <section>
            <h2 className="text-xl font-extrabold">Fotos do produto</h2>
            <p className="mb-4 mt-1 text-[15px] text-muted">Até {maxPhotos} fotos. A primeira é a capa. Fotos com boa luz vendem mais rápido.</p>
            <input ref={galleryInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Button variant="soft" size="lg" onClick={() => cameraInput.current?.click()} disabled={photos.length >= maxPhotos}><Camera className="h-5 w-5" /> Câmera</Button>
              <Button variant="soft" size="lg" onClick={() => galleryInput.current?.click()} disabled={photos.length >= maxPhotos}><ImagePlus className="h-5 w-5" /> Galeria</Button>
            </div>
            {photos.length === 0 ? (
              <button onClick={() => galleryInput.current?.click()} className="flex aspect-[16/9] w-full flex-col items-center justify-center rounded-card border-2 border-dashed border-line bg-white text-muted hover:border-action/50">
                <ImagePlus className="h-10 w-10 text-action" />
                <span className="mt-2 font-bold text-ink">Adicionar fotos</span>
              </button>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((p, i) => (
                  <li key={p.key} className="overflow-hidden rounded-card border border-line bg-white">
                    <div className="relative aspect-square bg-[#EEF1EE]">
                      {p.processing ? (
                        <div className="flex h-full items-center justify-center text-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
                      ) : (
                        <img src={p.preview} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                      )}
                      {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">Capa</span>}
                    </div>
                    <div className="flex items-center justify-between p-1.5">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded-lg p-2 disabled:opacity-30" aria-label="Mover para a esquerda"><ArrowLeft className="h-4 w-4" /></button>
                      {i !== 0 ? (
                        <button onClick={() => makeCover(i)} className="rounded-lg p-2 text-action" aria-label="Definir como capa"><Star className="h-4 w-4" /></button>
                      ) : <span className="w-8" />}
                      <button onClick={() => remove(i)} className="rounded-lg p-2 text-danger" aria-label="Excluir foto"><Trash2 className="h-4 w-4" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === photos.length - 1} className="rounded-lg p-2 disabled:opacity-30" aria-label="Mover para a direita"><ArrowRight className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-page/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
              <Button size="lg" className="w-full" onClick={() => setStep(1)}>Continuar</Button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-5">
            <Field label="Nome do produto" htmlFor="title" error={errors.title}>
              <Input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={80} placeholder="Ex.: Sofá 3 lugares" />
            </Field>
            <Field label="Categoria" error={errors.category}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {cats.data?.filter((c) => c.active).map((c) => (
                  <button key={c.id} type="button" onClick={() => set("category", c.id)}
                    className={cn("flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-[14.5px] font-bold", form.category === c.id ? "border-action bg-action-soft text-action" : "border-line bg-white text-ink")}>
                    <CategoryIcon name={c.icon} className="h-5 w-5 shrink-0" /> <span className="min-w-0 break-words leading-tight">{c.name}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Estado de conservação" error={errors.condition}>
              <ChoiceGroup<Condition> value={form.condition} onChange={(v) => set("condition", v)} options={[{ value: "novo", label: "Novo" }, { value: "seminovo", label: "Seminovo" }, { value: "usado", label: "Usado" }]} />
            </Field>
            <Field label="Você quer…">
              <ChoiceGroup<ListingType> columns={2} value={form.type} onChange={(v) => set("type", v)} options={[{ value: "venda", label: "Vender" }, { value: "doacao", label: "Doar" }]} />
            </Field>
            {form.type === "venda" && (
              <>
                <Field label="Preço pedido" error={errors.price}><MoneyInput cents={form.price} onChange={(v) => set("price", v)} /></Field>
                <Switch checked={form.acceptsOffers} onChange={(v) => set("acceptsOffers", v)} label="Aceita propostas" description="Interessados podem oferecer outro valor." />
              </>
            )}
            <Switch checked={form.acceptsTrade} onChange={(v) => set("acceptsTrade", v)} label="Disponível para troca" />
            <Field label="Descrição" optional>
              <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} placeholder="Medidas, tempo de uso, defeitos, o que acompanha…" />
            </Field>
            <Field label="Cidade ou bairro" optional hint="Não coloque seu endereço completo.">
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={80} placeholder="Ex.: Centro, Londrina" />
            </Field>
            <Field label="Entrega" error={errors.delivery}>
              <div className="flex flex-wrap gap-2">
                {Object.entries(DELIVERY_LABEL).map(([k, label]) => {
                  const on = form.delivery.includes(k);
                  return (
                    <button key={k} type="button" aria-pressed={on} onClick={() => set("delivery", on ? form.delivery.filter((d) => d !== k) : [...form.delivery, k])}
                      className={cn("rounded-full border px-4 py-2.5 text-[15px] font-bold", on ? "border-action bg-action-soft text-action" : "border-line bg-white text-ink")}>{label}</button>
                  );
                })}
              </div>
            </Field>
            <Field label="Observações" optional>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={500} placeholder="Ex.: retirar até sábado" />
            </Field>
            <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-page/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
              <Button variant="outline" size="lg" onClick={() => setStep(0)}>Voltar</Button>
              <Button size="lg" className="flex-1" onClick={() => validateInfo() && setStep(2)}>Revisar</Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2 className="text-xl font-extrabold">Assim seu anúncio aparece na vitrine</h2>
            <p className="mb-5 mt-1 text-[15px] text-muted">Confira antes de publicar. Anunciar é gratuito.</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="overflow-hidden rounded-card border border-line/70 bg-white shadow-card">
                <div className="aspect-[4/5] bg-[#EEF1EE]">{photos[0]?.preview && <img src={photos[0].preview} alt="" className="h-full w-full object-cover" />}</div>
                <div className="space-y-1 p-3">
                  <p className="text-[17px] font-extrabold">{form.type === "doacao" ? "Grátis" : formatBRL(form.price)}</p>
                  <p className="line-clamp-2 text-[14px] font-semibold">{form.title}</p>
                  <p className="text-[12.5px] text-muted">{form.condition && CONDITION_LABEL[form.condition]}{form.type === "venda" && form.acceptsOffers && <span className="text-action"> · Negociável</span>}</p>
                  {form.location && <p className="flex items-center gap-1 text-[12.5px] text-muted"><MapPin className="h-3 w-3" />{form.location}</p>}
                </div>
              </div>
              <dl className="col-span-1 space-y-2.5 text-[15px] sm:col-span-2">
                <div><dt className="text-sm text-muted">Categoria</dt><dd className="font-bold">{category?.name}</dd></div>
                <div><dt className="text-sm text-muted">Fotos</dt><dd className="font-bold">{photos.length}</dd></div>
                <div><dt className="text-sm text-muted">Entrega</dt><dd className="font-bold">{form.delivery.map((d) => DELIVERY_LABEL[d]).join(", ")}</dd></div>
                {form.acceptsTrade && <div><dt className="text-sm text-muted">Troca</dt><dd className="font-bold">Aceita</dd></div>}
              </dl>
            </div>
            {form.description && <p className="mt-4 line-clamp-4 whitespace-pre-line rounded-card bg-white p-4 text-[15px] text-ink/80">{form.description}</p>}
            {form.type === "venda" && (
              <p className="mt-4 rounded-xl bg-action-soft p-3.5 text-sm text-brand">
                Sem custo para anunciar. Se vender, a comissão de {(settings.commission_rate_bps / 100).toLocaleString("pt-BR")}% sobre o valor real da venda é paga ao administrador por Pix.
              </p>
            )}
            <div className="mt-6 space-y-2">
              {isDraft ? (
                <>
                  <Button size="lg" className="w-full" loading={saving !== null} onClick={() => save(true)}>Publicar anúncio</Button>
                  <Button size="lg" variant="outline" className="w-full" disabled={saving !== null} onClick={() => save(false)}>Salvar rascunho</Button>
                </>
              ) : (
                <Button size="lg" className="w-full" loading={saving !== null} onClick={() => save(true)}>Salvar alterações</Button>
              )}
              <Button size="lg" variant="ghost" className="w-full" disabled={saving !== null} onClick={() => setStep(1)}>Voltar e editar</Button>
              {saving && <p className="text-center text-sm font-semibold text-muted" role="status">{saving}</p>}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
