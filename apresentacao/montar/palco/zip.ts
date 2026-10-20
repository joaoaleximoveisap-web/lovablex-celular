/**
 * Leitor ZIP preguiçoso: lê só o índice e as partes pedidas, direto do arquivo.
 * Mídias guardadas sem compressão viram um pedaço (slice) do próprio arquivo,
 * sem copiar para a memória — por isso PPTX de até 1 GB funcionam.
 */
export const MAX_PPTX_MB = 1024;
const MB = 1024 * 1024;
const MAX_DIRECTORY = 32 * MB;
const MAX_XML = 64 * MB;

type RecordInfo = { method: number; flags: number; localOffset: number; compressedSize: number; uncompressedSize: number };

function normalize(path: string) {
  const parts: string[] = [];
  path.replace(/\\/g, "/").split("/").forEach(p => { if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p); });
  return parts.join("/");
}

export class ZipArchive {
  private constructor(private file: Blob, private items: Map<string, RecordInfo>) {}

  static async open(file: Blob): Promise<ZipArchive> {
    const tailSize = Math.min(file.size, 65557);
    if (tailSize < 22) throw Error("Arquivo inválido ou incompleto.");
    const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw Error("Estrutura ZIP não encontrada. O arquivo é mesmo um .pptx?");
    let total = tail.getUint16(eocd + 10, true);
    let length = tail.getUint32(eocd + 12, true);
    let start = tail.getUint32(eocd + 16, true);
    // ZIP64: usado em arquivos muito grandes ou com muitos itens
    if (total === 0xffff || length === 0xffffffff || start === 0xffffffff) {
      const locAt = eocd - 20;
      if (locAt < 0 || tail.getUint32(locAt, true) !== 0x07064b50) throw Error("Índice ZIP64 não encontrado.");
      const z64At = Number(tail.getBigUint64(locAt + 8, true));
      const z = new DataView(await file.slice(z64At, z64At + 56).arrayBuffer());
      if (z.getUint32(0, true) !== 0x06064b50) throw Error("Índice ZIP64 inválido.");
      total = Number(z.getBigUint64(32, true));
      length = Number(z.getBigUint64(40, true));
      start = Number(z.getBigUint64(48, true));
    }
    if (length > MAX_DIRECTORY || start + length > file.size) throw Error("O índice do arquivo é inválido ou grande demais.");
    const dir = new DataView(await file.slice(start, start + length).arrayBuffer());
    const files = new Map<string, RecordInfo>();
    const dec = new TextDecoder();
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > dir.byteLength || dir.getUint32(p, true) !== 0x02014b50) throw Error("O índice do arquivo está incompleto.");
      const flags = dir.getUint16(p + 8, true), method = dir.getUint16(p + 10, true);
      let compressedSize = dir.getUint32(p + 20, true), uncompressedSize = dir.getUint32(p + 24, true);
      const nameLength = dir.getUint16(p + 28, true), extraLength = dir.getUint16(p + 30, true), commentLength = dir.getUint16(p + 32, true);
      let localOffset = dir.getUint32(p + 42, true);
      if (p + 46 + nameLength + extraLength + commentLength > dir.byteLength) throw Error("Entrada ZIP incompleta.");
      const name = normalize(dec.decode(new Uint8Array(dir.buffer, p + 46, nameLength)));
      // campo extra ZIP64 com tamanhos e posição reais
      let e = p + 46 + nameLength;
      const eEnd = e + extraLength;
      while (e + 4 <= eEnd) {
        const tag = dir.getUint16(e, true), size = dir.getUint16(e + 2, true);
        if (tag === 1) {
          let q = e + 4;
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(dir.getBigUint64(q, true)); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(dir.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) localOffset = Number(dir.getBigUint64(q, true));
        }
        e += 4 + size;
      }
      p += 46 + nameLength + extraLength + commentLength;
      if (name) files.set(name, { flags, method, compressedSize, uncompressedSize, localOffset });
    }
    return new ZipArchive(file, files);
  }

  names() { return [...this.items.keys()]; }
  has(path: string) { return this.items.has(path); }
  size(path: string) { return this.items.get(path)?.uncompressedSize ?? 0; }

  private async raw(path: string): Promise<{ item: RecordInfo; slice: Blob } | undefined> {
    const item = this.items.get(path);
    if (!item) return undefined;
    if (item.flags & 1) throw Error("PowerPoint protegido por senha não é compatível. Salve uma cópia sem senha.");
    if (item.method !== 0 && item.method !== 8) throw Error("Compressão não compatível em " + path);
    const at = item.localOffset;
    if (at < 0 || at + 30 > this.file.size) throw Error("Entrada fora do arquivo: " + path);
    const header = new DataView(await this.file.slice(at, at + 30).arrayBuffer());
    if (header.getUint32(0, true) !== 0x04034b50) throw Error("Cabeçalho inválido: " + path);
    const begin = at + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const end = begin + item.compressedSize;
    if (end > this.file.size) throw Error("Arquivo incompleto: " + path);
    return { item, slice: this.file.slice(begin, end) };
  }
  private inflate(slice: Blob): Response {
    try {
      return new Response(slice.stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat)));
    } catch {
      throw Error("Este navegador não consegue abrir o arquivo. Use Chrome, Edge, Safari ou Firefox atualizados.");
    }
  }

  /** Lê uma parte pequena (XML) para a memória. */
  async read(path: string): Promise<Uint8Array | undefined> {
    const r = await this.raw(path);
    if (!r) return undefined;
    if (r.item.uncompressedSize > MAX_XML) throw Error("Parte interna grande demais: " + path);
    const buf = r.item.method === 0 ? await r.slice.arrayBuffer() : await this.inflate(r.slice).arrayBuffer();
    return new Uint8Array(buf);
  }

  /** Devolve uma mídia como Blob; sem compressão, nem passa pela memória. */
  async blob(path: string, type = ""): Promise<Blob | undefined> {
    const r = await this.raw(path);
    if (!r) return undefined;
    if (r.item.method === 0) return new Blob([r.slice], { type });
    const b = await this.inflate(r.slice).blob();
    return new Blob([b], { type });
  }
}
/** Nome antigo mantido para compatibilidade. */
export const PptxArchive = ZipArchive;

/* ---------- gravação (sem compressão) para as cópias de segurança ---------- */
let CRC: Uint32Array | null = null;
function crcTable() {
  if (CRC) return CRC;
  CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  return CRC;
}
export async function crc32(b: Blob): Promise<number> {
  const t = crcTable();
  let c = 0xffffffff;
  for (let o = 0; o < b.size; o += 8 * MB) {
    const u = new Uint8Array(await b.slice(o, o + 8 * MB).arrayBuffer());
    for (let i = 0; i < u.length; i++) c = t[(c ^ u[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export async function writeZip(files: { name: string; data: Blob }[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const big = (n: number) => n >= 0xffffffff;
  for (const f of files) {
    const name = enc.encode(f.name), size = f.data.size, crc = await crc32(f.data);
    const z64 = big(size) || big(offset);
    const extra = z64 ? new Uint8Array(28) : new Uint8Array(0);
    if (z64) {
      const ev = new DataView(extra.buffer);
      ev.setUint16(0, 1, true); ev.setUint16(2, 24, true);
      ev.setBigUint64(4, BigInt(size), true); ev.setBigUint64(12, BigInt(size), true); ev.setBigUint64(20, BigInt(offset), true);
    }
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, z64 ? 45 : 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, z64 ? 0xffffffff : size, true); lv.setUint32(22, z64 ? 0xffffffff : size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length + extra.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 45, true); cv.setUint16(6, z64 ? 45 : 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, z64 ? 0xffffffff : size, true); cv.setUint32(24, z64 ? 0xffffffff : size, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, extra.length, true);
    cv.setUint32(42, z64 ? 0xffffffff : offset, true);
    c.set(name, 46); c.set(extra, 46 + name.length);
    central.push(c);
    parts.push(local, f.data);
    offset += local.length + size;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  parts.push(...central);
  const need64 = big(offset) || files.length >= 0xffff;
  if (need64) {
    const z = new Uint8Array(56), zv = new DataView(z.buffer);
    zv.setUint32(0, 0x06064b50, true); zv.setBigUint64(4, 44n, true); zv.setUint16(12, 45, true); zv.setUint16(14, 45, true);
    zv.setBigUint64(24, BigInt(files.length), true); zv.setBigUint64(32, BigInt(files.length), true);
    zv.setBigUint64(40, BigInt(cdSize), true); zv.setBigUint64(48, BigInt(offset), true);
    const loc = new Uint8Array(20), lc = new DataView(loc.buffer);
    lc.setUint32(0, 0x07064b50, true); lc.setBigUint64(8, BigInt(offset + cdSize), true); lc.setUint32(16, 1, true);
    parts.push(z, loc);
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, need64 ? 0xffff : files.length, true); ev.setUint16(10, need64 ? 0xffff : files.length, true);
  ev.setUint32(12, need64 ? 0xffffffff : cdSize, true); ev.setUint32(16, need64 ? 0xffffffff : offset, true);
  parts.push(end);
  return new Blob(parts, { type: "application/zip" });
}
