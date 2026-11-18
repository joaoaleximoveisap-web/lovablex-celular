// Conversa com a API oficial do WhatsApp (WhatsApp Cloud API, da Meta).
import { textoParaVariavel } from "./util.js";

// A Meta devolve este código quando a janela de 24h está fechada.
const FORA_DA_JANELA = 131047;

export class WhatsApp {
  constructor(env, fetcher = fetch) {
    this.token = env.WHATSAPP_TOKEN;
    this.phoneId = env.WHATSAPP_PHONE_ID;
    this.versao = env.GRAPH_VERSION || "v24.0";
    this.template = env.TEMPLATE_RECADO || "recado";
    this.idioma = env.TEMPLATE_IDIOMA || "pt_BR";
    this.fetch = fetcher;
  }

  async #enviar(corpo) {
    const r = await this.fetch(`https://graph.facebook.com/${this.versao}/${this.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(dados?.error?.message || `WhatsApp respondeu ${r.status}`);
      e.codigo = dados?.error?.code;
      e.status = r.status;
      throw e;
    }
    return dados;
  }

  texto(para, corpo) {
    return this.#enviar({ to: para, type: "text", text: { body: String(corpo).slice(0, 4096), preview_url: true } });
  }

  // Template "recado":  Olá, {{1}}! {{2}}  (+ rodapé fixo que você escolher)
  recado(para, nome, corpo) {
    return this.#enviar({
      to: para,
      type: "template",
      template: {
        name: this.template,
        language: { code: this.idioma },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: textoParaVariavel(nome || "tudo bem") },
            { type: "text", text: textoParaVariavel(corpo) },
          ],
        }],
      },
    });
  }

  // Tenta texto livre; se a janela de 24h estiver fechada, manda pelo template.
  async mensagem(para, nome, corpo, janelaAberta) {
    if (janelaAberta) {
      try {
        return { via: "texto", ...(await this.texto(para, corpo)) };
      } catch (e) {
        if (e.codigo !== FORA_DA_JANELA) throw e;
      }
    }
    return { via: "template", ...(await this.recado(para, nome, corpo)) };
  }

  marcarLida(idMensagem) {
    return this.#enviar({ status: "read", message_id: idMensagem }).catch(() => {});
  }
}

// A Meta assina cada webhook com o "App Secret". Sem a assinatura certa,
// qualquer um poderia mandar mensagens falsas para o robô.
export async function assinaturaValida(segredo, corpoBruto, cabecalho) {
  if (!segredo || !cabecalho?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpoBruto));
  const hex = [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = cabecalho.slice(7).toLowerCase();
  if (recebido.length !== hex.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

// Tira do webhook só o que interessa: mensagens recebidas.
export function extrairMensagens(payload) {
  const saida = [];
  for (const entrada of payload?.entry ?? []) {
    for (const mudanca of entrada.changes ?? []) {
      const v = mudanca.value ?? {};
      const nomes = Object.fromEntries((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages ?? []) {
        let texto = null;
        if (m.type === "text") texto = m.text?.body;
        else if (m.type === "button") texto = m.button?.text;
        else if (m.type === "interactive") {
          texto = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
        }
        saida.push({ id: m.id, de: m.from, nomePerfil: nomes[m.from] ?? null, tipo: m.type, texto });
      }
    }
  }
  return saida;
}
