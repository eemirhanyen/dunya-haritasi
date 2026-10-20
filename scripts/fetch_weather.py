#!/usr/bin/env python3
"""
Hava durumu katmanları için veri.

NOAA GFS modelinin en son çalıştırmasından, önümüzdeki 24 saatin 3 saatlik
tahminlerini 1 derecelik dünya ızgarasında indirir (NOMADS grib filtresi,
yalnızca gereken değişkenler) ve sitenin doğrudan okuyabileceği küçük PNG
dosyalarına çevirir:

  data/weather/wind_fXXX.png  R = rüzgâr doğu bileşeni, G = kuzey bileşeni,
                              B = 2 m sıcaklık
  data/weather/sky_fXXX.png   R = toplam bulut örtüsü, G = yağış şiddeti
  data/weather/meta.json      zaman damgaları ve kodlama aralıkları

Izgara: 360 x 181, satır 0 = 90°K, sütun 0 = 180°B (site için kaydırılır).
"""

import datetime as dt
import json
import math
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "weather")
UA = {"User-Agent": "dunya-haritasi/1.0 (+https://github.com/eemirhanyen/dunya-haritasi)"}

STEPS = list(range(0, 25, 3))        # f000 … f024
U_RANGE = (-50.0, 50.0)              # m/s
T_RANGE = (-50.0, 50.0)              # °C
PRECIP_MAX = 20.0                    # mm/saat; kodlama: sqrt(x/MAX)
FILTER = ("https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl?dir=%2Fgfs.{d}%2F{h}%2Fatmos"
          "&file=gfs.t{h}z.pgrb2.1p00.f{f:03d}"
          "&var_UGRD=on&var_VGRD=on&var_TMP=on&var_TCDC=on&var_PRATE=on"
          "&lev_10_m_above_ground=on&lev_2_m_above_ground=on&lev_entire_atmosphere=on&lev_surface=on")


def log(m):
    print(m, flush=True)


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last = e
        except Exception as e:
            last = e
        time.sleep(5 * (i + 1))
    raise RuntimeError(f"{url[:100]} -> {last}")


def decode(raw):
    """GRIB2 -> {kısa ad: değerler (liste, 360*181)}. Aynı addan ilk mesaj alınır."""
    import eccodes
    path = "/tmp/_gfs.grb2"
    open(path, "wb").write(raw)
    out = {}
    with open(path, "rb") as f:
        while True:
            g = eccodes.codes_grib_new_from_file(f)
            if g is None:
                break
            try:
                name = eccodes.codes_get(g, "shortName")
                if name not in out:
                    ni, nj = eccodes.codes_get(g, "Ni"), eccodes.codes_get(g, "Nj")
                    if (ni, nj) != (360, 181):
                        raise RuntimeError(f"beklenmeyen ızgara {ni}x{nj}")
                    out[name] = eccodes.codes_get_values(g).tolist()
            finally:
                eccodes.codes_release(g)
    need = {"10u", "10v", "2t", "tcc", "prate"}
    if not need <= set(out):
        raise RuntimeError(f"eksik değişken: {need - set(out)}")
    return out


def latest_run():
    """İlk tahmin dosyası yayımlanmış en son GFS çalıştırması."""
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(0, 30, 6):
        run = now - dt.timedelta(hours=back + 3, minutes=30)
        run = run.replace(hour=run.hour - run.hour % 6, minute=0, second=0, microsecond=0)
        d, h = run.strftime("%Y%m%d"), run.strftime("%H")
        try:
            raw = get(FILTER.format(d=d, h=h, f=STEPS[-1]), tries=1)
            if len(raw) > 10000:
                return run
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("Yayımlanmış GFS çalıştırması bulunamadı")


def png(path, w, h, rows):
    """Basit RGB PNG yazıcı (bağımlılıksız). rows: her biri w*3 baytlık bytes."""
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def q(v, lo, hi):
    return max(0, min(255, int(round((v - lo) / (hi - lo) * 255))))


def encode(fields, step):
    W, H = 360, 181
    u, v, t, c, p = fields["10u"], fields["10v"], fields["2t"], fields["tcc"], fields["prate"]
    wind_rows, sky_rows = [], []
    for j in range(H):
        wr, sr = bytearray(), bytearray()
        for i in range(W):
            k = j * W + (i + 180) % 360          # sütun 0 = 180°B
            wr += bytes((q(u[k], *U_RANGE), q(v[k], *U_RANGE), q(t[k] - 273.15, *T_RANGE)))
            mmh = max(0.0, p[k]) * 3600.0
            pr = int(round(min(1.0, math.sqrt(mmh / PRECIP_MAX)) * 255))
            sr += bytes((q(c[k], 0, 100), pr, 0))
        wind_rows.append(bytes(wr))
        sky_rows.append(bytes(sr))
    png(os.path.join(OUT, f"wind_f{step:03d}.png"), W, H, wind_rows)
    png(os.path.join(OUT, f"sky_f{step:03d}.png"), W, H, sky_rows)


def main():
    os.makedirs(OUT, exist_ok=True)
    run = latest_run()
    d, h = run.strftime("%Y%m%d"), run.strftime("%H")
    log(f"GFS çalıştırması: {d} {h}Z")
    frames = []
    for s in STEPS:
        raw = get(FILTER.format(d=d, h=h, f=s))
        encode(decode(raw), s)
        frames.append({
            "time": (run + dt.timedelta(hours=s)).isoformat().replace("+00:00", "Z"),
            "wind": f"wind_f{s:03d}.png", "sky": f"sky_f{s:03d}.png",
        })
        log(f"  f{s:03d} tamam ({len(raw) // 1024} KB)")
        time.sleep(1)   # NOMADS: dakikada 120 istekten az
    json.dump({
        "source": "NOAA GFS 1.0° (NOMADS)",
        "run": run.isoformat().replace("+00:00", "Z"),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "grid": {"w": 360, "h": 181, "lon0": -180, "lat0": 90, "step": 1},
        "encoding": {"u": U_RANGE, "v": U_RANGE, "t_c": T_RANGE, "cloud_pct": [0, 100],
                     "precip_mmh": {"max": PRECIP_MAX, "scale": "sqrt"}},
        "frames": frames,
    }, open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8"), indent=1)
    keep = {f["wind"] for f in frames} | {f["sky"] for f in frames} | {"meta.json"}
    for f in os.listdir(OUT):
        if f not in keep:
            os.remove(os.path.join(OUT, f))
    log("Yazıldı: data/weather/")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"HATA: {e}")
        sys.exit(1)
