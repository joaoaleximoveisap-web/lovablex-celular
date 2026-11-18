// Quando cada mensagem agendada deve sair.
//
// Formatos de "quando" (sempre no horário de Brasília):
//   { tipo: "uma_vez", em: "2026-11-20T09:00" }
//   { tipo: "diario",  hora: "08:30" }
//   { tipo: "semanal", dias: ["seg", "qui"], hora: "09:00" }
//   { tipo: "mensal",  dia: 5, hora: "10:00" }
import { brasiliaParaMs, partesBrasilia, diaDaSemana, formatarBrasilia, DIAS } from "./util.js";

const DIA_MS = 24 * 60 * 60 * 1000;
// Se o robô ficou fora do ar, não manda um disparo atrasado demais.
export const ATRASO_MAXIMO_MS = 6 * 60 * 60 * 1000;

function horaValida(h) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h ?? ""));
}

export function validarQuando(q) {
  if (!q || typeof q !== "object") return "faltou dizer quando";
  switch (q.tipo) {
    case "uma_vez":
      return Number.isNaN(brasiliaParaMs(q.em)) ? "data inválida (use AAAA-MM-DDTHH:MM)" : null;
    case "diario":
      return horaValida(q.hora) ? null : "hora inválida (use HH:MM)";
    case "semanal":
      if (!horaValida(q.hora)) return "hora inválida (use HH:MM)";
      if (!Array.isArray(q.dias) || q.dias.length === 0) return "faltaram os dias da semana";
      return q.dias.every((d) => diaDaSemana(d) >= 0) ? null : "dia da semana inválido (use seg, ter, qua…)";
    case "mensal":
      if (!horaValida(q.hora)) return "hora inválida (use HH:MM)";
      return Number.isInteger(q.dia) && q.dia >= 1 && q.dia <= 28 ? null : "dia do mês deve ser de 1 a 28";
    default:
      return "tipo deve ser uma_vez, diario, semanal ou mensal";
  }
}

// Horário (ms) daquele dia de Brasília, se o agendamento cai nele; senão null.
function candidatoNoDia(q, diaMs) {
  const p = partesBrasilia(diaMs);
  const z = (n) => String(n).padStart(2, "0");
  const base = `${p.ano}-${z(p.mes)}-${z(p.dia)}T${q.hora}`;
  if (q.tipo === "diario") return brasiliaParaMs(base);
  if (q.tipo === "semanal") {
    const dias = q.dias.map(diaDaSemana);
    return dias.includes(p.semana) ? brasiliaParaMs(base) : null;
  }
  if (q.tipo === "mensal") return p.dia === q.dia ? brasiliaParaMs(base) : null;
  return null;
}

export function ultimaOcorrencia(q, agora) {
  if (q.tipo === "uma_vez") {
    const t = brasiliaParaMs(q.em);
    return t <= agora ? t : null;
  }
  for (let i = 0; i <= 32; i++) {
    const t = candidatoNoDia(q, agora - i * DIA_MS);
    if (t !== null && t <= agora) return t;
  }
  return null;
}

export function proximaOcorrencia(q, agora) {
  if (q.tipo === "uma_vez") {
    const t = brasiliaParaMs(q.em);
    return t > agora ? t : null;
  }
  for (let i = 0; i <= 32; i++) {
    const t = candidatoNoDia(q, agora + i * DIA_MS);
    if (t !== null && t > agora) return t;
  }
  return null;
}

// Quais agendamentos têm um disparo pendente agora. Devolve [{ag, ocorrencia}].
export function agendamentosDevidos(lista, agora) {
  const devidos = [];
  for (const ag of lista) {
    if (ag.ativo === false) continue;
    const occ = ultimaOcorrencia(ag.quando, agora);
    if (occ === null) continue;
    const marco = Math.max(ag.ultimo_envio ?? 0, ag.criado_em ?? 0);
    if (occ > marco && agora - occ <= ATRASO_MAXIMO_MS) devidos.push({ ag, ocorrencia: occ });
  }
  return devidos;
}

export function descreverQuando(q) {
  switch (q.tipo) {
    case "uma_vez": return `uma vez, ${formatarBrasilia(brasiliaParaMs(q.em))}`;
    case "diario": return `todo dia às ${q.hora}`;
    case "semanal": return `toda ${q.dias.map((d) => DIAS[diaDaSemana(d)]).join(", ")} às ${q.hora}`;
    case "mensal": return `todo dia ${q.dia} às ${q.hora}`;
    default: return "?";
  }
}
