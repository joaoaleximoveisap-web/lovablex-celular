// Conversa com o WhatsApp pelo Evolution API: um servidor que conecta no seu
// número lendo o QR code (como o WhatsApp Web) e repassa as mensagens para cá.
import { normalizarNumero } from "./util.js";

export class Evolution {
  constructor(env, fetcher = fetch) {
    this.base = String(env.EVOLUTION_URL ?? "").replace(/\/+$/, "");
    this.chave = env.EVOLUTION_API_KEY;
    this.instancia = env.EVOLUTION_INSTANCIA || "joao";
    this.fetch = fetcher;
  }

  // `para` pode ser um número (5543999998888) ou um jid (…@s.whatsapp.net, …@lid).
  // `digitando` mostra "digitando…" por alguns segundos antes de enviar (parece gente).
  async texto(para, corpo, digitando = 0) {
    const r = await this.fetch(`${this.base}/message/sendText/${encodeURIComponent(this.instancia)}`, {
      method: "POST",
      headers: { apikey: this.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ number: para, text: String(corpo).slice(0, 4096), ...(digitando ? { delay: digitando } : {}) }),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = dados?.response?.message ?? dados?.message ?? dados?.error;
      throw new Error(`Evolution respondeu ${r.status}${msg ? `: ${JSON.stringify(msg).slice(0, 200)}` : ""}`);
    }
    return { id: dados?.key?.id ?? null };
  }
}

function textoDa(m) {
  return m?.conversation
    ?? m?.extendedTextMessage?.text
    ?? m?.ephemeralMessage?.message?.extendedTextMessage?.text
    ?? m?.ephemeralMessage?.message?.conversation
    ?? m?.buttonsResponseMessage?.selectedDisplayText
    ?? m?.listResponseMessage?.title
    ?? null;
}

// De qual telefone é um jid. Contatos novos às vezes vêm como "…@lid" (um id
// interno do WhatsApp); aí o telefone de verdade vem num campo "Alt".
function telefoneDo(key) {
  for (const jid of [key?.remoteJid, key?.remoteJidAlt, key?.senderPn]) {
    if (typeof jid === "string" && jid.endsWith("@s.whatsapp.net")) return normalizarNumero(jid.split("@")[0]);
  }
  return null;
}

// Tira do webhook do Evolution só as mensagens novas.
export function extrairEventos(payload) {
  const evento = String(payload?.event ?? "").toLowerCase().replace(/_/g, ".");
  if (evento !== "messages.upsert") return [];
  const lista = Array.isArray(payload.data) ? payload.data : [payload.data];
  const eu = typeof payload.sender === "string" ? normalizarNumero(payload.sender.split("@")[0]) : null;
  const saida = [];
  for (const d of lista) {
    const key = d?.key;
    if (!key?.remoteJid) continue;
    const jid = key.remoteJid;
    const ignorar = jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
    saida.push({
      id: key.id,
      jid,
      numero: telefoneDo(key),
      eu,
      deMim: Boolean(key.fromMe),
      grupo: ignorar,
      nomePerfil: d.pushName ?? null,
      tipo: d.messageType ?? Object.keys(d.message ?? {})[0] ?? "?",
      texto: textoDa(d.message),
    });
  }
  return saida;
}
