/**
 * Ponto de entrada do importador dentro do Chromium (usado por montar.mjs).
 * É o mesmo caminho do "Importar PowerPoint" do Palco (src/lib/importer.ts),
 * só que os arquivos ficam na memória em vez do IndexedDB.
 */
import { importPptx } from "./pptx";
import { autoFloors, newProject } from "./model";

/** Miniatura leve (até 720 px) para slides longe da câmera — igual a makeThumb do Palco. */
async function makeThumb(blob: Blob): Promise<Blob | null> {
  if (blob.type === "image/svg+xml" || blob.type === "image/gif") return null;
  try {
    const bmp = await createImageBitmap(blob);
    const s = 720 / Math.max(bmp.width, bmp.height);
    if (s >= 0.8) { bmp.close(); return null; }
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const g = c.getContext("2d");
    if (!g) return null;
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise(r => c.toBlob(b => r(b), blob.type === "image/png" ? "image/png" : "image/jpeg", 0.82));
  } catch { return null; }
}

async function importar(file: File) {
  const assets = new Map<string, Blob>();
  const out = await importPptx(file, {
    saveAsset: async (id, blob, kind) => {
      assets.set(id, blob);
      if (kind === "image") { const t = await makeThumb(blob); if (t) assets.set(id + "@t", t); }
    },
  });
  const project = newProject(file.name.replace(/\.(pptx|ppsx|potx)$/i, ""), out.w, out.h);
  project.floors = autoFloors(out.slides, out.sections);
  project.slides = out.slides;
  project.fonts = out.fonts;
  project.warnings = out.warnings;
  return { project, assets };
}

(globalThis as unknown as { palcoImportar: typeof importar }).palcoImportar = importar;
