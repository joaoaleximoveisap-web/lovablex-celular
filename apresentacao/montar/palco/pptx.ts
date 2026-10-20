/**
 * Importador de PowerPoint 100% local (nada é enviado para servidor).
 * Reconstrói cada slide em camadas editáveis: formas, textos com estilo, tabelas,
 * imagens e vídeos originais (sem recompressão). Herda estilos do layout e do
 * slide mestre, cores do tema, grupos, recortes e sombras.
 */
import { ZipArchive, MAX_PPTX_MB } from "./zip";
import { mimeOf } from "./mime";
import type { Cell, Layer, Para, Run, Slide } from "./model";
import { animateRoute, autoAnimate, safeLink, slideTitle, uid } from "./model";

export type ImportOutput = {
  w: number; h: number; slides: Slide[]; fonts: string[]; warnings: string[];
  sections?: { name: string; ids: number[] }[];
};
export type ImportOptions = {
  onProgress?: (done: number, total: number, label: string) => void;
  saveAsset: (id: string, blob: Blob, kind: "image" | "video") => Promise<void>;
};

const EMU = 9525; // EMU por pixel (96 dpi)
const dec = new TextDecoder();

/* ---------- utilitários de XML ---------- */
const kids = (el: Element | null | undefined, name?: string) => (el ? Array.from(el.children).filter(c => !name || c.localName === name) : []);
const kid = (el: Element | null | undefined, name: string): Element | null => (el ? Array.from(el.children).find(c => c.localName === name) ?? null : null);
const at = (el: Element | null | undefined, ...names: string[]) => names.reduce<Element | null>((e, n) => kid(e, n), el ?? null);
const num = (el: Element | null | undefined, a: string, def = 0) => { const v = el?.getAttribute(a); return v == null || v === "" ? def : Number(v); };
const attr = (el: Element | null | undefined, a: string) => el?.getAttribute(a) ?? null;
function rid(el: Element | null | undefined, name: string) {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) if (a.localName === name && (a.prefix === "r" || (a.namespaceURI ?? "").includes("relationships"))) return a.value;
  return null;
}
function parse(bytes?: Uint8Array): Document | null {
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(dec.decode(bytes), "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}
function norm(path: string) {
  const out: string[] = [];
  path.split("/").forEach(p => { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); });
  return out.join("/");
}
/** Hyperlink of a shape (on the shape itself or on its text), as in PowerPoint's "Insert → Link". */
function linkOf(el: Element, rels: Map<string, Rel>): string | undefined {
  const own = at(kids(el).find(k => k.localName.startsWith("nv")), "cNvPr", "hlinkClick");
  const inText = Array.from(el.getElementsByTagName("*")).filter(e => e.localName === "hlinkClick");
  for (const h of [own, ...inText]) {
    const rel = rels.get(rid(h, "id") ?? "");
    const url = rel?.external ? safeLink(rel.target) : undefined;
    if (url) return url;
  }
  return undefined;
}
const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
const relsPath = (p: string) => dirOf(p) + "_rels/" + p.slice(p.lastIndexOf("/") + 1) + ".rels";

type Rel = { target: string; type: string; external: boolean };
async function readRels(zip: ZipArchive, part: string): Promise<Map<string, Rel>> {
  const doc = parse(await zip.read(relsPath(part)));
  const m = new Map<string, Rel>();
  if (!doc) return m;
  for (const r of Array.from(doc.getElementsByTagName("*"))) {
    if (r.localName !== "Relationship") continue;
    const id = r.getAttribute("Id"), t = r.getAttribute("Target") ?? "", ext = r.getAttribute("TargetMode") === "External";
    if (id) m.set(id, { target: ext ? t : norm(t.startsWith("/") ? t.slice(1) : dirOf(part) + t), type: r.getAttribute("Type") ?? "", external: ext });
  }
  return m;
}

/* ---------- cores ---------- */
type Theme = { colors: Record<string, string>; major: string; minor: string };
type Ctx = { theme: Theme; clrMap: Record<string, string>; rels: Map<string, Rel> };
const PRESET: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", darkGray: "A9A9A9", lightGray: "D3D3D3", orange: "FFA500", navy: "000080" };
function rgb(hex: string): [number, number, number] { const h = hex.replace("#", "").padEnd(6, "0"); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number]; }
function toHsl([r, g, b]: number[]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  return [h, s, l];
}
function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function colorOf(el: Element | null | undefined, ctx: Ctx, ph?: string): string | undefined {
  if (!el) return undefined;
  const c = Array.from(el.children).find(k => ["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"].includes(k.localName));
  if (!c) return undefined;
  let hex = "000000";
  const v = c.getAttribute("val") ?? "";
  if (c.localName === "srgbClr") hex = v;
  else if (c.localName === "sysClr") hex = c.getAttribute("lastClr") ?? (v === "window" ? "FFFFFF" : "000000");
  else if (c.localName === "prstClr") hex = PRESET[v] ?? "000000";
  else if (c.localName === "scrgbClr") hex = ["r", "g", "b"].map(k => Math.round(Math.min(1, num(c, k) / 100000) * 255).toString(16).padStart(2, "0")).join("");
  else if (c.localName === "hslClr") hex = fromHsl(num(c, "hue") / 21600000, num(c, "sat") / 100000, num(c, "lum") / 100000).map(x => Math.round(x).toString(16).padStart(2, "0")).join("");
  else if (c.localName === "schemeClr") {
    if (v === "phClr") hex = ph?.replace("#", "") ?? "000000";
    else { const mapped = ctx.clrMap[v] ?? v; hex = ctx.theme.colors[mapped] ?? ctx.theme.colors[v] ?? "000000"; }
  }
  let [r, g, b] = rgb(hex);
  let alpha = 1;
  for (const m of Array.from(c.children)) {
    const val = num(m, "val") / 100000;
    switch (m.localName) {
      case "lumMod": case "lumOff": {
        const [h, s, l] = toHsl([r, g, b]);
        [r, g, b] = fromHsl(h, s, Math.min(1, Math.max(0, m.localName === "lumMod" ? l * val : l + val)));
        break;
      }
      case "satMod": { const [h, s, l] = toHsl([r, g, b]); [r, g, b] = fromHsl(h, Math.min(1, s * val), l); break; }
      case "tint": [r, g, b] = [r, g, b].map(x => x + (255 - x) * (1 - val)) as [number, number, number]; break;
      case "shade": [r, g, b] = [r, g, b].map(x => x * val) as [number, number, number]; break;
      case "alpha": alpha = val; break;
    }
  }
  const hx = "#" + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
  return alpha < 1 ? `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+alpha.toFixed(3)})` : hx;
}

/* ---------- formas pré-definidas mais comuns (viewBox 100×100) ---------- */
const PRST: Record<string, string> = {
  triangle: "M50 0L100 100H0Z", rtTriangle: "M0 0L100 100H0Z", diamond: "M50 0L100 50L50 100L0 50Z",
  parallelogram: "M25 0H100L75 100H0Z", trapezoid: "M25 0H75L100 100H0Z", pentagon: "M50 0L100 38L81 100H19L0 38Z",
  hexagon: "M25 0H75L100 50L75 100H25L0 50Z", octagon: "M29 0H71L100 29V71L71 100H29L0 71V29Z",
  homePlate: "M0 0H80L100 50L80 100H0Z", chevron: "M0 0H80L100 50L80 100H0L20 50Z",
  rightArrow: "M0 25H65V0L100 50L65 100V75H0Z", leftArrow: "M100 25H35V0L0 50L35 100V75H100Z",
  upArrow: "M25 100V35H0L50 0L100 35H75V100Z", downArrow: "M25 0V65H0L50 100L100 65H75V0Z",
  plus: "M35 0H65V35H100V65H65V100H35V65H0V35H35Z", star5: "M50 0L61 35H98L68 57L79 91L50 70L21 91L32 57L2 35H39Z",
  flowChartDecision: "M50 0L100 50L50 100L0 50Z", snip1Rect: "M0 0H84L100 16V100H0Z",
};
const RECTISH = new Set(["rect", "flowChartProcess", "frame", "snip2SameRect", "textBox"]);

function custPath(geom: Element, w: number, h: number): { d: string; w: number; h: number } | null {
  const paths = kids(at(geom, "pathLst"), "path");
  if (!paths.length) return null;
  let d = "", pw = w, phh = h;
  for (const p of paths) {
    pw = num(p, "w", w) || w; phh = num(p, "h", h) || h;
    let cx = 0, cy = 0;
    for (const c of Array.from(p.children)) {
      const pts = kids(c, "pt").map(pt => [num(pt, "x"), num(pt, "y")]);
      if (c.localName === "moveTo" && pts[0]) { [cx, cy] = pts[0]; d += `M${cx} ${cy}`; }
      else if (c.localName === "lnTo" && pts[0]) { [cx, cy] = pts[0]; d += `L${cx} ${cy}`; }
      else if (c.localName === "cubicBezTo" && pts.length === 3) { d += "C" + pts.map(q => q.join(" ")).join(" "); [cx, cy] = pts[2]; }
      else if (c.localName === "quadBezTo" && pts.length === 2) { d += "Q" + pts.map(q => q.join(" ")).join(" "); [cx, cy] = pts[1]; }
      else if (c.localName === "arcTo") {
        const wR = num(c, "wR"), hR = num(c, "hR"), st = num(c, "stAng") / 60000 * Math.PI / 180, sw = num(c, "swAng") / 60000 * Math.PI / 180;
        const ox = cx - wR * Math.cos(st), oy = cy - hR * Math.sin(st);
        const ex = ox + wR * Math.cos(st + sw), ey = oy + hR * Math.sin(st + sw);
        d += `A${wR} ${hR} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex} ${ey}`; cx = ex; cy = ey;
      } else if (c.localName === "close") d += "Z";
    }
  }
  return d ? { d, w: pw, h: phh } : null;
}

/* ---------- texto ---------- */
type StyleSrc = (lvl: number) => (Element | null)[];
const lvlOf = (list: Element | null | undefined, lvl: number) => kid(list, "lvl" + (lvl + 1) + "pPr");
function first<T>(els: (Element | null | undefined)[], f: (e: Element) => T | null | undefined): T | undefined {
  for (const e of els) { if (!e) continue; const v = f(e); if (v != null) return v; }
  return undefined;
}
function spacing(e: Element, name: string, sizePx: number): number | null {
  const s = kid(e, name);
  if (!s) return null;
  const pts = kid(s, "spcPts"), pct = kid(s, "spcPct");
  if (pts) return (num(pts, "val") / 100) * 4 / 3;
  if (pct) return (num(pct, "val") / 100000) * sizePx;
  return null;
}
function roman(n: number) {
  const m: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = ""; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s;
}
type TextOut = { paras: Para[]; anchor: "t" | "ctr" | "b"; inset: [number, number, number, number]; nowrap: boolean; vert: boolean };
function parseText(tx: Element, ctx: Ctx, stack: StyleSrc, bodyFallback: (Element | null)[], fonts: Set<string>, slideNo: number): TextOut {
  const bp = kid(tx, "bodyPr");
  const bps = [bp, ...bodyFallback];
  const ins = (a: string, d: number) => (first(bps, e => (e.hasAttribute(a) ? num(e, a) : null)) ?? d) / EMU;
  const inset: [number, number, number, number] = [ins("lIns", 91440), ins("tIns", 45720), ins("rIns", 91440), ins("bIns", 45720)];
  const anchorRaw = first(bps, e => attr(e, "anchor"));
  const anchor = anchorRaw === "ctr" ? "ctr" : anchorRaw === "b" ? "b" : "t";
  const nowrap = first(bps, e => attr(e, "wrap")) === "none";
  const vertRaw = first(bps, e => attr(e, "vert")) ?? "horz";
  const fit = kid(bp, "normAutofit");
  const fontScale = fit ? num(fit, "fontScale", 100000) / 100000 : 1;
  const lnRed = fit ? num(fit, "lnSpcReduction", 0) / 100000 : 0;
  const own = kid(tx, "lstStyle");
  const paras: Para[] = [];
  const counters: number[] = [];
  for (const p of kids(tx, "p")) {
    const pPr = kid(p, "pPr");
    const lvl = num(pPr, "lvl", 0);
    const srcs = [pPr, lvlOf(own, lvl), ...stack(lvl)];
    const rSrcs = (rPr: Element | null) => [rPr, ...srcs.map(s => kid(s, "defRPr"))];
    const sizeOf = (rs: (Element | null)[]) => (first(rs, e => (e.hasAttribute("sz") ? num(e, "sz") : null)) ?? 1800) / 100 * 4 / 3 * fontScale;
    const run = (rPr: Element | null, t: string): Run => {
      const rs = rSrcs(rPr);
      const r: Run = { t, sz: +sizeOf(rs).toFixed(2) };
      const b = first(rs, e => attr(e, "b")); if (b === "1" || b === "true") r.b = true;
      const i = first(rs, e => attr(e, "i")); if (i === "1" || i === "true") r.i = true;
      const u = first(rs, e => attr(e, "u")); if (u && u !== "none") r.u = true;
      const s = first(rs, e => attr(e, "strike")); if (s && s !== "noStrike") r.strike = true;
      if (first(rs, e => attr(e, "cap")) === "all") r.caps = true;
      const spc = first(rs, e => (e.hasAttribute("spc") ? num(e, "spc") : null)); if (spc) r.spc = +(spc / 100 * 4 / 3).toFixed(2);
      const base = first(rs, e => (e.hasAttribute("baseline") ? num(e, "baseline") : null)); if (base) { if (base > 0) r.sup = true; else r.sub = true; }
      const col = first(rs, e => { const f = kid(e, "solidFill"); return f ? colorOf(f, ctx) : kid(e, "noFill") ? "transparent" : null; });
      if (col) r.color = col;
      let face = first(rs, e => attr(kid(e, "latin"), "typeface"));
      if (face === "+mj-lt") face = ctx.theme.major; else if (face === "+mn-lt") face = ctx.theme.minor;
      if (face) { r.font = face; fonts.add(face); }
      return r;
    };
    const runs: Run[] = [];
    for (const c of Array.from(p.children)) {
      if (c.localName === "r") runs.push(run(kid(c, "rPr"), kid(c, "t")?.textContent ?? ""));
      else if (c.localName === "br") runs.push({ ...run(kid(c, "rPr"), "\n"), br: true });
      else if (c.localName === "fld") runs.push(run(kid(c, "rPr"), attr(c, "type") === "slidenum" ? String(slideNo) : kid(c, "t")?.textContent ?? ""));
    }
    const endSz = sizeOf(rSrcs(kid(p, "endParaRPr")));
    const para: Para = { runs, sz: +endSz.toFixed(2) };
    const algn = first(srcs, e => attr(e, "algn"));
    if (algn) para.align = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" || algn === "dist" ? "justify" : "left";
    const base = runs.find(r => r.t.trim())?.sz ?? endSz;
    const ln = first(srcs, e => { const s = kid(e, "lnSpc"); if (!s) return null; const pct = kid(s, "spcPct"), pts = kid(s, "spcPts"); return pct ? { pct: num(pct, "val") / 100000 } : pts ? { px: num(pts, "val") / 100 * 4 / 3 } : null; });
    if (ln?.pct) para.lh = +((ln.pct - lnRed) * 1.2).toFixed(3); else if (ln?.px) para.lhPx = ln.px; else if (lnRed) para.lh = +((1 - lnRed) * 1.2).toFixed(3);
    const sb = first(srcs, e => spacing(e, "spcBef", base)); if (sb) para.spB = +sb.toFixed(2);
    const sa = first(srcs, e => spacing(e, "spcAft", base)); if (sa) para.spA = +sa.toFixed(2);
    const marL = first(srcs, e => (e.hasAttribute("marL") ? num(e, "marL") : null)); if (marL) para.marL = marL / EMU;
    const indent = first(srcs, e => (e.hasAttribute("indent") ? num(e, "indent") : null)); if (indent) para.indent = indent / EMU;
    const bu = first(srcs, e => kid(e, "buNone") ? "none" : kid(e, "buChar") ? "char:" + (attr(kid(e, "buChar"), "char") ?? "•") : kid(e, "buAutoNum") ? "num:" + (attr(kid(e, "buAutoNum"), "type") ?? "arabicPeriod") : null);
    if (bu && bu !== "none" && runs.some(r => r.t.trim())) {
      if (bu.startsWith("char:")) para.bullet = bu.slice(5);
      else {
        counters[lvl] = (counters[lvl] ?? 0) + 1; counters.length = lvl + 1;
        const n = counters[lvl], type = bu.slice(4);
        const letter = String.fromCharCode(97 + ((n - 1) % 26));
        const core = type.startsWith("alphaLc") ? letter : type.startsWith("alphaUc") ? letter.toUpperCase() : type.startsWith("romanLc") ? roman(n).toLowerCase() : type.startsWith("romanUc") ? roman(n) : String(n);
        para.bullet = type.endsWith("ParenR") ? core + ")" : type.endsWith("ParenBoth") ? "(" + core + ")" : core + ".";
      }
      const bc = first(srcs, e => (kid(e, "buClr") ? colorOf(kid(e, "buClr"), ctx) : null)); if (bc) para.bulletColor = bc;
    } else counters.length = lvl;
    paras.push(para);
  }
  return { paras, anchor, inset, nowrap, vert: vertRaw !== "horz" };
}

/* ---------- placeholders (herança do layout e do mestre) ---------- */
type PhInfo = { type: string; idx: string | null; sp: Element };
type PartInfo = { doc: Document; ctx: Ctx; phs: PhInfo[]; tree: Element | null; showMasterSp: boolean };
function phInfo(el: Element): { type: string; idx: string | null } | null {
  const nv = kids(el).find(k => k.localName.startsWith("nv"));
  const ph = at(nv, "nvPr", "ph");
  return ph ? { type: attr(ph, "type") ?? "body", idx: attr(ph, "idx") } : null;
}
function collectPhs(tree: Element | null): PhInfo[] {
  const out: PhInfo[] = [];
  const walk = (el: Element) => { for (const c of Array.from(el.children)) { const p = phInfo(c); if (p) out.push({ ...p, sp: c }); else if (c.localName === "grpSp") walk(c); } };
  if (tree) walk(tree);
  return out;
}
const masterType = (t: string) => (t === "ctrTitle" ? "title" : t === "subTitle" || t === "obj" ? "body" : t);
function findLayoutPh(list: PhInfo[] | undefined, type: string, idx: string | null) {
  if (!list) return undefined;
  return (idx != null ? list.find(p => p.idx === idx) : undefined) ?? list.find(p => p.type === type) ?? list.find(p => masterType(p.type) === masterType(type));
}
function findMasterPh(list: PhInfo[] | undefined, type: string) {
  if (!list) return undefined;
  const t = masterType(type);
  return list.find(p => p.type === t) ?? (t === "body" ? undefined : undefined);
}

/* ---------- importação ---------- */
type Xf = { ox: number; oy: number; sx: number; sy: number };

export type PptxLink = { slide: number; name: string; text: string; link: string };
/** Hyperlinks of the visible slides only (no media is read), in the same slide order as importPptx.
 * Used to give links to presentations imported before links were supported. */
export async function readPptxLinks(file: Blob): Promise<PptxLink[]> {
  const zip = await ZipArchive.open(file);
  const pres = parse(await zip.read("ppt/presentation.xml"));
  if (!pres) return [];
  const presRels = await readRels(zip, "ppt/presentation.xml");
  const ids = kids(at(pres.documentElement, "sldIdLst"), "sldId").map(s => presRels.get(rid(s, "id") ?? "")?.target ?? "").filter(p => p && zip.has(p));
  const list = ids.length ? ids : zip.names().filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1]) - Number(b.match(/(\d+)\.xml$/)?.[1]));
  const out: PptxLink[] = [];
  let index = 0;
  for (const path of list) {
    const doc = parse(await zip.read(path));
    if (!doc || attr(doc.documentElement, "show") === "0") continue;
    const rels = await readRels(zip, path);
    const groupLink = (el: Element | null): string | undefined => {
      for (let g = el?.parentElement ?? null; g; g = g.parentElement) {
        if (g.localName !== "grpSp") continue;
        const r = rels.get(rid(at(g, "nvGrpSpPr", "cNvPr", "hlinkClick"), "id") ?? "");
        const url = r?.external ? safeLink(r.target) : undefined;
        if (url) return url;
      }
      return undefined;
    };
    for (const el of Array.from(doc.getElementsByTagName("*"))) {
      if (!["sp", "pic", "cxnSp"].includes(el.localName)) continue;
      const nv = kids(el).find(k => k.localName.startsWith("nv"));
      const name = attr(kid(nv, "cNvPr"), "name") ?? "";
      const link = linkOf(el, rels) ?? groupLink(el);
      if (!link) continue;
      const text = Array.from(el.getElementsByTagName("*")).filter(e => e.localName === "t").map(e => e.textContent ?? "").join("");
      out.push({ slide: index, name, text, link });
    }
    index++;
  }
  return out;
}

export async function importPptx(file: File, opts: ImportOptions): Promise<ImportOutput> {
  if (!/\.(pptx|ppsx|potx)$/i.test(file.name)) throw new Error("Selecione um arquivo do PowerPoint (.pptx).");
  if (file.size > MAX_PPTX_MB * 1024 * 1024) throw new Error("O arquivo passa de 1 GB. O máximo é 1024 MB.");
  const zip = await ZipArchive.open(file);
  const presPath = "ppt/presentation.xml";
  const pres = parse(await zip.read(presPath));
  if (!pres) throw new Error("Este arquivo não parece ser uma apresentação do PowerPoint.");
  const presRels = await readRels(zip, presPath);
  const P = pres.documentElement;
  const sz = at(P, "sldSz");
  const W = Math.round(num(sz, "cx", 12192000) / EMU), H = Math.round(num(sz, "cy", 6858000) / EMU);
  const warnings = new Set<string>();
  const fonts = new Set<string>();
  const defaultText = at(P, "defaultTextStyle");

  const ids = kids(at(P, "sldIdLst"), "sldId").map(s => ({ id: num(s, "id"), path: presRels.get(rid(s, "id") ?? "")?.target ?? "" })).filter(s => s.path && zip.has(s.path));
  const slideList = ids.length ? ids : zip.names().filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1]) - Number(b.match(/(\d+)\.xml$/)?.[1])).map((path, i) => ({ id: i, path }));
  if (!slideList.length) throw new Error("Nenhum slide foi encontrado no arquivo.");

  // seções do PowerPoint viram andares da torre
  let sections: { name: string; ids: number[] }[] | undefined;
  const secEls = Array.from(pres.getElementsByTagName("*")).filter(e => e.localName === "section" && e.parentElement?.localName === "sectionLst");
  if (secEls.length) sections = secEls.map(s => ({ name: attr(s, "name") ?? "", ids: Array.from(s.getElementsByTagName("*")).filter(e => e.localName === "sldId").map(e => num(e, "id")) }));

  const parts = new Map<string, PartInfo>();
  const themes = new Map<string, Theme>();
  async function loadTheme(path: string): Promise<Theme> {
    const hit = themes.get(path);
    if (hit) return hit;
    const doc = parse(await zip.read(path));
    const t: Theme = { colors: {}, major: "Calibri", minor: "Calibri" };
    if (doc) {
      const all = Array.from(doc.getElementsByTagName("*"));
      for (const c of kids(all.find(e => e.localName === "clrScheme"))) {
        const v = kid(c, "srgbClr")?.getAttribute("val") ?? kid(c, "sysClr")?.getAttribute("lastClr");
        if (v) t.colors[c.localName] = v;
      }
      const fs = all.find(e => e.localName === "fontScheme");
      t.major = attr(at(fs, "majorFont", "latin"), "typeface") || t.major;
      t.minor = attr(at(fs, "minorFont", "latin"), "typeface") || t.minor;
    }
    themes.set(path, t);
    return t;
  }
  async function loadPart(path: string): Promise<PartInfo | undefined> {
    const hit = parts.get(path);
    if (hit) return hit;
    const doc = parse(await zip.read(path));
    if (!doc) return undefined;
    const rels = await readRels(zip, path);
    const themeRel = [...rels.values()].find(r => r.type.endsWith("/theme"));
    const theme = themeRel ? await loadTheme(themeRel.target) : { colors: {}, major: "Calibri", minor: "Calibri" };
    const clrMap: Record<string, string> = {};
    const cm = kid(doc.documentElement, "clrMap");
    if (cm) for (const a of Array.from(cm.attributes)) clrMap[a.name] = a.value;
    const tree = at(doc.documentElement, "cSld", "spTree");
    const info: PartInfo = { doc, tree, phs: collectPhs(tree), showMasterSp: attr(doc.documentElement, "showMasterSp") !== "0", ctx: { theme, clrMap, rels } };
    parts.set(path, info);
    return info;
  }

  const media = new Map<string, string>(); // caminho no zip -> id do arquivo guardado
  async function asset(rel: Rel | undefined, kind: "image" | "video"): Promise<string | undefined> {
    if (!rel || rel.external) return undefined;
    const hit = media.get(rel.target);
    if (hit) return hit;
    const ext = rel.target.split(".").pop()?.toLowerCase() ?? "";
    const mime = mimeOf(rel.target);
    if (!mime || (kind === "image" && !mime.startsWith("image/"))) {
      warnings.add(ext === "emf" || ext === "wmf" ? "Imagens EMF/WMF (formato antigo do Windows) não aparecem no navegador. No PowerPoint, salve-as como PNG." : "Algumas mídias em formato não suportado (." + ext + ") ficaram de fora.");
      return undefined;
    }
    const blob = await zip.blob(rel.target, mime);
    if (!blob) return undefined;
    const id = uid() + "." + ext;
    await opts.saveAsset(id, blob, kind);
    media.set(rel.target, id);
    return id;
  }
  function gradient(g: Element, ctx: Ctx) {
    const stops = kids(at(g, "gsLst"), "gs").sort((a, b) => num(a, "pos") - num(b, "pos")).map(s => `${colorOf(s, ctx) ?? "#000"} ${num(s, "pos") / 1000}%`);
    if (!stops.length) return undefined;
    if (kid(g, "path")) return `radial-gradient(circle, ${stops.join(",")})`;
    const lin = kid(g, "lin");
    return `linear-gradient(${(lin ? num(lin, "ang") / 60000 : 0) + 90}deg, ${stops.join(",")})`;
  }
  async function fillOf(spPr: Element | null, style: Element | null, ctx: Ctx, lay: Partial<Layer>): Promise<void> {
    if (kid(spPr, "noFill")) return;
    const solid = kid(spPr, "solidFill"), grad = kid(spPr, "gradFill"), blip = kid(spPr, "blipFill"), patt = kid(spPr, "pattFill");
    if (solid) { lay.fill = colorOf(solid, ctx); return; }
    if (grad) { lay.fill = gradient(grad, ctx); return; }
    if (patt) { lay.fill = colorOf(kid(patt, "fgClr"), ctx); return; }
    if (blip) { lay.asset = await asset(ctx.rels.get(rid(kid(blip, "blip"), "embed") ?? ""), "image"); return; }
    const ref = kid(style, "fillRef");
    if (ref && num(ref, "idx") > 0) lay.fill = colorOf(ref, ctx);
  }
  function lineOf(spPr: Element | null, style: Element | null, ctx: Ctx, lay: Partial<Layer>) {
    const ln = kid(spPr, "ln");
    if (kid(ln, "noFill")) return;
    const own = kid(ln, "solidFill") ? colorOf(kid(ln, "solidFill"), ctx) : kid(ln, "gradFill") ? colorOf(at(ln, "gradFill", "gsLst", "gs"), ctx) : undefined;
    const ref = kid(style, "lnRef");
    const color = own ?? (ref && num(ref, "idx") > 0 ? colorOf(ref, ctx) : undefined);
    if (!color) return;
    lay.stroke = color;
    lay.strokeW = +Math.max(0.75, num(ln, "w", 9525) / EMU).toFixed(2);
    const dash = attr(kid(ln, "prstDash"), "val");
    if (dash && dash !== "solid") lay.dash = true;
  }
  function shadowOf(spPr: Element | null, ctx: Ctx): string | undefined {
    const sh = at(spPr, "effectLst", "outerShdw");
    if (!sh) return undefined;
    const blur = num(sh, "blurRad") / EMU, dist = num(sh, "dist") / EMU, dir = num(sh, "dir") / 60000 * Math.PI / 180;
    const col = colorOf(sh, ctx) ?? "rgba(0,0,0,.3)";
    return `drop-shadow(${(Math.cos(dir) * dist).toFixed(1)}px ${(Math.sin(dir) * dist).toFixed(1)}px ${(blur / 2).toFixed(1)}px ${col})`;
  }
  function box(xfrm: Element | null, T: Xf) {
    const off = kid(xfrm, "off"), ext = kid(xfrm, "ext");
    return {
      x: T.ox + num(off, "x") / EMU * T.sx, y: T.oy + num(off, "y") / EMU * T.sy,
      w: Math.max(0, num(ext, "cx") / EMU * T.sx), h: Math.max(0, num(ext, "cy") / EMU * T.sy),
      rot: num(xfrm, "rot") / 60000, flipH: attr(xfrm, "flipH") === "1", flipV: attr(xfrm, "flipV") === "1",
    };
  }

  async function walk(tree: Element, part: PartInfo, layout: PartInfo | undefined, master: PartInfo | undefined, T: Xf, out: Layer[], isSlide: boolean, slideNo: number) {
    const ctx = part.ctx;
    for (const el of Array.from(tree.children)) {
      const name = el.localName;
      if (name === "AlternateContent") {
        const before = out.length;
        const choice = kid(el, "Choice"), fallback = kid(el, "Fallback");
        if (choice) await walk(choice, part, layout, master, T, out, isSlide, slideNo);
        if (out.length === before && fallback) await walk(fallback, part, layout, master, T, out, isSlide, slideNo);
        continue;
      }
      if (name === "grpSp") {
        const xf = at(el, "grpSpPr", "xfrm");
        const off = kid(xf, "off"), ext = kid(xf, "ext"), cOff = kid(xf, "chOff"), cExt = kid(xf, "chExt");
        const sx = num(cExt, "cx") ? num(ext, "cx") / num(cExt, "cx") : 1, sy = num(cExt, "cy") ? num(ext, "cy") / num(cExt, "cy") : 1;
        const G: Xf = { ox: T.ox + (num(off, "x") - num(cOff, "x") * sx) / EMU * T.sx, oy: T.oy + (num(off, "y") - num(cOff, "y") * sy) / EMU * T.sy, sx: T.sx * sx, sy: T.sy * sy };
        const before = out.length;
        await walk(el, part, layout, master, G, out, isSlide, slideNo);
        // A button drawn as a group (box + text) with the link on the group.
        const groupRel = ctx.rels.get(rid(at(el, "nvGrpSpPr", "cNvPr", "hlinkClick"), "id") ?? "");
        const groupLink = groupRel?.external ? safeLink(groupRel.target) : undefined;
        if (groupLink) for (const l of out.slice(before)) l.link ??= groupLink;
        continue;
      }
      if (!["sp", "cxnSp", "pic", "graphicFrame"].includes(name)) continue;
      const ph = phInfo(el);
      if (ph && !isSlide) continue; // placeholders do layout/mestre são só moldes
      const lph = ph ? findLayoutPh(layout?.phs, ph.type, ph.idx) : undefined;
      const mph = ph ? findMasterPh(master?.phs, lph?.type ?? ph.type) : undefined;

      if (name === "graphicFrame") {
        const g = at(el, "graphic", "graphicData");
        const tbl = kid(g, "tbl");
        if (!tbl) {
          const uri = attr(g, "uri") ?? "";
          warnings.add(uri.includes("chart") ? "Gráficos do PowerPoint ainda não são importados: cole-os como imagem para aparecerem." : uri.includes("diagram") ? "SmartArt não é importado: converta em formas ou imagem no PowerPoint." : "Alguns objetos incorporados ficaram de fora.");
          continue;
        }
        const b = box(kid(el, "xfrm"), T);
        const cols = kids(kid(tbl, "tblGrid"), "gridCol").map(c => num(c, "w") / EMU * T.sx);
        const rows = kids(tbl, "tr").map(tr => ({
          h: num(tr, "h") / EMU * T.sy,
          cells: kids(tr, "tc").map(tc => {
            const tcPr = kid(tc, "tcPr");
            const tx = kid(tc, "txBody");
            const t = tx ? parseText(tx, ctx, lvl => [lvlOf(defaultText, lvl)], [], fonts, slideNo) : null;
            const border = (n: string) => { const l = kid(tcPr, n); const c = l && !kid(l, "noFill") ? colorOf(kid(l, "solidFill"), ctx) : undefined; return c ? `${Math.max(1, num(l, "w", 12700) / EMU).toFixed(1)}px solid ${c}` : undefined; };
            const cell: Cell = {
              paras: t?.paras ?? [], fill: kid(tcPr, "solidFill") ? colorOf(kid(tcPr, "solidFill"), ctx) : undefined,
              span: num(tc, "gridSpan", 1), rowSpan: num(tc, "rowSpan", 1), merged: attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1",
              inset: [num(tcPr, "marL", 91440) / EMU, num(tcPr, "marT", 45720) / EMU, num(tcPr, "marR", 91440) / EMU, num(tcPr, "marB", 45720) / EMU],
              anchor: attr(tcPr, "anchor") === "ctr" ? "ctr" : attr(tcPr, "anchor") === "b" ? "b" : "t",
              borders: { b: border("lnB"), r: border("lnR"), t: border("lnT"), l: border("lnL") },
            };
            return cell;
          }),
        }));
        out.push({ id: uid(), kind: "table", x: b.x, y: b.y, w: b.w, h: b.h, cols, rows, anim: { type: "rise", delay: 0, dur: 0.9 } });
        continue;
      }

      const spPr = kid(el, "spPr");
      const style = kid(el, "style");
      const xfrm = kid(spPr, "xfrm") ?? at(lph?.sp, "spPr", "xfrm") ?? at(mph?.sp, "spPr", "xfrm");
      if (!xfrm) continue;
      const b = box(xfrm, T);
      const lay: Layer = { id: uid(), kind: "shape", x: b.x, y: b.y, w: b.w, h: b.h, anim: { type: "rise", delay: 0, dur: 0.9 } };
      if (b.rot) lay.rot = b.rot;
      if (b.flipH) lay.flipH = true;
      if (b.flipV) lay.flipV = true;
      const nm = attr(at(kids(el).find(k => k.localName.startsWith("nv")), "cNvPr"), "name");
      if (nm) lay.name = nm;
      const link = linkOf(el, ctx.rels);
      if (link) lay.link = link;

      // geometria
      const prstEl = kid(spPr, "prstGeom");
      const prst = attr(prstEl, "prst");
      const cust = kid(spPr, "custGeom");
      if (cust) {
        const cp = custPath(cust, b.w * EMU, b.h * EMU);
        if (cp) { lay.geom = "path"; lay.path = cp.d; lay.pathW = cp.w; lay.pathH = cp.h; } else lay.geom = "rect";
      } else if (prst === "ellipse" || prst === "flowChartConnector") lay.geom = "ellipse";
      else if (prst === "line" || prst === "straightConnector1" || (name === "cxnSp" && (!prst || prst.includes("Connector")))) lay.geom = "line";
      else if (prst && (/^round/i.test(prst) || prst === "flowChartAlternateProcess")) {
        lay.geom = "roundRect";
        const gd = kids(at(prstEl, "avLst"), "gd")[0];
        const adj = gd ? Number((attr(gd, "fmla") ?? "val 16667").split(" ").pop()) : 16667;
        lay.radius = +(Math.min(b.w, b.h) * adj / 100000).toFixed(2);
      } else if (prst && PRST[prst]) { lay.geom = "path"; lay.path = PRST[prst]; lay.pathW = 100; lay.pathH = 100; }
      else {
        lay.geom = "rect";
        if (prst && !RECTISH.has(prst) && name !== "pic") warnings.add("Algumas formas especiais viraram retângulos.");
      }

      if (name === "pic") {
        const blip = at(el, "blipFill", "blip");
        const svgExt = blip ? Array.from(blip.getElementsByTagName("*")).find(e => e.localName === "svgBlip") : undefined;
        const nvPr = at(el, "nvPicPr", "nvPr");
        const vid = kid(nvPr, "videoFile");
        const p14 = nvPr ? Array.from(nvPr.getElementsByTagName("*")).find(e => e.localName === "media") : undefined;
        let img = svgExt ? await asset(ctx.rels.get(rid(svgExt, "embed") ?? ""), "image") : undefined;
        img ??= await asset(ctx.rels.get(rid(blip, "embed") ?? ""), "image");
        const vRel = ctx.rels.get(rid(p14, "embed") ?? "") ?? ctx.rels.get(rid(vid, "link") ?? "");
        if (vRel && !vRel.external && /\.(mp4|m4v|mov|webm)$/i.test(vRel.target)) {
          const v = await asset(vRel, "video");
          if (v) { lay.kind = "video"; lay.asset = v; if (img) lay.poster = img; }
        } else if (kid(nvPr, "audioFile") || vid) warnings.add("Áudios e vídeos por link externo não são importados.");
        if (lay.kind !== "video") { if (!img) continue; lay.kind = "image"; lay.asset = img; }
        const src = at(el, "blipFill", "srcRect");
        if (src) lay.crop = { l: num(src, "l") / 100000, t: num(src, "t") / 100000, r: num(src, "r") / 100000, b: num(src, "b") / 100000 };
        const alpha = kid(blip, "alphaModFix");
        if (alpha) lay.opacity = num(alpha, "amt", 100000) / 100000;
        lineOf(spPr, style, ctx, lay);
        const shd = shadowOf(spPr, ctx); if (shd) lay.shadow = shd;
        if (lay.geom === "rect") delete lay.geom;
        out.push(lay);
        continue;
      }

      await fillOf(spPr, style, ctx, lay);
      if (lay.asset) lay.kind = "image";
      lineOf(spPr, style, ctx, lay);
      if (lay.geom === "line") { lay.stroke ??= colorOf(kid(style, "lnRef"), ctx) ?? "#000000"; lay.strokeW ??= 1; delete lay.fill; }
      const shd = shadowOf(spPr, ctx); if (shd) lay.shadow = shd;

      const tx = kid(el, "txBody");
      if (tx) {
        const kind = ph ? (["title", "ctrTitle"].includes(ph.type) ? "titleStyle" : ["body", "subTitle", "obj"].includes(ph.type) ? "bodyStyle" : "otherStyle") : "otherStyle";
        const txStyles = at(master?.doc.documentElement, "txStyles", kind);
        const stack: StyleSrc = lvl => [lvlOf(at(lph?.sp, "txBody", "lstStyle"), lvl), lvlOf(at(mph?.sp, "txBody", "lstStyle"), lvl), lvlOf(txStyles, lvl), lvlOf(defaultText, lvl)];
        const t = parseText(tx, ctx, stack, [at(lph?.sp, "txBody", "bodyPr"), at(mph?.sp, "txBody", "bodyPr")], fonts, slideNo);
        if (t.paras.some(p => p.runs.some(r => r.t.trim()))) {
          const fcol = colorOf(kid(style, "fontRef"), ctx);
          if (fcol) for (const p of t.paras) for (const r of p.runs) r.color ??= fcol;
          lay.paras = t.paras; lay.anchor = t.anchor; lay.inset = t.inset;
          if (t.nowrap) lay.nowrap = true;
          if (t.vert) lay.vert = true;
        }
      }
      // An invisible box with a link is a clickable area over a button: keep it.
      if (!(lay.fill || lay.stroke || lay.paras || lay.asset || lay.link)) continue;
      if (lay.kind === "shape" && !lay.fill && !lay.stroke && !lay.asset && lay.geom !== "line") lay.kind = "text";
      out.push(lay);
    }
  }

  async function background(part: PartInfo | undefined, slide: Slide): Promise<boolean> {
    const bg = at(part?.doc.documentElement, "cSld", "bg");
    if (!bg || !part) return false;
    const pr = kid(bg, "bgPr"), ref = kid(bg, "bgRef");
    if (pr) {
      const tmp: Partial<Layer> = {};
      await fillOf(pr, null, part.ctx, tmp);
      if (tmp.asset) slide.bgAsset = tmp.asset;
      if (tmp.fill) slide.bg = tmp.fill;
      return !!(tmp.asset || tmp.fill);
    }
    if (ref) { slide.bg = colorOf(ref, part.ctx) ?? "#ffffff"; return true; }
    return false;
  }

  const slides: Slide[] = [];
  const keptIds: number[] = [];
  let hidden = 0;
  for (const [i, s] of slideList.entries()) {
    opts.onProgress?.(i, slideList.length, `Slide ${i + 1} de ${slideList.length}`);
    const sp = await loadPart(s.path);
    if (!sp) { warnings.add("Um slide com conteúdo inválido foi ignorado."); continue; }
    if (attr(sp.doc.documentElement, "show") === "0") { hidden++; continue; }
    const layRel = [...sp.ctx.rels.values()].find(r => r.type.endsWith("/slideLayout"));
    const layout = layRel ? await loadPart(layRel.target) : undefined;
    const mRel = layout ? [...layout.ctx.rels.values()].find(r => r.type.endsWith("/slideMaster")) : undefined;
    const master = mRel ? await loadPart(mRel.target) : undefined;
    // slide e layout usam o tema e o mapa de cores do mestre
    if (master) for (const pi of [sp, layout]) if (pi) { pi.ctx.theme = master.ctx.theme; if (!Object.keys(pi.ctx.clrMap).length) pi.ctx.clrMap = master.ctx.clrMap; }
    const slide: Slide = { id: uid(), title: "", floor: "", layers: [], kb: false, focus: [] };
    if (!(await background(sp, slide)) && !(await background(layout, slide)) && !(await background(master, slide))) slide.bg = "#ffffff";
    const T: Xf = { ox: 0, oy: 0, sx: 1, sy: 1 };
    if (sp.showMasterSp) {
      if (master?.tree && (layout?.showMasterSp ?? true)) await walk(master.tree, master, undefined, undefined, T, slide.layers, false, i + 1);
      if (layout?.tree) await walk(layout.tree, layout, undefined, master, T, slide.layers, false, i + 1);
    }
    if (sp.tree) await walk(sp.tree, sp, layout, master, T, slide.layers, true, i + 1);
    slide.layers = slide.layers.filter(l => l.w > 0.5 || l.h > 0.5);
    slide.title = slideTitle(slide, H) || "Slide " + (slides.length + 1);
    autoAnimate(slide, W, H);
    animateRoute(slide);
    slides.push(slide);
    keptIds.push(s.id);
  }
  if (hidden) warnings.add(`${hidden} slide(s) oculto(s) no PowerPoint ficaram de fora.`);
  if (!slides.length) throw new Error("Nenhum slide visível foi encontrado.");
  opts.onProgress?.(slideList.length, slideList.length, "Montando a torre");
  if (sections) sections = sections.map(s => ({ name: s.name, ids: s.ids.filter(id => keptIds.includes(id)) })).filter(s => s.ids.length);
  return { w: W, h: H, slides, fonts: [...fonts], warnings: [...warnings], sections };
}
