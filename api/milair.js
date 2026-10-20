// Askeri uçaklar: adsb.lol açık verisi (ODbL). Yalnızca kendini yayımlayan uçaklar görünür.
module.exports = async (req, res) => {
  try {
    const r = await fetch("https://api.adsb.lol/v2/mil", { headers: { "User-Agent": "dunya-haritasi/1.0" } });
    if (!r.ok) {
      res.setHeader("Cache-Control", "s-maxage=60");
      return res.status(502).json({ error: "adsb.lol " + r.status });
    }
    const j = await r.json();
    // [lng, lat, irtifa ft→m, hız kt→m/s, yön °, çağrı adı, tip, icao, dikey hız m/s, tescil]
    const out = [];
    for (const a of j.ac || []) {
      if (a.lat == null || a.lon == null || a.alt_baro === "ground") continue;
      const alt = typeof a.alt_geom === "number" ? a.alt_geom : (typeof a.alt_baro === "number" ? a.alt_baro : 0);
      out.push([
        Math.round(a.lon * 1000) / 1000, Math.round(a.lat * 1000) / 1000,
        Math.round(alt * 0.3048), Math.round((a.gs || 0) * 0.5144 * 10) / 10, Math.round(a.track ?? a.true_heading ?? 0),
        (a.flight || a.r || "").trim(), a.t || "", a.hex || "", Math.round((a.geom_rate || a.baro_rate || 0) * 0.00508 * 10) / 10, a.r || ""
      ]);
    }
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({ time: Math.round((j.now || Date.now()) / 1000), n: out.length, ttl: 60, s: out });
  } catch (e) {
    res.setHeader("Cache-Control", "s-maxage=30");
    res.status(502).json({ error: String(e && e.message || e) });
  }
};
