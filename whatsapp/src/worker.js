// Ponto de entrada no Cloudflare Workers.
//   GET  /webhook  → a Meta confirma que o endereço é seu (uma vez, na configuração)
//   POST /webhook  → chegou mensagem no WhatsApp
//   GET  /         → página simples dizendo se está tudo configurado
//   a cada 5 min   → solta os disparos agendados e a fila de envio
import { Dados } from "./dados.js";
import { WhatsApp, assinaturaValida, extrairMensagens } from "./whatsapp.js";
import { responder, resumoRadar } from "./agente.js";
import { agendamentosDevidos } from "./agenda.js";
import { normalizarNumero, mesmoNumero } from "./util.js";

// No plano grátis da Cloudflare cada execução pode fazer ~50 chamadas externas.
const LOTE_POR_EXECUCAO = 40;
const PALAVRAS_SAIR = new Set(["sair", "parar", "pare", "stop", "descadastrar", "remover"]);
const NECESSARIOS = ["ANTHROPIC_API_KEY", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "DONO_NUMERO"];

function limpo(texto) {
  return String(texto ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!]+$/, "");
}

export function criarServicos(env, extras = {}) {
  const dados = new Dados(env.DADOS);
  const wa = extras.whatsapp ?? new WhatsApp(env, extras.fetcher);
  const avisarDono = async (texto) => {
    const aberta = await dados.janelaAberta(env.DONO_NUMERO);
    await wa.mensagem(normalizarNumero(env.DONO_NUMERO), env.NOME_DONO || "João", `🔔 ${texto}`, aberta);
  };
  return { dados, wa, avisarDono };
}

export async function processarMensagem(env, msg, extras = {}) {
  const { dados, wa, avisarDono } = criarServicos(env, extras);
  if (await dados.jaProcessada(msg.id)) return;

  const numero = normalizarNumero(msg.de);
  const agora = extras.agora ?? Date.now();
  await dados.marcarEntrada(numero);
  await wa.marcarLida(msg.id);

  const ehDono = mesmoNumero(numero, env.DONO_NUMERO);

  if (!msg.texto) {
    await wa.texto(msg.de, "Por enquanto eu só consigo ler mensagens de texto. Pode escrever, por favor? 🙂");
    if (!ehDono) await avisarDono(`${msg.nomePerfil ?? numero} (wa.me/${numero}) mandou um(a) ${msg.tipo} que eu não consigo abrir.`);
    return;
  }

  let contato = null;
  if (!ehDono) {
    contato = await dados.contato(numero);
    if (!contato) {
      contato = await dados.atualizarContato(numero, { nome: msg.nomePerfil ?? "", tags: ["novo"], wa_id: msg.de });
      await avisarDono(`Contato novo: ${msg.nomePerfil ?? "sem nome"} — wa.me/${numero} — "${msg.texto.slice(0, 200)}"`);
    } else if (contato.wa_id !== msg.de) {
      contato = await dados.atualizarContato(numero, { wa_id: msg.de });
    }

    const comando = limpo(msg.texto);
    if (PALAVRAS_SAIR.has(comando)) {
      await dados.atualizarContato(numero, { optout: true });
      await wa.texto(msg.de, "Pronto, você não vai mais receber mensagens automáticas. Se mudar de ideia, é só responder VOLTAR.");
      return;
    }
    if (comando === "voltar" && contato.optout) {
      await dados.atualizarContato(numero, { optout: false });
      await wa.texto(msg.de, "Combinado, você voltou a receber as mensagens. 😊");
      return;
    }
    if (contato.pausado) {
      await dados.anotar(numero, "user", msg.texto);
      await avisarDono(`${contato.nome || numero} escreveu (robô pausado para ele) — wa.me/${numero}: "${msg.texto.slice(0, 300)}"`);
      return;
    }
  }

  const historico = await dados.historico(numero);
  const ctx = { dados, env, agora, numero, contato, nomePerfil: msg.nomePerfil, avisarDono, fetcher: extras.fetcher };
  const r = await responder({ env, modo: ehDono ? "dono" : "contato", historico, texto: msg.texto, ctx, cliente: extras.cliente });

  await dados.anotar(numero, "user", msg.texto);
  if (r.recusou || !r.texto) {
    await wa.texto(msg.de, "Vou pedir para o responsável te responder sobre isso, tá bom?");
    if (!ehDono) await avisarDono(`Não consegui responder ${contato?.nome || numero} (wa.me/${numero}): "${msg.texto.slice(0, 300)}"`);
    return;
  }
  await wa.texto(msg.de, r.texto);
  await dados.anotar(numero, "assistant", r.texto);
}

// Roda a cada 5 minutos: agendamentos vencidos entram na fila; a fila sai em lotes.
export async function rodarAgenda(env, extras = {}) {
  const { dados, wa, avisarDono } = criarServicos(env, extras);
  const agora = extras.agora ?? Date.now();

  const lista = await dados.agendamentos();
  const devidos = agendamentosDevidos(lista, agora);
  if (devidos.length) {
    for (const { ag, ocorrencia } of devidos) {
      let texto = ag.texto;
      if (texto.includes("RESUMO_RADAR")) {
        const resumo = await resumoRadar(env, extras.fetcher).catch(() => "(Radar indisponível agora)");
        texto = texto.replaceAll("RESUMO_RADAR", resumo);
      }
      const quem = await dados.destinatarios(ag.para);
      await dados.enfileirar(quem.map((c) => ({ numero: c.numero, texto })));
      ag.ultimo_envio = ocorrencia;
      if (ag.quando.tipo === "uma_vez") ag.ativo = false;
    }
    await dados.salvarAgendamentos(lista.filter((a) => a.ativo !== false));
  }

  const fila = await dados.fila();
  if (!fila.length) return { enviados: 0, restantes: 0 };
  const lote = fila.slice(0, LOTE_POR_EXECUCAO);
  // tira da fila antes de mandar: se der pane no meio, ninguém recebe em dobro
  await dados.salvarFila(fila.slice(LOTE_POR_EXECUCAO));

  const contatos = await dados.contatos();
  const falhas = [];
  let enviados = 0;
  for (const item of lote) {
    const c = contatos[item.numero];
    if (!c || c.optout) continue;
    const primeiroNome = (c.nome ?? "").split(" ")[0];
    const texto = item.texto.replaceAll("{nome}", primeiroNome || "tudo bem");
    try {
      const aberta = await dados.janelaAberta(item.numero, agora);
      await wa.mensagem(c.wa_id || item.numero, primeiroNome, texto, aberta);
      await dados.anotar(item.numero, "assistant", texto);
      enviados++;
    } catch (e) {
      falhas.push(`${c.nome || item.numero}: ${e.message}`);
    }
  }
  if (falhas.length) {
    await avisarDono(`${falhas.length} mensagem(ns) não saíram: ${falhas.slice(0, 5).join(" | ")}`).catch(() => {});
  }
  return { enviados, falhas: falhas.length, restantes: fila.length - lote.length };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe"
        && env.WHATSAPP_VERIFY_TOKEN
        && url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("token errado", { status: 403 });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const bruto = await request.text();
      if (!(await assinaturaValida(env.WHATSAPP_APP_SECRET, bruto, request.headers.get("x-hub-signature-256")))) {
        return new Response("assinatura inválida", { status: 401 });
      }
      let payload;
      try { payload = JSON.parse(bruto); } catch { return new Response("json inválido", { status: 400 }); }
      // responde 200 na hora (senão a Meta reenvia) e trabalha em segundo plano
      for (const msg of extrairMensagens(payload)) {
        ctx.waitUntil(processarMensagem(env, msg).catch((e) => console.error("erro ao responder", msg.de, e)));
      }
      return new Response("ok");
    }

    if (url.pathname === "/") {
      const faltando = NECESSARIOS.filter((k) => !env[k]);
      const corpo = faltando.length
        ? `Robô do WhatsApp no ar, mas faltam os segredos: ${faltando.join(", ")}`
        : "Robô do WhatsApp no ar e configurado. Endereço do webhook: " + url.origin + "/webhook";
      return new Response(corpo, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    return new Response("não encontrado", { status: 404 });
  },

  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(rodarAgenda(env).then((r) => console.log("agenda", JSON.stringify(r))).catch((e) => console.error("erro na agenda", e)));
  },
};
