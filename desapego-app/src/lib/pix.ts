// Pix "copia e cola" (BR Code estático) conforme o Manual de Padrões para Iniciação do Pix (Banco Central).
// Gera o texto; o QR Code é só a imagem desse mesmo texto.

function field(id: string, value: string): string {
  const len = value.length;
  if (len > 99) throw new Error(`Campo ${id} muito longo`);
  return id + String(len).padStart(2, "0") + value;
}

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Remove acentos e caracteres fora do padrão aceito pelos bancos. */
export function pixText(s: string, max: number): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .\-@]/g, "")
    .trim()
    .slice(0, max);
}

export function normalizePixKey(key: string): string {
  const k = key.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k)) return k.toLowerCase();             // e-mail
  if (/^\+\d{12,13}$/.test(k.replace(/[\s()-]/g, ""))) return k.replace(/[\s()-]/g, ""); // telefone +55...
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase(); // aleatória
  const digits = k.replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 14) return digits;               // CPF / CNPJ
  return k;
}

export interface PixInput {
  key: string;
  name: string;
  city: string;
  amountCents?: number;
  txid?: string;
  description?: string;
}

export function buildPixPayload(p: PixInput): string {
  const key = normalizePixKey(p.key);
  const name = pixText(p.name, 25);
  const city = pixText(p.city, 15);
  if (!key || !name || !city) throw new Error("Pix do administrador incompleto");
  const desc = p.description ? pixText(p.description, 40) : "";
  const mai = field("00", "br.gov.bcb.pix") + field("01", key) + (desc ? field("02", desc) : "");
  const txid = (p.txid ? p.txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) : "") || "***";
  let payload =
    field("00", "01") +
    field("26", mai) +
    field("52", "0000") +
    field("53", "986") +
    (p.amountCents && p.amountCents > 0 ? field("54", (p.amountCents / 100).toFixed(2)) : "") +
    field("58", "BR") +
    field("59", name) +
    field("60", city) +
    field("62", field("05", txid));
  payload += "6304";
  return payload + crc16(payload);
}

export function pixConfigured(s: { pix_key?: string; pix_receiver_name?: string; pix_city?: string }): boolean {
  return Boolean(s.pix_key && s.pix_receiver_name && s.pix_city);
}
