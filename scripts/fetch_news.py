#!/usr/bin/env python3
"""
Haber ve borsa verisi.

Haberler GDELT 2.0 GKG ham dosyalarından gelir (her 15 dakikada bir
yayımlanan, dünya genelindeki haberlerin işlenmiş listesi). GDELT'in arama
API'si GitHub sunucularını sık sık reddettiği için ham dosyalar kullanılıyor:
sorgu sınırı yok, veri aynı.

  - Son HOURS saatin İngilizce ve çeviri (65 dil) GKG dosyaları indirilir.
  - Her haberin geçtiği ülkeler GKG konum alanından okunur.
  - Bir haber, en çok adı geçen ülkeye ya da en az MIN_MENTIONS kez geçen
    ülkelere atanır.
  - Haberin yayın ülkesi alan adından bulunur (GDELT alan adı-ülke listesi,
    yoksa ülke uzantısı). Yayın ülkesi = haber ülkesi ise "yerel", değilse
    "uluslararası" sayılır.
  - GDELT'in ton ölçümü (negatif = olumsuz dil) ülke bazında ortalanır ve
    AI değerlendirmesine ek sinyal olarak verilir.

Borsa verisi markets.json'daki ana endeksler için Yahoo Finance grafik uç
noktasından çekilir.

Çıktı: data/news.json
"""

import concurrent.futures as cf
import datetime as dt
import html
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(ROOT, "data", "index.json")
OUT_PATH = os.path.join(ROOT, "data", "news.json")
FIPS = json.load(open(os.path.join(ROOT, "scripts", "fips.json"), encoding="utf-8"))
MARKETS = json.load(open(os.path.join(ROOT, "scripts", "markets.json"), encoding="utf-8"))

UA = {"User-Agent": "Mozilla/5.0 (compatible; dunya-haritasi/1.0; +https://github.com/eemirhanyen/dunya-haritasi)"}
GDELT_BASE = "http://data.gdeltproject.org/gdeltv2/"
DOMAINS_URL = ("http://data.gdeltproject.org/blog/2018-news-outlets-by-country-may2018-update/"
               "MASTER-GDELTDOMAINSBYCOUNTRY-MAY2018.TXT")

HOURS = int(os.environ.get("NEWS_HOURS", "24"))
MIN_MENTIONS = 3          # ana ülke değilse en az bu kadar geçmeli
KEEP_PER_SOURCE = 25
CANDIDATES = 400          # ülke başına sıralamaya giren aday sayısı
WORKERS = 8

TITLE_RE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)
SRCLANG_RE = re.compile(r"srclc:(\w+)")
# Başlıklarda sık görülen site adı ekleri: "Başlık - Site" / "Başlık | Site"
TITLE_TAIL_RE = re.compile(r"\s+[|\-–—]\s+[^|\-–—]{2,40}$")


def log(m):
    print(m, flush=True)


def http_get(url, tries=3, timeout=120):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last = e
        except Exception as e:
            last = e
        time.sleep(5 * (i + 1))
    raise RuntimeError(f"{url[:120]} -> {last}")


# ----------------------------------------------------------------- GDELT GKG

def slots(hours):
    """Son `hours` saatin 15 dakikalık zaman damgaları (en yeni önce)."""
    now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=20)  # yayın gecikmesi
    now = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0)
    return [(now - dt.timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S") for i in range(hours * 4)]


def domain_countries():
    """Alan adı -> FIPS ülke kodu. GDELT'in yayımladığı liste; erişilemezse boş."""
    try:
        text = http_get(DOMAINS_URL, tries=2).decode("utf-8", "replace")
    except Exception as e:
        log(f"  UYARI: alan adı-ülke listesi alınamadı ({e}); yalnızca ülke uzantısı kullanılacak")
        return {}
    out = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[1].strip():
            out[parts[0].strip().lower()] = parts[1].strip().upper()
    return out


def parse_gkg(raw, translated):
    """Bir GKG dosyasından (url, domain, title, time, tone, {fips: sayı}, dil) kayıtları üretir."""
    text = raw.decode("utf-8", "replace")
    for line in text.split("\n"):
        f = line.split("\t")
        if len(f) < 27 or f[2] != "1":      # 1 = web haberi
            continue
        m = TITLE_RE.search(f[26])
        if not m:
            continue
        title = " ".join(html.unescape(m.group(1)).split())
        if len(title) < 15:
            continue
        counts = defaultdict(int)
        for loc in f[10].split(";"):         # V2Locations
            p = loc.split("#")
            if len(p) > 2 and p[2]:          # Tür#Ad#ÜlkeKodu(FIPS)#...
                counts[p[2]] += 1
        if not counts:
            continue
        try:
            tone = float(f[15].split(",")[0])
        except ValueError:
            tone = None
        lang = "en"
        if translated:
            lm = SRCLANG_RE.search(f[25])
            lang = lm.group(1) if lm else None
        yield f[4], f[3].lower(), title, f[1], tone, counts, lang


def download(stamp, kind):
    name = f"{stamp}.{'translation.' if kind == 'tr' else ''}gkg.csv.zip"
    try:
        raw = http_get(GDELT_BASE + name, tries=2)
    except urllib.error.HTTPError:
        return stamp, kind, None          # GDELT bazen bir dilimi atlar
    except Exception as e:
        log(f"  UYARI: {name}: {e}")
        return stamp, kind, None
    z = zipfile.ZipFile(io.BytesIO(raw))
    return stamp, kind, z.read(z.namelist()[0])


def clean_title(t):
    t2 = TITLE_TAIL_RE.sub("", t)
    return t2 if len(t2) >= 15 else t


def collect(targets_fips, fips_to_iso, dom_map, iso2_to_fips):
    """Ülke başına aday haberler ve ton istatistikleri."""
    cand = defaultdict(list)            # iso -> [(puan, kayıt)]
    tone_sum, tone_n = defaultdict(float), defaultdict(int)
    seen_url = set()
    stamps = slots(HOURS)
    jobs = [(s, k) for s in stamps for k in ("en", "tr")]
    ok_files = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        for stamp, kind, raw in ex.map(lambda j: download(*j), jobs):
            if raw is None:
                continue
            ok_files += 1
            for url, domain, title, when, tone, counts, lang in parse_gkg(raw, kind == "tr"):
                if url in seen_url:
                    continue
                seen_url.add(url)
                top = max(counts.values())
                src = dom_map.get(domain)
                if not src:
                    tld = domain.rsplit(".", 1)[-1]
                    src = iso2_to_fips.get("GB" if tld == "uk" else tld.upper())
                for fc, n in counts.items():
                    if fc not in targets_fips:
                        continue
                    primary = n == top
                    if not primary and n < MIN_MENTIONS:
                        continue
                    iso = fips_to_iso[fc]
                    if tone is not None:
                        tone_sum[iso] += tone
                        tone_n[iso] += 1
                    rec = {
                        "title": clean_title(title)[:300], "url": url, "domain": domain,
                        "time": dt.datetime.strptime(when, "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc).isoformat(),
                        "lang": lang, "tone": None if tone is None else round(tone, 2),
                        "local": src == fc,
                        "mentions": n,
                    }
                    score = n * (2 if primary else 1) + (1 if stamp >= stamps[len(stamps) // 4] else 0)
                    lst = cand[iso]
                    lst.append((score, rec))
                    if len(lst) > CANDIDATES * 2:
                        lst.sort(key=lambda x: (-x[0], x[1]["time"]))
                        del lst[CANDIDATES:]
    log(f"  {ok_files}/{len(jobs)} dosya işlendi, {len(seen_url)} haber, {time.time() - t0:.0f} sn")
    if ok_files < len(jobs) * 0.5:
        raise RuntimeError(f"GDELT dosyalarının yarısından azı indirilebildi ({ok_files}/{len(jobs)})")
    return cand, tone_sum, tone_n


def pick(lst, local):
    lst = sorted((x for x in lst if x[1]["local"] == local), key=lambda x: (-x[0], x[1]["time"]))
    seen, out = set(), []
    for _, r in lst:
        key = re.sub(r"\W+", "", r["title"].lower())[:80]
        if key in seen:
            continue
        seen.add(key)
        r = {k: v for k, v in r.items() if k not in ("local", "mentions")}
        out.append(r)
        if len(out) >= KEEP_PER_SOURCE:
            break
    out.sort(key=lambda r: r["time"], reverse=True)
    return out


# ----------------------------------------------------------------- borsa

def market(symbol):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol)
           + "?range=3mo&interval=1d")
    data = json.loads(http_get(url, tries=2, timeout=60))
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


# ----------------------------------------------------------------- ana akış

def main():
    idx = json.load(open(INDEX_PATH, encoding="utf-8"))["countries"]
    targets = [iso for iso, c in idx.items() if c.get("index_score") is not None and iso in FIPS]
    only = os.environ.get("ONLY")
    if only:
        targets = [t for t in targets if t in only.split(",")]
    fips_to_iso = {}
    for iso in targets:
        for f in FIPS[iso]:
            fips_to_iso[f] = iso
    iso2_to_fips = {c["iso2"]: FIPS[i][0] for i, c in idx.items() if i in FIPS and c.get("iso2")}
    log(f"{len(targets)} ülke, son {HOURS} saatin GDELT dosyaları")

    dom_map = domain_countries()
    log(f"  alan adı-ülke eşlemesi: {len(dom_map)}")
    cand, tone_sum, tone_n = collect(set(fips_to_iso), fips_to_iso, dom_map, iso2_to_fips)

    out = {}
    for iso in targets:
        entry = {
            "local": pick(cand.get(iso, []), True),
            "intl": pick(cand.get(iso, []), False),
            "tone": round(tone_sum[iso] / tone_n[iso], 2) if tone_n[iso] else None,
            "articles": tone_n[iso],
            "market": None,
        }
        if iso in MARKETS:
            try:
                entry["market"] = market(MARKETS[iso])
            except Exception as e:
                log(f"  {iso} BORSA HATASI ({MARKETS[iso]}): {e}")
        out[iso] = entry

    # Dünya ortalama tonu: ülke tonunu yorumlamak için referans
    tones = [e["tone"] for e in out.values() if e["tone"] is not None and e["articles"] >= 20]
    world_tone = round(sum(tones) / len(tones), 2) if tones else None

    for iso in ("TUR", "GRC", "ISR"):
        if iso in out:
            e = out[iso]
            log(f"  {iso}: yerel {len(e['local'])}, uluslararası {len(e['intl'])}, haber {e['articles']}, "
                f"ton {e['tone']}, borsa {'var' if e['market'] else 'yok'}")
            for a in (e["local"][:2] + e["intl"][:2]):
                log(f"      {a['time'][:16]} {a['domain']} | {a['title'][:90]}")
    empty = [iso for iso, e in out.items() if not e["local"] and not e["intl"]]
    log(f"Haber bulunamayan {len(empty)} ülke: {empty}")

    json.dump({
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "hours": HOURS,
        "world_tone": world_tone,
        "sources": {"news": "GDELT Project GKG 2.0 (https://www.gdeltproject.org/)", "market": "Yahoo Finance"},
        "countries": out,
    }, open(OUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"Yazıldı: {OUT_PATH} ({os.path.getsize(OUT_PATH) // 1024} KB)")


if __name__ == "__main__":
    main()
