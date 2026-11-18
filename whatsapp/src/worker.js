// Ponto de entrada no Cloudflare Workers.
//   POST /evolution/<WEBHOOK_SEGREDO>  → o Evolution avisa que chegou (ou saiu) mensagem
//   GET  /                            → página simples dizendo se está tudo configurado
//   a cada 5 min                      → solta os disparos agendados, aos poucos
//
// O robô usa o SEU número. Por isso ele é cuidadoso:
//   • só responde contatos que você cadastrou (família e amigos, nunca);
//   • se você mesmo responde alguém, ele fica quieto com aquela pessoa por algumas horas;
//   • fala com você no "Conversar comigo" quando a mensagem começa com "robô";
//   • dispara devagar, só de dia e com limite diário, para o número não ser bloqueado.
import { Dados } from "./dados.js";
import { Evolution, extrairEventos } from "./evolution.js";
import { responder, resumoRadar } from "./agente.js";
import { agendamentosDevidos } from "./agenda.js";
import { normalizarNumero, partesBrasilia } from "./util.js";

const PALAVRAS_SAIR = new Set(["sair", "parar", "pare", "stop", "descadastrar", "remover"]);
const NECESSARIOS = ["ANTHROPIC_API_KEY", "EVOLUTION_URL", "EVOLUTION_API_KEY", "WEBHOOK_SEGREDO", "DONO_NUMERO"];
const MARCA = "🤖";
// Caractere invisível no fim de tudo que o robô manda: quando a cópia volta,
// dá para saber na hora que foi ele (e não você) sem depender do banco.
export const ASSINATURA = "\u2063";
const PREFIXO_DONO = /^\s*rob[oô](?=[\s,.:!?-]|$)[\s,.:!-]*/i;

function limpo(texto) {
  return String(texto ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!]+$/, "");
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const sorteio = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export function criarServicos(env, extras = {}) {
  const dados = new Dados(env.DADOS);
  const wa = extras.whatsapp ?? new Evolution(env, extras.fetcher);
  const eu = normalizarNumero(env.DONO_NUMERO);
  // manda e anota que foi o robô (para a cópia que volta não parecer você)
  const enviar = async (para, texto, digitando = 0) => {
    const r = await wa.texto(para, texto + ASSINATURA, digitando);
    await dados.marcarDoRobo(r?.id);
    return r;
  };
  // recados para você vão no "Conversar comigo"
  const avisarDono = (texto) => enviar(eu, `${MARCA} 🔔 ${texto}`);
  return { dados, wa, eu, enviar, avisarDono };
}

export async function processarEvento(env, ev, extras = {}) {
  if (ev.grupo) return;
  const s = criarServicos(env, extras);
  const { dados, eu } = s;
  if (await dados.jaProcessada(ev.id)) return;
  const agora = extras.agora ?? Date.now();

  if (ev.deMim) return tratarMinha(env, ev, s, agora, extras);

  // ---- mensagem que chegou de alguém ----
  let numero = ev.numero;
  let contato = numero ? await dados.contato(numero) : null;
  if (!contato) {
    // às vezes o WhatsApp esconde o telefone (…@lid): procura pelo jid já visto
    const achado = Object.entries(await dados.contatos()).find(([, c]) => c.wa_id === ev.jid);
    if (achado) [numero, contato] = [achado[0], achado[1]];
  }
  if (!contato || numero === eu) return; // não cadastrado: vida pessoal, o robô não mexe
  if (contato.wa_id !== ev.jid) contato = await dados.atualizarContato(numero, { wa_id: ev.jid });
  if (!ev.texto) return; // áudio, foto…: você vê no celular

  const comando = limpo(ev.texto);
  if (PALAVRAS_SAIR.has(comando)) {
    await dados.atualizarContato(numero, { optout: true });
    await s.enviar(ev.jid, "Pronto, você não vai mais receber as mensagens automáticas. Se mudar de ideia, é só responder VOLTAR.");
    return;
  }
  if (comando === "voltar" && contato.optout) {
    await dados.atualizarContato(numero, { optout: false });
    await s.enviar(ev.jid, "Combinado, você voltou a receber as mensagens. 😊");
    return;
  }

  const pausado = contato.pausado || (contato.pausado_ate ?? 0) > agora;
  if (pausado || env.AUTO_RESPOSTA === "nao") {
    await dados.anotar(numero, "user", ev.texto);
    return;
  }

  const historico = await dados.historico(numero);
  const ctx = {
    dados, env, agora, numero, contato, nomePerfil: ev.nomePerfil, fetcher: extras.fetcher,
    avisarDono: (t) => s.avisarDono(t),
  };
  const r = await responder({ env, modo: "contato", historico, texto: ev.texto, ctx, cliente: extras.cliente });
  await dados.anotar(numero, "user", ev.texto);
  if (r.recusou || !r.texto) {
    await s.avisarDono(`Não respondi ${contato.nome || numero} (wa.me/${numero}). Responda você: "${ev.texto.slice(0, 300)}"`);
    return;
  }
  await s.enviar(ev.jid, r.texto, sorteio(1500, 4000));
  await dados.anotar(numero, "assistant", r.texto);
}

// Mensagem que saiu do seu número: foi o robô, foi você falando com o robô,
// ou foi você respondendo um contato pessoalmente.
async function tratarMinha(env, ev, s, agora, extras) {
  const { dados, eu } = s;
  if (!ev.texto || ev.texto.startsWith(MARCA) || ev.texto.endsWith(ASSINATURA)) return;
  // a cópia do que o robô mandou pode chegar antes de ele anotar: espera um pouco
  await esperar(extras.espera ?? 4000);
  if (await dados.foiDoRobo(ev.id)) return;

  const conversaComigo = ev.numero === eu || (ev.eu && ev.numero === ev.eu);
  if (conversaComigo) {
    const temPrefixo = PREFIXO_DONO.test(ev.texto);
    if (!temPrefixo && !(await dados.donoConversando(agora))) return; // é só uma anotação sua
    await dados.marcarDonoConversando(agora);
    const texto = ev.texto.replace(PREFIXO_DONO, "").trim() || "oi";
    const historico = await dados.historico("eu");
    const ctx = { dados, env, agora, numero: eu, contato: null, fetcher: extras.fetcher, avisarDono: (t) => s.avisarDono(t) };
    const r = await responder({ env, modo: "dono", historico, texto, ctx, cliente: extras.cliente });
    const resposta = r.texto || "Não consegui fazer isso. Pode pedir de outro jeito?";
    await dados.anotar("eu", "user", texto);
    await dados.anotar("eu", "assistant", resposta);
    await s.enviar(ev.jid, `${MARCA} ${resposta}`);
    return;
  }

  // você respondeu um contato: o robô sai de cena por um tempo
  const contato = ev.numero ? await dados.contato(ev.numero) : null;
  if (!contato) return;
  const horas = Number(env.PAUSA_HORAS || 12);
  await dados.atualizarContato(ev.numero, { pausado_ate: agora + horas * 3600_000 });
  await dados.anotar(ev.numero, "assistant", `(${env.NOME_DONO || "João"}) ${ev.texto}`);
}

// Roda a cada 5 minutos: agendamentos vencidos entram na fila; a fila sai devagar.
export async function rodarAgenda(env, extras = {}) {
  const s = criarServicos(env, extras);
  const { dados } = s;
  const agora = extras.agora ?? Date.now();
  const dormir = extras.dormir ?? esperar;

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

  // só em horário comercial, poucas por vez e com limite por dia
  const p = partesBrasilia(agora);
  const inicio = Number(env.HORA_INICIO ?? 8);
  const fim = Number(env.HORA_FIM ?? 20);
  if (p.hora < inicio || p.hora >= fim) return { enviados: 0, restantes: fila.length, motivo: "fora do horário" };
  const dia = `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
  const sobra = Number(env.LIMITE_DIA || 80) - (await dados.enviadosNoDia(dia));
  if (sobra <= 0) return { enviados: 0, restantes: fila.length, motivo: "limite do dia" };

  const lote = fila.slice(0, Math.min(Number(env.LOTE || 4), sobra));
  // tira da fila antes de mandar: se der pane no meio, ninguém recebe em dobro
  await dados.salvarFila(fila.slice(lote.length));

  const contatos = await dados.contatos();
  const falhas = [];
  let enviados = 0;
  for (const item of lote) {
    const c = contatos[item.numero];
    if (!c || c.optout) continue;
    const primeiroNome = (c.nome ?? "").split(" ")[0];
    const texto = item.texto.replaceAll("{nome}", primeiroNome || "tudo bem");
    try {
      if (enviados > 0) await dormir(sorteio(8000, 20000)); // intervalo de gente, não de máquina
      await s.enviar(c.wa_id || item.numero, texto, sorteio(2000, 5000));
      await dados.anotar(item.numero, "assistant", texto);
      enviados++;
    } catch (e) {
      falhas.push(`${c.nome || item.numero}: ${e.message}`);
    }
  }
  if (enviados) await dados.somarEnviados(dia, enviados);
  if (falhas.length) {
    await s.avisarDono(`${falhas.length} mensagem(ns) não saíram: ${falhas.slice(0, 5).join(" | ")}`).catch(() => {});
  }
  return { enviados, falhas: falhas.length, restantes: fila.length - lote.length };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const caminho = env.WEBHOOK_SEGREDO ? `/evolution/${env.WEBHOOK_SEGREDO}` : null;

    if (request.method === "POST" && caminho && (url.pathname === caminho || url.pathname.startsWith(caminho + "/"))) {
      let payload;
      try { payload = await request.json(); } catch { return new Response("json inválido", { status: 400 }); }
      for (const ev of extrairEventos(payload)) {
        ctx.waitUntil(processarEvento(env, ev).catch((e) => console.error("erro no evento", ev.jid, e)));
      }
      return new Response("ok");
    }

    if (url.pathname === "/") {
      const faltando = NECESSARIOS.filter((k) => !env[k]);
      const corpo = faltando.length
        ? `Robô do WhatsApp no ar, mas faltam os segredos: ${faltando.join(", ")}`
        : "Robô do WhatsApp no ar e configurado. O endereço do webhook está no resumo do GitHub Actions.";
      return new Response(corpo, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    return new Response("não encontrado", { status: 404 });
  },

  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(rodarAgenda(env).then((r) => console.log("agenda", JSON.stringify(r))).catch((e) => console.error("erro na agenda", e)));
  },
};
