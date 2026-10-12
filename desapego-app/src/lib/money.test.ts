import { describe, expect, it } from "vitest";
import { calcCommissionCents, formatBRL, maskBRLInput, parseBRL } from "./money";

describe("comissão", () => {
  it("5% de R$ 900 = R$ 45", () => expect(calcCommissionCents(90000, 500)).toBe(4500));
  it("5% de R$ 500 = R$ 25", () => expect(calcCommissionCents(50000, 500)).toBe(2500));
  it("arredonda meio centavo para cima, igual ao servidor", () => {
    expect(calcCommissionCents(999, 500)).toBe(50);
    expect(calcCommissionCents(1, 500)).toBe(0);
    expect(calcCommissionCents(12345, 750)).toBe(926);
  });
  it("doação e taxa zero não geram comissão", () => {
    expect(calcCommissionCents(0, 500)).toBe(0);
    expect(calcCommissionCents(10000, 0)).toBe(0);
  });
  it("valores altos continuam exatos", () => expect(calcCommissionCents(99_999_999_99, 500)).toBe(5_000_000_00));
  it("bate com o servidor numa varredura", () => {
    for (let p = 0; p < 50000; p += 37) {
      for (const r of [100, 250, 500, 750, 1000]) {
        const expected = p <= 0 ? 0 : Number((BigInt(p) * BigInt(r) + 5000n) / 10000n);
        expect(calcCommissionCents(p, r)).toBe(expected);
      }
    }
  });
});

describe("valores em reais", () => {
  it("formata", () => {
    expect(formatBRL(4500)).toBe("R$ 45,00");
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
  });
  it("lê o que a pessoa digita", () => {
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("900")).toBe(90000);
    expect(parseBRL("0,5")).toBe(50);
    expect(parseBRL("1.000")).toBe(100000);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("1,234")).toBeNull();
  });
  it("máscara de digitação", () => {
    expect(maskBRLInput("90000")).toEqual({ text: "900,00", cents: 90000 });
    expect(maskBRLInput("")).toEqual({ text: "", cents: null });
    expect(maskBRLInput("R$ 1.000,00")).toEqual({ text: "1.000,00", cents: 100000 });
  });
});
