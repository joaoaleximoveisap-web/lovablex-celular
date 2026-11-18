// Funções pequenas e puras: números de telefone e horário de Brasília.

// Deixa só os dígitos e põe no formato 55 + DDD + número.
// Celulares antigos às vezes chegam do WhatsApp sem o 9 (554399998888):
// aqui eles ganham o 9 de volta, para o mesmo contato ter sempre a mesma chave.
export function normalizarNumero(entrada) {
  let d = String(entrada ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d; // sem o 55
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d[4])) {
    d = d.slice(0, 4) + "9" + d.slice(4); // celular sem o nono dígito
  }
  return d;
}

export function mesmoNumero(a, b) {
  const x = normalizarNumero(a);
  return x !== "" && x === normalizarNumero(b);
}

// Brasília não tem horário de verão desde 2019: UTC-3 o ano todo.
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

// Data em Brasília -> partes (ano, mês, dia, hora, minuto, dia da semana)
export function partesBrasilia(ms) {
  const d = new Date(ms - OFFSET_MS);
  return {
    ano: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
    hora: d.getUTCHours(),
    minuto: d.getUTCMinutes(),
    semana: d.getUTCDay(),
  };
}

// "2026-11-20T09:30" (hora de Brasília) -> milissegundos UTC
export function brasiliaParaMs(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(texto ?? ""));
  if (!m) return NaN;
  const [, a, me, d, h, mi] = m.map(Number);
  return Date.UTC(a, me - 1, d, h, mi) + OFFSET_MS;
}

export function formatarBrasilia(ms) {
  const p = partesBrasilia(ms);
  const z = (n) => String(n).padStart(2, "0");
  return `${DIAS[p.semana]} ${z(p.dia)}/${z(p.mes)}/${p.ano} ${z(p.hora)}:${z(p.minuto)}`;
}

export function diaDaSemana(nome) {
  const n = String(nome).toLowerCase().slice(0, 3)
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  return DIAS.indexOf(n);
}

export { DIAS };

// Template do WhatsApp não aceita quebra de linha, tab nem 4+ espaços seguidos
// dentro de uma variável.
export function textoParaVariavel(texto) {
  return String(texto ?? "")
    .replace(/\s*\n+\s*/g, " — ")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, 1000);
}

export function idCurto() {
  return Math.random().toString(36).slice(2, 7);
}
