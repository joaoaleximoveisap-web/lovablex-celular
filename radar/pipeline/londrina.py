#!/usr/bin/env python3
"""Radar de Hospedagem — coletor de Londrina (PR).

Lê só as páginas públicas de busca do Airbnb (as mesmas que qualquer pessoa vê no
navegador), devagar, com uma pausa entre cada página. Sem API paga, sem chave, sem login.

O que cada execução faz:
  1. Catálogo: varre o mapa de Londrina e lista todas as unidades (nome, tipo, bairro,
     localização, nota, nº de avaliações e diária de referência).
  2. Datas: para ~60 estadias de 2 noites nos próximos 12 meses (fins de semana, dias úteis
     e feriados), pergunta quantas unidades estão livres e, com o filtro de preço máximo da
     própria busca, quanto custam (mediana e quartis). 4-5 páginas por data.
  3. Zonas: o mesmo, por zona da cidade, uma vez por mês.
  4. Histórico: acrescenta tudo em radar/data/londrina-historico.json. Como roda toda
     semana, o histórico de preço e de procura de cada data vai crescendo sozinho.

Uso:  python3 radar/pipeline/londrina.py                       coleta completa (~40 min)
      python3 radar/pipeline/londrina.py --rapido              próximas semanas e feriados (~10 min)
      python3 radar/pipeline/londrina.py --datas 2026-12-24    só estas datas (~1 min cada)
"""
import base64, gzip, hashlib, json, math, os, random, re, subprocess, sys, time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DADOS = os.path.join(RAIZ, "data")
BUSCA = "https://www.airbnb.com.br/s/Londrina--PR/homes"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
PAUSA = (1.5, 3.0)          # segundos entre páginas — ritmo de uma pessoa navegando
POR_PAGINA = 18
MAX_PAGINAS = 15            # a busca não passa de 15 páginas; acima disso a área é dividida

# área urbana de Londrina (Cambé fica a oeste e Ibiporã a leste, fora deste retângulo)
AREA = dict(sw_lat=-23.43, sw_lng=-51.245, ne_lat=-23.22, ne_lng=-51.06)
ZONAS = {
    "Norte":            dict(sw_lat=-23.295, sw_lng=-51.245, ne_lat=-23.22,  ne_lng=-51.06),
    "Centro":           dict(sw_lat=-23.325, sw_lng=-51.18,  ne_lat=-23.295, ne_lng=-51.13),
    "Oeste / Gleba Palhano": dict(sw_lat=-23.43, sw_lng=-51.245, ne_lat=-23.295, ne_lng=-51.18),
    "Sul":              dict(sw_lat=-23.43,  sw_lng=-51.18,  ne_lat=-23.325, ne_lng=-51.13),
    "Leste":            dict(sw_lat=-23.43,  sw_lng=-51.13,  ne_lat=-23.295, ne_lng=-51.06),
}

# Prédios acompanhados unidade por unidade: quais estão livres e quanto cada uma cobra em cada data.
# padrao = como os anfitriões escrevem o nome do prédio no anúncio; centro/raio = onde ele fica.
PREDIOS = {
    "JH Palhano": dict(padrao=r"\bJ\.?\s?H(?![a-z])", centro=(-23.3282, -51.1803), raio=0.0018),
}

# Número do anúncio → quando ele entrou no Airbnb (calibrado com ~44 mil anúncios do Rio
# com data da primeira avaliação, dados Inside Airbnb). Serve para reconstruir a oferta desde 2012.
CALIBRACAO = [
    (2.8e5, 2012.0), (8.9e5, 2013.1), (2.0e6, 2014.0), (5.0e6, 2015.1), (1.0e7, 2016.0),
    (1.78e7, 2017.2), (2.24e7, 2018.0), (3.16e7, 2019.0), (4.47e7, 2020.3), (5.01e7, 2021.2),
    (5.62e7, 2021.9), (5.43e17, 2022.0), (6.6e17, 2022.5), (7.94e17, 2023.0), (9.33e17, 2023.5),
    (1.047e18, 2024.0), (1.202e18, 2024.5), (1.333e18, 2025.0), (1.462e18, 2025.5),
    (1.585e18, 2026.0), (1.718e18, 2026.5), (1.85e18, 2027.0),
]


def ano_entrada(lid):
    try:
        x = math.log10(int(lid))
    except (TypeError, ValueError):
        return None
    pts = [(math.log10(a), b) for a, b in CALIBRACAO]
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return round(y0 + (y1 - y0) * (x - x0) / (x1 - x0), 2)
        if x1 < x0:   # salto entre IDs curtos (até 2021) e longos (2022+)
            continue
    if 5.7e7 < int(lid) < 5.43e17:
        return 2021.95
    return pts[-1][1]


# ---------------- rede ----------------
_pedidos = 0


def baixar(params):
    """Uma página de busca. Com RADAR_CACHE=<pasta>, guarda cada página para retomar uma coleta interrompida."""
    global _pedidos
    url = BUSCA + "?" + urlencode(params, doseq=True)
    cache = os.environ.get("RADAR_CACHE")
    if cache:
        os.makedirs(cache, exist_ok=True)
        arq = os.path.join(cache, hashlib.sha1(url.encode()).hexdigest() + ".html.gz")
        if os.path.exists(arq):
            with gzip.open(arq, "rt", encoding="utf-8") as f:
                return f.read()
        corpo = _baixar(url)
        with gzip.open(arq, "wt", encoding="utf-8") as f:
            f.write(corpo)
        return corpo
    return _baixar(url)


def _baixar(url):
    global _pedidos
    for tentativa in range(4):
        time.sleep(random.uniform(*PAUSA))
        r = subprocess.run(["curl", "-sS", "--compressed", "--max-time", "60", "-A", UA,
                            "-H", "Accept-Language: pt-BR,pt;q=0.9", "-w", "\n%{http_code}", url],
                           capture_output=True, text=True)
        _pedidos += 1
        corpo, _, cod = r.stdout.rpartition("\n")
        if r.returncode == 0 and cod == "200" and "data-deferred-state-0" in corpo:
            return corpo
        espera = 30 * (tentativa + 1)
        print(f"  ! resposta {cod or r.returncode}; tentando de novo em {espera}s", flush=True)
        time.sleep(espera)
    raise RuntimeError("o Airbnb não respondeu depois de 4 tentativas")


def ler(html, noites=None):
    m = re.search(r'<script id="data-deferred-state-0"[^>]*>(.*?)</script>', html, re.S)
    d = json.loads(m.group(1))
    ss = None
    for item in d.get("niobeClientData", []):
        ss = (((item[1] or {}).get("data") or {}).get("presentation") or {}).get("staysSearch")
        if ss:
            break
    if not ss:
        raise RuntimeError("formato da página mudou (staysSearch não encontrado)")
    res = ss.get("results") or {}
    texto = json.dumps(res, ensure_ascii=False)
    total, mais_de = None, False
    m = re.search(r'"structuredTitle":\s*"([^"]*acomoda[^"]*)"', texto)
    if m:
        t = m.group(1)
        mais_de = "Mais de" in t or "+" in t
        n = re.search(r"([\d.]+)", t)
        total = int(n.group(1).replace(".", "")) if n else None
    hist = None
    m = re.search(r'"minValue":\s*([\d.]+),\s*"maxValue":\s*([\d.]+),\s*"priceHistogram":\s*\[([\d,\s]*)\]', texto)
    if m:
        hist = dict(min=float(m.group(1)), max=float(m.group(2)), barras=[int(v) for v in m.group(3).split(",") if v.strip()])
    paginas = len(((res.get("paginationInfo") or {}).get("pageCursors")) or [])
    return dict(total=total, mais_de=mais_de, hist=hist, paginas=paginas, itens=[u for u in (unidade(x, noites) for x in res.get("searchResults") or []) if u])


def valor(txt):
    """'R$ 1.085,00' → 1085.0"""
    m = re.search(r"R\$\s*([\d.]+(?:,\d+)?)", txt or "")
    return float(m.group(1).replace(".", "").replace(",", ".")) if m else None


def unidade(x, noites_busca=None):
    dsl = x.get("demandStayListing") or {}
    if not dsl.get("id"):
        return None
    try:
        lid = base64.b64decode(dsl["id"]).decode().split(":")[-1]
    except Exception:
        return None
    coord = ((dsl.get("location") or {}).get("coordinate")) or {}
    titulo = x.get("title") or ""
    tipo, _, bairro = re.sub(r"\s*[⋅·•]\s*", "⋅", titulo, count=1).partition("⋅")
    nome = ((x.get("nameLocalized") or {}).get("localizedStringWithTranslationPreference")) or x.get("subtitle") or ""
    nota, n_aval = None, 0
    m = re.match(r"([\d,]+)\s*\((\d+)\)", x.get("avgRatingLocalized") or "")
    if m:
        nota, n_aval = float(m.group(1).replace(",", ".")), int(m.group(2))
    preco = x.get("structuredDisplayPrice") or {}
    linha = preco.get("primaryLine") or {}
    total = valor(linha.get("discountedPrice") or linha.get("price"))
    if total is None:   # "O preço original era R$ 203 e o novo preço total é R$ 172" → o último valor
        achados = re.findall(r"R\$\s*[\d.]+(?:,\d+)?", linha.get("accessibilityLabel") or "")
        total = valor(achados[-1]) if achados else None
    sel = [b.get("text") for b in (x.get("badges") or []) if isinstance(b, dict) and b.get("text")]
    o = x.get("listingParamOverrides") or {}
    noites = noites_busca
    if o.get("checkin") and o.get("checkout"):
        noites = (date.fromisoformat(o["checkout"]) - date.fromisoformat(o["checkin"])).days
    return dict(id=lid, nome=nome.strip()[:80], tipo=tipo.strip() or "—", bairro=bairro.strip() or "Londrina",
                lat=coord.get("latitude"), lon=coord.get("longitude"), nota=nota, aval=n_aval,
                diaria=round(total / noites) if total and noites else None, selos=sel)


def caixa(area):
    return {k: f"{v:.5f}" for k, v in area.items()}


def params(area, checkin=None, checkout=None, cursor=None):
    p = dict(refinement_paths="/homes", search_type="user_map_move", search_by_map="true", zoom_level="13", adults="1", **caixa(area))
    if checkin:
        p.update(checkin=checkin, checkout=checkout, price_filter_num_nights=str((date.fromisoformat(checkout) - date.fromisoformat(checkin)).days))
    if cursor is not None:
        p["cursor"] = base64.b64encode(json.dumps({"section_offset": 0, "items_offset": cursor, "version": 1}, separators=(",", ":")).encode()).decode()
    return p


def dividir(a):
    mlat, mlng = (a["sw_lat"] + a["ne_lat"]) / 2, (a["sw_lng"] + a["ne_lng"]) / 2
    return [dict(sw_lat=a["sw_lat"], sw_lng=a["sw_lng"], ne_lat=mlat, ne_lng=mlng),
            dict(sw_lat=a["sw_lat"], sw_lng=mlng, ne_lat=mlat, ne_lng=a["ne_lng"]),
            dict(sw_lat=mlat, sw_lng=a["sw_lng"], ne_lat=a["ne_lat"], ne_lng=mlng),
            dict(sw_lat=mlat, sw_lng=mlng, ne_lat=a["ne_lat"], ne_lng=a["ne_lng"])]


def catalogo(area, achados, nivel=0):
    """Varre uma área; se ela tiver mais unidades do que a busca mostra (15 páginas), divide em 4."""
    pg = ler(baixar(params(area)))
    total = pg["total"]
    cheio = pg["mais_de"] or (total or 0) > POR_PAGINA * MAX_PAGINAS - 10 or (total is None and pg["paginas"] >= MAX_PAGINAS)
    if cheio and nivel < 5:
        for sub in dividir(area):
            catalogo(sub, achados, nivel + 1)
        return
    for u in pg["itens"]:
        achados.setdefault(u["id"], u)
    paginas = min(MAX_PAGINAS, max(pg["paginas"], math.ceil((total or 0) / POR_PAGINA)))
    for i in range(1, paginas):
        itens = ler(baixar(params(area, cursor=i * POR_PAGINA)))["itens"]
        if not itens:
            break
        for u in itens:
            achados.setdefault(u["id"], u)
    print(f"  área nível {nivel}: {total} anunciadas · catálogo acumulado {len(achados)}", flush=True)


# ---------------- datas ----------------
def pascoa(ano):
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    return date(ano, mes, (h + l - 7 * m + 114) % 31 + 1)


def feriados(ano):
    p = pascoa(ano)
    return {
        date(ano, 1, 1): "Ano Novo", p - timedelta(days=47): "Carnaval", p - timedelta(days=2): "Sexta-feira Santa",
        date(ano, 4, 21): "Tiradentes", date(ano, 5, 1): "Dia do Trabalho", p + timedelta(days=60): "Corpus Christi",
        date(ano, 9, 7): "Independência", date(ano, 10, 12): "N. Sra. Aparecida", date(ano, 11, 2): "Finados",
        date(ano, 11, 15): "Proclamação da República", date(ano, 11, 20): "Consciência Negra",
        date(ano, 12, 10): "Aniversário de Londrina", date(ano, 12, 25): "Natal", date(ano, 12, 31): "Réveillon",
    }


def plano(hoje, rapido=False):
    """Estadias de 2 noites a consultar. Retorna [(checkin, checkout, rótulo, tipo)]."""
    out = {}
    sexta = hoje + timedelta(days=(4 - hoje.weekday()) % 7 or 7)
    terca = hoje + timedelta(days=(1 - hoje.weekday()) % 7 or 7)
    semanas = 8 if rapido else 26
    for i in range(semanas):                                   # todo fim de semana dos próximos 6 meses
        d = sexta + timedelta(weeks=i)
        out[d] = (d, d + timedelta(days=2), "Fim de semana", "fds")
    for i in range(0, semanas, 2):                             # terça a quinta, a cada 2 semanas
        d = terca + timedelta(weeks=i)
        out.setdefault(d, (d, d + timedelta(days=2), "Dia útil", "util"))
    if not rapido:
        for mes in range(7, 13):                               # depois disso, um de cada por mês
            alvo = hoje + timedelta(days=30 * mes)
            for wd, rot, tp in ((4, "Fim de semana", "fds"), (1, "Dia útil", "util")):
                d = alvo + timedelta(days=(wd - alvo.weekday()) % 7)
                out.setdefault(d, (d, d + timedelta(days=2), rot, tp))
    for ano in (hoje.year, hoje.year + 1):
        for f, nome in feriados(ano).items():
            ini = f - timedelta(days=1)
            if hoje + timedelta(days=2) <= ini <= hoje + timedelta(days=364):
                out[ini] = (ini, ini + timedelta(days=2), nome, "feriado")
    return [v for _, v in sorted(out.items())]


def quantis_por_filtro(area, ci, co, total, chute):
    """Quartis do preço total da estadia usando o filtro "preço máximo" da busca.

    Cada consulta responde "quantas unidades livres custam até X". Com 3-4 pontos dessa curva
    a mediana e os quartis saem por interpolação. Os pontos partem da mediana da data anterior.
    """
    if not total:
        return None
    pts = {0: 0}
    for t in (round(chute * 0.6), round(chute), round(chute * 1.6)):
        p = params(area, ci, co)
        p["price_max"] = str(t)
        pts[t] = ler(baixar(p))["total"] or 0
    if max(pts.values()) < 0.78 * total:          # o 3º quartil ficou acima do maior ponto
        t = round(chute * 2.8)
        p = params(area, ci, co)
        p["price_max"] = str(t)
        pts[t] = ler(baixar(p))["total"] or 0
    curva = sorted(pts.items())
    res = []
    for q in (0.25, 0.5, 0.75):
        alvo = q * total
        val = None
        for (x0, y0), (x1, y1) in zip(curva, curva[1:]):
            if y0 <= alvo <= y1 and y1 > y0:
                val = x0 + (x1 - x0) * (alvo - y0) / (y1 - y0)
                break
        res.append(round(val) if val is not None else None)
    return res, [[x, y] for x, y in curva]


_chute = {"valor": 520}


def consulta_data(area, ci, co, com_preco=True):
    noites = (co - ci).days
    pg = ler(baixar(params(area, ci.isoformat(), co.isoformat())), noites)
    livres = pg["total"] if pg["total"] is not None else (1000 if pg["mais_de"] else None)
    out = dict(livres=livres, p25=None, mediana=None, p75=None, curva=None)
    if com_preco and livres:
        r = quantis_por_filtro(area, ci.isoformat(), co.isoformat(), livres, _chute["valor"])
        if r:
            (q1, q2, q3), curva = r
            if q2:
                _chute["valor"] = q2
            out.update(p25=q1 and round(q1 / noites), mediana=q2 and round(q2 / noites), p75=q3 and round(q3 / noites), curva=curva)
    out["amostra"] = sorted(u["diaria"] for u in pg["itens"] if u["diaria"])
    return out


# ---------------- prédios ----------------
def ids_predio(unidades, cfg):
    """unidades: linhas do londrina.json ([id, nome, tipo, bairro, lat, lon, ...])."""
    lat0, lon0 = cfg["centro"]
    r = cfg["raio"]
    return sorted(u[0] for u in unidades
                  if re.search(cfg["padrao"], u[1] or "", re.I) and abs(u[4] - lat0) <= r and abs(u[5] - lon0) <= r)


def consulta_predio(cfg, ids, ci, co):
    """Uma busca num retângulo pequeno em volta do prédio: lista as unidades livres e o preço de cada uma."""
    lat0, lon0 = cfg["centro"]
    r = cfg["raio"] * 1.4
    area = dict(sw_lat=lat0 - r, sw_lng=lon0 - r, ne_lat=lat0 + r, ne_lng=lon0 + r)
    noites = (co - ci).days
    alvo = set(ids)
    precos = {}
    pg = ler(baixar(params(area, ci.isoformat(), co.isoformat())), noites)
    paginas = min(5, max(1, math.ceil((pg["total"] or 0) / POR_PAGINA)))
    itens = list(pg["itens"])
    for i in range(1, paginas):
        itens += ler(baixar(params(area, ci.isoformat(), co.isoformat(), cursor=i * POR_PAGINA)), noites)["itens"]
    for u in itens:
        if u["id"] in alvo:
            precos[u["id"]] = u["diaria"]
    return dict(checkin=ci.isoformat(), checkout=co.isoformat(), livres=sorted(precos), precos=precos)


def atualizar_predios(saida, estadias):
    """Consulta os prédios nas estadias dadas e junta em saida["predios"] (substitui a mesma estadia)."""
    antigos = {p["nome"]: p for p in saida.get("predios", [])}
    novos = []
    for nome, cfg in PREDIOS.items():
        ids = ids_predio(saida["unidades"], cfg)
        if not ids:
            continue
        datas = {d["checkin"] + ":" + d["checkout"]: d for d in antigos.get(nome, {}).get("datas", [])}
        for ci, co in estadias:
            d = consulta_predio(cfg, ids, ci, co)
            datas[d["checkin"] + ":" + d["checkout"]] = d
            print(f"  {nome} {ci}: {len(d['livres'])}/{len(ids)} livres", flush=True)
        hoje = date.today().isoformat()
        novos.append(dict(nome=nome, centro=cfg["centro"], ids=ids,
                          datas=sorted((d for d in datas.values() if d["checkin"] > hoje), key=lambda d: d["checkin"])))
    saida["predios"] = novos
    return novos


# ---------------- polígono ----------------
def dentro(lat, lon, poligono):
    if lat is None or lon is None:
        return False
    for anel in poligono:
        x, y, ok = lon, lat, False
        for (x1, y1), (x2, y2) in zip(anel, anel[1:] + anel[:1]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                ok = not ok
        if ok:
            return True
    return False


def classifica(ci):
    """Rótulo e tipo de uma estadia que começa em ci (feriado no dia seguinte, fim de semana ou dia útil)."""
    for f, nome in {**feriados(ci.year), **feriados(ci.year + 1)}.items():
        if ci <= f <= ci + timedelta(days=1):
            return nome, "feriado"
    return ("Fim de semana", "fds") if ci.weekday() in (4, 5) else ("Dia útil", "util")


def atualizar_datas(estadias, origem):
    """Consulta só algumas datas e junta no londrina.json que já existe (sem refazer o catálogo).

    estadias: [(checkin, checkout, rotulo|None, tipo|None)]. Usado pela pesquisa de uma data no app
    ("--datas") e pela atualização rápida ("--rapido").
    """
    caminho = os.path.join(DADOS, "londrina.json")
    if not os.path.exists(caminho):
        raise SystemExit("ainda não há coleta completa — rode sem --datas/--rapido primeiro")
    with open(caminho, encoding="utf-8") as f:
        saida = json.load(f)
    if saida["amostras"]:
        medianas = [a["mediana"] * 2 for a in saida["amostras"][:6] if a.get("mediana")]
        if medianas:
            _chute["valor"] = sorted(medianas)[len(medianas) // 2]
    chave = lambda a: a["checkin"] + ":" + a["checkout"]   # 1 noite e 2 noites na mesma data são estadias diferentes
    por_data = {chave(a): a for a in saida["amostras"]}
    novas = []
    for ci, co, rot, tp in estadias:
        if not rot:
            rot, tp = classifica(ci)
        r = consulta_data(AREA, ci, co)
        a = dict(checkin=ci.isoformat(), checkout=co.isoformat(), rotulo=rot, tipo=tp, **r)
        if origem == "pesquisa":
            a["pesquisa"] = True
        antiga = por_data.get(chave(a))
        if antiga and antiga.get("pesquisa") and origem != "pesquisa":
            a["pesquisa"] = True
        por_data[chave(a)] = a
        novas.append(a)
        print(f"  {ci} {rot:24s} livres={r['livres']} mediana={r['mediana']}", flush=True)
    atualizar_predios(saida, [(ci, co) for ci, co, _, _ in estadias])
    hoje = date.today().isoformat()
    saida["amostras"] = sorted((a for a in por_data.values() if a["checkin"] > hoje), key=lambda a: a["checkin"])
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    saida["meta"]["atualizado"] = agora
    saida["meta"]["ultima_atualizacao"] = dict(tipo=origem, quando=agora, datas=[chave(a) for a in novas], pedidos=_pedidos)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))

    hpath = os.path.join(DADOS, "londrina-historico.json")
    hist = dict(coletas=[], avaliacoes={})
    if os.path.exists(hpath):
        with open(hpath, encoding="utf-8") as f:
            hist = json.load(f)
    dia = agora[:10]
    reg = next((c for c in hist["coletas"] if c["data"] == dia), None)
    if not reg:
        reg = dict(data=dia, unidades=len(saida["unidades"]), avaliacoes=sum(u[7] or 0 for u in saida["unidades"]),
                   fator=saida["meta"].get("fator_londrina", 1), datas=[], parcial=True)
        hist["coletas"].append(reg)
    def linha(a):   # 5ª coluna só quando a estadia não é de 2 noites
        r = [a["checkin"], a["livres"], a["mediana"], a["tipo"]]
        return r if (date.fromisoformat(a["checkout"]) - date.fromisoformat(a["checkin"])).days == 2 else r + [a["checkout"]]
    linhas = {d[0] + ":" + (d[4] if len(d) > 4 else ""): d for d in reg["datas"]}
    for a in novas:
        r = linha(a)
        linhas[r[0] + ":" + (r[4] if len(r) > 4 else "")] = r
    reg["datas"] = sorted(linhas.values())
    for pr in saida.get("predios", []):
        atual = {x[0]: x for x in reg.setdefault("predios", {}).get(pr["nome"], [])}
        for d in pr["datas"]:
            atual[d["checkin"]] = [d["checkin"], len(d["livres"]), len(pr["ids"])]
        reg["predios"][pr["nome"]] = sorted(atual.values())
    hist["coletas"].sort(key=lambda c: c["data"])
    with open(hpath, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
    print(f"ok: {len(novas)} datas atualizadas, {_pedidos} páginas consultadas", flush=True)


def plano_rapido(hoje):
    """Próximos 8 fins de semana, 4 dias úteis e os feriados dos próximos 4 meses."""
    return [e for e in plano(hoje, rapido=True) if e[3] != "feriado" or e[0] <= hoje + timedelta(days=120)]


def ler_datas(txt):
    """'2026-12-24' ou '2026-12-24:2026-12-27' ou '24/12/2026', separados por vírgula ou espaço."""
    out = []
    for parte in re.split(r"[,\s;]+", txt.strip()):
        if not parte:
            continue
        ini, _, fim = parte.partition(":")
        def d(x):
            m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", x)
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else date.fromisoformat(x)
        ci = d(ini)
        co = d(fim) if fim else ci + timedelta(days=2)
        if co <= ci or (co - ci).days > 30:
            raise SystemExit(f"período inválido: {parte}")
        if ci <= date.today():
            raise SystemExit(f"a data {parte} já passou")
        out.append((ci, co, None, None))
    return out[:10]


def ano_dia_a_dia(saida, dias=365, dias_predio=240):
    """Para cada dia do próximo ano (chegada no dia, 2 noites): quantas hospedagens de Londrina estão livres
    e, em cada prédio acompanhado, quais unidades estão livres e a diária média delas.
    1 página por dia para a cidade; os prédios (~4 páginas/dia, a região é densa) só até dias_predio,
    porque depois disso a maioria dos donos ainda não abriu a agenda. Salva em saida["ano"]."""
    hoje = date.today()
    cidade, predios = [], {}
    cfgs = {nome: (cfg, ids_predio(saida["unidades"], cfg)) for nome, cfg in PREDIOS.items()}
    for k in range(1, dias + 1):
        ci = hoje + timedelta(days=k)
        co = ci + timedelta(days=2)
        pg = ler(baixar(params(AREA, ci.isoformat(), co.isoformat())), 2)
        cidade.append(pg["total"] if pg["total"] is not None else None)
        for nome, (cfg, ids) in cfgs.items():
            if not ids:
                continue
            if k > dias_predio:
                predios.setdefault(nome, []).append(None)
                continue
            r = consulta_predio(cfg, ids, ci, co)
            precos = [v for v in r["precos"].values() if v]
            predios.setdefault(nome, []).append([len(r["livres"]), round(sum(precos) / len(precos)) if precos else None])
        if k % 30 == 0:
            print(f"  ano: {k}/{dias} dias", flush=True)
    saida["ano"] = dict(inicio=(hoje + timedelta(days=1)).isoformat(), noites=2, coleta=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        londrina=cidade, predios={n: dict(unidades=len(cfgs[n][1]), dias=v) for n, v in predios.items()})


def so_ano():
    caminho = os.path.join(DADOS, "londrina.json")
    with open(caminho, encoding="utf-8") as f:
        saida = json.load(f)
    ano_dia_a_dia(saida)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"ok: ano dia a dia, {_pedidos} páginas consultadas", flush=True)


def so_predios():
    caminho = os.path.join(DADOS, "londrina.json")
    with open(caminho, encoding="utf-8") as f:
        saida = json.load(f)
    estadias = [(date.fromisoformat(a["checkin"]), date.fromisoformat(a["checkout"])) for a in saida["amostras"]
                if (date.fromisoformat(a["checkout"]) - date.fromisoformat(a["checkin"])).days == 2]
    atualizar_predios(saida, estadias)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"ok: prédios em {len(estadias)} datas, {_pedidos} páginas consultadas", flush=True)


def main(args):
    if "--predios" in args:
        return so_predios()
    if "--ano" in args:
        return so_ano()
    if "--datas" in args:
        return atualizar_datas(ler_datas(args[args.index("--datas") + 1]), "pesquisa")
    if "--rapido" in args:
        return atualizar_datas(plano_rapido(date.today()), "rapida")
    rapido = False
    hoje = date.today()
    with open(os.path.join(os.path.dirname(__file__), "londrina.geojson"), encoding="utf-8") as f:
        geo = json.load(f)["geometry"]
    aneis = [geo["coordinates"][0]] if geo["type"] == "Polygon" else [p[0] for p in geo["coordinates"]]

    print("1/3 catálogo de unidades…", flush=True)
    achados = {}
    catalogo(AREA, achados)
    unidades = [u for u in achados.values() if dentro(u["lat"], u["lon"], aneis)]
    fora = len(achados) - len(unidades)
    print(f"  {len(unidades)} unidades em Londrina ({fora} de cidades vizinhas descartadas)", flush=True)
    if len(unidades) < 50:
        raise SystemExit("catálogo pequeno demais — a página do Airbnb provavelmente mudou; nada foi salvo")

    print("2/3 preço e disponibilidade por data…", flush=True)
    amostras = []
    for ci, co, rot, tp in plano(hoje, rapido):
        r = consulta_data(AREA, ci, co)
        amostras.append(dict(checkin=ci.isoformat(), checkout=co.isoformat(), rotulo=rot, tipo=tp, **r))
        print(f"  {ci} {rot:24s} livres={r['livres']} mediana={r['mediana']}", flush=True)

    print("3/3 zonas da cidade (um fim de semana por mês)…", flush=True)
    zonas = {z: [] for z in ZONAS}
    meses_vistos = set()
    for a in amostras:
        if a["tipo"] != "fds" or a["checkin"][:7] in meses_vistos or (rapido and len(meses_vistos) >= 2):
            continue
        meses_vistos.add(a["checkin"][:7])
        for z, area in ZONAS.items():
            r = consulta_data(area, date.fromisoformat(a["checkin"]), date.fromisoformat(a["checkout"]), com_preco=False)
            zonas[z].append(dict(checkin=a["checkin"], livres=r["livres"], amostra=r["amostra"]))
    em_zona = {z: sum(1 for u in unidades if a["sw_lat"] <= u["lat"] < a["ne_lat"] and a["sw_lng"] <= u["lon"] < a["ne_lng"])
               for z, a in ZONAS.items()}
    # o total "anunciado" numa área sem datas inclui vizinhos dentro do retângulo; a proporção
    # unidades-dentro / catálogo-da-área corrige as contagens por data para só Londrina
    fator = len(unidades) / max(1, len(achados))

    agora = datetime.now(timezone.utc)
    os.makedirs(DADOS, exist_ok=True)
    saida = dict(
        meta=dict(cidade="Londrina", uf="PR", coleta=agora.isoformat(timespec="seconds"), pedidos=_pedidos,
                  area=AREA, fator_londrina=round(fator, 4), fonte="Páginas públicas de busca do Airbnb (airbnb.com.br)"),
        unidades=[[u["id"], u["nome"], u["tipo"], u["bairro"], round(u["lat"], 5), round(u["lon"], 5), u["nota"], u["aval"],
                   u["diaria"], ano_entrada(u["id"]), 1 if any("Preferido" in s or "Superhost" in s for s in u["selos"]) else 0]
                  for u in sorted(unidades, key=lambda u: -u["aval"])],
        amostras=amostras,
        zonas=[dict(nome=z, unidades=em_zona[z], area=ZONAS[z], datas=zonas[z]) for z in ZONAS],
    )
    print("prédios acompanhados…", flush=True)
    atualizar_predios(saida, [(date.fromisoformat(a["checkin"]), date.fromisoformat(a["checkout"])) for a in amostras])
    print("ano dia a dia…", flush=True)
    ano_dia_a_dia(saida)
    with open(os.path.join(DADOS, "londrina.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))

    # histórico: uma linha por coleta, e as avaliações de cada unidade para medir procura real
    hpath = os.path.join(DADOS, "londrina-historico.json")
    hist = dict(coletas=[], avaliacoes={})
    if os.path.exists(hpath):
        with open(hpath, encoding="utf-8") as f:
            hist = json.load(f)
    dia = agora.date().isoformat()
    hist["coletas"] = [c for c in hist["coletas"] if c["data"] != dia]
    hist["coletas"].append(dict(data=dia, unidades=len(unidades), avaliacoes=sum(u["aval"] for u in unidades),
                                predios={p["nome"]: [[d["checkin"], len(d["livres"]), len(p["ids"])] for d in p["datas"]] for p in saida.get("predios", [])},
                                fator=round(fator, 4),
                                datas=[[a["checkin"], a["livres"], a["mediana"], a["tipo"]] for a in amostras]))
    hist["coletas"].sort(key=lambda c: c["data"])
    for u in unidades:
        serie = [p for p in hist["avaliacoes"].get(u["id"], []) if p[0] != dia]
        if not serie or serie[-1][1] != u["aval"]:
            serie.append([dia, u["aval"]])
        hist["avaliacoes"][u["id"]] = serie
    with open(hpath, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
    print(f"ok: {len(unidades)} unidades, {len(amostras)} datas, {_pedidos} páginas consultadas", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
