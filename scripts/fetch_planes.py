#!/usr/bin/env python3
"""
Sivil uçak konumları: OpenSky Network'ten anlık durum verisini çeker ve
sıkıştırılmış planes.json yazar. GitHub Actions ~10 dakikada bir çalıştırır;
dosya depoya değil, geçmişi tutulmayan "live" dalına yazılır.

OpenSky, Vercel'in bulut sunucularından gelen istekleri kabul etmediği için
veri GitHub üzerinden aktarılıyor. OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET
tanımlıysa hesapla (daha yüksek kota), değilse anonim çağrılır.
"""
import json, os, sys, time, urllib.parse, urllib.request

PREV_URL = "https://raw.githubusercontent.com/eemirhanyen/dunya-haritasi/live/planes.json"
HIST_POINTS = 6          # uçak başına saklanan önceki konum sayısı (~1 saat)
HIST_MAX_AGE = 80 * 60   # bundan eski konumlar atılır (sn)

UA = {"User-Agent": "dunya-haritasi/1.0 (+https://github.com/eemirhanyen/dunya-haritasi)"}
TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"


def token():
    cid, sec = os.environ.get("OPENSKY_CLIENT_ID"), os.environ.get("OPENSKY_CLIENT_SECRET")
    if not cid or not sec:
        return None
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid, "client_secret": sec}).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body, headers=UA), timeout=30) as r:
        return json.loads(r.read())["access_token"]


def main(out):
    headers = dict(UA)
    try:
        t = token()
        if t:
            headers["Authorization"] = "Bearer " + t
    except Exception as e:
        print(f"UYARI: OpenSky oturumu açılamadı, anonim devam: {e}")
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request("https://opensky-network.org/api/states/all", headers=headers)
            with urllib.request.urlopen(req, timeout=90) as r:
                print("Kalan kredi:", r.headers.get("X-Rate-Limit-Remaining"))
                j = json.loads(r.read())
            break
        except Exception as e:
            last = e
            time.sleep(15 * (i + 1))
    else:
        print(f"HATA: OpenSky alınamadı: {last}")
        sys.exit(1)
    now = j.get("time") or int(time.time())

    # Önceki dosyadan iz geçmişi: {icao24: [[lng, lat, zaman], ...]} eskiden yeniye
    hist = {}
    try:
        with urllib.request.urlopen(urllib.request.Request(PREV_URL + "?t=%d" % now, headers=UA), timeout=60) as r:
            prev = json.loads(r.read())
        pt = prev.get("time", 0)
        if 0 < now - pt < 40 * 60:
            old = prev.get("h", {})
            for a in prev.get("s", []):
                if len(a) > 7 and a[7]:
                    hist[a[7]] = [p for p in old.get(a[7], []) if now - p[2] <= HIST_MAX_AGE] + [[a[0], a[1], pt]]
        print(f"Önceki dosya: {len(hist)} uçağın izi ({now - pt} sn önce)")
    except Exception as e:
        print(f"UYARI: önceki dosya okunamadı, iz sıfırdan başlıyor: {e}")

    s, h = [], {}
    for a in j.get("states") or []:
        if a[5] is None or a[6] is None or a[8]:
            continue  # konumsuz ya da yerde
        alt = a[13] if a[13] is not None else (a[7] or 0)
        icao = a[0]
        s.append([round(a[5], 3), round(a[6], 3), round(alt), round(a[9] or 0, 1), round(a[10] or 0),
                  (a[1] or "").strip(), a[2] or "", icao, round(a[11] or 0, 1)])
        if icao in hist:
            h[icao] = [[round(p[0], 2), round(p[1], 2), p[2]] for p in hist[icao][-HIST_POINTS:]]
    json.dump({"time": now, "n": len(s), "source": "OpenSky Network",
               "fields": ["lng", "lat", "alt_m", "speed_ms", "heading", "callsign", "country", "icao24", "vrate_ms"],
               "s": s, "h": h},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(s)} uçak, {len(h)} izli, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "planes.json")
