// Uydu yörünge elemanları: GitHub Actions'ın günde bir CelesTrak'tan çekip
// "sats" dalına yazdığı dosya. Konum hesabı tarayıcıda yapılır.
const SRC = "https://raw.githubusercontent.com/eemirhanyen/dunya-haritasi/sats/sats.json";

module.exports = async (req, res) => {
  try {
    const r = await fetch(SRC + "?t=" + Math.floor(Date.now() / 3600000), { headers: { "User-Agent": "dunya-haritasi/1.0" } });
    if (!r.ok) {
      res.setHeader("Cache-Control", "s-maxage=300");
      return res.status(502).json({ error: "kaynak " + r.status });
    }
    const j = await r.json();
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");
    res.status(200).json(j);
  } catch (e) {
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(502).json({ error: String(e && e.message || e) });
  }
};
