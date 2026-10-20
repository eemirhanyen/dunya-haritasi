/* Dünya Haritası — küre ve ülke paneli */
(function () {
  "use strict";

  var COLORS = { good: "#34c77b", mid: "#f2c94c", bad: "#ef5350", none: "#2a3347" };
  // Kademeli renk: 0 kırmızı, 50 sarı (dünya ortası), 100 yeşil
  var STOPS = [[0, [239, 83, 80]], [50, [242, 201, 76]], [100, [52, 199, 123]]];
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(["tr"], { type: "region" }); } catch (e) { /* eski tarayıcı */ }

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
  function scoreColor(score, alpha) {
    if (score == null) return alpha == null ? COLORS.none : hexAlpha(COLORS.none, alpha);
    var s = Math.max(0, Math.min(100, score)), i = s <= 50 ? 0 : 1;
    var a = STOPS[i], b = STOPS[i + 1], t = (s - a[0]) / (b[0] - a[0]);
    var c = [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * t); });
    return "rgba(" + c.join(",") + "," + (alpha == null ? 1 : alpha) + ")";
  }
  function countryOf(feat) {
    return state.data && state.data.countries[feat.properties.iso] || null;
  }
  function scoredOf(feat) {
    var c = countryOf(feat);
    return c && c.final_score != null ? c : null;
  }
  function trName(c, fallback) {
    if (c && c.iso2 && regionNames) {
      try { var n = regionNames.of(c.iso2); if (n && n !== c.iso2) return n; } catch (e) { /* yok */ }
    }
    return (c && c.name) || fallback;
  }
  function nameOf(feat) {
    return trName(countryOf(feat), feat.properties.name);
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
        return scoredOf(f) ? 0.012 : 0.006;
      })
      .polygonCapColor(function (f) {
        var c = scoredOf(f);
        if (!c) return f === state.hover && countryOf(f) ? "#3a4766" : COLORS.none;
        return scoreColor(c.final_score, f === state.hover || f === state.selected ? 1 : 0.9);
      })
      .polygonSideColor(function (f) {
        var c = scoredOf(f);
        return c ? scoreColor(c.final_score, 0.35) : "rgba(20,28,45,0.6)";
      })
      .polygonStrokeColor(function () { return "rgba(7,11,20,0.9)"; })
      .polygonLabel(function (f) {
        var c = countryOf(f);
        var s = c && c.final_score != null ? " · <b>" + nf.format(c.final_score) + "</b>" : (c ? " · veri yetersiz" : "");
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
    var r = rings[0], x = 0, y = 0, minX = 180, maxX = -180, minY = 90, maxY = -90;
    r.forEach(function (p) {
      x += p[0]; y += p[1];
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    var span = Math.max(maxX - minX, maxY - minY);
    return { lng: x / r.length, lat: y / r.length, span: span };
  }

  function select(f) {
    state.selected = f;
    globe.controls().autoRotate = false;
    var c = centroid(f);
    var mobile = window.innerWidth <= 640;
    globe.pointOfView({ lat: c.lat - (mobile ? 6 : 0), lng: c.lng + (mobile ? 0 : 9), altitude: Math.max(0.6, Math.min(2.2, c.span / 28)) }, 1100);
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
    var name = trName(c, c.name);
    var h = "";

    h += '<div class="p-head">';
    h += '<div class="p-score" style="background:' + scoreColor(c.final_score) + '">' +
      (c.final_score == null ? "–" : nf0.format(c.final_score)) + "</div>";
    h += '<div><h2 class="p-name">' + esc(name) + '</h2><div class="p-verdict">' +
      (c.final_score == null ? "Veri yetersiz" : verdict(b)) + "</div></div>";
    h += "</div>";

    if (c.missing && c.missing.length) {
      h += '<div class="note" style="margin:0 0 18px">Skor hesaplanmadı: şu boyutlarda güncel veri yok — ' +
        esc(c.missing.join(", ")) + ". Ülkeler arası adil karşılaştırma için skor yalnızca beş boyutun hepsi varsa hesaplanır.</div>";
    }

    h += '<div class="split">';
    h += '<div><div class="k">Endeks</div><div class="v">' + (c.index_score == null ? "–" : nf.format(c.index_score)) + "</div></div>";
    h += '<div><div class="k">AI · ' + (c.ai ? c.ai.days + " gün ort." : "7 gün ort.") + '</div><div class="v' +
      (c.ai_score == null ? ' pending">Henüz yok' : '">' + nf.format(c.ai_score)) + "</div></div>";
    h += "</div>";

    if (c.ai && c.ai.latest) {
      var L = c.ai.latest;
      h += "<h3>AI değerlendirmesi · " + esc(fmtDate(L.date)) + "</h3>";
      h += '<div class="ai">';
      h += '<div class="ai-top"><span class="chip" style="background:' + scoreColor(L.score) + '">' + L.score + "</span>" +
        "<span>Bugünkü puan" + (L.confidence ? " · güven: " + esc(L.confidence) : "") + "</span>" + spark(c.ai.series) + "</div>";
      h += '<p class="ai-sum">' + esc(L.summary || "") + "</p>";
      if (L.drivers && L.drivers.length) {
        h += '<ul class="ai-drv">' + L.drivers.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>";
      }
      h += '<div class="src">' + (L.headlines || 0) + " haber başlığı ve borsa verisi üzerinden, Claude tarafından üretildi. " +
        "Son skorun %50'si bu puanın 7 günlük ortalamasıdır.</div>";
      h += "</div>";
    }

    h += "<h3>Boyutlar · dünya yüzdelik dilimi</h3>";
    Object.keys(c.dimensions).forEach(function (k) {
      var d = c.dimensions[k];
      var col = scoreColor(d.score);
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

    h += '<div id="live"><h3>Haberler ve borsa</h3><div class="note" style="margin-top:0">Yükleniyor…</div></div>';

    h += '<div class="note">Her gösterge tüm ülkeler arasında yüzdelik dilime çevrilir; 50 dünya ortasıdır, çubuktaki ince çizgi bu noktayı gösterir. ' +
      "Beş boyut eşit ağırlıklıdır. Yargı ve medya puanları kaynak kuruluşların değerlendirmesidir. " +
      "Satırlara tıklayarak ham değerleri ve kaynakları görebilirsin.</div>";

    document.getElementById("panel-body").innerHTML = h;
    document.getElementById("panel").scrollTop = 0;
    loadNews().then(function (news) {
      if (state.selected && countryOf(state.selected) === c) renderLive(c, news);
    });
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
    return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
  }
  function ago(iso) {
    if (!iso) return "";
    var h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
    if (h < 1) return "az önce";
    if (h < 24) return h + " sa önce";
    return Math.round(h / 24) + " gün önce";
  }
  function spark(series, w, hgt, color) {
    // series: [{score}] veya sayı dizisi
    var v = (series || []).map(function (x) { return typeof x === "number" ? x : x.score; });
    if (v.length < 2) return "";
    w = w || 90; hgt = hgt || 26;
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v), r = max - min || 1;
    var pts = v.map(function (y, i) {
      return (i * (w - 2) / (v.length - 1) + 1).toFixed(1) + "," + (hgt - 2 - (y - min) / r * (hgt - 4)).toFixed(1);
    }).join(" ");
    return '<svg class="spark" width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + " " + hgt + '" aria-hidden="true">' +
      '<polyline fill="none" stroke="' + (color || "#7aa2ff") + '" stroke-width="1.6" stroke-linejoin="round" points="' + pts + '"/></svg>';
  }
  function pct(x) {
    if (x == null) return '<span class="muted">–</span>';
    var cls = x > 0 ? "up" : x < 0 ? "down" : "";
    return '<span class="' + cls + '">' + (x > 0 ? "+" : "") + nf2.format(x) + "%</span>";
  }

  var newsPromise = null;
  function loadNews() {
    if (!newsPromise) {
      newsPromise = fetch("data/news.json?t=" + Math.floor(Date.now() / 3600000))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return newsPromise;
  }

  function renderLive(c, news) {
    var box = document.getElementById("live");
    if (!box) return;
    var n = news && news.countries && news.countries[c.iso3];
    var h = "";
    if (n && n.market) {
      var m = n.market, up = (m.chg_1m || 0) >= 0;
      h += "<h3>Borsa</h3>";
      h += '<div class="mkt"><div><div class="mkt-name">' + esc(m.name) + '</div><div class="mkt-last">' +
        nf2.format(m.last) + " " + esc(m.currency || "") + "</div></div>" +
        spark(m.spark, 110, 34, up ? "#34c77b" : "#ef5350") + "</div>";
      h += '<div class="mkt-chg"><span>1 gün ' + pct(m.chg_1d) + "</span><span>1 hafta " + pct(m.chg_1w) +
        "</span><span>1 ay " + pct(m.chg_1m) + "</span></div>";
      h += '<div class="src">' + esc(fmtDate(m.as_of)) + " kapanışı · Yahoo Finance</div>";
    }
    if (n && (n.local.length || n.intl.length)) {
      h += "<h3>Son 72 saatin haberleri</h3>";
      h += '<div class="tabs" role="tablist"><button class="on" data-k="intl">Uluslararası</button><button data-k="local">Yerel medya</button></div>';
      h += '<ul class="news" data-k="intl">' + newsList(n.intl) + "</ul>";
      h += '<ul class="news" data-k="local" hidden>' + newsList(n.local) + "</ul>";
      h += '<div class="src">' + (n.stale ? "Bugün güncellenemedi, önceki günün haberleri gösteriliyor. " : "") +
        'Kaynak: <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener">GDELT Project</a></div>';
    } else if (c.final_score != null) {
      h += "<h3>Haberler</h3><div class=\"note\" style=\"margin-top:0\">Bu ülke için henüz haber verisi yok.</div>";
    }
    box.innerHTML = h;
    var tabs = box.querySelectorAll(".tabs button");
    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle("on", x === b); });
        Array.prototype.forEach.call(box.querySelectorAll("ul.news"), function (u) { u.hidden = u.dataset.k !== b.dataset.k; });
      });
    });
  }

  function newsList(items) {
    if (!items || !items.length) return '<li class="muted">Haber yok.</li>';
    return items.slice(0, 12).map(function (a) {
      var url = /^https?:\/\//.test(a.url || "") ? a.url : "#";
      return '<li><a href="' + esc(url) + '" target="_blank" rel="noopener nofollow">' + esc(a.title) + "</a>" +
        '<span class="meta">' + esc(a.domain || "") + " · " + esc(ago(a.time)) + "</span></li>";
    }).join("");
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
