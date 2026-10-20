#!/usr/bin/env python3
"""
Aktif uydular: CelesTrak'ın yayımladığı yörünge elemanları (TLE). Günde bir
kez çekilir; konumlar tarayıcıda satellite.js (SGP4) ile anlık hesaplanır.
CelesTrak aynı veriyi 2 saatten sık indirmemeyi istiyor; günlük çekim bunun
çok altında.
"""
import json, sys, time, urllib.request

URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
UA = {"User-Agent": "dunya-haritasi/1.0 (+https://github.com/eemirhanyen/dunya-haritasi)"}

GNSS = ("NAVSTAR", "GPS ", "GLONASS", "GALILEO", "GSAT0", "BEIDOU", "IRNSS", "QZS")
STATIONS = ("ISS (ZARYA)", "CSS (TIANHE)", "TIANGONG")


def category(name, l2):
    n = name.upper()
    if any(n.startswith(s) for s in STATIONS):
        return "station"
    if n.startswith("STARLINK"):
        return "starlink"
    if n.startswith("ONEWEB"):
        return "oneweb"
    if any(k in n for k in GNSS):
        return "gnss"
    try:
        mm = float(l2[52:63])          # günlük tur sayısı
    except ValueError:
        return "other"
    if 0.9 < mm < 1.1:
        return "geo"
    return "other"


def main(out):
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(URL, headers=UA), timeout=120) as r:
                text = r.read().decode("utf-8", "replace")
            break
        except Exception as e:
            last = e
            time.sleep(20 * (i + 1))
    else:
        print(f"HATA: CelesTrak alınamadı: {last}")
        sys.exit(1)
    lines = [l.rstrip() for l in text.splitlines() if l.strip()]
    sats = []
    for i in range(0, len(lines) - 2, 3):
        name, l1, l2 = lines[i].strip(), lines[i + 1], lines[i + 2]
        if not (l1.startswith("1 ") and l2.startswith("2 ")):
            continue
        sats.append([name, l1, l2, category(name, l2)])
    if len(sats) < 1000:
        print(f"HATA: beklenenden az uydu ({len(sats)})")
        sys.exit(1)
    cats = {}
    for s in sats:
        cats[s[3]] = cats.get(s[3], 0) + 1
    json.dump({"time": int(time.time()), "n": len(sats), "source": "CelesTrak", "cats": cats, "s": sats},
              open(out, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{len(sats)} uydu: {cats}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "sats.json")
