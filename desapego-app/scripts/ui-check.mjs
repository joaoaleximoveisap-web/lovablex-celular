// Verificação visual do app publicado (../desapego) com a API do Supabase simulada.
// Confere: telas abrem, nenhum erro no console, sem rolagem horizontal, rotas funcionam ao recarregar.
// Uso: node scripts/ui-check.mjs <pasta-de-saida>
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const OUT = process.argv[2] || "ui-check";
await mkdir(OUT, { recursive: true });
const ROOT = new URL("../../desapego/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "") || "index.html";
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(4317);

const U = "a0000000-0000-0000-0000-000000000001";
const OTHER = "a0000000-0000-0000-0000-000000000002";
const now = Date.now();
const iso = (h) => new Date(now - h * 3600_000).toISOString();
const products = [
  ["Sofá 3 lugares retrátil", 65000, "seminovo", "moveis", "#C9B79C"],
  ["iPad 9ª geração 64GB", 150000, "usado", "eletronicos", "#9AA5B1"],
  ["Mesa de jantar 6 cadeiras", 40000, "seminovo", "casa", "#A47551"],
  ["Bicicleta aro 29 Caloi", 85000, "usado", "esportes", "#5B7F95"],
  ["Televisão 50\" 4K Samsung", 100000, "usado", "eletronicos", "#2F3B45"],
  ["Carrinho de bebê Galzerano", 0, "usado", "infantil", "#D8A7B1"],
  ["Coleção Harry Potter (7 livros)", 15000, "usado", "livros", "#7D5A50"],
  ["Geladeira Brastemp Frost Free", 120000, "seminovo", "eletrodomesticos", "#B8C4C2"],
  ["Jaqueta de couro masculina", 20000, "novo", "roupas", "#4A3B32"],
  ["Air fryer Philips 4L", 22000, "seminovo", "eletrodomesticos", "#6F6F6F"],
];
const listings = products.map(([title, price, condition, cat, color], i) => ({
  id: `b0000000-0000-0000-0000-00000000000${i}`, title, asking_price_cents: price, condition, listing_type: price ? "venda" : "doacao",
  accepts_offers: i % 3 !== 2 && price > 0, accepts_trade: i === 3, location: ["Centro", "Gleba Palhano", "Jardim Higienópolis", "Zona Sul"][i % 4],
  status: i === 4 ? "reserved" : "active", category_id: cat, cover_path: `${OTHER}/p${i}.svg`, cover_thumb_path: `${OTHER}/p${i}_t.svg`,
  published_at: iso(i * 20), created_at: iso(i * 20), seller_id: i % 2 ? U : OTHER, seller_name: i % 2 ? "Fernanda Lima" : "Maria Aparecida", _color: color,
}));
const profile = { id: U, name: "Fernanda Lima", avatar_url: null, location: "Londrina", contact_preferences: {}, role: "admin", account_status: "active", created_at: "2026-01-10T12:00:00Z" };
const settings = [["app_name", "Desapego da Família"], ["commission_rate_bps", 500], ["payment_due_days", 7], ["overdue_grace_days", 10], ["pix_key", "dono@familia.com.br"], ["pix_receiver_name", "Joao Alex"], ["pix_city", "Londrina"], ["max_photos", 10], ["max_active_listings", 30], ["moderation_mode", "post"], ["participation_policy", "Anúncios gratuitos; comissão só nas vendas."]].map(([key, value]) => ({ key, value }));
const cats = [["moveis", "Móveis", "sofa"], ["eletronicos", "Eletrônicos", "smartphone"], ["roupas", "Roupas", "shirt"], ["infantil", "Infantil", "baby"], ["casa", "Casa", "house"], ["eletrodomesticos", "Eletrodomésticos", "refrigerator"], ["esportes", "Esportes", "bike"], ["veiculos", "Veículos", "car"], ["livros", "Livros", "book-open"], ["outros", "Outros", "package"]].map(([id, name, icon], i) => ({ id, name, icon, sort_order: i * 10, active: true }));
const full = (l) => ({ ...l, description: "Em ótimo estado, sem marcas de uso aparentes. Acompanha nota fiscal e manual.\nRetirada combinada durante a semana.", delivery_options: ["retirada", "entrega"], notes: "Retirar até sábado", image_count: 4, sold_at: null, updated_at: l.created_at,
  listing_images: [0, 1, 2, 3].map((k) => ({ id: `${l.id}-${k}`, listing_id: l.id, storage_path: `${OTHER}/p${listings.indexOf(l)}_${k}.svg`, thumb_path: `${OTHER}/p${listings.indexOf(l)}_${k}_t.svg`, display_order: k })),
  seller: { id: l.seller_id, name: l.seller_name, avatar_url: null, location: "Londrina", created_at: "2026-01-10T12:00:00Z" }, category: cats.find((c) => c.id === l.category_id) });
const conv = { id: "c0000000-0000-0000-0000-000000000001", listing_id: listings[4].id, buyer_id: OTHER, seller_id: U, listing: { ...full(listings[4]), seller_id: U }, buyer: { id: OTHER, name: "Maria Aparecida", avatar_url: null }, seller: { id: U, name: "Fernanda Lima", avatar_url: null } };
const offer = { id: "d0000000-0000-0000-0000-000000000001", listing_id: listings[4].id, conversation_id: conv.id, buyer_id: OTHER, seller_id: U, proposed_by: OTHER, amount_cents: 90000, status: "pending", created_at: iso(1) };
const messages = [
  { id: "m1", conversation_id: conv.id, sender_id: OTHER, kind: "text", content: "Oi! A TV ainda está disponível?", metadata: {}, created_at: iso(3), read_at: iso(2) },
  { id: "m2", conversation_id: conv.id, sender_id: U, kind: "text", content: "Está sim! Funcionando perfeitamente, com controle e suporte de parede.", metadata: {}, created_at: iso(2.5), read_at: iso(2) },
  { id: "m3", conversation_id: conv.id, sender_id: OTHER, kind: "offer", content: "Proposta: R$ 900,00", metadata: { offer_id: offer.id, amount_cents: 90000 }, created_at: iso(1), read_at: null },
];
const commission = { id: "e0000000-0000-0000-0000-000000000001", sale_id: "s1", seller_id: U, base_cents: 90000, rate_bps: 500, original_amount_cents: 4500, amount_cents: 4500, due_at: new Date(now + 6 * 86400_000).toISOString(), status: "awaiting_payment", effective_status: "awaiting_payment", reminder_sent_at: null, paid_at: null, admin_note: null, created_at: iso(20), listing_id: listings[4].id, final_price_cents: 90000, sale_type: "venda", completed_at: iso(20), listing_title: listings[4].title, listing_thumb: listings[4].cover_thumb_path, seller_name: "Fernanda Lima" };
const commissions = [commission, { ...commission, id: "e2", seller_name: "Maria Aparecida", listing_title: "Sofá 3 lugares retrátil", base_cents: 60000, amount_cents: 3000, status: "payment_reported", effective_status: "payment_reported" }, { ...commission, id: "e3", seller_name: "Carlos Souza", listing_title: "Bicicleta aro 29", base_cents: 80000, amount_cents: 4000, status: "paid", effective_status: "paid", paid_at: iso(5) }, { ...commission, id: "e4", seller_name: "Ana Paula", listing_title: "Geladeira Brastemp", base_cents: 110000, amount_cents: 5500, status: "awaiting_payment", effective_status: "overdue", due_at: iso(48) }];
const dash = { members_active: 18, members_pending: 1, listings_active: 42, listings_pending_review: 0, listings_sold: 12, sales_volume_cents: 1245000, commissions_generated_cents: 62250, commissions_received_cents: 41500, commissions_pending_cents: 20750, commissions_overdue_cents: 5500, commissions_to_review: 1, reports_open: 1, top_sellers: [{ id: U, name: "Fernanda Lima", sales: 5, volume_cents: 480000 }, { id: OTHER, name: "Maria Aparecida", sales: 4, volume_cents: 390000 }] };
const notifs = [
  { id: "n1", type: "offer_new", title: "Nova proposta: R$ 900,00", body: "Maria Aparecida · Televisão 50\" 4K", link: `/conversas/${conv.id}`, read_at: null, created_at: iso(1) },
  { id: "n2", type: "commission_new", title: "Comissão gerada: R$ 45,00", body: "Televisão 50\" 4K · pagar até 18/10", link: "/perfil/comissoes", read_at: null, created_at: iso(20) },
  { id: "n3", type: "payment_approved", title: "Pagamento confirmado", body: "Sofá · R$ 32,50", link: "/perfil/comissoes", read_at: iso(30), created_at: iso(40) },
];

function svg(path) {
  const m = path.match(/p(\d+)/);
  const l = listings[Number(m?.[1] ?? 0)] ?? listings[0];
  const k = Number(path.match(/_(\d)/)?.[1] ?? 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l._color}"/><stop offset="1" stop-color="#EEF1EE"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><rect x="${160 + k * 20}" y="330" width="480" height="340" rx="40" fill="rgba(255,255,255,.35)"/><text x="400" y="520" font-family="sans-serif" font-size="44" font-weight="700" fill="#202522" text-anchor="middle">${l.title.split(" ").slice(0, 2).join(" ").replace(/"/g, "")}</text></svg>`;
}

function api(url, headers) {
  const u = new URL(url);
  const p = u.pathname;
  const single = (headers.accept || "").includes("vnd.pgrst.object"); // .single(); .maybeSingle() recebe lista
  const one = (rows) => (single ? rows[0] ?? null : rows);
  if (p.startsWith("/storage/v1/object/public/")) return { type: "image/svg+xml", body: svg(p) };
  const t = p.replace("/rest/v1/", "");
  const sp = u.searchParams;
  switch (t) {
    case "profiles": {
      const all = [profile, { ...profile, id: OTHER, name: "Maria Aparecida", role: "member" }, { ...profile, id: "x3", name: "Ana Paula", role: "member", account_status: "pending" }];
      const id = sp.get("id")?.replace("eq.", "");
      return one(id ? all.filter((x) => x.id === id) : all);
    }
    case "app_settings": return settings;
    case "categories": return cats;
    case "rpc/search_listings": return listings;
    case "rpc/unread_counts": return { messages: 1, notifications: 2 };
    case "rpc/sync_my_reminders": return 0;
    case "rpc/public_branding": return { app_name: "Desapego da Família" };
    case "rpc/my_conversations": return [{ id: conv.id, listing_id: listings[4].id, listing_title: listings[4].title, listing_price_cents: 100000, listing_status: "reserved", listing_thumb: listings[4].cover_thumb_path, i_am_seller: true, other_id: OTHER, other_name: "Maria Aparecida", other_avatar: null, last_message_at: iso(1), last_message_preview: "Proposta: R$ 900,00", unread: 1 }, { id: "c2", listing_id: listings[1].id, listing_title: listings[1].title, listing_price_cents: 150000, listing_status: "active", listing_thumb: listings[1].cover_thumb_path, i_am_seller: false, other_id: OTHER, other_name: "Carlos Souza", other_avatar: null, last_message_at: iso(26), last_message_preview: "Combinado, passo aí sábado.", unread: 0 }];
    case "rpc/admin_dashboard": return dash;
    case "favorites": return sp.get("select")?.includes("listing:") ? [] : [{ listing_id: listings[0].id }];
    case "listings": return one(sp.get("id") ? [full(listings.find((l) => sp.get("id").includes(l.id)) ?? listings[0])] : listings.map(full));
    case "conversations": return one([conv]);
    case "messages": return [...messages].reverse();
    case "offers": return [{ ...offer, buyer: { name: "Maria Aparecida" }, seller: { name: "Fernanda Lima" }, listing: { title: listings[4].title } }];
    case "user_blocks": return [];
    case "commissions_view": return one(sp.get("id") ? [commission] : commissions);
    case "payment_reports": return [];
    case "notifications": return notifs;
    case "invites": return [{ id: "i1", label: "Tia Maria", grants_role: "member", expires_at: new Date(now + 5 * 86400_000).toISOString(), max_uses: 1, use_count: 0, revoked_at: null, created_at: iso(10) }];
    case "sales": return [];
    case "profile_private": return one([{ phone: "(43) 99999-0000" }]);
    default: return single ? null : [];
  }
}

const VIEWPORTS = { celular: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ipad: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, computador: { width: 1440, height: 900, deviceScaleFactor: 1 } };
const PAGES = [
  ["entrar", "/entrar", false], ["cadastro", "/cadastro?convite=AB12-CD34-EF56", false], ["vitrine", "/", true], ["busca", "/buscar?q=tv&proposta=1", true],
  ["produto", `/anuncio/${listings[0].id}`, true], ["produto-dono", `/anuncio/${listings[1].id}`, true], ["anunciar", "/anunciar", true], ["conversas", "/conversas", true],
  ["chat", `/conversas/${conv.id}`, true], ["perfil-comissoes", "/perfil/comissoes", true], ["pagar-comissao", `/comissoes/${commission.id}`, true], ["notificacoes", "/notificacoes", true],
  ["admin", "/admin", true], ["admin-comissoes", "/admin/comissoes", true], ["admin-usuarios", "/admin/usuarios", true], ["admin-config", "/admin/configuracoes", true], ["termos", "/termos", true],
];

const browser = await chromium.launch();
const problems = [];
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  for (const [name, route, logged] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor, locale: "pt-BR", serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && !/WebSocket|realtime|ERR_FAILED|net::/.test(m.text()) && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.DESAPEGO_CONFIG={supabaseUrl:"https://demo.supabase.test",supabaseAnonKey:"anon"}' }));
    await page.route("https://demo.supabase.test/**", async (r) => {
      const req = r.request();
      if (req.url().includes("/realtime/")) return r.abort();
      const out = api(req.url(), req.headers());
      if (out && out.type) return r.fulfill({ contentType: out.type, body: out.body });
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(out) });
    });
    if (logged) {
      await page.addInitScript(([uid]) => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        localStorage.setItem("sb-demo-auth-token", JSON.stringify({ access_token: "x.eyJzdWIiOiJ4In0.x", token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user: { id: uid, aud: "authenticated", role: "authenticated", email: "fernanda@familia.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-10T12:00:00Z" } }));
      }, [U]);
    }
    // abre direto no endereço (equivale a atualizar a página numa rota interna)
    await page.goto(`http://localhost:4317/#${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    if (name === "anunciar") {
      const btn = page.getByRole("button", { name: "Continuar" });
      if (await btn.count()) await btn.click();
      else problems.push(`${vpName}/${name}: botão Continuar não apareceu — ${(await page.evaluate(() => document.body.innerText)).slice(0, 300)}`);
      await page.waitForTimeout(200);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`${vpName}/${name}: rolagem horizontal de ${overflow}px`);
    for (const e of errors) problems.push(`${vpName}/${name}: erro no console: ${e}`);
    const text = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    if (/Não foi possível carregar|Página não encontrada|Perfil não encontrado|não encontrad[ao]\./.test(text)) problems.push(`${vpName}/${name}: tela de erro`);
    await page.screenshot({ path: `${OUT}/${vpName}-${name}.png`, fullPage: vpName !== "computador" ? false : true });
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log(problems.length ? "PROBLEMAS:\n" + problems.join("\n") : `OK: ${PAGES.length * 3} telas verificadas, sem erros de console nem rolagem horizontal.`);
process.exit(problems.length ? 1 : 0);
