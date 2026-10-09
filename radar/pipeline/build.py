#!/usr/bin/env python3
"""Radar de Hospedagem — gera os dados do app a partir da Inside Airbnb.

Fonte: https://insideairbnb.com (dados públicos, licença CC BY 4.0, sem API paga).
Só usa a biblioteca padrão do Python + curl.

Uso:
  python3 radar/pipeline/build.py rio-de-janeiro são-paulo lisbon
  python3 radar/pipeline/build.py --list            # mostra todas as cidades disponíveis
  python3 radar/pipeline/build.py --from-file radar/pipeline/cidades.txt

Para cada cidade grava:
  radar/data/<cidade>.json         agregados (demanda histórica, preços, 365 dias à frente, bairros)
  radar/data/<cidade>.units.json   todas as unidades com disponibilidade
  radar/data/history/<cidade>.json preços de cada coleta — acumula a cada execução,
                                   então o histórico de preço cresce sozinho com o tempo
  radar/data/index.json            lista das cidades prontas
"""
import csv, gzip, json, os, re, shutil, statistics, subprocess, sys, tempfile, time, unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

csv.field_size_limit(1 << 30)
SITE = "https://insideairbnb.com"
RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DADOS = os.path.join(RAIZ, "data")

# Modelo de ocupação da própria Inside Airbnb: ~50% dos hóspedes deixam avaliação,
# estadia média de 3 noites. Usado só para converter avaliações em noites estimadas.
TAXA_AVALIACAO = 0.5
NOITES_POR_ESTADIA = 3

TIPOS = {"Entire home/apt": "Imóvel inteiro", "Private room": "Quarto privado",
         "Shared room": "Quarto compartilhado", "Hotel room": "Quarto de hotel"}


def baixar(url, destino, tentativas=4):
    for i in range(tentativas):
        r = subprocess.run(["curl", "-sSfL", "--retry", "2", "-o", destino, url])
        if r.returncode == 0:
            return True
        time.sleep(2 ** (i + 1))
    return False


def baixar_texto(url):
    with tempfile.NamedTemporaryFile(delete=False) as t:
        caminho = t.name
    try:
        if not baixar(url, caminho):
            raise RuntimeError(f"não consegui baixar {url}")
        with open(caminho, encoding="utf-8") as f:
            return f.read()
    finally:
        os.unlink(caminho)


def catalogo():
    """Todas as coletas publicadas (cada cidade tem a atual + trimestrais dos últimos 12 meses)."""
    pagina = json.loads(baixar_texto(f"{SITE}/page-data/get-the-data/page-data.json"))
    for h in pagina.get("staticQueryHashes", []):
        try:
            d = json.loads(baixar_texto(f"{SITE}/page-data/sq/d/{h}.json"))
        except Exception:
            continue
        sets = (d.get("data") or {}).get("allData", {}).get("datasets")
        if sets:
            return sets
    raise RuntimeError("catálogo da Inside Airbnb não encontrado")


def cidades(sets):
    por = defaultdict(list)
    for s in sets:
        por[s["link"]].append(s)
    for v in por.values():
        v.sort(key=lambda s: s["publishDate"], reverse=True)
    return por


def abrir_csv(caminho):
    f = gzip.open(caminho, "rt", encoding="utf-8", newline="") if caminho.endswith(".gz") \
        else open(caminho, encoding="utf-8", newline="")
    return csv.DictReader(f)


def preco(txt):
    if not txt:
        return None
    try:
        v = float(re.sub(r"[^0-9.]", "", txt))
    except ValueError:
        return None
    return v if v > 0 else None


def num(txt, tipo=float):
    try:
        return tipo(txt)
    except (TypeError, ValueError):
        return None


def mediana(v):
    return round(statistics.median(v), 2) if v else None


def quantil(v, q):
    if not v:
        return None
    v = sorted(v)
    return round(v[min(len(v) - 1, int(q * (len(v) - 1) + 0.5))], 2)


def limpa_precos(v):
    """Corta anúncios com preço absurdo (erros de cadastro) — acima do percentil 99,5."""
    if len(v) < 20:
        return v
    teto = quantil(v, 0.995)
    return [x for x in v if x <= teto]


def slug(link):
    """Nome de arquivo só com ASCII (são-paulo → sao-paulo)."""
    return unicodedata.normalize("NFKD", link).encode("ascii", "ignore").decode()


def mes(d):
    return d[:7]


def gerar(link, coletas, tmp):
    atual = coletas[0]
    base = atual["dataRoot"] + atual["publishDate"] + "/"
    print(f"→ {atual['city']} ({atual['publishDate']})", flush=True)

    arq = {k: os.path.join(tmp, k) for k in ("listings.csv.gz", "calendar.csv.gz", "reviews.csv")}
    for nome, sub in (("listings.csv.gz", "data/"), ("calendar.csv.gz", "data/"), ("reviews.csv", "visualisations/")):
        if not baixar(base + sub + nome, arq[nome]):
            raise RuntimeError(f"falhou {base + sub + nome}")

    # ---------- anúncios (coleta atual) ----------
    moedas = Counter()
    bairros_idx, tipos_idx = {}, {}
    unidades, info = [], {}
    for x in abrir_csv(arq["listings.csv.gz"]):
        lid = x["id"]
        p = preco(x.get("price"))
        m = re.search(r'"currency":\s*"([A-Z]{3})"', x.get("price_quote_raw") or "")
        if m:
            moedas[m.group(1)] += 1
        occ = num(x.get("estimated_occupancy_l365d"), int)
        a30 = num(x.get("availability_30"), int) or 0
        a365 = num(x.get("availability_365"), int) or 0
        ltm = num(x.get("number_of_reviews_ltm"), int) or 0
        bairro = x.get("neighbourhood_cleansed") or "—"
        tipo = TIPOS.get(x.get("room_type"), x.get("room_type") or "—")
        bi = bairros_idx.setdefault(bairro, len(bairros_idx))
        ti = tipos_idx.setdefault(tipo, len(tipos_idx))
        info[lid] = dict(p=p, occ=occ, a30=a30, a365=a365, ltm=ltm, b=bairro, t=tipo,
                         rev=num(x.get("estimated_revenue_l365d"), float),
                         minn=num(x.get("minimum_nights"), int) or 1)
        if a365 > 0:
            nome = (x.get("name") or "").strip()
            unidades.append([
                lid, nome[:60], bi, ti,
                round(p) if p else None, occ, a30, a365, ltm,
                num(x.get("review_scores_rating"), float),
                round(num(x.get("latitude")) or 0, 4), round(num(x.get("longitude")) or 0, 4),
                num(x.get("accommodates"), int), num(x.get("bedrooms"), float),
                num(x.get("calculated_host_listings_count"), int),
            ])
    moeda = moedas.most_common(1)[0][0] if moedas else "USD"

    precos_validos = limpa_precos([i["p"] for i in info.values() if i["p"]])
    teto = max(precos_validos) if precos_validos else 0
    ativos = {k for k, i in info.items() if i["ltm"] > 0}   # tiveram hóspede nos últimos 12 meses

    # ---------- bairros ----------
    porb = defaultdict(list)
    for i in info.values():
        porb[i["b"]].append(i)
    bairros = []
    for b, L in porb.items():
        ps = [i["p"] for i in L if i["p"] and i["p"] <= teto]
        oc = [i["occ"] for i in L if i["occ"] is not None and i["ltm"] > 0]
        rv = [i["rev"] for i in L if i["rev"] and i["ltm"] > 0]
        bairros.append(dict(nome=b, n=len(L), ativos=sum(1 for i in L if i["ltm"] > 0),
                            preco=mediana(ps), ocup=round(statistics.median(oc) / 365 * 100, 1) if oc else None,
                            receita=mediana(rv), disp30=round(statistics.mean(i["a30"] for i in L), 1)))
    bairros.sort(key=lambda b: -b["n"])

    # ---------- tipos ----------
    port = defaultdict(list)
    for i in info.values():
        port[i["t"]].append(i)
    tipos = [dict(nome=t, n=len(L), preco=mediana([i["p"] for i in L if i["p"] and i["p"] <= teto]),
                  ocup=round(statistics.median([i["occ"] for i in L if i["occ"] is not None and i["ltm"] > 0] or [0]) / 365 * 100, 1))
             for t, L in sorted(port.items(), key=lambda kv: -len(kv[1]))]

    # ---------- faixa de preço ----------
    faixas = []
    if precos_validos:
        p95 = quantil(precos_validos, 0.95)
        passo = max(1, round(p95 / 20 / 10) * 10) if p95 > 200 else max(1, round(p95 / 20))
        cont = Counter(min(int(p // passo), 20) for p in precos_validos)
        faixas = [[k * passo, cont.get(k, 0)] for k in range(21)]

    # ---------- demanda histórica (avaliações por mês, desde o primeiro anúncio) ----------
    por_mes = Counter()
    primeira, ultima = {}, {}
    for x in abrir_csv(arq["reviews.csv"]):
        lid, d = x["listing_id"], x["date"]
        if not d:
            continue
        por_mes[mes(d)] += 1
        if lid not in primeira or d < primeira[lid]:
            primeira[lid] = d
        if lid not in ultima or d > ultima[lid]:
            ultima[lid] = d
    ativos_mes = Counter()
    for lid, d0 in primeira.items():
        ativos_mes[mes(d0)] += 1
        d1 = datetime.strptime(mes(ultima[lid]) + "-01", "%Y-%m-%d")
        prox = (d1.replace(day=28) + timedelta(days=4)).strftime("%Y-%m")
        ativos_mes[prox] -= 1
    demanda = []
    if por_mes:
        ini = min(por_mes)
        fim = mes(atual["publishDate"])
        a, m_ = int(ini[:4]), int(ini[5:])
        acum = 0
        while f"{a:04d}-{m_:02d}" <= fim:
            k = f"{a:04d}-{m_:02d}"
            acum += ativos_mes.get(k, 0)
            dias = ((date(a + (m_ == 12), m_ % 12 + 1, 1)) - date(a, m_, 1)).days
            rev = por_mes.get(k, 0)
            noites = rev / TAXA_AVALIACAO * NOITES_POR_ESTADIA
            ocup = round(min(100, noites / (acum * dias) * 100), 1) if acum else None
            demanda.append([k, rev, acum, ocup])
            m_ += 1
            if m_ > 12:
                a, m_ = a + 1, 1
        # o mês da coleta está incompleto
        if demanda and demanda[-1][0] == fim:
            demanda.pop()

    # sazonalidade: média de cada mês do ano relativa à média do próprio ano (só anos completos)
    anos = defaultdict(dict)
    for k, rev, ativ, oc in demanda:
        if ativ >= 30:
            anos[k[:4]][int(k[5:])] = rev / ativ
    saz_vals = defaultdict(list)
    for ano, ms in anos.items():
        if len(ms) == 12 and ano not in ("2020", "2021"):   # pandemia distorce
            med = statistics.mean(ms.values())
            for mm, v in ms.items():
                saz_vals[mm].append(v / med * 100)
    sazonalidade = [round(statistics.mean(saz_vals[mm]), 1) if saz_vals[mm] else None for mm in range(1, 13)]

    # ---------- próximos 365 dias (calendário) ----------
    # Muitos anfitriões só abrem a agenda alguns meses à frente: o resto aparece como "fechado"
    # sem ser reserva. Por isso cada anúncio só conta até a última noite que ele deixou aberta.
    disp_dia = Counter()
    janela = Counter()          # anúncios ativos cuja agenda já cobre aquela noite
    livres_ativos = Counter()
    ultima_livre = {}
    for x in abrir_csv(arq["calendar.csv.gz"]):
        if x["available"] == "t" and x["date"] > ultima_livre.get(x["listing_id"], ""):
            ultima_livre[x["listing_id"]] = x["date"]
    for x in abrir_csv(arq["calendar.csv.gz"]):
        lid, d = x["listing_id"], x["date"]
        livre = x["available"] == "t"
        if livre:
            disp_dia[d] += 1
        if lid in ativos and lid in ultima_livre and d <= ultima_livre[lid]:
            janela[d] += 1
            if livre:
                livres_ativos[d] += 1
    futuro = [[d, disp_dia[d], round(100 - livres_ativos[d] / janela[d] * 100, 1) if janela[d] >= 30 else None, janela[d]]
              for d in sorted(disp_dia | janela)]
    futuro = [f for f in futuro if f[0] > atual["publishDate"]][:365]

    # ---------- preço em cada coleta (atual + trimestrais) ----------
    coletas_preco = []
    p_atual = {k: i["p"] for k, i in info.items() if i["p"] and i["p"] <= teto}
    for c in coletas:
        if c is atual:
            precos = p_atual
            tipo_de = {k: info[k]["t"] for k in p_atual}
            oferta = len(info)
        else:
            caminho = os.path.join(tmp, "hist.csv")
            url = c["dataRoot"] + c["publishDate"] + "/visualisations/listings.csv"
            if not baixar(url, caminho):
                print(f"  (sem {url})")
                continue
            precos, tipo_de, oferta = {}, {}, 0
            for x in abrir_csv(caminho):
                oferta += 1
                p = preco(x.get("price"))
                if p:
                    precos[x["id"]] = p
                    tipo_de[x["id"]] = TIPOS.get(x.get("room_type"), x.get("room_type"))
            os.unlink(caminho)
            v = limpa_precos(list(precos.values()))
            t2 = max(v) if v else 0
            precos = {k: p for k, p in precos.items() if p <= t2}
        vals = list(precos.values())
        if not vals:
            # algumas coletas da Inside Airbnb saíram sem preço; a oferta ainda vale
            coletas_preco.append(dict(data=c["publishDate"], oferta=oferta, anuncios=0, mediana=None))
            continue
        # índice pareado: mesmos anúncios nas duas coletas, para não confundir preço com mudança de oferta
        comuns = [precos[k] / p_atual[k] for k in precos.keys() & p_atual.keys()]
        portipo = defaultdict(list)
        for k, p in precos.items():
            portipo[tipo_de.get(k)].append(p)
        coletas_preco.append(dict(
            data=c["publishDate"], oferta=oferta, anuncios=len(vals), mediana=mediana(vals),
            p25=quantil(vals, .25), p75=quantil(vals, .75), media=round(statistics.mean(vals), 2),
            indice=round(statistics.median(comuns) * 100, 1) if len(comuns) > 50 else None,
            portipo={t: mediana(v) for t, v in portipo.items() if t and len(v) >= 10},
        ))

    # histórico acumulado: junta com o que já foi salvo em execuções anteriores
    hdir = os.path.join(DADOS, "history")
    os.makedirs(hdir, exist_ok=True)
    hpath = os.path.join(hdir, f"{slug(link)}.json")
    hist = {}
    if os.path.exists(hpath):
        with open(hpath, encoding="utf-8") as f:
            hist = {c["data"]: c for c in json.load(f).get("coletas", [])}
    for c in coletas_preco:
        hist[c["data"]] = c   # índice pareado é recalculado contra a coleta atual
    hist_lista = sorted(hist.values(), key=lambda c: c["data"])
    with open(hpath, "w", encoding="utf-8") as f:
        json.dump({"cidade": link, "moeda": moeda, "coletas": hist_lista}, f, ensure_ascii=False, separators=(",", ":"))

    # ---------- números de capa ----------
    occs = [i["occ"] for k, i in info.items() if k in ativos and i["occ"] is not None]
    revs = [i["rev"] for k, i in info.items() if k in ativos and i["rev"]]
    kpi = dict(
        anuncios=len(info), ativos=len(ativos), com_disponibilidade=len(unidades),
        disp_30=sum(1 for i in info.values() if i["a30"] > 0),
        preco_mediano=mediana(precos_validos),
        ocupacao_mediana=round(statistics.median(occs) / 365 * 100, 1) if occs else None,
        receita_mediana=mediana(revs),
        anfitrioes_multi=round(sum(1 for u in unidades if (u[14] or 0) > 1) / max(1, len(unidades)) * 100, 1),
    )

    meta = dict(cidade=atual["city"], regiao=atual.get("region"), pais=atual["country"], link=link, arquivo=slug(link),
                coleta=atual["publishDate"], moeda=moeda, gerado=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                fonte=atual["dataRoot"] + atual["publishDate"] + "/",
                modelo=dict(taxa_avaliacao=TAXA_AVALIACAO, noites_por_estadia=NOITES_POR_ESTADIA))
    saida = dict(meta=meta, kpi=kpi, demanda=demanda, sazonalidade=sazonalidade, futuro=futuro,
                 coletas=hist_lista, bairros=bairros, tipos=tipos, faixas=faixas)
    with open(os.path.join(DADOS, f"{slug(link)}.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DADOS, f"{slug(link)}.units.json"), "w", encoding="utf-8") as f:
        json.dump(dict(bairros=list(bairros_idx), tipos=list(tipos_idx), unidades=unidades),
                  f, ensure_ascii=False, separators=(",", ":"))
    return dict(link=link, arquivo=slug(link), cidade=atual["city"], pais=atual["country"], regiao=atual.get("region"),
                coleta=atual["publishDate"], moeda=moeda, anuncios=len(info),
                preco=kpi["preco_mediano"], ocup=kpi["ocupacao_mediana"])


def atualizar_indice(novas, todas):
    caminho = os.path.join(DADOS, "index.json")
    atual = {}
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            atual = {c["link"]: c for c in json.load(f).get("prontas", [])}
    for c in novas:
        atual[c["link"]] = c
    disponiveis = sorted({(v[0]["link"], v[0]["city"] or v[0]["link"], v[0]["country"] or "") for v in todas.values()}, key=lambda t: (t[2], t[1]))
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dict(atualizado=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                       prontas=sorted(atual.values(), key=lambda c: (c["pais"] or "", c["cidade"] or "")),
                       disponiveis=[dict(link=l, cidade=c, pais=p) for l, c, p in disponiveis]),
                  f, ensure_ascii=False, indent=1)


def main(args):
    todas = cidades(catalogo())
    if "--list" in args:
        for link, v in sorted(todas.items(), key=lambda kv: (kv[1][0]["country"] or "", kv[1][0]["city"] or "")):
            print(f"{link:40s} {v[0]['city']}, {v[0]['country']}  ({len(v)} coletas, última {v[0]['publishDate']})")
        return
    pedidas = []
    if "--from-file" in args:
        with open(args[args.index("--from-file") + 1], encoding="utf-8") as f:
            pedidas = [l.split("#")[0].strip() for l in f if l.split("#")[0].strip()]
    else:
        pedidas = [a for a in args if not a.startswith("--")]
    os.makedirs(DADOS, exist_ok=True)
    feitas, falhas = [], []
    for link in pedidas:
        if link not in todas:
            print(f"✗ cidade desconhecida: {link} (use --list)")
            falhas.append(link)
            continue
        tmp = tempfile.mkdtemp(prefix="radar-")
        try:
            feitas.append(gerar(link, todas[link], tmp))
        except Exception as e:
            print(f"✗ {link}: {e}")
            falhas.append(link)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    atualizar_indice(feitas, todas)
    print(f"ok: {len(feitas)}  falhas: {len(falhas)} {falhas if falhas else ''}")
    if falhas and not feitas:
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
