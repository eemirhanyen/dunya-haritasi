#!/usr/bin/env python3
"""
Endeks skoru üretici.

Beş boyutun verisini resmi kaynaklardan çeker, her göstergeyi dünya
genelinde yüzdelik dilime (0-100) çevirir ve data/index.json dosyasını
yazar. Yüzdelik dilim 50 = dünya ortası demektir.

Boyutlar (eşit ağırlık):
  1. Yönetişim        Dünya Bankası WGI: hükümet etkinliği, düzenleyici kalite,
                      siyasi istikrar, yolsuzluk kontrolü
  2. Ekonomi          Dünya Bankası: kişi başı GSYH (SAGP), enflasyon, işsizlik
  3. İnsani gelişme   UNDP İnsani Gelişme Endeksi (Our World in Data üzerinden)
  4. Yargı            V-Dem yargısal denetim endeksi (Our World in Data üzerinden)
  5. Medya            RSF Dünya Basın Özgürlüğü Endeksi

Herhangi bir öne çıkan ülke için bir boyut eksik kalırsa betik hata verir ve
mevcut veri dosyasının üzerine yazmaz. Çıktı: data/index.json.

Yalnızca Python standart kütüphanesi kullanır.
"""

import csv
import datetime as dt
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

# Bu ülkeler skorlanamazsa betik durur (kaynak bozulmasının işareti).
FEATURED = ["TUR", "GRC", "ISR"]
# Skorlanan ülke sayısı bunun altına düşerse betik durur.
MIN_SCORED = 120

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "data", "index.json")

UA = {"User-Agent": "dunya-haritasi/1.0 (+https://github.com/eemirhanyen/dunya-haritasi)"}

WB = "https://api.worldbank.org/v2"
OWID = "https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=full&useColumnShortNames=false"
RSF = "https://rsf.org/sites/default/files/import_classement/{year}.csv"

WGI = {
    "GOV_WGI_GE.EST": "Hükümet etkinliği",
    "GOV_WGI_RQ.EST": "Düzenleyici kalite",
    "GOV_WGI_PV.EST": "Siyasi istikrar",
    "GOV_WGI_CC.EST": "Yolsuzluk kontrolü",
}

ECON = {
    "NY.GDP.PCAP.PP.KD": "Kişi başı GSYH (SAGP, sabit 2021 $)",
    "FP.CPI.TOTL.ZG": "Enflasyon (TÜFE, %)",
    "SL.UEM.TOTL.ZS": "İşsizlik (%)",
}

# Askeri güç: genel skora KATILMAZ, ayrı gösterge ve katman olarak sunulur.
# SIPRI askeri harcama verisi ve silahlı kuvvetler personeli (Dünya Bankası üzerinden).
MIL = {
    "MS.MIL.XPND.CD": "Askeri harcama (cari $)",
    "MS.MIL.TOTL.P1": "Silahlı kuvvetler personeli",
}
MIL_INFO = {"MS.MIL.XPND.GD.ZS": "Askeri harcama (GSYH %)"}
MIL_MAX_AGE = 10   # personel verisi yavaş güncelleniyor

DEMO = {
    "SP.POP.TOTL": "Nüfus",
    "SP.DYN.LE00.IN": "Doğuşta yaşam beklentisi (yıl)",
    "SP.URB.TOTL.IN.ZS": "Kentsel nüfus (%)",
    "SP.POP.0014.TO.ZS": "0-14 yaş (%)",
    "SP.POP.65UP.TO.ZS": "65 yaş ve üstü (%)",
}

CURRENT_YEAR = dt.date.today().year
# Bundan eski veriler kullanılmaz; eski veri ülkeyi haksız yere öne/arkaya atar.
MAX_AGE_YEARS = 6

# Enflasyonda hedef: yüzde 2 civarı en iyi kabul edilir; hem yüksek
# enflasyon hem deflasyon kötü puan alır.
INFLATION_TARGET = 2.0


# ----------------------------------------------------------------- yardımcılar

def get(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"İndirilemedi: {url} ({last})")


def log(msg):
    print(msg, flush=True)


def percentile_map(values, higher_is_better=True):
    """{iso: ham_değer} -> {iso: yüzdelik 0-100}. Eşitlikler yarım sayılır."""
    items = [(k, v) for k, v in values.items() if v is not None and not math.isnan(v)]
    n = len(items)
    if n < 2:
        return {}
    vals = sorted(v for _, v in items)
    out = {}
    for k, v in items:
        below = sum(1 for x in vals if x < v)
        equal = sum(1 for x in vals if x == v)
        p = 100.0 * (below + 0.5 * equal) / n
        out[k] = p if higher_is_better else 100.0 - p
    return out


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


# ----------------------------------------------------------------- kaynaklar

def wb_countries():
    """Dünya Bankası ülke listesi (bölge toplamları hariç). ISO3 -> ad."""
    data = json.loads(get(f"{WB}/country?format=json&per_page=400"))
    out = {}
    for c in data[1]:
        if c["region"]["id"] != "NA":  # NA = bölge/gelir grubu toplamı
            out[c["id"]] = {"name": c["name"], "iso2": c["iso2Code"]}
    return out


def wb_indicator(code, source=None, max_age=None):
    """Her ülke için son MAX_AGE_YEARS içindeki en güncel değer: {iso: (değer, yıl)}.

    mrnev parametresi bazı WGI serilerinde çok eski yıl döndürdüğü için
    kullanılmıyor; yıl aralığı açıkça isteniyor ve en güncel yıl seçiliyor.
    """
    y1 = CURRENT_YEAR - (max_age or MAX_AGE_YEARS)
    out = {}
    page, pages = 1, 1
    while page <= pages:
        url = (f"{WB}/country/all/indicator/{code}?format=json&per_page=20000"
               f"&date={y1}:{CURRENT_YEAR}&page={page}")
        if source:
            url += f"&source={source}"
        data = json.loads(get(url))
        if not isinstance(data, list) or len(data) < 2 or data[1] is None:
            raise RuntimeError(f"Dünya Bankası göstergesi boş döndü: {code} -> {str(data)[:200]}")
        pages = int(data[0].get("pages", 1))
        for row in data[1]:
            iso = row.get("countryiso3code")
            if not iso or row.get("value") is None:
                continue
            y = int(row["date"])
            if iso not in out or y > out[iso][1]:
                out[iso] = (float(row["value"]), y)
        page += 1
    return out


def owid_latest(slug):
    """OWID grafik CSV'sinden her ülkenin en son değeri: {iso: (değer, yıl)}, sütun adı."""
    text = get(OWID.format(slug=slug)).decode("utf-8")
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    if header[:3] != ["Entity", "Code", "Year"]:
        raise RuntimeError(f"OWID {slug}: beklenmeyen başlık {header}")
    col = header[3]
    out = {}
    for row in reader:
        code, year, val = row[1], row[2], row[3]
        if len(code) != 3 or not val:
            continue
        y = int(year)
        if y < CURRENT_YEAR - MAX_AGE_YEARS:
            continue
        if code not in out or y > out[code][1]:
            out[code] = (float(val), y)
    return out, col


def parse_rsf_number(s):
    s = s.strip().replace("\xa0", "")
    if not s:
        return None
    if "," in s or "." in s:
        return float(s.replace(",", "."))
    v = float(s)
    # Bazı RSF dosyalarında ondalık ayırıcı düşmüş olabiliyor (ör. 2794 = 27.94).
    if v > 100:
        v = v / (10 ** (len(s.lstrip("-")) - 2))
    return v


def rsf_latest():
    """RSF basın özgürlüğü: en güncel yılın dosyası. {iso: (skor, yıl)}."""
    this_year = dt.date.today().year
    for year in range(this_year, this_year - 4, -1):
        try:
            raw = get(RSF.format(year=year), tries=2)
        except RuntimeError:
            continue
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        reader = csv.reader(io.StringIO(text), delimiter=";")
        header = [h.strip() for h in next(reader)]
        if "ISO" not in header:
            continue
        i_iso = header.index("ISO")
        score_cols = [i for i, h in enumerate(header) if h.startswith("Score") and "N-1" not in h and "evolution" not in h]
        if not score_cols:
            continue
        i_sc = score_cols[0]
        out = {}
        for row in reader:
            if len(row) <= max(i_iso, i_sc):
                continue
            v = parse_rsf_number(row[i_sc])
            if v is not None and 0 <= v <= 100:
                out[row[i_iso].strip()] = (v, year)
        if len(out) > 100:
            return out
    raise RuntimeError("RSF dosyası bulunamadı (son 4 yıl).")


# ----------------------------------------------------------------- ana akış

def main():
    log("Ülke listesi çekiliyor...")
    countries = wb_countries()
    universe = set(countries)
    log(f"  {len(universe)} ülke")

    raw = {}          # gösterge -> {iso: (değer, yıl)}
    labels = {}

    log("WGI çekiliyor...")
    for code, label in WGI.items():
        raw[code] = wb_indicator(code, source=3)
        labels[code] = label

    log("Ekonomi çekiliyor...")
    for code, label in ECON.items():
        raw[code] = wb_indicator(code)
        labels[code] = label

    log("Askeri veriler çekiliyor...")
    mil_raw = {}
    for code in list(MIL) + list(MIL_INFO):
        try:
            mil_raw[code] = wb_indicator(code, max_age=MIL_MAX_AGE)
            mil_raw[code] = {i: v for i, v in mil_raw[code].items() if i in universe}
            ys = sorted({y for _, y in mil_raw[code].values()})
            log(f"  {code}: {len(mil_raw[code])} ülke, yıllar {ys[0] if ys else '-'}-{ys[-1] if ys else '-'}")
        except RuntimeError as e:
            log(f"  UYARI: {e}")
    mil_pct = {code: percentile_map({i: v[0] for i, v in mil_raw.get(code, {}).items()}) for code in MIL}

    log("Demografi çekiliyor...")
    demo_raw = {}
    for code, label in DEMO.items():
        try:
            demo_raw[code] = wb_indicator(code)
        except RuntimeError as e:
            log(f"  UYARI: {e}")

    log("İnsani Gelişme Endeksi çekiliyor...")
    raw["HDI"], _ = owid_latest("human-development-index")
    labels["HDI"] = "İnsani Gelişme Endeksi"

    log("V-Dem yargısal denetim endeksi çekiliyor...")
    raw["VDEM_JUCON"], _ = owid_latest("judicial-constraints-on-the-executive-index")
    labels["VDEM_JUCON"] = "Yargısal denetim endeksi (V-Dem)"

    log("RSF basın özgürlüğü çekiliyor...")
    raw["RSF"] = rsf_latest()
    labels["RSF"] = "Basın özgürlüğü skoru (RSF)"

    # Evreni ülke listesiyle sınırla
    coverage = {}
    for k in raw:
        raw[k] = {iso: v for iso, v in raw[k].items() if iso in universe}
        years = sorted({y for _, y in raw[k].values()})
        log(f"  {k}: {len(raw[k])} ülke, yıllar {years[0] if years else '-'}-{years[-1] if years else '-'}")
        coverage[k] = {"countries": len(raw[k]), "years": [years[0], years[-1]] if years else []}

    # Yüzdelik dilimler
    def vals(k, f=lambda x: x):
        return {iso: f(v[0]) for iso, v in raw[k].items()}

    pct = {}
    for code in WGI:
        pct[code] = percentile_map(vals(code))
    pct["NY.GDP.PCAP.PP.KD"] = percentile_map(vals("NY.GDP.PCAP.PP.KD"))
    pct["FP.CPI.TOTL.ZG"] = percentile_map(
        vals("FP.CPI.TOTL.ZG", lambda x: abs(x - INFLATION_TARGET)), higher_is_better=False)
    pct["SL.UEM.TOTL.ZS"] = percentile_map(vals("SL.UEM.TOTL.ZS"), higher_is_better=False)
    pct["HDI"] = percentile_map(vals("HDI"))
    pct["VDEM_JUCON"] = percentile_map(vals("VDEM_JUCON"))
    pct["RSF"] = percentile_map(vals("RSF"))

    dims = {
        "governance": {"label": "Yönetişim", "parts": list(WGI), "min_parts": 3},
        "economy": {"label": "Ekonomi", "parts": list(ECON), "min_parts": 2},
        "human": {"label": "İnsani gelişme", "parts": ["HDI"], "min_parts": 1},
        "judiciary": {"label": "Yargı bağımsızlığı", "parts": ["VDEM_JUCON"], "min_parts": 1},
        "media": {"label": "Medya bağımsızlığı", "parts": ["RSF"], "min_parts": 1},
    }

    sources = {
        "governance": {"name": "Dünya Bankası, Worldwide Governance Indicators",
                       "url": "https://www.worldbank.org/en/publication/worldwide-governance-indicators"},
        "economy": {"name": "Dünya Bankası, World Development Indicators",
                    "url": "https://data.worldbank.org/"},
        "human": {"name": "UNDP İnsani Gelişme Raporu (Our World in Data)",
                  "url": "https://ourworldindata.org/grapher/human-development-index"},
        "judiciary": {"name": "V-Dem (Our World in Data)",
                      "url": "https://ourworldindata.org/grapher/judicial-constraints-on-the-executive-index"},
        "media": {"name": "Sınır Tanımayan Gazeteciler (RSF), Dünya Basın Özgürlüğü Endeksi",
                  "url": "https://rsf.org/en/index"},
    }

    result = {}
    for iso in sorted(universe):
        entry = {"iso3": iso, "iso2": countries[iso]["iso2"], "name": countries[iso]["name"], "dimensions": {}, "demographics": {}}
        dim_scores, missing = [], []
        for dk, d in dims.items():
            parts = []
            for code in d["parts"]:
                if iso in pct[code]:
                    v, y = raw[code][iso]
                    parts.append({
                        "code": code, "label": labels[code],
                        "value": round(v, 4), "year": y,
                        "percentile": round(pct[code][iso], 1),
                    })
            if len(parts) < d["min_parts"]:
                missing.append(d["label"])
                continue
            score = mean(p["percentile"] for p in parts)
            dim_scores.append(score)
            entry["dimensions"][dk] = {
                "label": d["label"], "score": round(score, 1),
                "parts": parts, "source": sources[dk],
            }
        for code, label in DEMO.items():
            if code in demo_raw and iso in demo_raw[code]:
                v, y = demo_raw[code][iso]
                entry["demographics"][code] = {"label": label, "value": v, "year": y}
        # Skor yalnızca beş boyutun hepsi varsa hesaplanır; eksik boyutla
        # hesaplamak ülkeyi diğerleriyle karşılaştırılamaz hale getirir.
        if missing:
            entry["index_score"] = None
            entry["missing"] = missing
        else:
            entry["index_score"] = round(mean(dim_scores), 1)
        # Askeri güç: harcama zorunlu, personel varsa ortalamaya girer
        mparts = []
        for code, label in MIL.items():
            if iso in mil_pct.get(code, {}):
                v, y = mil_raw[code][iso]
                mparts.append({"code": code, "label": label, "value": round(v, 2), "year": y,
                               "percentile": round(mil_pct[code][iso], 1)})
        for code, label in MIL_INFO.items():
            if iso in mil_raw.get(code, {}):
                v, y = mil_raw[code][iso]
                mparts.append({"code": code, "label": label, "value": round(v, 2), "year": y, "percentile": None})
        if any(p["code"] == "MS.MIL.XPND.CD" for p in mparts):
            scored = [p["percentile"] for p in mparts if p["percentile"] is not None]
            entry["military"] = {
                "score": round(mean(scored), 1), "parts": mparts,
                "source": {"name": "SIPRI ve IISS (Dünya Bankası, World Development Indicators)",
                           "url": "https://data.worldbank.org/indicator/MS.MIL.XPND.CD"},
            }
        entry["ai_score"] = None
        entry["final_score"] = entry["index_score"]
        result[iso] = entry

    scored = [iso for iso, e in result.items() if e["index_score"] is not None]
    log(f"Skorlanan ülke: {len(scored)} / {len(result)}")
    bad = [iso for iso in FEATURED if result.get(iso, {}).get("index_score") is None]
    if bad or len(scored) < MIN_SCORED:
        log(f"HATA: eksik veri (öncelikli ülkeler: {bad}, skorlanan: {len(scored)} < {MIN_SCORED}?). "
            "Kaynaklardan biri bozulmuş olabilir; data/index.json güncellenmedi.")
        sys.exit(1)

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "method": {
            "description": "Her gösterge dünya genelinde yüzdelik dilime çevrilir (50 = dünya ortası). "
                           "Beş boyut eşit ağırlıklıdır. Beş boyutun hepsinde verisi olmayan ülke skorlanmaz.",
            "thresholds": {"red_below": 33.3, "green_from": 66.7},
            "inflation_target": INFLATION_TARGET,
            "universe_size": len(universe),
            "max_age_years": MAX_AGE_YEARS,
            "coverage": coverage,
        },
        "countries": result,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log(f"Yazıldı: {OUT_PATH}")
    for iso in FEATURED:
        e = result[iso]
        dims_txt = ", ".join(f"{d['label']} {d['score']}" for d in e["dimensions"].values())
        log(f"  {iso} {e['index_score']} | {dims_txt}")
    no = sorted((iso, e["missing"]) for iso, e in result.items() if e.get("missing"))
    log(f"Skorlanamayan {len(no)} ülke: " + "; ".join(f"{i} ({', '.join(m)})" for i, m in no))


if __name__ == "__main__":
    main()
