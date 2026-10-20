/* Dünya Haritası — küre, ülke paneli, dil seçimi */
(function () {
  "use strict";

  var COLORS = { none: "#2a3347" };
  // Kademeli renk: 0 kırmızı, 50 sarı (dünya ortası), 100 yeşil
  var STOPS = [[0, [239, 83, 80]], [50, [242, 201, 76]], [100, [52, 199, 123]]];
  // Askeri güç iyi/kötü değil, büyüklük gösterir: tek tonlu mor skala
  var MIL_STOPS = [[0, [52, 62, 98]], [50, [118, 96, 222]], [100, [236, 122, 252]]];
  var I = window.I18N;

  var state = { data: null, geo: null, selected: null, hover: null, lang: "en", mode: "scores", war: null };
  var fmt = {};

  // ------------------------------------------------------------ dil
  function pickLang() {
    var codes = I.langs.map(function (l) { return l[0]; });
    var saved = null;
    try { saved = localStorage.getItem("lang"); } catch (e) { /* gizli pencere */ }
    var q = (location.search.match(/[?&]lang=([a-z]{2})/) || [])[1];
    if (q && codes.indexOf(q) >= 0) return q;
    if (saved && codes.indexOf(saved) >= 0) return saved;
    var nav = (navigator.languages || [navigator.language || "en"]);
    for (var i = 0; i < nav.length; i++) {
      var c = String(nav[i]).slice(0, 2).toLowerCase();
      if (codes.indexOf(c) >= 0) return c;
    }
    return "en";
  }
  function t(key, vars) {
    var d = I.dict[state.lang] || {}, s = d[key];
    if (s == null) s = I.dict.en[key];
    if (s == null) s = key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(vars[k]); });
    return s;
  }
  function setLang(l) {
    state.lang = l;
    try { localStorage.setItem("lang", l); } catch (e) { /* yok say */ }
    var loc = l === "zh" ? "zh-CN" : l;
    fmt = {
      n1: new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }),
      n2: new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }),
      n0: new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }),
      pct: new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 1 }),
      pctS: new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" }),
      usd: new Intl.NumberFormat(loc, { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
      date: new Intl.DateTimeFormat(loc, { day: "numeric", month: "long" }),
      dateY: new Intl.DateTimeFormat(loc, { day: "numeric", month: "long", year: "numeric" }),
      rel: (Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(loc, { numeric: "auto", style: "short" }) : null),
      region: null
    };
    try { fmt.region = new Intl.DisplayNames([loc], { type: "region" }); } catch (e) { /* eski tarayıcı */ }
    var html = document.documentElement;
    html.lang = l;
    html.dir = I.rtl.indexOf(l) >= 0 ? "rtl" : "ltr";
    document.title = t("title");
    applyStatic();
    if (state.data) updateDate();
    if (globe) refresh(true);
    labelEls.forEach(function (x) { x[0].textContent = nameOf(x[1]); });
    if (state.selected) renderPanel(countryOf(state.selected));
    document.dispatchEvent(new Event("langchange"));
  }
  function applyStatic() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    var sel = document.getElementById("lang");
    if (sel) sel.value = state.lang;
  }
  function buildLangMenu() {
    var sel = document.getElementById("lang");
    sel.innerHTML = I.langs.map(function (l) {
      return '<option value="' + l[0] + '">' + l[1] + "</option>";
    }).join("");
    sel.addEventListener("change", function () { setLang(sel.value); });
  }

  // ------------------------------------------------------------ yardımcılar
  function band(score, th) {
    if (score == null) return "none";
    if (score < th.red_below) return "bad";
    if (score >= th.green_from) return "good";
    return "mid";
  }
  function verdict(b) {
    return { good: t("vGood"), mid: t("vMid"), bad: t("vBad"), none: t("noData") }[b];
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hexAlpha(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function scoreColor(score, alpha, stops) {
    if (score == null) return alpha == null ? COLORS.none : hexAlpha(COLORS.none, alpha);
    stops = stops || STOPS;
    var s = Math.max(0, Math.min(100, score)), i = s <= 50 ? 0 : 1;
    var a = stops[i], b = stops[i + 1], k = (s - a[0]) / (b[0] - a[0]);
    var c = [0, 1, 2].map(function (j) { return Math.round(a[1][j] + (b[1][j] - a[1][j]) * k); });
    return "rgba(" + c.join(",") + "," + (alpha == null ? 1 : alpha) + ")";
  }
  function countryOf(feat) {
    return state.data && state.data.countries[feat.properties.iso] || null;
  }
  function scoredOf(feat) {
    var c = countryOf(feat);
    return c && c.final_score != null ? c : null;
  }
  // Etkin boyama moduna göre ülkenin değeri ve rengi
  // Savaş modunda ülkenin rolü: { color, label }
  function warRole(iso) { return state.war && state.war[iso] || null; }
  function modeValue(c) {
    if (!c) return null;
    if (state.mode === "war") return null;
    if (state.mode === "military") return c.military ? c.military.score : null;
    return c.final_score;
  }
  function modeColor(v, alpha) {
    return scoreColor(v, alpha, state.mode === "military" ? MIL_STOPS : STOPS);
  }
  function cName(c, fallback, iso2) {
    var code = (c && c.iso2) || iso2;
    if (code && fmt.region) {
      try { var n = fmt.region.of(code); if (n && n !== code) return n; } catch (e) { /* yok */ }
    }
    return (c && c.name) || fallback;
  }
  function nameOf(feat) {
    return cName(countryOf(feat), feat.properties.name, feat.properties.iso2);
  }
  function fmtDate(iso, withYear) {
    if (!iso) return "";
    var d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
    return (withYear ? fmt.dateY : fmt.date).format(d);
  }
  function ago(iso) {
    if (!iso) return "";
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!fmt.rel) return "";
    if (mins < 60) return fmt.rel.format(-Math.max(1, mins), "minute");
    if (mins < 1440) return fmt.rel.format(-Math.round(mins / 60), "hour");
    return fmt.rel.format(-Math.round(mins / 1440), "day");
  }
  // Çok dilli metin: {dil: metin} ya da eski kayıtlarda düz Türkçe metin
  function loc(v) {
    if (v == null) return v;
    if (typeof v === "string" || Array.isArray(v)) return v;
    return v[state.lang] || v.en || v.tr || v[Object.keys(v)[0]];
  }
  function showError(msg) {
    var el = document.getElementById("error");
    el.textContent = msg;
    el.hidden = false;
  }
  function updateLegend() {
    var lg = document.querySelector(".legend");
    lg.classList.toggle("dim", state.mode === "none");
    lg.hidden = state.mode === "war";   // savaş modunda açıklama katman panelinde
    lg.classList.toggle("mil", state.mode === "military");
    var title = lg.querySelector(".grad-title");
    title.setAttribute("data-i18n", state.mode === "military" ? "milLegend" : "gradTitle");
    title.textContent = t(title.getAttribute("data-i18n"));
  }
  function updateDate() {
    document.getElementById("updated").textContent =
      t("dataAsOf", { d: fmtDate(state.data.built_at || state.data.generated_at, true) });
  }

  // ------------------------------------------------------------ küre
  var globe;
  var labelEls = [], labelRank = 3, showLabels = true;
  function applyLabelVisibility(el) {
    var ok = showLabels && el.dataset.front !== "0" && +el.dataset.rank <= labelRank;
    // display'ı küre çizici her karede kendisi ayarlıyor; bu yüzden visibility kullanılıyor
    el.style.visibility = ok ? "visible" : "hidden";
  }
  function initGlobe() {
    var el = document.getElementById("globe");
    globe = Globe()(el)
      .backgroundColor("#070b14")
      .showGlobe(true)
      .showAtmosphere(true)
      .atmosphereColor("#4b6cb7")
      .atmosphereAltitude(0.18)
      .polygonsData(state.geo.features)
      .polygonAltitude(function (f) {
        if (f === state.selected) return 0.04;
        if (state.mode === "war") return warRole(f.properties.iso) ? 0.014 : 0.006;
        if (f === state.hover && countryOf(f)) return 0.025;
        return state.mode !== "none" && modeValue(countryOf(f)) != null ? 0.012 : 0.006;
      })
      .polygonCapColor(function (f) {
        if (state.mode === "none") return f === state.hover && countryOf(f) ? "rgba(255,255,255,0.18)" : "rgba(14,22,38,0.35)";
        if (state.mode === "war") {
          var r = warRole(f.properties.iso);
          return r ? r.color : (f === state.hover ? "#2c3753" : "#1c2438");
        }
        var v = modeValue(countryOf(f));
        if (v == null) return f === state.hover && countryOf(f) ? "#3a4766" : COLORS.none;
        return modeColor(v, f === state.hover || f === state.selected ? 1 : 0.9);
      })
      .polygonSideColor(function (f) {
        if (state.mode === "none") return "rgba(0,0,0,0)";
        if (state.mode === "war") { var r = warRole(f.properties.iso); return r ? hexAlpha(r.color, 0.45) : "rgba(20,28,45,0.6)"; }
        var v = modeValue(countryOf(f));
        return v != null ? modeColor(v, 0.35) : "rgba(20,28,45,0.6)";
      })
      .polygonStrokeColor(function () { return state.mode !== "none" ? "rgba(7,11,20,0.9)" : "rgba(200,215,240,0.35)"; })
      .polygonLabel(function (f) {
        var c = countryOf(f), v = modeValue(c), s;
        if (state.mode === "war") {
          var r = warRole(f.properties.iso);
          s = r ? " · " + esc(r.label) : "";
        } else {
          s = v != null ? " · <b>" + fmt.n0.format(v) + "</b>" : (c ? " · " + esc(t("noData")) : "");
        }
        return '<div class="tip" dir="auto">' + esc(nameOf(f)) + s + "</div>";
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
      .polygonsTransitionDuration(250)
      // Ülke adları: uzaktan yalnızca büyük ülkeler, yaklaştıkça küçükler
      .htmlElementsData(state.geo.features)
      .htmlLat(function (f) { return f.properties.ly; })
      .htmlLng(function (f) { return f.properties.lx; })
      .htmlAltitude(0.015)
      .htmlElement(function (f) {
        var el = document.createElement("div");
        el.className = "clabel r" + Math.min(6, f.properties.rank || 6);
        el.textContent = nameOf(f);
        el.dataset.rank = f.properties.rank || 9;
        labelEls.push([el, f]);
        return el;
      })
      .htmlElementVisibilityModifier(function (el, visible) {
        el.dataset.front = visible ? "1" : "0";
        applyLabelVisibility(el);
      })
      .onZoom(function (pov) {
        var r = pov.altitude > 2.2 ? 2 : pov.altitude > 1.5 ? 3 : pov.altitude > 1.0 ? 4 : pov.altitude > 0.6 ? 5 : 9;
        if (r !== labelRank) {
          labelRank = r;
          labelEls.forEach(function (x) { applyLabelVisibility(x[0]); });
        }
      });

    var mat = globe.globeMaterial();
    mat.color.set("#0e1626");
    if (mat.emissive) mat.emissive.set("#0a1120");
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

  function refresh(labels) {
    globe.polygonAltitude(globe.polygonAltitude()).polygonCapColor(globe.polygonCapColor());
    if (labels) globe.polygonLabel(globe.polygonLabel());
  }

  // weather.js ve ileride eklenecek katmanlar için
  window.WorldApp = {
    t: function (k, v) { return t(k, v); },
    locale: function () { return state.lang === "zh" ? "zh-CN" : state.lang; },
    globe: function () { return globe; },
    setLabelsVisible: function (v) {
      showLabels = v;
      labelEls.forEach(function (x) { applyLabelVisibility(x[0]); });
    },
    // Savaş boyaması: { ISO3: { color, label } }
    setWar: function (map) {
      state.war = map;
      if (state.mode === "war" && globe) {
        globe.polygonSideColor(globe.polygonSideColor());
        refresh(true);
      }
    },
    // "scores" | "military" | "war" | "none"
    setColorMode: function (m) {
      state.mode = m;
      updateLegend();
      if (!globe) return;
      globe.polygonSideColor(globe.polygonSideColor()).polygonStrokeColor(globe.polygonStrokeColor());
      refresh(true);
    }
  };

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
    return { lng: x / r.length, lat: y / r.length, span: Math.max(maxX - minX, maxY - minY) };
  }

  function select(f) {
    state.selected = f;
    globe.controls().autoRotate = false;
    var c = centroid(f);
    var mobile = window.innerWidth <= 640;
    var shift = document.documentElement.dir === "rtl" ? -9 : 9;
    globe.pointOfView({ lat: c.lat - (mobile ? 6 : 0), lng: c.lng + (mobile ? 0 : shift), altitude: Math.max(0.6, Math.min(2.2, c.span / 28)) }, 1100);
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
      case "NY.GDP.PCAP.PP.KD": return fmt.usd.format(v);
      case "FP.CPI.TOTL.ZG":
      case "SL.UEM.TOTL.ZS": return fmt.pct.format(v / 100);
      case "RSF": return fmt.n1.format(v);
      default: return fmt.n2.format(v); // WGI: yaklaşık -2,5 … +2,5; HDI ve V-Dem 0-1
    }
  }
  function fmtMil(p) {
    if (p.code === "MS.MIL.XPND.CD") {
      return new Intl.NumberFormat(window.WorldApp.locale(), { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(p.value);
    }
    if (p.code === "MS.MIL.XPND.GD.ZS") return fmt.pct.format(p.value / 100);
    return fmt.n0.format(p.value);
  }
  function fmtDemo(code, v) {
    if (code === "SP.POP.TOTL") return fmt.n0.format(v);
    if (code === "SP.DYN.LE00.IN") return fmt.n1.format(v);
    return fmt.pct.format(v / 100);
  }
  function confLabel(c) {
    var map = { low: "confLow", medium: "confMedium", high: "confHigh", "düşük": "confLow", "orta": "confMedium", "yüksek": "confHigh" };
    return map[c] ? t(map[c]) : "";
  }
  function spark(series, w, hgt, color) {
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
  function chg(x) {
    if (x == null) return '<span class="muted">–</span>';
    var cls = x > 0 ? "up" : x < 0 ? "down" : "";
    return '<span class="' + cls + '" dir="ltr">' + fmt.pctS.format(x / 100) + "</span>";
  }

  function renderPanel(c) {
    var th = state.data.method.thresholds;
    var b = band(c.final_score, th);
    var h = "";

    h += '<div class="p-head">';
    h += '<div class="p-score" style="background:' + scoreColor(c.final_score) + '">' +
      (c.final_score == null ? "–" : fmt.n0.format(c.final_score)) + "</div>";
    h += '<div><h2 class="p-name">' + esc(cName(c, c.name)) + '</h2><div class="p-verdict">' + verdict(b) + "</div></div>";
    h += "</div>";

    if (c.missing && c.missing.length) {
      var dimKeys = { "Yönetişim": "dim_governance", "Ekonomi": "dim_economy", "İnsani gelişme": "dim_human",
                      "Yargı bağımsızlığı": "dim_judiciary", "Medya bağımsızlığı": "dim_media" };
      var list = c.missing.map(function (m) { return dimKeys[m] ? t(dimKeys[m]) : m; }).join(", ");
      h += '<div class="note" style="margin:0 0 18px">' + esc(t("missing", { list: list })) + "</div>";
    }

    h += '<div class="split">';
    h += '<div><div class="k">' + esc(t("index")) + '</div><div class="v">' +
      (c.index_score == null ? "–" : fmt.n1.format(c.index_score)) + "</div></div>";
    h += '<div><div class="k">' + esc(t("aiAvg", { n: c.ai ? c.ai.days : 7 })) + '</div><div class="v' +
      (c.ai_score == null ? ' pending">' + esc(t("notYet")) : '">' + fmt.n1.format(c.ai_score)) + "</div></div>";
    h += "</div>";

    if (c.ai && c.ai.latest) {
      var L = c.ai.latest, drivers = loc(L.drivers) || [];
      h += "<h3>" + esc(t("aiTitle")) + " · " + esc(fmtDate(L.date)) + "</h3>";
      h += '<div class="ai">';
      h += '<div class="ai-top"><span class="chip" style="background:' + scoreColor(L.score) + '">' + fmt.n0.format(L.score) + "</span>" +
        "<span>" + esc(t("todayScore")) + (confLabel(L.confidence) ? " · " + esc(t("confidence")) + ": " + esc(confLabel(L.confidence)) : "") +
        "</span>" + spark(c.ai.series) + "</div>";
      h += '<p class="ai-sum" dir="auto">' + esc(loc(L.summary) || "") + "</p>";
      if (drivers.length) {
        h += '<ul class="ai-drv" dir="auto">' + drivers.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>";
      }
      h += '<div class="src">' + esc(t("aiFoot", { n: L.headlines || 0 })) + "</div>";
      h += "</div>";
    }

    h += "<h3>" + esc(t("dimsTitle")) + "</h3>";
    Object.keys(c.dimensions).forEach(function (k) {
      var d = c.dimensions[k];
      h += '<details class="dim"><summary>';
      h += '<div class="dim-top"><span>' + esc(t("dim_" + k)) + "</span><b>" + fmt.n1.format(d.score) + "</b></div>";
      h += '<div class="bar"><i style="width:' + d.score + "%;background:" + scoreColor(d.score) + '"></i></div>';
      h += '</summary><div class="parts"><table>';
      d.parts.forEach(function (p) {
        h += "<tr><td>" + esc(t(p.code)) + ' <span style="opacity:.6">(' + p.year + ")</span></td>" +
          '<td dir="ltr">' + fmtValue(p) + '</td><td dir="ltr">' + fmt.n0.format(p.percentile) + "/100</td></tr>";
      });
      h += "</table>";
      h += '<div class="src">' + esc(t("source")) + ': <a href="' + esc(d.source.url) + '" target="_blank" rel="noopener">' +
        esc(t("src_" + k) === "src_" + k ? d.source.name : t("src_" + k)) + "</a></div>";
      h += "</div></details>";
    });

    if (c.military) {
      var M = c.military;
      h += "<h3>" + esc(t("military")) + "</h3>";
      h += '<details class="dim mil"><summary>';
      h += '<div class="dim-top"><span>' + esc(t("milIndex")) + "</span><b>" + fmt.n1.format(M.score) + "</b></div>";
      h += '<div class="bar"><i style="width:' + M.score + "%;background:" + scoreColor(M.score, null, MIL_STOPS) + '"></i></div>';
      h += '</summary><div class="parts"><table>';
      M.parts.forEach(function (p) {
        h += "<tr><td>" + esc(t(p.code)) + ' <span style="opacity:.6">(' + p.year + ")</span></td>" +
          '<td dir="ltr">' + fmtMil(p) + '</td><td dir="ltr">' + (p.percentile == null ? "" : fmt.n0.format(p.percentile) + "/100") + "</td></tr>";
      });
      h += "</table>";
      h += '<div class="src">' + esc(t("source")) + ': <a href="' + esc(M.source.url) + '" target="_blank" rel="noopener">' +
        esc(t("src_military")) + "</a></div>";
      h += "</div></details>";
      h += '<div class="note" style="margin-top:6px">' + esc(t("milNote")) + "</div>";
    }

    var demoKeys = Object.keys(c.demographics || {});
    if (demoKeys.length) {
      h += "<h3>" + esc(t("demographics")) + '</h3><div class="demo">';
      demoKeys.forEach(function (k) {
        var d = c.demographics[k];
        h += "<span>" + esc(t(k)) + " (" + d.year + ')</span><span dir="ltr">' + fmtDemo(k, d.value) + "</span>";
      });
      h += "</div>";
    }

    h += '<div id="live"><h3>' + esc(t("news")) + '</h3><div class="note" style="margin-top:0">' + esc(t("loading")) + "</div></div>";
    h += '<div class="note">' + esc(t("method")) + "</div>";

    document.getElementById("panel-body").innerHTML = h;
    document.getElementById("panel").scrollTop = 0;
    loadNews(c.iso3).then(function (news) {
      if (state.selected && countryOf(state.selected) === c) renderLive(c, news);
    });
  }

  var newsCache = {};
  function loadNews(iso) {
    if (!newsCache[iso]) {
      newsCache[iso] = fetch("data/news/" + iso + ".json?t=" + Math.floor(Date.now() / 3600000))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return newsCache[iso];
  }

  function renderLive(c, news) {
    var box = document.getElementById("live");
    if (!box) return;
    var n = news && (news.local || news.intl) ? news : null;
    var h = "";
    if (n && n.market) {
      var m = n.market, up = (m.chg_1m || 0) >= 0;
      h += "<h3>" + esc(t("market")) + "</h3>";
      h += '<div class="mkt"><div><div class="mkt-name" dir="auto">' + esc(m.name) + '</div><div class="mkt-last" dir="ltr">' +
        fmt.n2.format(m.last) + " " + esc(m.currency || "") + "</div></div>" +
        spark(m.spark, 110, 34, up ? "#34c77b" : "#ef5350") + "</div>";
      h += '<div class="mkt-chg"><span>' + esc(t("d1")) + " " + chg(m.chg_1d) + "</span><span>" + esc(t("w1")) + " " +
        chg(m.chg_1w) + "</span><span>" + esc(t("m1")) + " " + chg(m.chg_1m) + "</span></div>";
      h += '<div class="src">' + esc(t("closeOf", { d: fmtDate(m.as_of) })) + " · Yahoo Finance</div>";
    }
    if (n && (n.local.length || n.intl.length)) {
      h += "<h3>" + esc(t("newsTitle", { h: n.hours || 24 })) + "</h3>";
      h += '<div class="tabs" role="tablist"><button class="on" data-k="intl">' + esc(t("intl")) +
        '</button><button data-k="local">' + esc(t("local")) + "</button></div>";
      h += '<ul class="news" data-k="intl">' + newsList(n.intl) + "</ul>";
      h += '<ul class="news" data-k="local" hidden>' + newsList(n.local) + "</ul>";
      h += '<div class="src">' + esc(t("source")) + ': <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener">GDELT Project</a></div>';
    } else if (c.final_score != null) {
      h += "<h3>" + esc(t("news")) + '</h3><div class="note" style="margin-top:0">' + esc(t("noNewsCountry")) + "</div>";
    }
    box.innerHTML = h;
    var tabs = box.querySelectorAll(".tabs button");
    Array.prototype.forEach.call(tabs, function (btn) {
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle("on", x === btn); });
        Array.prototype.forEach.call(box.querySelectorAll("ul.news"), function (u) { u.hidden = u.dataset.k !== btn.dataset.k; });
      });
    });
  }

  function newsList(items) {
    if (!items || !items.length) return '<li class="muted">' + esc(t("noNews")) + "</li>";
    return items.slice(0, 12).map(function (a) {
      var url = /^https?:\/\//.test(a.url || "") ? a.url : "#";
      return '<li><a href="' + esc(url) + '" target="_blank" rel="noopener nofollow" dir="auto">' + esc(a.title) + "</a>" +
        '<span class="meta">' + esc(a.domain || "") + " · " + esc(ago(a.time)) + "</span></li>";
    }).join("");
  }

  // ------------------------------------------------------------ açılış
  buildLangMenu();
  setLang(pickLang());
  document.getElementById("close").addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });

  if (typeof Globe !== "function") {
    showError(t("errLib"));
    return;
  }

  var bust = "?t=" + Math.floor(Date.now() / 3600000);
  Promise.all([
    fetch("data/countries.json" + bust).then(function (r) { if (!r.ok) throw new Error("countries.json " + r.status); return r.json(); }),
    fetch("data/ne_110m_countries.geojson").then(function (r) { if (!r.ok) throw new Error("geojson " + r.status); return r.json(); })
  ]).then(function (res) {
    state.data = res[0];
    state.geo = res[1];
    updateDate();
    initGlobe();
    var s = document.createElement("script");
    s.src = "weather.js";
    document.body.appendChild(s);
  }).catch(function (e) {
    showError(t("errData", { e: e.message }));
  });
})();
