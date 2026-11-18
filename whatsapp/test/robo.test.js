import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarNumero, brasiliaParaMs, textoParaVariavel } from "../src/util.js";
import { agendamentosDevidos, proximaOcorrencia, validarQuando } from "../src/agenda.js";
import { assinaturaValida, extrairMensagens, WhatsApp } from "../src/whatsapp.js";
import { montarHistorico } from "../src/agente.js";
import { processarMensagem, rodarAgenda } from "../src/worker.js";

// ---------- dublês ----------
class KVFalso {
  constructor() { this.m = new Map(); }
  async get(k, tipo) { const v = this.m.get(k); return v == null ? null : tipo === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
}

class WhatsFalso {
  constructor() { this.enviadas = []; }
  async texto(para, corpo) { this.enviadas.push({ via: "texto", para, corpo }); }
  async recado(para, nome, corpo) { this.enviadas.push({ via: "template", para, nome, corpo }); }
  async mensagem(para, nome, corpo, aberta) { return aberta ? this.texto(para, corpo) : this.recado(para, nome, corpo); }
  async marcarLida() {}
}

// Claude de mentira: devolve as respostas da lista, uma por chamada.
function claudeFalso(respostas) {
  const chamadas = [];
  return {
    chamadas,
    beta: { messages: { create: async (p) => { chamadas.push(structuredClone(p)); return respostas.shift(); } } },
  };
}
const texto = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
const ferramenta = (name, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t" + Math.random(), name, input }] });

const DONO = "5543988887777";
function ambiente() {
  return { DADOS: new KVFalso(), DONO_NUMERO: "43 98888-7777", NOME_DONO: "João" };
}

// ---------- util ----------
test("normaliza números brasileiros", () => {
  assert.equal(normalizarNumero("(43) 99999-8888"), "5543999998888");
  assert.equal(normalizarNumero("554399998888"), "5543999998888"); // sem o 9
  assert.equal(normalizarNumero("+55 43 3333-4444"), "554333334444"); // fixo fica igual
});

test("variável de template não tem quebra de linha", () => {
  assert.equal(textoParaVariavel("linha 1\n\nlinha 2\t  fim"), "linha 1 — linha 2 fim");
});

// ---------- agenda ----------
test("semanal: dispara uma vez por ocorrência", () => {
  const criado = brasiliaParaMs("2026-11-16T08:00"); // segunda
  const ag = { id: "a", quando: { tipo: "semanal", dias: ["seg", "qua"], hora: "09:00" }, criado_em: criado };
  assert.equal(agendamentosDevidos([ag], brasiliaParaMs("2026-11-16T08:59")).length, 0);
  const d = agendamentosDevidos([ag], brasiliaParaMs("2026-11-16T09:04"));
  assert.equal(d.length, 1);
  ag.ultimo_envio = d[0].ocorrencia;
  assert.equal(agendamentosDevidos([ag], brasiliaParaMs("2026-11-16T09:10")).length, 0);
  assert.equal(agendamentosDevidos([ag], brasiliaParaMs("2026-11-17T09:10")).length, 0); // terça
  assert.equal(agendamentosDevidos([ag], brasiliaParaMs("2026-11-18T09:01")).length, 1); // quarta
});

test("não manda disparo muito atrasado", () => {
  const ag = { quando: { tipo: "diario", hora: "09:00" }, criado_em: 0 };
  assert.equal(agendamentosDevidos([ag], brasiliaParaMs("2026-11-18T16:00")).length, 0);
});

test("próxima ocorrência e validação", () => {
  const prox = proximaOcorrencia({ tipo: "mensal", dia: 5, hora: "10:00" }, brasiliaParaMs("2026-11-18T12:00"));
  assert.equal(prox, brasiliaParaMs("2026-12-05T10:00"));
  assert.match(validarQuando({ tipo: "semanal", dias: ["xyz"], hora: "09:00" }), /dia da semana/);
  assert.equal(validarQuando({ tipo: "diario", hora: "07:30" }), null);
});

// ---------- whatsapp ----------
test("assinatura da Meta", async () => {
  const corpo = '{"a":1}';
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("segredo"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await assinaturaValida("segredo", corpo, "sha256=" + sig), true);
  assert.equal(await assinaturaValida("outro", corpo, "sha256=" + sig), false);
  assert.equal(await assinaturaValida("segredo", corpo, null), false);
});

test("extrai mensagens do webhook", () => {
  const m = extrairMensagens({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "554399998888", profile: { name: "Ana" } }],
    messages: [{ id: "w1", from: "554399998888", type: "text", text: { body: "oi" } }],
    statuses: [{ id: "x" }],
  } }] }] });
  assert.deepEqual(m, [{ id: "w1", de: "554399998888", nomePerfil: "Ana", tipo: "text", texto: "oi" }]);
});

test("fora da janela de 24h cai no template", async () => {
  const pedidos = [];
  const fetcher = async (_url, init) => {
    const corpo = JSON.parse(init.body);
    pedidos.push(corpo);
    if (corpo.type === "text") return new Response(JSON.stringify({ error: { code: 131047, message: "janela" } }), { status: 400 });
    return new Response(JSON.stringify({ messages: [{ id: "ok" }] }));
  };
  const wa = new WhatsApp({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "1" }, fetcher);
  const r = await wa.mensagem("5543", "Ana", "linha1\nlinha2", true);
  assert.equal(r.via, "template");
  assert.equal(pedidos[1].template.name, "recado");
  assert.equal(pedidos[1].template.components[0].parameters[1].text, "linha1 — linha2");
});

// ---------- agente ----------
test("histórico começa pelo usuário e alterna", () => {
  const h = montarHistorico([{ role: "assistant", content: "disparo 1" }, { role: "assistant", content: "disparo 2" }], "oi");
  assert.deepEqual(h.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(h[1].content, /disparo 1\n\ndisparo 2/);
});

test("dono agenda um disparo semanal conversando", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  const agora = brasiliaParaMs("2026-11-18T13:00");
  const msg = (id, t) => ({ id, de: "554388887777", nomePerfil: "João", tipo: "text", texto: t });

  const c1 = claudeFalso([
    ferramenta("salvar_contato", { numero: "43 99999-1111", nome: "Carla Souza", empresa: "Imob Sol", etiquetas: ["Imobiliaria"] }),
    texto("Salvei a Carla."),
  ]);
  await processarMensagem(env, msg("m1", "salva a Carla da Imob Sol 43 99999-1111"), { whatsapp: wa, cliente: c1, agora });
  assert.equal(c1.chamadas[0].model, "claude-opus-5-5");
  assert.ok(c1.chamadas[0].system.includes("assistente pessoal de João"));
  assert.equal(c1.chamadas[0].messages.at(-1).role, "system");

  const c2 = claudeFalso([
    ferramenta("agendar_mensagem", {
      texto: "Oi {nome}! Resumo da semana: RESUMO_RADAR",
      para: { tipo: "etiqueta", etiqueta: "imobiliaria" },
      quando: { tipo: "semanal", dias: ["seg"], hora: "09:00" },
    }),
    texto("Agendado para segunda 9h."),
  ]);
  await processarMensagem(env, msg("m2", "toda segunda 9h manda o resumo do radar pras imobiliárias"), { whatsapp: wa, cliente: c2, agora });
  const resultado = JSON.parse(c2.chamadas[1].messages.at(-1).content[0].content);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.destinatarios, 1);
  assert.match(resultado.proximo_envio, /seg 23\/11\/2026 09:00/);
  assert.deepEqual(wa.enviadas.map((e) => e.corpo), ["Salvei a Carla.", "Agendado para segunda 9h."]);

  // segunda 9h02: o disparo sai pelo template (a Carla nunca escreveu)
  const radar = { meta: { coleta: "2026-11-23T07:00:00Z" }, unidades: [1, 2, 3], zonas: [], amostras: [{ checkin: "2099-12-24", rotulo: "Natal", livres: 200, mediana: 180 }] };
  const fetcher = async () => new Response(JSON.stringify(radar));
  const env2 = { ...env, RADAR_URL: "https://x/radar.json" };
  const wa2 = new WhatsFalso();
  const r = await rodarAgenda(env2, { whatsapp: wa2, fetcher, agora: brasiliaParaMs("2026-11-23T09:02") });
  assert.equal(r.enviados, 1);
  assert.equal(wa2.enviadas[0].via, "template");
  assert.equal(wa2.enviadas[0].nome, "Carla");
  assert.match(wa2.enviadas[0].corpo, /^Oi Carla! Resumo da semana: Radar Londrina/);
  assert.match(wa2.enviadas[0].corpo, /Natal\): 200 livres, diária mediana R\$ 180/);

  // rodar de novo não repete
  const r2 = await rodarAgenda(env2, { whatsapp: wa2, fetcher, agora: brasiliaParaMs("2026-11-23T09:07") });
  assert.equal(r2.enviados, 0);
});

test("contato pede reunião e o dono é avisado", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await env.DADOS.put("contatos", JSON.stringify({ "5543999991111": { nome: "Carla", empresa: "Imob Sol", tags: ["imobiliaria"] } }));
  const c = claudeFalso([
    ferramenta("avisar_dono", { motivo: "reuniao", resumo: "Quer reunião sobre captação, quinta 10h ou sexta 15h" }),
    texto("Anotei! O João confirma o horário com você em seguida."),
  ]);
  await processarMensagem(env, { id: "c1", de: "554399991111", texto: "quero marcar uma reunião", tipo: "text" }, { whatsapp: wa, cliente: c });
  assert.ok(c.chamadas[0].system.includes("respondendo no WhatsApp em nome dele"));
  const aviso = wa.enviadas.find((e) => e.para === DONO);
  assert.match(aviso.corpo, /\[reuniao\] Carla \(Imob Sol\) — wa.me\/5543999991111/);
  assert.equal(aviso.via, "template"); // o dono não escreveu nas últimas 24h
  assert.equal(wa.enviadas.at(-1).corpo, "Anotei! O João confirma o horário com você em seguida.");
});

test("SAIR tira o contato dos disparos", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await env.DADOS.put("contatos", JSON.stringify({ "5543999991111": { nome: "Carla", tags: ["imobiliaria"] } }));
  await processarMensagem(env, { id: "s1", de: "5543999991111", texto: "Sair", tipo: "text" }, { whatsapp: wa, cliente: claudeFalso([]) });
  const c = await env.DADOS.get("contatos", "json");
  assert.equal(c["5543999991111"].optout, true);
  await env.DADOS.put("fila", JSON.stringify([{ numero: "5543999991111", texto: "promo" }]));
  const r = await rodarAgenda(env, { whatsapp: wa, agora: Date.now() });
  assert.equal(r.enviados, 0);
});

test("contato desconhecido vira contato novo e avisa o dono", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await processarMensagem(env, { id: "n1", de: "554391234567", nomePerfil: "Pedro", texto: "olá", tipo: "text" }, { whatsapp: wa, cliente: claudeFalso([texto("Oi Pedro!")]) });
  const c = await env.DADOS.get("contatos", "json");
  assert.deepEqual(c["5543991234567"].tags, ["novo"]);
  assert.match(wa.enviadas[0].corpo, /Contato novo: Pedro/);
  assert.equal(wa.enviadas[1].corpo, "Oi Pedro!");
});

test("mensagem repetida da Meta é ignorada", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  const c = claudeFalso([texto("um"), texto("dois")]);
  const m = { id: "dup", de: "554388887777", texto: "oi", tipo: "text" };
  await processarMensagem(env, m, { whatsapp: wa, cliente: c });
  await processarMensagem(env, m, { whatsapp: wa, cliente: c });
  assert.equal(c.chamadas.length, 1);
});
