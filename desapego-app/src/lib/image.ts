// Fotos: redimensiona e comprime no aparelho antes de enviar (economiza dados e armazenamento).
// Navegadores atuais já aplicam a orientação EXIF ao desenhar a imagem, então foto "deitada" sai em pé.

export const MAX_INPUT_BYTES = 30 * 1024 * 1024;

export interface Compressed { blob: Blob; width: number; height: number; type: string }

let webpOk: boolean | null = null;
function canWebp(): boolean {
  if (webpOk == null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpOk = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpOk;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // a imagem já foi decodificada; pode liberar a memória do link
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível processar a foto."))), type, quality),
  );
}

export async function compressImage(file: Blob, maxSide: number, quality = 0.82): Promise<Compressed> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Foto muito grande (máximo 30 MB).");
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu processar a foto.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const type = canWebp() ? "image/webp" : "image/jpeg";
  let blob = await toBlob(canvas, type, quality);
  // garante o limite do servidor (3 MB) mesmo em fotos muito detalhadas
  for (let q = quality - 0.12; blob.size > 2.8 * 1024 * 1024 && q > 0.4; q -= 0.12) blob = await toBlob(canvas, type, q);
  canvas.width = canvas.height = 0; // libera memória no celular
  return { blob, width, height, type };
}

export function extFor(type: string): string {
  return type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
}
