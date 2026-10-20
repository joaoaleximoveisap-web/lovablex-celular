/**
 * Modelo do Palco: um projeto é uma "torre" de andares; cada andar agrupa slides.
 * Os slides guardam camadas (formas, textos, imagens, vídeos) em coordenadas
 * do próprio slide, em pixels, e cada camada tem a sua animação de entrada.
 */
export type AnimType = "none" | "fade" | "rise" | "scale" | "grow" | "count" | "blur" | "draw";
/** click: 0/ausente = entra junto com o slide; 1, 2, 3… = entra no 1º, 2º, 3º clique (como "Ao clicar" no PowerPoint). */
export type Anim = { type: AnimType; delay: number; dur: number; click?: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Run = {
  t: string; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; caps?: boolean;
  sz?: number; color?: string; font?: string; spc?: number; br?: boolean; sup?: boolean; sub?: boolean;
};
export type Para = {
  runs: Run[]; align?: "left" | "center" | "right" | "justify";
  lh?: number; lhPx?: number; spB?: number; spA?: number; marL?: number; indent?: number;
  bullet?: string; bulletColor?: string; sz?: number;
};
export type Cell = { paras: Para[]; fill?: string; span?: number; rowSpan?: number; merged?: boolean; inset?: [number, number, number, number]; anchor?: "t" | "ctr" | "b"; borders?: { b?: string; r?: string; t?: string; l?: string } };

export type Layer = {
  id: string; kind: "shape" | "text" | "image" | "video" | "table";
  name?: string;
  x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean; opacity?: number;
  geom?: "rect" | "roundRect" | "ellipse" | "line" | "path";
  path?: string; pathW?: number; pathH?: number;
  fill?: string; stroke?: string; strokeW?: number; dash?: boolean; radius?: number; shadow?: string;
  paras?: Para[]; anchor?: "t" | "ctr" | "b"; inset?: [number, number, number, number]; nowrap?: boolean; vert?: boolean;
  asset?: string; crop?: { l: number; t: number; r: number; b: number }; poster?: string; kb?: boolean; cover?: boolean;
  /** vídeo: começa sozinho ao chegar no slide (padrão), repete, sem som */
  vauto?: boolean; vloop?: boolean; vmute?: boolean;
  cols?: number[]; rows?: { h: number; cells: Cell[] }[];
  /** hiperlink do PowerPoint: clicar na apresentação abre o endereço (ex.: simulador, espelho de vendas) */
  link?: string;
  anim: Anim;
};

/** Only web, e-mail and phone links: never javascript: or data: from an imported file. */
export const safeLink = (url: string | null | undefined) => {
  const u = url?.trim();
  if (!u) return undefined;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^www\./i.test(u)) return "https://" + u;
  return undefined;
};
export type Slide = {
  id: string; title: string; floor: string; bg?: string; bgAsset?: string; layers: Layer[]; kb: boolean; focus: Rect[];
};
export type Floor = { id: string; name: string };
export type LayoutKind = "torre" | "jornada" | "grade" | "pilha";
export type ModeId = "cinema" | "imersivo" | "suave" | "clean" | "tradicional" | "dissolver" | "agil";
export type Settings = { layout: LayoutKind; speed: number; dim: boolean; animSpeed: number; mode?: ModeId };

/**
 * Modos de apresentação: cada um define como a câmera se move, o fundo e a
 * intensidade das animações. "voo" afasta e aproxima (rho = quanto recua);
 * "deslize" vai reto sem recuar; "corte" não move a câmera (um slide se funde no outro).
 */
export type Mode = {
  id: ModeId; name: string; para: string; desc: string;
  layout: LayoutKind; move: "voo" | "deslize" | "corte"; rho: number; dur: number; ease: "cubic" | "sine" | "out";
  /** troca entre slides quando a câmera não se move (formato pilha) */
  tr: "fade" | "push" | "mergulho";
  theme: "escuro" | "claro" | "preto" | "grafite"; dimOp: number; labels: boolean; kb: boolean; rise: number; animSpeed: number;
};
export const MODES: Mode[] = [
  { id: "cinema", tr: "fade", name: "Cinema", para: "Lançamentos e eventos", desc: "A torre com voo de câmera entre os andares. O de maior impacto.",
    layout: "torre", move: "voo", rho: 1.414, dur: 1, ease: "cubic", theme: "escuro", dimOp: 0.26, labels: true, kb: true, rise: 26, animSpeed: 1 },
  { id: "imersivo", tr: "mergulho", name: "Imersivo", para: "Fotos e renders · tour pelo imóvel", desc: "A imagem avança devagar, como a câmera entrando na cena, e a próxima aparece por cima, sem cortes.",
    layout: "pilha", move: "corte", rho: 0, dur: 1, ease: "sine", theme: "preto", dimOp: 0, labels: false, kb: true, rise: 18, animSpeed: 1 },
  { id: "suave", tr: "fade", name: "Suave", para: "Reuniões com clientes", desc: "A câmera desliza de lado com um zoom bem leve. Não cansa a vista.",
    layout: "jornada", move: "voo", rho: 0.45, dur: 1.35, ease: "sine", theme: "escuro", dimOp: 0.35, labels: true, kb: true, rise: 14, animSpeed: 0.9 },
  { id: "clean", tr: "fade", name: "Clean", para: "Corporativo e bancos", desc: "Fundo claro, deslize discreto e sem efeitos de cinema.",
    layout: "jornada", move: "deslize", rho: 0, dur: 1, ease: "sine", theme: "claro", dimOp: 0.5, labels: false, kb: false, rise: 10, animSpeed: 1 },
  { id: "tradicional", tr: "push", name: "Tradicional", para: "Igual ao PowerPoint · sem zoom", desc: "Um slide por vez em tela cheia; o próximo entra empurrando o anterior, sem câmera.",
    layout: "pilha", move: "corte", rho: 0, dur: 1, ease: "sine", theme: "preto", dimOp: 0, labels: false, kb: false, rise: 10, animSpeed: 1 },
  { id: "dissolver", tr: "fade", name: "Dissolver", para: "Quem enjoa fácil · palestras longas", desc: "Nenhum movimento de câmera: um slide se funde no outro.",
    layout: "pilha", move: "corte", rho: 0, dur: 1, ease: "sine", theme: "preto", dimOp: 0, labels: false, kb: false, rise: 8, animSpeed: 1 },
  { id: "agil", tr: "fade", name: "Ágil", para: "Pitch e treinamentos", desc: "Transições rápidas e retas, animações curtas e diretas.",
    layout: "grade", move: "deslize", rho: 0, dur: 0.6, ease: "out", theme: "grafite", dimOp: 0.3, labels: true, kb: false, rise: 14, animSpeed: 1.5 },
];
export const nextMode = (id: ModeId): ModeId => MODES[(MODES.findIndex(m => m.id === id) + 1) % MODES.length].id;
/** Efeito padrão de toda apresentação: um slide se funde no outro, sem movimento de câmera. */
export const DEFAULT_MODE: ModeId = "dissolver";
export const modeOf = (p: Project): Mode => MODES.find(m => m.id === (p.settings.mode ?? DEFAULT_MODE)) ?? MODES[0];
export function applyMode(p: Project, id: ModeId) {
  const m = MODES.find(x => x.id === id) ?? MODES[0];
  p.settings.mode = m.id;
  p.settings.layout = m.layout;
  p.settings.speed = 1;
  p.settings.animSpeed = m.animSpeed;
  p.settings.dim = m.dimOp < 1;
}
export type Project = {
  id: string; name: string; created: number; updated: number; w: number; h: number;
  floors: Floor[]; slides: Slide[]; settings: Settings; fonts: string[]; cover?: string; bytes?: number; warnings?: string[];
  /** os links do PowerPoint original já foram lidos (projetos importados antes de existir link) */
  linksChecked?: boolean;
};
export type ProjectMeta = Pick<Project, "id" | "name" | "created" | "updated" | "cover" | "bytes"> & { slides: number; floors: number };

export const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export const defaultSettings = (): Settings => {
  const m = MODES.find(x => x.id === DEFAULT_MODE)!;
  return { mode: m.id, layout: m.layout, speed: 1, dim: m.dimOp < 1, animSpeed: m.animSpeed };
};
/** Projeto sem efeito escolhido abre no padrão; um efeito escolhido nunca é trocado. */
export function withDefaultMode(p: Project) {
  if (!p.settings.mode) applyMode(p, DEFAULT_MODE);
  return p;
}
export const ANIMS: { v: AnimType; label: string }[] = [
  { v: "none", label: "Sem animação" }, { v: "rise", label: "Subir" }, { v: "fade", label: "Aparecer" },
  { v: "scale", label: "Crescer" }, { v: "grow", label: "Barra (estica)" }, { v: "count", label: "Contar números" },
  { v: "blur", label: "Desfoque" }, { v: "draw", label: "Desenhar caminho" },
];

/** Ordem do roteiro: andares de baixo para cima, slides na ordem dentro do andar. */
export function pathSlides(p: Project): Slide[] {
  return p.floors.flatMap(f => p.slides.filter(s => s.floor === f.id));
}

export function layerText(l: Layer): string {
  const ps = l.paras ?? l.rows?.flatMap(r => r.cells.flatMap(c => c.paras)) ?? [];
  return ps.map(p => p.runs.map(r => r.t).join("")).join("\n").trim();
}
function maxFont(l: Layer) {
  let m = 0;
  for (const p of l.paras ?? []) for (const r of p.runs) if (r.t.trim()) m = Math.max(m, r.sz ?? p.sz ?? 18);
  return m;
}
/** Um texto curto e grande com número vira contador (ex.: +57%, R$ 1.250.000,00, 3,2x). */
export function isBigNumber(l: Layer, slideH: number) {
  const t = layerText(l);
  if (!t || t.length > 28 || !/\d/.test(t)) return false;
  const nums = t.match(/\d[\d.,]*/g) ?? [];
  if (nums.every(n => /^(19|20)\d\d$/.test(n))) return false;
  return maxFont(l) >= slideH * 0.035;
}

/**
 * Animações automáticas: o fundo fica parado, o resto entra em cascata na ordem de leitura.
 * Barras finas esticam, números contam, logos e imagens pequenas aparecem.
 */
export function autoAnimate(s: Slide, W: number, H: number, style: "cascata" | "junto" | "nenhuma" = "cascata") {
  const area = W * H;
  const order = s.layers
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (Math.round(a.l.y / (H * 0.04)) - Math.round(b.l.y / (H * 0.04))) || a.l.x - b.l.x);
  let rank = 0;
  const bigImage = s.layers.filter(l => l.kind === "image").sort((a, b) => b.w * b.h - a.w * a.h)[0];
  for (const { l } of order) {
    const cover = l.w * l.h >= area * 0.8;
    if (style === "nenhuma" || cover) { l.anim = { type: "none", delay: 0, dur: 0.9 }; continue; }
    let type: AnimType = "rise";
    if (l.kind === "image" || l.kind === "video") type = l.w * l.h < area * 0.06 ? "fade" : "rise";
    else if (l.kind === "shape" && !l.paras?.length) {
      if (l.geom === "line" || (l.h < H * 0.06 && l.w > l.h * 3) || (l.w < W * 0.03 && l.h > l.w * 3)) type = "grow";
      else if (l.geom === "ellipse" && l.w < W * 0.06) type = "scale";
    }
    if ((l.kind === "text" || l.kind === "shape") && l.paras?.length && isBigNumber(l, H)) type = "count";
    const delay = style === "junto" ? 0.15 : Math.min(1.8, 0.1 + rank * 0.09);
    l.anim = { type, delay: Math.round(delay * 100) / 100, dur: type === "grow" ? 1.2 : type === "count" ? 1.5 : 0.9 };
    rank++;
  }
  // slide que é basicamente uma foto ganha o zoom lento (Ken Burns)
  const photo = !!bigImage && bigImage.w * bigImage.h >= area * 0.55;
  s.kb = photo && s.layers.filter(l => l.kind !== "image").length <= 6;
  for (const l of s.layers) l.kb = l === bigImage && photo;
}

/**
 * Caminho no mapa (ex.: Aurora Shopping → JH Palhano → The One): no PowerPoint, linhas livres
 * chamadas "caminho 1", "caminho 2"… se desenham em ordem, e os marcadores "parada 1",
 * "parada 2"… aparecem no começo e no fim de cada trecho. O resto do slide anima normalmente.
 */
export function animateRoute(s: Slide) {
  const LEG = /^caminho\s*(\d+)/i, STOP = /^parada\s*(\d+)/i;
  // Number(undefined) is NaN, so layers without the name are skipped
  const num = (l: Layer, re: RegExp) => Number(l.name?.match(re)?.[1]);
  const legs = s.layers.filter(l => l.geom === "path" && l.stroke && !l.fill && Number.isFinite(num(l, LEG)));
  const stops = s.layers.filter(l => Number.isFinite(num(l, STOP)));
  if (!legs.length) return;
  // the route sits on a map photo: the slow photo zoom would move the map under the line
  s.kb = false;
  for (const l of s.layers) l.kb = false;
  const order = [...stops.map(l => ({ l, n: num(l, STOP), leg: false })), ...legs.map(l => ({ l, n: num(l, LEG), leg: true }))]
    .sort((a, b) => a.n - b.n || Number(a.leg) - Number(b.leg));
  let t = 0.4;
  for (const { l, leg } of order) {
    if (leg) { l.anim = { type: "draw", delay: +t.toFixed(2), dur: 1.8 }; t += 1.8; }
    else { l.anim = { type: "scale", delay: +t.toFixed(2), dur: 0.5 }; t += 0.25; }
  }
}

/**
 * "Um por vez": cada linha do slide (ex.: nome + barra + valor de um gráfico, ou
 * um item de lista) vira um clique. Título, fundo e rodapé entram com o slide.
 */
export function revealByRows(s: Slide, W: number, H: number) {
  const area = W * H;
  const cand = s.layers.filter(l => l.w * l.h < area * 0.5);
  const items = cand.map(l => ({ l, cy: l.y + l.h / 2 })).sort((a, b) => a.cy - b.cy);
  const tol = H * 0.035;
  const rows: { cy: number; ls: Layer[] }[] = [];
  for (const it of items) {
    const r = rows.find(r => Math.abs(r.cy - it.cy) <= tol);
    if (r) { r.ls.push(it.l); r.cy = (r.cy * (r.ls.length - 1) + it.cy) / r.ls.length; } else rows.push({ cy: it.cy, ls: [it.l] });
  }
  // título (topo) e rodapé entram com o slide; no meio, as linhas com 2+ elementos viram cliques
  const body = rows.filter(r => r.cy > H * 0.22 && r.cy < H * 0.88);
  const multi = body.filter(r => r.ls.length >= 2);
  const steps = multi.length >= 2 ? multi : body;
  for (const l of s.layers) l.anim.click = 0;
  steps.forEach((r, i) => {
    const ordered = [...r.ls].sort((a, b) => a.x - b.x);
    ordered.forEach((l, j) => {
      l.anim.click = i + 1;
      if (l.anim.type === "none") l.anim.type = "fade";
      l.anim.delay = Math.round(j * 0.12 * 100) / 100;
    });
  });
  return steps.length;
}

export function slideTitle(s: Slide, H: number) {
  const texts = s.layers.filter(l => l.paras?.length && (layerText(l).match(/\p{L}/gu)?.length ?? 0) >= 4 && !/^uso (confidencial|interno)$/i.test(layerText(l)));
  texts.sort((a, b) => maxFont(b) - maxFont(a) || a.y - b.y);
  const t = texts[0] ? layerText(texts[0]).split("\n")[0] : "";
  return t.replace(/\s+/g, " ").slice(0, 60);
}

/** Agrupa slides em andares: usa as seções do PowerPoint ou blocos de até 4. */
export function autoFloors(slides: Slide[], sections?: { name: string; ids: number[] }[]): Floor[] {
  const floors: Floor[] = [];
  const add = (name: string, list: Slide[]) => {
    if (!list.length) return;
    const f = { id: uid(), name: name || "Parte " + (floors.length + 1) };
    list.forEach(s => (s.floor = f.id));
    floors.push(f);
  };
  if (sections && sections.length > 1) {
    let i = 0;
    for (const sec of sections) { add(sec.name, slides.slice(i, i + sec.ids.length)); i += sec.ids.length; }
    if (i < slides.length) add("Mais", slides.slice(i));
    return floors;
  }
  if (slides.length <= 3) { add("Apresentação", slides); return floors; }
  add("Abertura", slides.slice(0, 1));
  const mid = slides.slice(1, -1);
  const n = Math.ceil(mid.length / 4), per = Math.ceil(mid.length / n);
  for (let i = 0; i < mid.length; i += per) {
    const chunk = mid.slice(i, i + per);
    add(chunk.find(s => s.title)?.title.split(/[·•|–-]/)[0].trim().slice(0, 28) ?? "", chunk);
  }
  add("Encerramento", slides.slice(-1));
  return floors;
}

export function newProject(name: string, w = 1280, h = 720): Project {
  const now = Date.now();
  return { id: uid(), name, created: now, updated: now, w, h, floors: [], slides: [], settings: defaultSettings(), fonts: [] };
}

export function validateProject(v: unknown): v is Project {
  if (!v || typeof v !== "object") return false;
  const p = v as Project;
  return typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.floors) && Array.isArray(p.slides) &&
    Number.isFinite(p.w) && Number.isFinite(p.h) && p.w > 0 && p.h > 0 &&
    p.slides.every(s => typeof s.id === "string" && typeof s.floor === "string" && Array.isArray(s.layers) &&
      s.layers.every(l => typeof l.id === "string" && [l.x, l.y, l.w, l.h].every(Number.isFinite) && !!l.anim));
}

/* ---------- layout no canvas ---------- */
export type Placed = { id: string; x: number; y: number; w: number; h: number; sc: number };
export type FloorBox = { id: string; name: string; num: string; x: number; y: number; w: number; h: number; labelX: number; labelY: number };
export type Layout = { slides: Map<string, Placed>; floors: FloorBox[]; ov: Rect; unit: number };

export function layoutProject(p: Project, override?: LayoutKind): Layout {
  const kind = override ?? p.settings.layout;
  const SW = p.w, SH = p.h, G = SW * 0.0625, slides = new Map<string, Placed>(), floors: FloorBox[] = [];
  const groups = p.floors.map(f => ({ f, list: p.slides.filter(s => s.floor === f.id) })).filter(g => g.list.length);
  const nf = groups.length;
  const lobby = kind === "torre" && nf > 2 && groups[0].list.length === 1;
  const roof = kind === "torre" && nf > 2 && groups[nf - 1].list.length === 1;
  const num = (i: number) =>
    lobby && i === 0 ? "T" : roof && i === nf - 1 ? "C" : String(i + (lobby ? 0 : 1)).padStart(2, "0");
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  if (kind === "pilha") {
    // todos os slides no mesmo lugar: a câmera não se move, um slide se funde no outro
    groups.forEach((g, i) => {
      g.list.forEach(s => slides.set(s.id, { id: s.id, x: 0, y: 0, w: SW, h: SH, sc: 1 }));
      floors.push({ id: g.f.id, name: g.f.name, num: num(i), x: 0, y: 0, w: SW, h: SH, labelX: 0, labelY: 0 });
    });
    minX = 0; minY = 0; maxX = SW; maxY = SH;
  } else if (kind === "grade") {
    // grade de leitura: 4 por linha, cada andar começa numa linha nova
    const cols = 4;
    let y = 0;
    groups.forEach((g, i) => {
      const y0 = y;
      g.list.forEach((s, k) => {
        const c = k % cols, r = Math.floor(k / cols);
        slides.set(s.id, { id: s.id, x: c * (SW + G), y: y0 + r * (SH + G), w: SW, h: SH, sc: 1 });
      });
      const rows = Math.ceil(g.list.length / cols);
      floors.push({ id: g.f.id, name: g.f.name, num: num(i), x: 0, y: y0, w: cols * SW + (cols - 1) * G, h: rows * (SH + G) - G, labelX: 0, labelY: y0 });
      y = y0 + rows * (SH + G) + G * 2.2;
    });
    minX = -SW * 0.15; maxX = cols * (SW + G) - G + SW * 0.15; minY = -SH * 0.45; maxY = y - G * 1.6;
  } else if (kind === "jornada") {
    let x = 0;
    groups.forEach((g, i) => {
      const x0 = x;
      g.list.forEach(s => { slides.set(s.id, { id: s.id, x, y: -SH / 2, w: SW, h: SH, sc: 1 }); x += SW + G; });
      floors.push({ id: g.f.id, name: g.f.name, num: num(i), x: x0, y: -SH / 2, w: x - G - x0, h: SH, labelX: x0, labelY: -SH / 2 - SW * 0.08 });
      x += G * 3;
    });
    minX = -SW * 0.2; maxX = x - G * 2; minY = -SH * 1.05; maxY = SH * 0.75;
  } else {
    const TW = 4 * SW + 3 * G, FG = SH * 0.54;
    let y = 0;
    groups.forEach((g, i) => {
      const rows: Slide[][] = [];
      for (let k = 0; k < g.list.length; k += 4) rows.push(g.list.slice(k, k + 4));
      const bottom = y;
      rows.forEach(row => {
        const n = row.length;
        const sc = Math.min((TW - (n - 1) * G) / n / SW, g.list.length === 1 ? 2.6 : 99);
        const h = SH * sc, rowW = n * SW * sc + (n - 1) * G, x0 = (TW - rowW) / 2;
        y -= h;
        row.forEach((s, j) => slides.set(s.id, { id: s.id, x: x0 + j * (SW * sc + G), y, w: SW * sc, h, sc }));
        y -= G;
      });
      y += G;
      floors.push({ id: g.f.id, name: g.f.name, num: num(i), x: 0, y, w: TW, h: bottom - y, labelX: -SW * 0.13, labelY: y });
      y -= FG;
    });
    const top = y + FG;
    minX = -SW * 1.55; maxX = TW + SW * 0.3; minY = top - SH * 0.55; maxY = SH * 0.45;
  }
  return { slides, floors, ov: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, unit: SW };
}
