// Sivil uçaklar: OpenSky Network durum verisi, sıkıştırılmış ve CDN'de önbelleğe alınmış.
// OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET tanımlıysa hesapla (günlük 4000 kredi),
// değilse anonim (günlük 400 kredi) çağırır. Tarayıcı OpenSky'ı doğrudan çağıramaz (CORS).
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
let token = null, tokenExp = 0;

async function getToken() {
  const id = process.env.OPENSKY_CLIENT_ID, secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (token && Date.now() < tokenExp - 60000) return token;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret })
  });
  if (!r.ok) throw new Error("token " + r.status);
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + (j.expires_in || 1800) * 1000;
  return token;
}

module.exports = async (req, res) => {
  const authed = !!(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);
  // Hesapla 2 dk, anonimken 15 dk önbellek (kredi sınırı)
  const maxAge = authed ? 120 : 900;
  try {
    const headers = { "User-Agent": "dunya-haritasi/1.0" };
    const t = await getToken().catch(() => null);
    if (t) headers.Authorization = "Bearer " + t;
    const r = await fetch("https://opensky-network.org/api/states/all", { headers });
    if (!r.ok) {
      res.setHeader("Cache-Control", "s-maxage=120");
      return res.status(r.status === 429 ? 429 : 502).json({ error: "opensky " + r.status });
    }
    const j = await r.json();
    // [lng, lat, irtifa m, hız m/s, yön °, çağrı adı, ülke]
    const out = [];
    for (const s of j.states || []) {
      if (s[5] == null || s[6] == null || s[8]) continue; // konumsuz ya da yerde
      out.push([
        Math.round(s[5] * 1000) / 1000, Math.round(s[6] * 1000) / 1000,
        Math.round(s[13] ?? s[7] ?? 0), Math.round((s[9] || 0) * 10) / 10, Math.round(s[10] || 0),
        (s[1] || "").trim(), s[2] || ""
      ]);
    }
    res.setHeader("Cache-Control", `s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    res.status(200).json({ time: j.time, n: out.length, ttl: maxAge, s: out });
  } catch (e) {
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(502).json({ error: String(e && e.message || e) });
  }
};
