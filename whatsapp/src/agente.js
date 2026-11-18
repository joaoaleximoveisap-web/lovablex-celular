// O cérebro: Claude com ferramentas.
//
// Dois modos, dependendo de quem escreve para o número do robô:
//   • você (DONO_NUMERO): o robô é o seu assistente. Você pede em português normal
//     ("toda segunda 9h manda pras imobiliárias o resumo do radar") e ele cadastra
//     contatos, agenda e dispara mensagens.
//   • os seus contatos (imobiliárias, corretores): o robô responde em seu nome,
//     tira dúvidas e te avisa quando precisa de você (reunião, negócio, problema).
import Anthropic from "@anthropic-ai/sdk";
import conhecimento from "../conhecimento.md";
import { validarQuando, descreverQuando, proximaOcorrencia } from "./agenda.js";
import { normalizarNumero, formatarBrasilia, idCurto, brasiliaParaMs } from "./util.js";

const MAX_VOLTAS = 6;

// ---------------------------------------------------------------- ferramentas

const PARA = {
  type: "object",
  description: "Quem recebe. tipo=todos (todos os contatos), etiqueta (contatos com aquela etiqueta) ou numeros (lista).",
  properties: {
    tipo: { type: "string", enum: ["todos", "etiqueta", "numeros"] },
    etiqueta: { type: "string", description: "quando tipo=etiqueta" },
    numeros: { type: "array", items: { type: "string" }, description: "quando tipo=numeros, com DDD" },
  },
  required: ["tipo"],
};

const QUANDO = {
  type: "object",
  description: "Horário de Brasília. uma_vez usa 'em' (AAAA-MM-DDTHH:MM). diario usa 'hora'. semanal usa 'dias' (seg, ter, qua, qui, sex, sab, dom) e 'hora'. mensal usa 'dia' (1-28) e 'hora'.",
  properties: {
    tipo: { type: "string", enum: ["uma_vez", "diario", "semanal", "mensal"] },
    em: { type: "string" },
    hora: { type: "string", description: "HH:MM" },
    dias: { type: "array", items: { type: "string" } },
    dia: { type: "integer" },
  },
  required: ["tipo"],
};

const RADAR = {
  name: "consultar_radar",
  description: "Dados do Radar Londrina (aluguel por temporada no Airbnb em Londrina): quantas unidades existem, quantas estão livres e o preço mediano da diária nas próximas datas e feriados.",
  input_schema: { type: "object", properties: {} },
};

export const FERRAMENTAS_DONO = [
  {
    name: "salvar_contato",
    description: "Cadastra ou atualiza um contato (imobiliária, corretor, cliente). Use etiquetas para agrupar, ex.: imobiliaria, corretor, vip.",
    input_schema: {
      type: "object",
      properties: {
        numero: { type: "string", description: "com DDD, ex.: 43 99999-8888" },
        nome: { type: "string", description: "como chamar a pessoa na mensagem" },
        empresa: { type: "string" },
        etiquetas: { type: "array", items: { type: "string" } },
      },
      required: ["numero", "nome"],
    },
  },
  {
    name: "listar_contatos",
    description: "Lista os contatos cadastrados (opcionalmente só de uma etiqueta).",
    input_schema: { type: "object", properties: { etiqueta: { type: "string" } } },
  },
  {
    name: "remover_contato",
    description: "Apaga um contato.",
    input_schema: { type: "object", properties: { numero: { type: "string" } }, required: ["numero"] },
  },
  {
    name: "agendar_mensagem",
    description: "Agenda uma mensagem para sair sozinha (uma vez ou repetindo). Use {nome} no texto para pôr o nome de cada contato. Escreva 'RESUMO_RADAR' no texto para incluir o resumo atualizado do Radar Londrina na hora do envio.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" }, para: PARA, quando: QUANDO },
      required: ["texto", "para", "quando"],
    },
  },
  {
    name: "enviar_agora",
    description: "Manda uma mensagem agora (sai em até 5 minutos). Use {nome} para personalizar.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" }, para: PARA },
      required: ["texto", "para"],
    },
  },
  {
    name: "listar_agendamentos",
    description: "Mostra os disparos agendados e quando sai o próximo de cada um.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um agendamento pelo id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "pausar_robo",
    description: "Faz o robô parar (pausado=true) ou voltar (pausado=false) a responder um contato. Use quando o dono for assumir a conversa pessoalmente.",
    input_schema: {
      type: "object",
      properties: { numero: { type: "string" }, pausado: { type: "boolean" } },
      required: ["numero", "pausado"],
    },
  },
  {
    name: "ver_conversa",
    description: "Mostra as últimas mensagens trocadas entre o robô e um contato.",
    input_schema: { type: "object", properties: { numero: { type: "string" } }, required: ["numero"] },
  },
  RADAR,
];

export const FERRAMENTAS_CONTATO = [
  {
    name: "avisar_dono",
    description: "Avisa o dono no WhatsApp pessoal dele. Use quando o contato quiser marcar reunião ou visita, falar de valores, fechar negócio, reclamar, ou pedir algo que você não sabe responder.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", enum: ["reuniao", "negocio", "duvida", "reclamacao", "outro"] },
        resumo: { type: "string", description: "o que o contato quer, em 1-3 frases, com dia/horário sugerido se for reunião" },
      },
      required: ["motivo", "resumo"],
    },
  },
  RADAR,
];

// ---------------------------------------------------------------- instruções

function instrucoes(env, modo) {
  const dono = env.NOME_DONO || "João";
  const comum = `Você conversa pelo WhatsApp. Escreva curto, natural, em português do Brasil, sem markdown (use *negrito* do WhatsApp com moderação). Nunca invente números, preços, imóveis ou compromissos.

SOBRE O NEGÓCIO (escrito pelo ${dono}):
${conhecimento}`;

  if (modo === "dono") {
    return `Você é o assistente pessoal de ${dono} no WhatsApp. ${dono} é assessor de imobiliárias e está falando com você agora.
Você cuida dos contatos dele, agenda e dispara mensagens e mostra conversas, usando as ferramentas.
- Antes de disparar para muita gente (todos, ou uma etiqueta), mostre o texto final e para quantos vai, e só envie depois que ele confirmar.
- Quando agendar, confirme em uma linha o que ficou agendado e quando sai o próximo envio.
- Mensagens para os contatos devem soar como o ${dono} escrevendo: cordiais, diretas, sem cara de robô.
${comum}`;
  }
  return `Você é o assistente de ${dono}, assessor de imobiliárias, e está respondendo no WhatsApp em nome dele. Quem fala com você é um contato dele (imobiliária, corretor ou cliente).
- Se perguntarem, diga com naturalidade que é o assistente virtual do ${dono}.
- Ajude com o que estiver no texto abaixo e nos dados do Radar. O que não souber, diga que vai passar para o ${dono}.
- Para marcar reunião: pergunte o assunto e dois horários que servem, use avisar_dono e diga que o ${dono} confirma em seguida. Você não confirma horário sozinho.
- Para valores, negociação, contrato ou reclamação: avise o ${dono} com avisar_dono.
- Se a pessoa não quiser mais receber mensagens, diga que basta responder SAIR.
${comum}`;
}

// ---------------------------------------------------------------- execução

export async function resumoRadar(env, fetcher = fetch) {
  const url = env.RADAR_URL;
  if (!url) return "Radar não configurado (falta RADAR_URL).";
  const r = await fetcher(url, { cf: { cacheTtl: 3600 } });
  if (!r.ok) return `Não consegui abrir o Radar agora (${r.status}).`;
  const d = await r.json();
  const hoje = new Date().toISOString().slice(0, 10);
  const proximas = (d.amostras ?? [])
    .filter((a) => a.checkin >= hoje)
    .sort((a, b) => a.checkin.localeCompare(b.checkin))
    .slice(0, 6)
    .map((a) => `${a.checkin.slice(8, 10)}/${a.checkin.slice(5, 7)}${a.rotulo ? ` (${a.rotulo})` : ""}: ${a.livres} livres, diária mediana R$ ${a.mediana}`);
  const zonas = (d.zonas ?? []).map((z) => `${z.nome} ${z.unidades}`).join(", ");
  return [
    `Radar Londrina — Airbnb, coleta de ${String(d.meta?.coleta ?? "").slice(0, 10)}`,
    `${(d.unidades ?? []).length} unidades anunciadas${zonas ? ` (por zona: ${zonas})` : ""}.`,
    "Próximas datas (2 noites):",
    ...proximas,
  ].join("\n");
}

function resolverPara(p) {
  if (p?.tipo === "etiqueta") return { tipo: "etiqueta", valor: p.etiqueta };
  if (p?.tipo === "numeros") return { tipo: "numeros", valor: (p.numeros ?? []).map(normalizarNumero) };
  return { tipo: "todos" };
}

function descreverPara(p) {
  if (p.tipo === "etiqueta") return `etiqueta "${p.valor}"`;
  if (p.tipo === "numeros") return p.valor.join(", ");
  return "todos os contatos";
}

export async function executarFerramenta(nome, entrada, ctx) {
  const { dados, env, agora } = ctx;
  switch (nome) {
    case "salvar_contato": {
      const n = normalizarNumero(entrada.numero);
      if (n.length < 12) return { erro: "número inválido: inclua o DDD" };
      const mud = { nome: entrada.nome };
      if (entrada.empresa) mud.empresa = entrada.empresa;
      if (entrada.etiquetas) mud.tags = entrada.etiquetas.map((t) => t.toLowerCase());
      const c = await dados.atualizarContato(n, mud);
      return { ok: true, numero: n, contato: c };
    }
    case "listar_contatos": {
      const todos = await dados.contatos();
      const tag = entrada.etiqueta?.toLowerCase();
      const lista = Object.entries(todos)
        .filter(([, c]) => !tag || (c.tags ?? []).includes(tag))
        .map(([n, c]) => `${c.nome ?? "?"}${c.empresa ? ` (${c.empresa})` : ""} — ${n}${c.tags?.length ? ` [${c.tags.join(", ")}]` : ""}${c.optout ? " — SAIU" : ""}${c.pausado ? " — robô pausado" : ""}`);
      return { total: lista.length, contatos: lista };
    }
    case "remover_contato":
      return { ok: await dados.removerContato(entrada.numero) };
    case "agendar_mensagem": {
      const erro = validarQuando(entrada.quando);
      if (erro) return { erro };
      if (entrada.quando.tipo === "uma_vez" && brasiliaParaMs(entrada.quando.em) <= agora) {
        return { erro: "esse horário já passou; para mandar já, use enviar_agora" };
      }
      const para = resolverPara(entrada.para);
      const quantos = (await dados.destinatarios(para)).length;
      if (quantos === 0) return { erro: `nenhum contato em ${descreverPara(para)}` };
      const ag = { id: idCurto(), texto: entrada.texto, para, quando: entrada.quando, ativo: true, criado_em: agora };
      const lista = await dados.agendamentos();
      lista.push(ag);
      await dados.salvarAgendamentos(lista);
      const prox = proximaOcorrencia(ag.quando, agora);
      return { ok: true, id: ag.id, quando: descreverQuando(ag.quando), proximo_envio: prox ? formatarBrasilia(prox) : null, destinatarios: quantos };
    }
    case "enviar_agora": {
      const para = resolverPara(entrada.para);
      const quem = await dados.destinatarios(para);
      if (quem.length === 0) return { erro: `nenhum contato em ${descreverPara(para)} (ou todos pediram para sair)` };
      await dados.enfileirar(quem.map((c) => ({ numero: c.numero, texto: entrada.texto })));
      return { ok: true, na_fila: quem.length, observacao: "sai em até 5 minutos" };
    }
    case "listar_agendamentos": {
      const lista = (await dados.agendamentos()).filter((a) => a.ativo !== false);
      return {
        agendamentos: lista.map((a) => {
          const prox = proximaOcorrencia(a.quando, agora);
          return `#${a.id} — ${descreverQuando(a.quando)} — para ${descreverPara(a.para)} — próximo: ${prox ? formatarBrasilia(prox) : "nenhum"} — "${a.texto.slice(0, 80)}"`;
        }),
      };
    }
    case "cancelar_agendamento": {
      const id = String(entrada.id).replace(/^#/, "");
      const lista = await dados.agendamentos();
      const resto = lista.filter((a) => a.id !== id);
      if (resto.length === lista.length) return { erro: `não achei o agendamento #${id}` };
      await dados.salvarAgendamentos(resto);
      return { ok: true };
    }
    case "pausar_robo": {
      const c = await dados.contato(entrada.numero);
      if (!c) return { erro: "contato não cadastrado" };
      await dados.atualizarContato(entrada.numero, { pausado: entrada.pausado });
      return { ok: true };
    }
    case "ver_conversa": {
      const h = await dados.historico(entrada.numero);
      if (!h.length) return { conversa: "sem mensagens nos últimos 30 dias" };
      return { conversa: h.map((m) => `${m.role === "user" ? "contato" : "robô"}: ${m.content}`).join("\n") };
    }
    case "consultar_radar":
      return { radar: await resumoRadar(env, ctx.fetcher) };
    case "avisar_dono": {
      const c = ctx.contato ?? {};
      const quem = `${c.nome ?? ctx.nomePerfil ?? "Contato"}${c.empresa ? ` (${c.empresa})` : ""}`;
      await ctx.avisarDono(`[${entrada.motivo}] ${quem} — wa.me/${ctx.numero}: ${entrada.resumo}`);
      return { ok: true };
    }
    default:
      return { erro: `ferramenta desconhecida: ${nome}` };
  }
}

// O histórico guardado pode começar com um disparo (fala do robô) ou ter duas
// falas seguidas do mesmo lado. A API quer começar pelo usuário e alternar.
export function montarHistorico(historico, texto) {
  const lista = [...historico.map((m) => ({ role: m.role, content: String(m.content) })), { role: "user", content: texto }];
  if (lista[0].role !== "user") lista.unshift({ role: "user", content: "(início da conversa)" });
  const saida = [];
  for (const m of lista) {
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.role === m.role) ultima.content += "\n\n" + m.content;
    else saida.push({ ...m });
  }
  return saida;
}

// Uma rodada de conversa: recebe o texto, devolve a resposta final.
export async function responder({ env, modo, historico, texto, ctx, cliente }) {
  const anthropic = cliente ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const ferramentas = modo === "dono" ? FERRAMENTAS_DONO : FERRAMENTAS_CONTATO;
  const sistema = instrucoes(env, modo);

  const mensagens = montarHistorico(historico, texto);
  // A hora certa vai numa mensagem de sistema no fim, para não estragar o cache
  // do começo da conversa.
  mensagens.push({ role: "system", content: `Agora em Brasília: ${formatarBrasilia(ctx.agora)}.` });

  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const r = await anthropic.beta.messages.create({
      model: env.MODELO || "claude-opus-5-5",
      max_tokens: 8000,
      system: sistema,
      tools: ferramentas,
      messages: mensagens,
      output_config: { effort: env.ESFORCO || "low" },
      cache_control: { type: "ephemeral" },
      // se o modelo recusar algo por engano, a própria API tenta de novo em outro modelo
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (r.stop_reason === "refusal") {
      return { texto: null, recusou: true };
    }

    mensagens.push({ role: "assistant", content: r.content });

    if (r.stop_reason === "pause_turn") continue;

    const usos = r.content.filter((b) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || usos.length === 0) {
      const final = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { texto: final || null };
    }

    const resultados = [];
    for (const uso of usos) {
      let saida;
      let erro = false;
      try {
        saida = await executarFerramenta(uso.name, uso.input ?? {}, ctx);
        erro = Boolean(saida?.erro);
      } catch (e) {
        saida = { erro: String(e?.message ?? e) };
        erro = true;
      }
      resultados.push({ type: "tool_result", tool_use_id: uso.id, content: JSON.stringify(saida), is_error: erro });
    }
    mensagens.push({ role: "user", content: resultados });
  }
  return { texto: "Desculpe, me enrolei aqui. Pode repetir de outro jeito?" };
}
