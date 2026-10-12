import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16, normalizePixKey } from "./pix";

describe("Pix copia e cola", () => {
  it("CRC16 do exemplo oficial do Banco Central", () => {
    const semCrc = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
    expect(crc16(semCrc)).toBe("1D3D");
  });
  it("reproduz o exemplo oficial", () => {
    expect(buildPixPayload({ key: "123e4567-e12b-12d1-a456-426655440000", name: "Fulano de Tal", city: "BRASILIA" })).toBe(
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D",
    );
  });
  it("inclui valor, identificador e remove acentos", () => {
    const p = buildPixPayload({ key: "dono@familia.com", name: "João Ação", city: "Londrina", amountCents: 4500, txid: "COM-ab12" });
    expect(p).toContain("540545.00");
    expect(p).toContain("5909Joao Acao");
    expect(p).toContain("0507COMab12");
    expect(crc16(p.slice(0, -4))).toBe(p.slice(-4));
  });
  it("normaliza chaves", () => {
    expect(normalizePixKey("123.456.789-09")).toBe("12345678909");
    expect(normalizePixKey("+55 (43) 99999-0000")).toBe("+5543999990000");
    expect(normalizePixKey("Dono@Familia.com")).toBe("dono@familia.com");
  });
  it("recusa dados incompletos", () => expect(() => buildPixPayload({ key: "", name: "x", city: "y" })).toThrow());
});
