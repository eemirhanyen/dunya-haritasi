/* Dünya Haritası — küre ve ülke paneli */
(function () {
  "use strict";

  var TR_NAMES = { TUR: "Türkiye", GRC: "Yunanistan", ISR: "İsrail" };
  var COLORS = { good: "#34c77b", mid: "#f2c94c", bad: "#ef5350", none: "#2a3347" };

  var state = { data: null, geo: null, selected: null, hover: null };
  var nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
  var nf0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

  function band(score, th) {
    if (score == null) return "none";
    if (score < th.red_below) return "bad";
    if (score >= th.green_from) return "good";
    return "mid";
  }
  function verdict(b) {
    return { good: "Dünya ortalamasının üstünde", mid: "Dünya ortalaması civarında",
             bad: "Dünya ortalamasının altında", none: "Henüz değerlendirilmedi" }[b];
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function countryOf(feat) {
    return state.data && state.data.countries[feat.properties.iso] || null;
  }
  function nameOf(feat) {
    return TR_NAMES[feat.properties.iso] || feat.properties.name;
  }
  function hexAlpha(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  function showError(msg) {
    var el = document.getElementById("error");
    el.textContent = msg;
    el.hidden = false;
  }

  // ------------------------------------------------------------ küre
  var globe;
  function initGlobe() {
    var el = document.getElementById("globe");
    globe = Globe()(el)
      .backgroundColor("#070b14")
      .showGlobe(true)
      .showAtmosphere(true)
      .atmosphereColor("#4b6cb7")
      .atmosphereAltitude(0.18)
      .polygonsData(state.geo.features.filter(function (f) { return f.properties.iso !== "ATA"; }))
      .polygonAltitude(function (f) {
        if (f === state.selected) return 0.04;
        if (f === state.hover && countryOf(f)) return 0.025;
        return countryOf(f) ? 0.012 : 0.006;
      })
      .polygonCapColor(function (f) {
        var c = countryOf(f);
        if (!c) return f === state.hover ? "#334061" : COLORS.none;
        var col = COLORS[band(c.final_score, state.data.method.thresholds)];
        return f === state.hover || f === state.selected ? col : hexAlpha(col, 0.88);
      })
      .polygonSideColor(function (f) {
        var c = countryOf(f);
        return c ? hexAlpha(COLORS[band(c.final_score, state.data.method.thresholds)], 0.35) : "rgba(20,28,45,0.6)";
      })
      .polygonStrokeColor(function () { return "rgba(7,11,20,0.9)"; })
      .polygonLabel(function (f) {
        var c = countryOf(f);
        var s = c ? " · <b>" + nf.format(c.final_score) + "</b>" : "";
        return '<div class="tip">' + esc(nameOf(f)) + s + "</div>";
      })
      .onPolygonHover(function (f) {
        state.hover = f;
        el.style.cursor = f && countryOf(f) ? "pointer" : "grab";
        refresh();
      })
      .onPolygonClick(function (f) {
        if (!countryOf(f)) return;
        select(f);
      })
      .onGlobeClick(function () { closePanel(); })
      .polygonsTransitionDuration(250);

    var mat = globe.globeMaterial();
    mat.color.set("#0e1626");
    mat.emissive && mat.emissive.set("#0a1120");
    mat.shininess = 4;

    globe.pointOfView({ lat: 36, lng: 30, altitude: 1.9 }, 0);
    var ctl = globe.controls();
    ctl.autoRotate = true;
    ctl.autoRotateSpeed = 0.25;
    ctl.minDistance = 130;
    ctl.maxDistance = 600;

    function size() { globe.width(window.innerWidth).height(window.innerHeight); }
    window.addEventListener("resize", size);
    size();
  }

  function refresh() {
    globe.polygonAltitude(globe.polygonAltitude()).polygonCapColor(globe.polygonCapColor());
  }

  function centroid(f) {
    // Kaba merkez: en büyük halkanın ortalaması
    var g = f.geometry, rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map(function (p) { return p[0]; });
    rings.sort(function (a, b) { return b.length - a.length; });
    var r = rings[0], x = 0, y = 0;
    r.forEach(function (p) { x += p[0]; y += p[1]; });
    return { lng: x / r.length, lat: y / r.length };
  }

  function select(f) {
    state.selected = f;
    globe.controls().autoRotate = false;
    var c = centroid(f);
    var mobile = window.innerWidth <= 640;
    globe.pointOfView({ lat: c.lat - (mobile ? 6 : 0), lng: c.lng + (mobile ? 0 : 9), altitude: 0.75 }, 1100);
    document.getElementById("hint").classList.add("gone");
    renderPanel(countryOf(f));
    var p = document.getElementById("panel");
    p.classList.add("open");
    p.setAttribute("aria-hidden", "false");
    refresh();
  }

  function closePanel() {
    if (!state.selected) return;
    state.selected = null;
    var p = document.getElementById("panel");
    p.classList.remove("open");
    p.setAttribute("aria-hidden", "true");
    refresh();
  }

  // ------------------------------------------------------------ panel
  function fmtValue(part) {
    var v = part.value;
    switch (part.code) {
      case "NY.GDP.PCAP.PP.KD": return "$" + nf0.format(v);
      case "FP.CPI.TOTL.ZG":
      case "SL.UEM.TOTL.ZS": return "%" + nf.format(v);
      case "HDI": return nf2.format(v);
      case "VDEM_JUCON": return nf2.format(v);
      case "RSF": return nf.format(v);
      default: return nf2.format(v); // WGI: yaklaşık -2,5 … +2,5
    }
  }
  function fmtDemo(code, v) {
    if (code === "SP.POP.TOTL") return nf0.format(v);
    if (code === "SP.DYN.LE00.IN") return nf.format(v);
    return "%" + nf.format(v);
  }

  function renderPanel(c) {
    var th = state.data.method.thresholds;
    var b = band(c.final_score, th);
    var name = TR_NAMES[c.iso3] || c.name;
    var h = "";

    h += '<div class="p-head">';
    h += '<div class="p-score" style="background:' + COLORS[b] + '">' + nf0.format(c.final_score) + "</div>";
    h += '<div><h2 class="p-name">' + esc(name) + '</h2><div class="p-verdict">' + verdict(b) + "</div></div>";
    h += "</div>";

    h += '<div class="split">';
    h += '<div><div class="k">Endeks</div><div class="v">' + nf.format(c.index_score) + "</div></div>";
    h += '<div><div class="k">AI değerlendirmesi</div><div class="v pending">' +
      (c.ai_score == null ? "Yakında" : nf.format(c.ai_score)) + "</div></div>";
    h += "</div>";

    h += "<h3>Boyutlar · dünya yüzdelik dilimi</h3>";
    Object.keys(c.dimensions).forEach(function (k) {
      var d = c.dimensions[k];
      var col = COLORS[band(d.score, th)];
      h += '<details class="dim"><summary>';
      h += '<div class="dim-top"><span>' + esc(d.label) + "</span><b>" + nf.format(d.score) + "</b></div>";
      h += '<div class="bar"><i style="width:' + d.score + "%;background:" + col + '"></i></div>';
      h += "</summary><div class=\"parts\"><table>";
      d.parts.forEach(function (p) {
        h += "<tr><td>" + esc(p.label) + " <span style=\"opacity:.6\">(" + p.year + ")</span></td>" +
          "<td>" + fmtValue(p) + "</td><td>" + nf0.format(p.percentile) + ". dilim</td></tr>";
      });
      h += "</table>";
      h += '<div class="src">Kaynak: <a href="' + esc(d.source.url) + '" target="_blank" rel="noopener">' +
        esc(d.source.name) + "</a></div>";
      h += "</div></details>";
    });

    var demoKeys = Object.keys(c.demographics || {});
    if (demoKeys.length) {
      h += "<h3>Demografi</h3><div class=\"demo\">";
      demoKeys.forEach(function (k) {
        var d = c.demographics[k];
        h += "<span>" + esc(d.label) + " (" + d.year + ")</span><span>" + fmtDemo(k, d.value) + "</span>";
      });
      h += "</div>";
    }

    h += "<h3>Haberler ve borsa</h3>";
    h += '<div class="note" style="margin-top:0">Son dakika haberleri, borsa endeksi ve AI değerlendirmesi ikinci aşamada eklenecek.</div>';

    h += '<div class="note">Her gösterge tüm ülkeler arasında yüzdelik dilime çevrilir; 50 dünya ortasıdır, çubuktaki ince çizgi bu noktayı gösterir. ' +
      "Beş boyut eşit ağırlıklıdır. Yargı ve medya puanları kaynak kuruluşların değerlendirmesidir. " +
      "Satırlara tıklayarak ham değerleri ve kaynakları görebilirsin.</div>";

    document.getElementById("panel-body").innerHTML = h;
    document.getElementById("panel").scrollTop = 0;
  }

  // ------------------------------------------------------------ açılış
  document.getElementById("close").addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });

  if (typeof Globe !== "function") {
    showError("Küre kütüphanesi yüklenemedi. İnternet bağlantını kontrol edip sayfayı yenile.");
    return;
  }

  var bust = "?t=" + Math.floor(Date.now() / 3600000);
  Promise.all([
    fetch("data/countries.json" + bust).then(function (r) { if (!r.ok) throw new Error("countries.json " + r.status); return r.json(); }),
    fetch("data/ne_110m_countries.geojson").then(function (r) { if (!r.ok) throw new Error("geojson " + r.status); return r.json(); })
  ]).then(function (res) {
    state.data = res[0];
    state.geo = res[1];
    var d = new Date(state.data.generated_at);
    document.getElementById("updated").textContent = "Veri: " + d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
    initGlobe();
  }).catch(function (e) {
    showError("Veri yüklenemedi (" + e.message + ").");
  });
})();
