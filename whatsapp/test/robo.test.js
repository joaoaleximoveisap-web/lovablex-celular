import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarNumero, brasiliaParaMs } from "../src/util.js";
import { agendamentosDevidos, proximaOcorrencia, validarQuando } from "../src/agenda.js";
import { extrairEventos } from "../src/evolution.js";
import { montarHistorico } from "../src/agente.js";
import { processarEvento, rodarAgenda, ASSINATURA } from "../src/worker.js";

// ---------- dublês ----------
class KVFalso {
  constructor() { this.m = new Map(); }
  async get(k, tipo) { const v = this.m.get(k); return v == null ? null : tipo === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
}

class WhatsFalso {
  constructor() { this.enviadas = []; this.n = 0; }
  async texto(para, corpo, digitando) { this.enviadas.push({ para, corpo, digitando }); return { id: "robo" + ++this.n }; }
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
const rapido = { espera: 0, dormir: async () => {} };
function ambiente() {
  return { DADOS: new KVFalso(), DONO_NUMERO: "43 98888-7777", NOME_DONO: "João" };
}

// ---------- util ----------
test("normaliza números brasileiros", () => {
  assert.equal(normalizarNumero("(43) 99999-8888"), "5543999998888");
  assert.equal(normalizarNumero("554399998888"), "5543999998888"); // sem o 9
  assert.equal(normalizarNumero("+55 43 3333-4444"), "554333334444"); // fixo fica igual
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

// ---------- agente ----------
test("histórico começa pelo usuário e alterna", () => {
  const h = montarHistorico([{ role: "assistant", content: "disparo 1" }, { role: "assistant", content: "disparo 2" }], "oi");
  assert.deepEqual(h.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(h[1].content, /disparo 1\n\ndisparo 2/);
});

// ---------- evolution ----------
test("extrai mensagens do webhook do Evolution", () => {
  const ev = extrairEventos({
    event: "messages.upsert", sender: "5543988887777@s.whatsapp.net",
    data: { key: { id: "A1", remoteJid: "12345@lid", remoteJidAlt: "554399991111@s.whatsapp.net", fromMe: false }, pushName: "Carla", messageType: "extendedTextMessage", message: { extendedTextMessage: { text: "oi" } } },
  });
  assert.deepEqual(ev, [{ id: "A1", jid: "12345@lid", numero: "5543999991111", eu: "5543988887777", deMim: false, grupo: false, nomePerfil: "Carla", tipo: "extendedTextMessage", texto: "oi" }]);
  assert.equal(extrairEventos({ event: "connection.update", data: {} }).length, 0);
  assert.equal(extrairEventos({ event: "MESSAGES_UPSERT", data: { key: { id: "g", remoteJid: "1@g.us" }, message: { conversation: "x" } } })[0].grupo, true);
});

// ---------- fluxos ----------
const de = (id, numero, texto, extra = {}) => ({ id, jid: `${numero}@s.whatsapp.net`, numero: normalizarNumero(numero), deMim: false, grupo: false, texto, tipo: "conversation", ...extra });
const meu = (id, numeroConversa, texto) => de(id, numeroConversa, texto, { deMim: true });

test("dono fala com o robô no Conversar comigo e agenda um disparo", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  const agora = brasiliaParaMs("2026-11-18T13:00");

  // anotação comum para si mesmo: o robô não se mete
  const c0 = claudeFalso([]);
  await processarEvento(env, meu("n0", DONO, "comprar pão"), { whatsapp: wa, cliente: c0, agora, ...rapido });
  assert.equal(c0.chamadas.length, 0);

  const c1 = claudeFalso([
    ferramenta("salvar_contato", { numero: "43 99999-1111", nome: "Carla Souza", empresa: "Imob Sol", etiquetas: ["Imobiliaria"] }),
    texto("Salvei a Carla."),
  ]);
  await processarEvento(env, meu("m1", DONO, "Robô, salva a Carla da Imob Sol 43 99999-1111"), { whatsapp: wa, cliente: c1, agora, ...rapido });
  assert.equal(c1.chamadas[0].model, "claude-opus-5-5");
  assert.ok(c1.chamadas[0].system.includes("assistente pessoal de João"));
  assert.equal(c1.chamadas[0].messages[0].content, "salva a Carla da Imob Sol 43 99999-1111");
  assert.equal(c1.chamadas[0].messages.at(-1).role, "system");
  assert.equal(wa.enviadas[0].para, `${DONO}@s.whatsapp.net`);
  assert.equal(wa.enviadas[0].corpo, "🤖 Salvei a Carla." + ASSINATURA);

  // a cópia da resposta do robô volta como "minha": é ignorada
  const cEco = claudeFalso([]);
  await processarEvento(env, meu("eco1", DONO, "🤖 Salvei a Carla." + ASSINATURA), { whatsapp: wa, cliente: cEco, agora, ...rapido });
  assert.equal(cEco.chamadas.length, 0);

  // logo depois, sem "robô" no começo, ainda é com ele
  const c2 = claudeFalso([
    ferramenta("agendar_mensagem", {
      texto: "Oi {nome}! Resumo da semana: RESUMO_RADAR",
      para: { tipo: "etiqueta", etiqueta: "imobiliaria" },
      quando: { tipo: "semanal", dias: ["seg"], hora: "09:00" },
    }),
    texto("Agendado para segunda 9h."),
  ]);
  await processarEvento(env, meu("m2", DONO, "toda segunda 9h manda o resumo do radar pras imobiliárias"), { whatsapp: wa, cliente: c2, agora: agora + 60_000, ...rapido });
  const resultado = JSON.parse(c2.chamadas[1].messages.at(-1).content[0].content);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.destinatarios, 1);
  assert.match(resultado.proximo_envio, /seg 23\/11\/2026 09:00/);
  assert.equal(c2.chamadas[0].messages.filter((m) => m.role === "assistant").length, 1); // lembra da conversa

  // segunda 9h02: o disparo sai
  const radar = { meta: { coleta: "2026-11-23T07:00:00Z" }, unidades: [1, 2, 3], zonas: [], amostras: [{ checkin: "2099-12-24", rotulo: "Natal", livres: 200, mediana: 180 }] };
  const fetcher = async () => new Response(JSON.stringify(radar));
  const env2 = { ...env, RADAR_URL: "https://x/radar.json" };
  const wa2 = new WhatsFalso();
  const r = await rodarAgenda(env2, { whatsapp: wa2, fetcher, agora: brasiliaParaMs("2026-11-23T09:02"), ...rapido });
  assert.equal(r.enviados, 1);
  assert.equal(wa2.enviadas[0].para, "5543999991111");
  assert.match(wa2.enviadas[0].corpo, /^Oi Carla! Resumo da semana: Radar Londrina/);
  assert.match(wa2.enviadas[0].corpo, /Natal\): 200 livres, diária mediana R\$ 180/);
  assert.ok(wa2.enviadas[0].digitando >= 2000);

  const r2 = await rodarAgenda(env2, { whatsapp: wa2, fetcher, agora: brasiliaParaMs("2026-11-23T09:07"), ...rapido });
  assert.equal(r2.enviados, 0);
});

test("família e amigos (não cadastrados) não recebem resposta", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  const c = claudeFalso([]);
  await processarEvento(env, de("f1", "5543991234567", "oi filho, vem almoçar?"), { whatsapp: wa, cliente: c, ...rapido });
  assert.equal(c.chamadas.length, 0);
  assert.equal(wa.enviadas.length, 0);
  assert.deepEqual(await env.DADOS.get("contatos", "json"), null);
});

test("contato pede reunião: robô responde e deixa recado para o dono", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await env.DADOS.put("contatos", JSON.stringify({ "5543999991111": { nome: "Carla", empresa: "Imob Sol", tags: ["imobiliaria"] } }));
  const c = claudeFalso([
    ferramenta("avisar_dono", { motivo: "reuniao", resumo: "Quer reunião sobre captação, quinta 10h ou sexta 15h" }),
    texto("Anotei! O João confirma o horário com você em seguida."),
  ]);
  await processarEvento(env, de("c1", "554399991111", "quero marcar uma reunião"), { whatsapp: wa, cliente: c, ...rapido });
  assert.ok(c.chamadas[0].system.includes("WhatsApp do próprio João"));
  assert.equal(wa.enviadas[0].para, DONO);
  assert.match(wa.enviadas[0].corpo, /🔔 \[reuniao\] Carla \(Imob Sol\) — wa.me\/5543999991111/);
  assert.equal(wa.enviadas[1].para, "554399991111@s.whatsapp.net");
  assert.equal(wa.enviadas[1].corpo, "Anotei! O João confirma o horário com você em seguida." + ASSINATURA);
});

test("quando o dono responde pessoalmente, o robô fica quieto", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await env.DADOS.put("contatos", JSON.stringify({ "5543999991111": { nome: "Carla", tags: ["imobiliaria"] } }));
  const agora = Date.now();
  await processarEvento(env, meu("j1", "5543999991111", "Oi Carla, te ligo já"), { whatsapp: wa, cliente: claudeFalso([]), agora, ...rapido });
  const c = claudeFalso([]);
  await processarEvento(env, de("c2", "5543999991111", "ok, aguardo"), { whatsapp: wa, cliente: c, agora: agora + 3600_000, ...rapido });
  assert.equal(c.chamadas.length, 0);
  const h = await env.DADOS.get("hist:5543999991111", "json");
  assert.deepEqual(h.map((m) => m.content), ["(João) Oi Carla, te ligo já", "ok, aguardo"]);
  // 13 horas depois o robô volta
  const c3 = claudeFalso([texto("Oi Carla!")]);
  await processarEvento(env, de("c3", "5543999991111", "oi?"), { whatsapp: wa, cliente: c3, agora: agora + 13 * 3600_000, ...rapido });
  assert.equal(c3.chamadas.length, 1);
});

test("cópia de mensagem do robô para contato não pausa o robô", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await env.DADOS.put("contatos", JSON.stringify({ "5543999991111": { nome: "Carla", tags: [] } }));
  await processarEvento(env, meu("e1", "5543999991111", "Oi Carla!" + ASSINATURA), { whatsapp: wa, ...rapido });
  const c = (await env.DADOS.get("contatos", "json"))["5543999991111"];
  assert.equal(c.pausado_ate, undefined);
});

test("SAIR tira o contato dos disparos", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await env.DADOS.put("contatos", JSON.stringify({ "5543999991111": { nome: "Carla", tags: ["imobiliaria"] } }));
  await processarEvento(env, de("s1", "5543999991111", "Sair"), { whatsapp: wa, cliente: claudeFalso([]), ...rapido });
  assert.equal((await env.DADOS.get("contatos", "json"))["5543999991111"].optout, true);
  await env.DADOS.put("fila", JSON.stringify([{ numero: "5543999991111", texto: "promo" }]));
  const r = await rodarAgenda(env, { whatsapp: wa, agora: brasiliaParaMs("2026-11-18T10:00"), ...rapido });
  assert.equal(r.enviados, 0);
});

test("disparos: só de dia, poucos por vez e com limite diário", async () => {
  const env = { ...ambiente(), LOTE: "2", LIMITE_DIA: "3" };
  const wa = new WhatsFalso();
  const contatos = {};
  for (let i = 0; i < 5; i++) contatos[`55439999900${i}0`.slice(0, 13)] = { nome: `P${i}`, tags: [] };
  await env.DADOS.put("contatos", JSON.stringify(contatos));
  await env.DADOS.put("fila", JSON.stringify(Object.keys(contatos).map((numero) => ({ numero, texto: "oi {nome}" }))));
  assert.equal((await rodarAgenda(env, { whatsapp: wa, agora: brasiliaParaMs("2026-11-18T22:00"), ...rapido })).motivo, "fora do horário");
  assert.equal((await rodarAgenda(env, { whatsapp: wa, agora: brasiliaParaMs("2026-11-18T10:00"), ...rapido })).enviados, 2);
  assert.equal((await rodarAgenda(env, { whatsapp: wa, agora: brasiliaParaMs("2026-11-18T10:05"), ...rapido })).enviados, 1);
  assert.equal((await rodarAgenda(env, { whatsapp: wa, agora: brasiliaParaMs("2026-11-18T10:10"), ...rapido })).motivo, "limite do dia");
  assert.equal((await rodarAgenda(env, { whatsapp: wa, agora: brasiliaParaMs("2026-11-19T08:00"), ...rapido })).enviados, 2);
  assert.deepEqual(wa.enviadas.map((e) => e.corpo.replace(ASSINATURA, "")), ["oi P0", "oi P1", "oi P2", "oi P3", "oi P4"]);
});

test("mensagem repetida do webhook é ignorada", async () => {
  const env = ambiente();
  const wa = new WhatsFalso();
  await env.DADOS.put("contatos", JSON.stringify({ "5543999991111": { nome: "Carla", tags: [] } }));
  const c = claudeFalso([texto("um"), texto("dois")]);
  const m = de("dup", "5543999991111", "oi");
  await processarEvento(env, m, { whatsapp: wa, cliente: c, ...rapido });
  await processarEvento(env, m, { whatsapp: wa, cliente: c, ...rapido });
  assert.equal(c.chamadas.length, 1);
});
