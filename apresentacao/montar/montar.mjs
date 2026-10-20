#!/usr/bin/env node
// Monta a apresentação protegida: PowerPoint → projeto do Palco → arquivo trancado com senha.
//
//   node apresentacao/montar/montar.mjs caminho/arquivo.pptx --senha "a senha" [--titulo "Nome na tela de senha"]
//
// O PowerPoint é lido pelo mesmo importador do Palco (importador.js), rodando num Chromium
// sem janela. O resultado (slides + imagens + vídeos originais) vira um único pacote,
// criptografado com AES-256-GCM; a chave sai da senha (PBKDF2-SHA256). O que vai para o
// GitHub é só o arquivo trancado: sem a senha, ninguém lê nada — nem o nome dos slides.
import { createHash, pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = resolve(AQUI, "..");
const ITERACOES = 310000;
const PEDACO = 4 * 1024 * 1024; // criptografa em pedaços de 4 MB: o celular abre com barra de progresso e sem pico de memória

function args() {
  const a = process.argv.slice(2), o = { arquivo: "", senha: process.env.APRESENTACAO_SENHA || "", titulo: "" };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--senha") o.senha = a[++i] ?? "";
    else if (a[i] === "--titulo") o.titulo = a[++i] ?? "";
    else o.arquivo = a[i];
  }
  if (!o.arquivo || !o.senha) {
    console.error('Uso: node montar.mjs arquivo.pptx --senha "senha" [--titulo "Título"]');
    process.exit(1);
  }
  return o;
}

function playwright() {
  const req = createRequire(import.meta.url);
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright", "@playwright/test"]) {
    try { return req(p); } catch { /* tenta o próximo */ }
  }
  throw new Error("Playwright não encontrado (npm i -g playwright).");
}

async function importar(arquivo) {
  const { chromium } = playwright();
  // o Chromium da versão do Playwright do projeto pode não estar baixado: usa o que já existe na máquina
  const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" }));
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => console.error("[chromium]", e.message));
    await page.setContent('<input type="file" id="f">');
    await page.addScriptTag({ content: readFileSync(join(AQUI, "importador.js"), "utf8") });
    await page.setInputFiles("#f", arquivo);
    const r = await page.evaluate(async () => {
      const f = document.querySelector("#f").files[0];
      const { project, assets } = await globalThis.palcoImportar(f);
      globalThis.__assets = assets;
      return { project, lista: [...assets].map(([id, b]) => ({ id, type: b.type, n: b.size })) };
    });
    const assets = [];
    for (const a of r.lista) {
      const partes = [];
      for (let o = 0; o < a.n; o += 8 * 1024 * 1024) {
        const b64 = await page.evaluate(async ([id, o]) => {
          const b = globalThis.__assets.get(id).slice(o, o + 8 * 1024 * 1024);
          const u = new Uint8Array(await b.arrayBuffer());
          let s = "";
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
          return btoa(s);
        }, [a.id, o]);
        partes.push(Buffer.from(b64, "base64"));
      }
      assets.push({ ...a, dados: Buffer.concat(partes) });
    }
    return { project: r.project, assets };
  } finally {
    await browser.close();
  }
}

function empacotar(project, assets) {
  const indice = {};
  let o = 0;
  for (const a of assets) { indice[a.id] = { o, n: a.dados.length, type: a.type }; o += a.dados.length; }
  const cab = Buffer.from(JSON.stringify({ formato: 1, project, assets: indice }), "utf8");
  const tam = Buffer.alloc(4); tam.writeUInt32LE(cab.length);
  return Buffer.concat([tam, cab, ...assets.map(a => a.dados)]);
}

// "PLC1" | iterações u32 | sal 16 | iv 12 | pedaço u32 | nº de pedaços u32 | pedaços (cada um com a etiqueta GCM de 16 bytes)
function trancar(claro, senha) {
  const sal = randomBytes(16), iv = randomBytes(12);
  const chave = pbkdf2Sync(Buffer.from(senha.normalize("NFC"), "utf8"), sal, ITERACOES, 32, "sha256");
  const n = Math.max(1, Math.ceil(claro.length / PEDACO));
  const cab = Buffer.alloc(4 + 4 + 16 + 12 + 4 + 4);
  cab.write("PLC1", 0, "ascii"); cab.writeUInt32LE(ITERACOES, 4); sal.copy(cab, 8); iv.copy(cab, 24);
  cab.writeUInt32LE(PEDACO, 36); cab.writeUInt32LE(n, 40);
  const saida = [cab];
  for (let i = 0; i < n; i++) {
    const ivi = Buffer.from(iv); ivi.writeUInt32BE((ivi.readUInt32BE(8) ^ i) >>> 0, 8);
    const c = createCipheriv("aes-256-gcm", chave, ivi);
    c.setAAD(Buffer.from(`${i}/${n}`)); // cada pedaço só vale na sua posição: ninguém corta nem troca a ordem
    saida.push(c.update(claro.subarray(i * PEDACO, (i + 1) * PEDACO)), c.final(), c.getAuthTag());
  }
  return Buffer.concat(saida);
}

const o = args();
console.log("Lendo", basename(o.arquivo), `(${(statSync(o.arquivo).size / 1048576).toFixed(1)} MB)…`);
const { project, assets } = await importar(resolve(o.arquivo));
console.log(`${project.slides.length} slides em ${project.floors.length} andares, ${assets.length} arquivos de mídia.`);
for (const w of project.warnings ?? []) console.log("aviso:", w);
const trancado = trancar(empacotar(project, assets), o.senha);
if (trancado.length > 95 * 1048576) console.log("aviso: o arquivo passou de 95 MB; o GitHub recusa acima de 100 MB.");
writeFileSync(join(SAIDA, "dados.palco"), trancado);
const v = createHash("sha256").update(trancado).digest("hex").slice(0, 12);
writeFileSync(join(SAIDA, "versao.json"), JSON.stringify({ v, titulo: o.titulo || "Apresentação", bytes: trancado.length }, null, 2) + "\n");
console.log(`Pronto: apresentacao/dados.palco (${(trancado.length / 1048576).toFixed(1)} MB), versão ${v}.`);
