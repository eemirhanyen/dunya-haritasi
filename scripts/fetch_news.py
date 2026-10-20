#!/usr/bin/env python3
"""
Haber ve borsa verisi.

Her skorlanan ülke için GDELT DOC 2.0 API'den son 72 saatin haberlerini çeker:
  - yerel kaynaklar: ülkenin kendi medyası (sourcecountry, FIPS kodu)
  - uluslararası kaynaklar: ülke adını geçen İngilizce haberler (ülkenin
    kendi medyası hariç). Basın özgürlüğü düşük ülkelerde yerel medya tek
    başına yanıltıcı olacağı için iki kaynak birlikte tutulur.
Borsa verisi markets.json'daki ana endeksler için Yahoo Finance grafik
uç noktasından çekilir.

Çıktı: data/news.json
GDELT saniyede bir isteği kaldırmıyor (en fazla 5 saniyede bir); betik bu
yüzden ~30 dakika sürer.
"""

import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(ROOT, "data", "index.json")
OUT_PATH = os.path.join(ROOT, "data", "news.json")
FIPS = json.load(open(os.path.join(ROOT, "scripts", "fips.json"), encoding="utf-8"))
MARKETS = json.load(open(os.path.join(ROOT, "scripts", "markets.json"), encoding="utf-8"))

UA = {"User-Agent": "Mozilla/5.0 (compatible; dunya-haritasi/1.0; +https://github.com/eemirhanyen/dunya-haritasi)"}
GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_GAP = 5.5          # saniye; GDELT kuralı: 5 saniyede en fazla 1 istek
TIMESPAN = "72h"
LOCAL_MAX = 40
INTL_MAX = 40
KEEP_PER_SOURCE = 25

# Uluslararası basında farklı geçen adlar
ALIASES = {
    "TUR": ["Turkey", "Türkiye", "Turkiye"],
    "CIV": ["Ivory Coast", "Côte d'Ivoire"],
    "CZE": ["Czech Republic", "Czechia"],
    "MMR": ["Myanmar", "Burma"],
    "SWZ": ["Eswatini", "Swaziland"],
    "MKD": ["North Macedonia"],
    "COD": ["Democratic Republic of Congo", "DR Congo", "DRC"],
    "COG": ["Republic of Congo", "Congo-Brazzaville"],
    "KOR": ["South Korea"],
    "PRK": ["North Korea"],
    "RUS": ["Russia"],
    "IRN": ["Iran"],
    "SYR": ["Syria"],
    "LAO": ["Laos"],
    "VNM": ["Vietnam"],
    "GBR": ["United Kingdom", "Britain", "UK"],
    "USA": ["United States", "U.S."],
    "PSE": ["Palestine", "Palestinian", "Gaza", "West Bank"],
    "XKX": ["Kosovo"],
    "CPV": ["Cape Verde", "Cabo Verde"],
    "TLS": ["Timor-Leste", "East Timor"],
    "BOL": ["Bolivia"],
    "VEN": ["Venezuela"],
    "TZA": ["Tanzania"],
    "MDA": ["Moldova"],
    "EGY": ["Egypt"],
    "YEM": ["Yemen"],
    "GMB": ["Gambia"],
    "BHS": ["Bahamas"],
    "KGZ": ["Kyrgyzstan"],
    "SVK": ["Slovakia"],
    "FSM": ["Micronesia"],
    "STP": ["Sao Tome"],
    "LCA": ["Saint Lucia"],
    "VCT": ["Saint Vincent"],
    "KNA": ["Saint Kitts"],
    "BRN": ["Brunei"],
}


def log(m):
    print(m, flush=True)


def http_get(url, tries=3, gap=5):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:
                time.sleep(15 * (i + 1))
                continue
            if e.code in (400, 404):
                raise
        except Exception as e:  # ağ hatası, zaman aşımı
            last = e
        time.sleep(gap * (i + 1))
    raise RuntimeError(f"{url[:120]} -> {last}")


_last_gdelt = [0.0]


def gdelt(query, maxrecords):
    wait = GDELT_GAP - (time.time() - _last_gdelt[0])
    if wait > 0:
        time.sleep(wait)
    url = GDELT + "?" + urllib.parse.urlencode({
        "query": query, "mode": "artlist", "maxrecords": str(maxrecords),
        "timespan": TIMESPAN, "format": "json", "sort": "hybridrel",
    })
    try:
        raw = http_get(url)
    finally:
        _last_gdelt[0] = time.time()
    raw = raw.strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # GDELT sorgu hatalarını düz metin olarak döndürür
        raise RuntimeError(f"GDELT: {raw[:160]!r}")
    return data.get("articles", []) or []


def clean(articles, keep):
    seen, out = set(), []
    for a in articles:
        title = " ".join((a.get("title") or "").split())
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        sd = a.get("seendate") or ""
        try:
            ts = dt.datetime.strptime(sd, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc).isoformat()
        except ValueError:
            ts = None
        out.append({
            "title": title[:300], "url": a.get("url"), "domain": a.get("domain"),
            "lang": a.get("language"), "src": a.get("sourcecountry"), "time": ts,
        })
        if len(out) >= keep:
            break
    return out


def quote_name(n):
    return f'"{n}"' if " " in n or "-" in n or "'" in n or "." in n else n


def intl_query(iso, name, fips):
    names = ALIASES.get(iso, [name])
    names = [n for n in names if len(n) >= 3 or n in ("UK",)]
    terms = " OR ".join(quote_name(n) for n in names)
    terms = f"({terms})" if len(names) > 1 else terms
    excl = " ".join(f"-sourcecountry:{f}" for f in fips)
    return f"{terms} sourcelang:english {excl}".strip()


def local_query(fips):
    if len(fips) == 1:
        return f"sourcecountry:{fips[0]}"
    return "(" + " OR ".join(f"sourcecountry:{f}" for f in fips) + ")"


def market(symbol):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol)
           + "?range=3mo&interval=1d")
    data = json.loads(http_get(url, tries=2))
    res = data["chart"]["result"][0]
    closes = res["indicators"]["quote"][0]["close"]
    stamps = res["timestamp"]
    series = [(t, c) for t, c in zip(stamps, closes) if c is not None]
    if len(series) < 10:
        raise RuntimeError("yetersiz seri")
    last_t, last = series[-1]

    def change(days):
        cutoff = last_t - days * 86400
        prev = [c for t, c in series if t <= cutoff]
        return round((last / prev[-1] - 1) * 100, 2) if prev else None

    meta = res["meta"]
    return {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": meta.get("currency"),
        "last": round(last, 2),
        "as_of": dt.datetime.fromtimestamp(last_t, dt.timezone.utc).isoformat(),
        "chg_1d": round((last / series[-2][1] - 1) * 100, 2),
        "chg_1w": change(7),
        "chg_1m": change(30),
        "spark": [round(c, 2) for _, c in series[-30:]],
    }


def main():
    idx = json.load(open(INDEX_PATH, encoding="utf-8"))["countries"]
    targets = [iso for iso, c in idx.items() if c.get("index_score") is not None]
    only = os.environ.get("ONLY")  # test için: ONLY=TUR,GRC
    if only:
        targets = [t for t in targets if t in only.split(",")]
    log(f"{len(targets)} ülke için haber çekilecek (~{len(targets) * 2 * GDELT_GAP / 60:.0f} dk)")

    prev = {}
    if os.path.exists(OUT_PATH):
        try:
            prev = json.load(open(OUT_PATH, encoding="utf-8")).get("countries", {})
        except Exception:
            prev = {}

    out, failures = {}, []
    for n, iso in enumerate(targets, 1):
        c = idx[iso]
        fips = FIPS.get(iso)
        entry = {"local": [], "intl": [], "market": None}
        try:
            if fips:
                entry["local"] = clean(gdelt(local_query(fips), LOCAL_MAX), KEEP_PER_SOURCE)
            entry["intl"] = clean(gdelt(intl_query(iso, c["name"], fips or []), INTL_MAX), KEEP_PER_SOURCE)
        except Exception as e:
            failures.append(iso)
            log(f"  [{n}] {iso} HABER HATASI: {e}")
            if iso in prev:  # bir önceki günün haberini koru, ama işaretle
                entry["local"], entry["intl"] = prev[iso].get("local", []), prev[iso].get("intl", [])
                entry["stale"] = True
        if iso in MARKETS:
            try:
                entry["market"] = market(MARKETS[iso])
            except Exception as e:
                log(f"  [{n}] {iso} BORSA HATASI ({MARKETS[iso]}): {e}")
        out[iso] = entry
        if n % 10 == 0 or n == len(targets):
            log(f"  [{n}/{len(targets)}] {iso}: yerel {len(entry['local'])}, uluslararası {len(entry['intl'])}"
                + (f", borsa {entry['market']['chg_1d']}%" if entry["market"] else ""))

    if len(failures) > len(targets) * 0.3:
        log(f"HATA: {len(failures)} ülkede haber alınamadı; GDELT erişimi bozuk olabilir. news.json güncellenmedi.")
        sys.exit(1)

    json.dump({
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "timespan": TIMESPAN,
        "sources": {
            "news": "GDELT Project DOC 2.0 API (https://www.gdeltproject.org/)",
            "market": "Yahoo Finance",
        },
        "failures": failures,
        "countries": out,
    }, open(OUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"Yazıldı: {OUT_PATH} (hata: {len(failures)})")


if __name__ == "__main__":
    main()
