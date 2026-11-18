// Tudo o que o robô guarda fica no Cloudflare KV (não no GitHub):
// os telefones dos seus contatos não aparecem no repositório.
//
//   contatos          { "5543999998888": { nome, empresa, tags, optout, pausado, ... } }
//   agendamentos      [ { id, texto, para, quando, ativo, criado_em, ultimo_envio } ]
//   fila              [ { numero, texto } ]  mensagens esperando para sair
//   hist:<numero>     últimas falas da conversa (some sozinho em 30 dias)
//   robo:<id>         mensagens que o robô mandou (para não confundir com você)
//   dia:<AAAA-MM-DD>  quantos disparos saíram no dia
//   msg:<id>          mensagens já processadas (o webhook às vezes repete)
import { normalizarNumero } from "./util.js";

const DIA_S = 24 * 60 * 60;
const MAX_HISTORICO = 24;

export class Dados {
  constructor(kv) {
    this.kv = kv;
  }

  async #json(chave, padrao) {
    const v = await this.kv.get(chave, "json");
    return v ?? padrao;
  }

  // ---- contatos ----
  async contatos() {
    return this.#json("contatos", {});
  }

  async salvarContatos(c) {
    await this.kv.put("contatos", JSON.stringify(c));
  }

  async contato(numero) {
    return (await this.contatos())[normalizarNumero(numero)] ?? null;
  }

  async atualizarContato(numero, mudancas) {
    const n = normalizarNumero(numero);
    if (!n) throw new Error("número inválido");
    const todos = await this.contatos();
    const atual = todos[n] ?? { tags: [], criado_em: Date.now() };
    todos[n] = { ...atual, ...mudancas };
    await this.salvarContatos(todos);
    return todos[n];
  }

  async removerContato(numero) {
    const n = normalizarNumero(numero);
    const todos = await this.contatos();
    if (!todos[n]) return false;
    delete todos[n];
    await this.salvarContatos(todos);
    return true;
  }

  // Quem recebe um disparo: "todos", uma etiqueta ou uma lista de números.
  // Nunca inclui quem pediu para sair.
  async destinatarios(para) {
    const todos = await this.contatos();
    const ativos = Object.entries(todos).filter(([, c]) => !c.optout);
    if (para?.tipo === "todos") return ativos.map(([n, c]) => ({ numero: n, ...c }));
    if (para?.tipo === "etiqueta") {
      const tag = String(para.valor ?? "").toLowerCase();
      return ativos
        .filter(([, c]) => (c.tags ?? []).some((t) => t.toLowerCase() === tag))
        .map(([n, c]) => ({ numero: n, ...c }));
    }
    if (para?.tipo === "numeros") {
      const pedidos = new Set((para.valor ?? []).map(normalizarNumero));
      return ativos.filter(([n]) => pedidos.has(n)).map(([n, c]) => ({ numero: n, ...c }));
    }
    return [];
  }

  // ---- agendamentos ----
  async agendamentos() {
    return this.#json("agendamentos", []);
  }

  async salvarAgendamentos(lista) {
    await this.kv.put("agendamentos", JSON.stringify(lista));
  }

  // ---- fila de envio ----
  async fila() {
    return this.#json("fila", []);
  }

  async salvarFila(f) {
    await this.kv.put("fila", JSON.stringify(f));
  }

  async enfileirar(itens) {
    const f = await this.fila();
    f.push(...itens);
    await this.salvarFila(f);
    return f.length;
  }

  // ---- conversa ----
  async historico(numero) {
    return this.#json(`hist:${normalizarNumero(numero)}`, []);
  }

  async anotar(numero, role, texto) {
    const n = normalizarNumero(numero);
    const h = await this.historico(n);
    h.push({ role, content: texto, em: Date.now() });
    await this.kv.put(`hist:${n}`, JSON.stringify(h.slice(-MAX_HISTORICO)), { expirationTtl: 30 * DIA_S });
  }

  // Mensagens que o próprio robô mandou. O WhatsApp devolve uma cópia de tudo
  // que sai do seu número; assim dá para separar o que foi o robô do que foi você.
  async marcarDoRobo(idMensagem) {
    if (idMensagem) await this.kv.put(`robo:${idMensagem}`, "1", { expirationTtl: 2 * DIA_S });
  }

  async foiDoRobo(idMensagem) {
    return Boolean(idMensagem && (await this.kv.get(`robo:${idMensagem}`)));
  }

  // Quantos disparos já saíram hoje (limite diário contra bloqueio).
  async enviadosNoDia(dia) {
    return Number(await this.kv.get(`dia:${dia}`)) || 0;
  }

  async somarEnviados(dia, n) {
    const atual = await this.enviadosNoDia(dia);
    await this.kv.put(`dia:${dia}`, String(atual + n), { expirationTtl: 3 * DIA_S });
  }

  // Conversa com o dono no "Conversar comigo": depois da 1ª mensagem com
  // "robô", as seguintes não precisam da palavra por alguns minutos.
  async donoConversando(agora) {
    const t = Number(await this.kv.get("dono:ativo"));
    return t > 0 && agora - t < 10 * 60 * 1000;
  }

  async marcarDonoConversando(agora) {
    await this.kv.put("dono:ativo", String(agora), { expirationTtl: DIA_S });
  }

  async jaProcessada(idMensagem) {
    if (!idMensagem) return false;
    const chave = `msg:${idMensagem}`;
    if (await this.kv.get(chave)) return true;
    await this.kv.put(chave, "1", { expirationTtl: 2 * DIA_S });
    return false;
  }
}
