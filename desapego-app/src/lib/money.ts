// Dinheiro sempre em centavos inteiros. Nada de ponto flutuante em cálculo financeiro.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return brl.format(cents / 100).replace(/ /g, " ");
}

/** "R$ 1.234,56", "1234,5", "1.000" → centavos. Retorna null se não for um valor válido. */
export function parseBRL(input: string): number | null {
  const s = input.replace(/[R$\s]/g, "").trim();
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  const [inteiro, decimal = ""] = s.replace(/\./g, "").split(",");
  const cents = Number(inteiro) * 100 + Number((decimal + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Máscara de digitação: os dígitos entram pela direita ("12345" → "123,45"). */
export function maskBRLInput(raw: string): { text: string; cents: number | null } {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, 11);
  if (!digits) return { text: "", cents: null };
  const cents = Number(digits);
  const text = brl.format(cents / 100).replace(/ /g, " ").replace("R$ ", "");
  return { text, cents };
}

/** Mesmo cálculo do servidor (public.calc_commission_cents): meio centavo arredonda para cima. */
export function calcCommissionCents(priceCents: number, rateBps: number): number {
  if (priceCents <= 0 || rateBps <= 0) return 0;
  return Math.floor((priceCents * rateBps + 5000) / 10000);
}

export function formatRate(bps: number): string {
  return (bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
}
