/* Katman paneli ve hava durumu katmanları (bulut, yağış, sıcaklık, rüzgâr animasyonu).
   Veri: data/weather/ (NOAA GFS, scripts/fetch_weather.py). */
(function () {
  "use strict";

  var APP = window.WorldApp;
  var THREE = window.THREE;
  var t = APP.t;

  var LAYERS = [
    { id: "scores", key: "layerScores", on: true },
    { id: "military", key: "layerMilitary", on: false },
    { id: "labels", key: "layerLabels", on: true },
    { id: "clouds", key: "layerClouds", on: false },
    { id: "precip", key: "layerPrecip", on: false },
    { id: "temp", key: "layerTemp", on: false },
    { id: "wind", key: "layerWind", on: false }
  ];
  var on = {};
  LAYERS.forEach(function (l) { on[l.id] = l.on; });
  try {
    var saved = JSON.parse(localStorage.getItem("layers") || "null");
    if (saved) Object.keys(saved).forEach(function (k) { if (k in on) on[k] = !!saved[k]; });
  } catch (e) { /* yok say */ }

  var MOBILE = Math.min(window.innerWidth, window.innerHeight) < 700;
  var SKY_W = MOBILE ? 1024 : 2048, SKY_H = SKY_W / 2;
  var WIND_W = MOBILE ? 1024 : 2048, WIND_H = WIND_W / 2;
  var PARTICLES = MOBILE ? 1800 : 4500;

  var wx = { meta: null, frames: [], loading: null, error: null };
  var sky = null, wind = null;
  var timeline = { pos: 0, playing: true, last: 0 };

  // ------------------------------------------------------------ panel
  var panel = document.getElementById("layers");

  function wxActive() { return on.clouds || on.precip || on.temp || on.wind; }

  function renderPanel() {
    var h = "";
    LAYERS.forEach(function (l) {
      h += '<label class="ly-row"><input type="checkbox" data-id="' + l.id + '"' + (on[l.id] ? " checked" : "") +
        "><span>" + esc(t(l.key)) + "</span></label>";
      if (l.id === "temp" && on.temp) {
        h += '<div class="ly-scale"><div class="ly-bar temp" dir="ltr"></div><div class="ly-ticks" dir="ltr"><span>−40°</span><span>0°</span><span>+40°C</span></div></div>';
      }
      if (l.id === "precip" && on.precip) {
        h += '<div class="ly-scale"><div class="ly-bar precip" dir="ltr"></div><div class="ly-ticks"><span>' + esc(t("light")) +
          "</span><span>" + esc(t("heavy")) + "</span></div></div>";
      }
    });
    if (wxActive()) {
      if (wx.error) {
        h += '<div class="ly-note">' + esc(t("wxError")) + "</div>";
      } else if (!wx.meta) {
        h += '<div class="ly-note">' + esc(t("loading")) + "</div>";
      } else {
        h += '<div class="ly-time">' +
          '<button class="ly-play" aria-label="' + esc(t(timeline.playing ? "pause" : "play")) + '">' + (timeline.playing ? "❚❚" : "▶") + "</button>" +
          '<input type="range" class="ly-range" min="0" max="' + ((wx.meta.frames.length - 1) * 100) + '" value="' + Math.round(timeline.pos * 100) + '">' +
          "</div>" +
          '<div class="ly-when" id="ly-when"></div>' +
          '<div class="ly-src">' + esc(t("wxSource")) + "</div>";
      }
    }
    panel.innerHTML = h;
    Array.prototype.forEach.call(panel.querySelectorAll("input[type=checkbox]"), function (cb) {
      cb.addEventListener("change", function () { toggle(cb.getAttribute("data-id"), cb.checked); });
    });
    var play = panel.querySelector(".ly-play");
    if (play) play.addEventListener("click", function () { timeline.playing = !timeline.playing; renderPanel(); });
    var range = panel.querySelector(".ly-range");
    if (range) range.addEventListener("input", function () {
      timeline.playing = false;
      timeline.pos = range.value / 100;
      var p = panel.querySelector(".ly-play");
      if (p) { p.textContent = "▶"; p.setAttribute("aria-label", t("play")); }
      drawSky(true);
      updateWhen();
    });
    updateWhen();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function updateWhen() {
    var el = document.getElementById("ly-when");
    if (!el || !wx.meta) return;
    var fr = wx.meta.frames, i = Math.min(fr.length - 1, Math.round(timeline.pos));
    var d = new Date(fr[i].time);
    var f = new Intl.DateTimeFormat(APP.locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    el.textContent = t("forecastAt", { d: f.format(d) });
  }

  function toggle(id, value) {
    on[id] = value;
    try { localStorage.setItem("layers", JSON.stringify(on)); } catch (e) { /* yok say */ }
    // Ülke skoru ve askeri güç aynı anda boyanamaz: biri seçilince diğeri kapanır
    if (id === "scores" && value) on.military = false;
    if (id === "military" && value) on.scores = false;
    if (id === "scores" || id === "military") {
      APP.setColorMode(on.scores ? "scores" : on.military ? "military" : "none");
      try { localStorage.setItem("layers", JSON.stringify(on)); } catch (e) { /* yok say */ }
    }
    if (id === "labels") APP.setLabelsVisible(value);
    if (wxActive()) ensureData().then(function () { setupMeshes(); drawSky(true); renderPanel(); });
    updateVisibility();
    renderPanel();
  }

  // ------------------------------------------------------------ veri
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () {
        var c = document.createElement("canvas");
        c.width = im.width; c.height = im.height;
        var x = c.getContext("2d");
        x.drawImage(im, 0, 0);
        res(x.getImageData(0, 0, im.width, im.height));
      };
      im.onerror = function () { rej(new Error(src)); };
      im.src = src;
    });
  }

  function ensureData() {
    if (wx.loading) return wx.loading;
    var bust = "?t=" + Math.floor(Date.now() / 3600000);
    wx.loading = fetch("data/weather/meta.json" + bust)
      .then(function (r) { if (!r.ok) throw new Error("meta " + r.status); return r.json(); })
      .then(function (meta) {
        return Promise.all(meta.frames.map(function (f) {
          return Promise.all([loadImage("data/weather/" + f.wind + bust), loadImage("data/weather/" + f.sky + bust)])
            .then(function (im) { return { wind: im[0], sky: im[1], time: new Date(f.time).getTime() }; });
        })).then(function (frames) {
          wx.meta = meta;
          wx.frames = frames;
          // Zaman çizgisini şu ana en yakın kareden başlat
          var now = Date.now(), best = 0;
          frames.forEach(function (f, i) { if (Math.abs(f.time - now) < Math.abs(frames[best].time - now)) best = i; });
          timeline.pos = best;
          buildFrameCanvases();
        });
      })
      .catch(function (e) { wx.error = e; console.warn("hava verisi", e); renderPanel(); });
    return wx.loading;
  }

  // Renk rampaları
  function ramp(stops, x) {
    if (x <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (x <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], k = (x - a[0]) / (b[0] - a[0]);
        return [0, 1, 2, 3].map(function (j) { return a[1][j] + (b[1][j] - a[1][j]) * k; });
      }
    }
    return stops[stops.length - 1][1];
  }
  var TEMP = [[-40, [120, 60, 200, 170]], [-20, [60, 110, 230, 160]], [0, [120, 200, 230, 140]], [10, [90, 200, 120, 130]],
              [20, [240, 220, 80, 140]], [30, [245, 140, 50, 160]], [40, [210, 40, 60, 180]]];
  var RAIN = [[0.1, [90, 170, 255, 90]], [1, [60, 140, 255, 170]], [5, [140, 90, 255, 210]], [15, [230, 60, 200, 235]]];

  function buildFrameCanvases() {
    var enc = wx.meta.encoding;
    wx.frames.forEach(function (fr) {
      var W = fr.sky.width, H = fr.sky.height, n = W * H;
      var cloud = new ImageData(W, H), rain = new ImageData(W, H), temp = new ImageData(W, H);
      for (var p = 0; p < n; p++) {
        var o = p * 4;
        var cc = fr.sky.data[o] / 255;                    // 0-1 bulut örtüsü
        var ca = cc < 0.25 ? 0 : Math.pow((cc - 0.25) / 0.75, 1.4) * 175;
        cloud.data[o] = cloud.data[o + 1] = cloud.data[o + 2] = 255; cloud.data[o + 3] = ca;

        var g = fr.sky.data[o + 1] / 255, mm = g * g * enc.precip_mmh.max;
        if (mm >= 0.1) {
          var rc = ramp(RAIN, mm);
          rain.data[o] = rc[0]; rain.data[o + 1] = rc[1]; rain.data[o + 2] = rc[2]; rain.data[o + 3] = rc[3];
        }
        var tc = enc.t_c[0] + fr.wind.data[o + 2] / 255 * (enc.t_c[1] - enc.t_c[0]);
        var tcl = ramp(TEMP, tc);
        temp.data[o] = tcl[0]; temp.data[o + 1] = tcl[1]; temp.data[o + 2] = tcl[2]; temp.data[o + 3] = tcl[3];
      }
      fr.canvas = { cloud: toCanvas(cloud), rain: toCanvas(rain), temp: toCanvas(temp) };
    });
  }
  function toCanvas(img) {
    var c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").putImageData(img, 0, 0);
    return c;
  }

  // ------------------------------------------------------------ küre üstü katmanlar
  function overlayMesh(canvas, altitude) {
    var R = APP.globe().getGlobeRadius() * (1 + altitude);
    var tex = new THREE.CanvasTexture(canvas);
    if ("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R, 128, 64),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    // three-globe ile aynı yönelim: dokunun sol kenarı 180°B
    mesh.rotation.y = -Math.PI / 2;
    mesh.raycast = function () { /* ülke tıklamalarını engellemesin */ };
    mesh.renderOrder = 10;
    APP.globe().scene().add(mesh);
    return { mesh: mesh, tex: tex };
  }

  function setupMeshes() {
    if (!wx.meta || sky) return;
    var c1 = document.createElement("canvas");
    c1.width = SKY_W; c1.height = SKY_H;
    sky = overlayMesh(c1, 0.05);
    sky.canvas = c1; sky.ctx = c1.getContext("2d");
    var c2 = document.createElement("canvas");
    c2.width = WIND_W; c2.height = WIND_H;
    wind = overlayMesh(c2, 0.055);
    wind.canvas = c2; wind.ctx = c2.getContext("2d");
    wind.particles = [];
    for (var i = 0; i < PARTICLES; i++) wind.particles.push(spawn({}));
    updateVisibility();
  }

  function updateVisibility() {
    if (sky) sky.mesh.visible = on.clouds || on.precip || on.temp;
    if (wind) {
      wind.mesh.visible = on.wind;
      if (!on.wind) wind.ctx.clearRect(0, 0, WIND_W, WIND_H);
    }
  }

  var lastSkyPos = -1;
  function drawSky(force) {
    if (!sky || !wx.frames.length) return;
    if (!force && Math.abs(timeline.pos - lastSkyPos) < 0.02) return;
    lastSkyPos = timeline.pos;
    var ctx = sky.ctx, n = wx.frames.length;
    var i0 = Math.floor(timeline.pos) % n, i1 = Math.min(n - 1, i0 + 1), k = timeline.pos - Math.floor(timeline.pos);
    ctx.clearRect(0, 0, SKY_W, SKY_H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // 1 derecelik ızgara büyütülünce kare kare görünmesin (Safari filtreyi yok sayar)
    ctx.filter = "blur(" + Math.round(SKY_W / 360 * 0.8) + "px)";
    ["temp", "rain", "cloud"].forEach(function (kind) {
      var flag = kind === "temp" ? on.temp : kind === "rain" ? on.precip : on.clouds;
      if (!flag) return;
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(wx.frames[i0].canvas[kind], 0, 0, SKY_W, SKY_H);
      if (k > 0.01 && i1 !== i0) {
        ctx.globalAlpha = k;
        ctx.drawImage(wx.frames[i1].canvas[kind], 0, 0, SKY_W, SKY_H);
      }
    });
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    sky.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ rüzgâr parçacıkları
  function spawn(p) {
    p.lon = Math.random() * 360 - 180;
    p.lat = Math.asin(Math.random() * 1.9 - 0.95) * 180 / Math.PI;   // alana göre eşit dağılım, kutuplar hariç
    p.age = Math.floor(Math.random() * 90);
    p.max = 60 + Math.floor(Math.random() * 60);
    return p;
  }

  function sampleWind(lon, lat) {
    // Iki zaman karesi arasında ve ızgarada çift doğrusal enterpolasyon
    var n = wx.frames.length, pos = Math.min(timeline.pos, n - 1);
    var i0 = Math.floor(pos), i1 = Math.min(n - 1, i0 + 1), k = pos - i0;
    var enc = wx.meta.encoding, W = 360, H = 181;
    var x = (lon + 180), y = (90 - lat);
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    var xa = ((x0 % W) + W) % W, xb = (xa + 1) % W, ya = Math.max(0, Math.min(H - 1, y0)), yb = Math.min(H - 1, ya + 1);
    function at(img, xx, yy, ch) { return img.data[(yy * W + xx) * 4 + ch]; }
    function bil(img, ch) {
      return (at(img, xa, ya, ch) * (1 - fx) + at(img, xb, ya, ch) * fx) * (1 - fy) +
             (at(img, xa, yb, ch) * (1 - fx) + at(img, xb, yb, ch) * fx) * fy;
    }
    var A = wx.frames[i0].wind, B = wx.frames[i1].wind;
    var ur = bil(A, 0) * (1 - k) + bil(B, 0) * k, vr = bil(A, 1) * (1 - k) + bil(B, 1) * k;
    var lo = enc.u[0], span = enc.u[1] - enc.u[0];
    return [lo + ur / 255 * span, lo + vr / 255 * span];
  }

  function speedColor(s) {
    if (s < 3) return "rgba(255,255,255,0.6)";
    if (s < 8) return "rgba(200,235,255,0.8)";
    if (s < 15) return "rgba(140,220,255,0.85)";
    if (s < 25) return "rgba(255,230,120,0.9)";
    return "rgba(255,130,90,0.95)";
  }

  var SCALE = 0.045;     // derece / (m/s) / kare
  function stepWind() {
    var ctx = wind.ctx, sx = WIND_W / 360, sy = WIND_H / 180;
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.955)";
    ctx.fillRect(0, 0, WIND_W, WIND_H);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = MOBILE ? 1.3 : 1.7;
    ctx.lineCap = "round";
    var buckets = {};
    for (var i = 0; i < wind.particles.length; i++) {
      var p = wind.particles[i];
      if (++p.age > p.max) { spawn(p); p.age = 0; continue; }
      var uv = sampleWind(p.lon, p.lat), s = Math.sqrt(uv[0] * uv[0] + uv[1] * uv[1]);
      var nlon = p.lon + uv[0] * SCALE / Math.max(0.2, Math.cos(p.lat * Math.PI / 180));
      var nlat = p.lat + uv[1] * SCALE;
      if (nlat > 85 || nlat < -85) { spawn(p); continue; }
      if (nlon > 180) nlon -= 360;
      if (nlon < -180) nlon += 360;
      var x0 = (p.lon + 180) * sx, y0 = (90 - p.lat) * sy, x1 = (nlon + 180) * sx, y1 = (90 - nlat) * sy;
      p.lon = nlon; p.lat = nlat;
      if (Math.abs(x1 - x0) > WIND_W / 2) continue;      // tarih çizgisini atlama
      var col = speedColor(s);
      (buckets[col] = buckets[col] || []).push(x0, y0, x1, y1);
    }
    Object.keys(buckets).forEach(function (col) {
      var a = buckets[col];
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (var j = 0; j < a.length; j += 4) { ctx.moveTo(a[j], a[j + 1]); ctx.lineTo(a[j + 2], a[j + 3]); }
      ctx.stroke();
    });
    wind.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ döngü
  var lastFrame = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!wx.meta || !sky) return;
    var dt = Math.min(100, ts - (timeline.last || ts));
    timeline.last = ts;
    if (timeline.playing && (on.clouds || on.precip || on.temp || on.wind)) {
      // 24 saatlik tahmin ~12 saniyede bir tur
      var n = wx.frames.length;
      timeline.pos += dt / 1000 * ((n - 1) / 12);
      if (timeline.pos > n - 1) timeline.pos = 0;
      var range = panel.querySelector(".ly-range");
      if (range) range.value = Math.round(timeline.pos * 100);
      updateWhen();
    }
    if (on.clouds || on.precip || on.temp) drawSky(false);
    if (on.wind && ts - lastFrame > (MOBILE ? 40 : 28)) {
      lastFrame = ts;
      stepWind();
    }
  }

  // ------------------------------------------------------------ açılış
  if (!THREE) {
    LAYERS = LAYERS.filter(function (l) { return ["scores", "military", "labels"].indexOf(l.id) >= 0; });
    ["clouds", "precip", "temp", "wind"].forEach(function (k) { on[k] = false; });
  }
  if (MOBILE) document.getElementById("layers-box").removeAttribute("open");
  if (on.scores && on.military) on.military = false;
  APP.setColorMode(on.scores ? "scores" : on.military ? "military" : "none");
  APP.setLabelsVisible(on.labels);
  renderPanel();
  document.addEventListener("langchange", renderPanel);
  if (wxActive()) ensureData().then(function () { setupMeshes(); drawSky(true); renderPanel(); });
  requestAnimationFrame(loop);
})();
