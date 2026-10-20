// Sivil uçaklar: GitHub Actions'ın her ~10 dakikada bir OpenSky'dan çekip
// "live" dalına yazdığı planes.json'u sunar (OpenSky, Vercel sunucularını kabul etmiyor).
const SRC = "https://raw.githubusercontent.com/eemirhanyen/dunya-haritasi/live/planes.json";

module.exports = async (req, res) => {
  try {
    const r = await fetch(SRC + "?t=" + Math.floor(Date.now() / 60000), { headers: { "User-Agent": "dunya-haritasi/1.0" } });
    if (!r.ok) {
      res.setHeader("Cache-Control", "s-maxage=60");
      return res.status(502).json({ error: "kaynak " + r.status });
    }
    const j = await r.json();
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json({ time: j.time, n: j.n, ttl: 180, s: j.s, h: j.h || {} });
  } catch (e) {
    res.setHeader("Cache-Control", "s-maxage=30");
    res.status(502).json({ error: String(e && e.message || e) });
  }
};
