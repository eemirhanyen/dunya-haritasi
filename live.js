/* Canlı katmanlar: gece/gündüz, uçaklar (OpenSky), askeri uçaklar (adsb.lol),
   depremler (USGS), Uluslararası Uzay İstasyonu. Katman paneli weather.js'te;
   bu dosya window.LiveLayers.set(id, açık) ile yönetilir. */
(function () {
  "use strict";

  var APP = window.WorldApp, THREE = window.THREE, t = APP.t;
  var globe = APP.globe();
  var R = globe.getGlobeRadius();
  var on = {};
  var counts = {};

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nfmt(n, d) { return new Intl.NumberFormat(APP.locale(), { maximumFractionDigits: d || 0 }).format(n); }
  function agoTxt(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    var rt = Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(APP.locale(), { numeric: "auto", style: "short" }) : null;
    if (!rt) return "";
    return m < 60 ? rt.format(-Math.max(1, m), "minute") : rt.format(-Math.round(m / 60), "hour");
  }
  function notify() { document.dispatchEvent(new Event("livecounts")); }

  // ------------------------------------------------------------ gece / gündüz
  var night = null;
  function sunPos(d) {
    // Yaklaşık güneş altı noktası (zaman denklemi ihmal: en çok ~4° sapma)
    var start = Date.UTC(d.getUTCFullYear(), 0, 0), day = (d - start) / 864e5;
    var dec = -23.44 * Math.cos(2 * Math.PI / 365 * (day + 10));
    var hours = d.getUTCHours() + d.getUTCMinutes() / 60;
    return { lat: dec, lng: (12 - hours) * 15 };
  }
  function drawNight() {
    var W = 360, H = 180, s = sunPos(new Date()), rad = Math.PI / 180;
    var small = night.small, ctx = small.getContext("2d"), img = ctx.createImageData(W, H);
    var sd = Math.sin(s.lat * rad), cd = Math.cos(s.lat * rad);
    for (var y = 0; y < H; y++) {
      var lat = (90 - y - 0.5) * rad, sl = Math.sin(lat), cl = Math.cos(lat);
      for (var x = 0; x < W; x++) {
        var lng = (x + 0.5 - 180) * rad;
        var cz = sl * sd + cl * cd * Math.cos(lng - s.lng * rad);
        var k = Math.max(0, Math.min(1, (0.08 - cz) / 0.2));     // alacakaranlık geçişi
        var o = (y * W + x) * 4;
        img.data[o] = 4; img.data[o + 1] = 8; img.data[o + 2] = 22; img.data[o + 3] = k * k * (3 - 2 * k) * 150;
      }
    }
    ctx.putImageData(img, 0, 0);
    var big = night.ctx;
    big.clearRect(0, 0, night.canvas.width, night.canvas.height);
    big.imageSmoothingEnabled = true;
    big.drawImage(small, 0, 0, night.canvas.width, night.canvas.height);
    night.tex.needsUpdate = true;
  }
  function setNight(v) {
    if (v && !night) {
      var c = document.createElement("canvas");
      c.width = 1024; c.height = 512;
      var tex = new THREE.CanvasTexture(c);
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      var mesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 96, 48),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      mesh.rotation.y = -Math.PI / 2;
      mesh.raycast = function () {};
      mesh.renderOrder = 9;
      globe.scene().add(mesh);
      var small = document.createElement("canvas");
      small.width = 360; small.height = 180;
      night = { mesh: mesh, tex: tex, canvas: c, ctx: c.getContext("2d"), small: small, timer: null };
    }
    if (!night) return;
    night.mesh.visible = v;
    clearInterval(night.timer);
    if (v) { drawNight(); night.timer = setInterval(drawNight, 60000); }
  }

  // ------------------------------------------------------------ uçaklar
  // Uçak simgesi: burnu yukarı bakan beyaz siluet (renk shader'da verilir)
  var planeTex = (function () {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var x = c.getContext("2d");
    x.translate(32, 32);
    x.fillStyle = "#fff";
    x.beginPath();
    x.moveTo(0, -29);                       // burun
    x.bezierCurveTo(3, -26, 3.5, -20, 3.5, -12);
    x.lineTo(28, 2); x.lineTo(28, 7); x.lineTo(3.5, 0);   // sağ kanat
    x.lineTo(3, 18); x.lineTo(11, 24); x.lineTo(11, 28); x.lineTo(0, 25);   // sağ kuyruk
    x.lineTo(-11, 28); x.lineTo(-11, 24); x.lineTo(-3, 18);                 // sol kuyruk
    x.lineTo(-3.5, 0); x.lineTo(-28, 7); x.lineTo(-28, 2); x.lineTo(-3.5, -12);   // sol kanat
    x.bezierCurveTo(-3.5, -20, -3, -26, 0, -29);
    x.closePath();
    x.fill();
    var t = new THREE.CanvasTexture(c);
    t.generateMipmaps = true;
    return t;
  })();

  // Her uçak ekranda kendi yönüne döner: yön vektörü ekrana izdüşürülüp açı hesaplanır
  var VERT = [
    "attribute vec3 dir;",
    "uniform float size;",
    "uniform float aspect;",
    "varying float vAng;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  vec4 c0 = projectionMatrix * mv;",
    "  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(position + dir, 1.0);",
    "  vec2 d = c1.xy / c1.w - c0.xy / c0.w;",
    "  d.x *= aspect;",
    "  vAng = atan(d.x, d.y);",
    "  gl_PointSize = clamp(size * 600.0 / -mv.z, 7.0, 30.0);",
    "  gl_Position = c0;",
    "}"
  ].join("\n");
  var FRAG = [
    "uniform sampler2D map;",
    "uniform vec3 color;",
    "varying float vAng;",
    "void main() {",
    "  vec2 p = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);",
    "  float c = cos(vAng), s = sin(vAng);",
    "  vec2 uv = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;",
    "  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;",
    "  vec4 t = texture2D(map, uv);",
    "  if (t.a < 0.08) discard;",
    "  gl_FragColor = vec4(color, t.a * 0.95);",
    "}"
  ].join("\n");
  var materials = [];
  function updateAspect() {
    var a = window.innerWidth / Math.max(1, window.innerHeight);
    materials.forEach(function (m) { m.uniforms.aspect.value = a; });
  }
  window.addEventListener("resize", updateAspect);

  function makeFleet(id, url, color, size) {
    var f = { id: id, url: url, data: [], fetched: 0, points: null, timer: null, ttl: 120, error: false };
    f.build = function () {
      var n = f.data.length;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute("dir", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      if (f.points) { f.points.geometry.dispose(); f.points.geometry = geo; }
      else {
        var mat = new THREE.ShaderMaterial({
          uniforms: {
            map: { value: planeTex }, color: { value: new THREE.Color(color) },
            size: { value: size }, aspect: { value: 1 }
          },
          vertexShader: VERT, fragmentShader: FRAG,
          transparent: true, depthWrite: false
        });
        materials.push(mat);
        updateAspect();
        f.points = new THREE.Points(geo, mat);
        f.points.raycast = function () {};
        f.points.renderOrder = 12;
        globe.scene().add(f.points);
      }
      f.points.visible = on[id];
      f.place();
    };
    f.where = function (i, atMs) {
      var a = f.data[i], rad = Math.PI / 180;
      var dt = Math.min(1500, ((atMs || Date.now()) - f.fetched) / 1000), d = a[3] * dt, h = a[4] * rad;
      var cosl = Math.max(0.15, Math.cos(a[1] * rad));
      return { lat: a[1] + d * Math.cos(h) / 111320, lng: a[0] + d * Math.sin(h) / (111320 * cosl),
               alt: 0.016 + Math.min(14000, a[2]) / 14000 * 0.012 };
    };
    f.place = function () {
      if (!f.points || !on[id]) return;
      // Son veriden bu yana geçen süre kadar ileri taşı (hız ve yöne göre)
      // Veri en fazla ~20 dk eski olabilir; daha uzun tahmin sapmayı büyütür
      var dt = Math.min(1500, (Date.now() - f.fetched) / 1000);
      var g = f.points.geometry;
      var pos = g.attributes.position.array, dir = g.attributes.dir.array, rad = Math.PI / 180;
      for (var i = 0; i < f.data.length; i++) {
        var a = f.data[i], d = a[3] * dt, h = a[4] * rad;
        var cosl = Math.max(0.15, Math.cos(a[1] * rad));
        var lat = a[1] + d * Math.cos(h) / 111320;
        var lng = a[0] + d * Math.sin(h) / (111320 * cosl);
        var alt = 0.016 + Math.min(14000, a[2]) / 14000 * 0.012;
        var c = globe.getCoords(lat, lng, alt);
        // Yön için ~5 km ileri bir nokta
        var c2 = globe.getCoords(lat + 0.05 * Math.cos(h), lng + 0.05 * Math.sin(h) / cosl, alt);
        pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z;
        dir[i * 3] = c2.x - c.x; dir[i * 3 + 1] = c2.y - c.y; dir[i * 3 + 2] = c2.z - c.z;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.dir.needsUpdate = true;
      g.computeBoundingSphere();
    };
    f.load = function () {
      return fetch(f.url).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).then(function (j) {
        f.data = j.s || [];
        f.hist = j.h || {};
        f.fetched = (j.time ? j.time * 1000 : Date.now());
        if (Date.now() - f.fetched > 3600e3) f.fetched = Date.now();
        f.ttl = Math.max(60, j.ttl || 120);
        f.error = false;
        counts[id] = f.data.length;
        f.build();
        notify();
        document.dispatchEvent(new CustomEvent("fleetupdate", { detail: id }));
      }).catch(function (e) {
        f.error = true;
        counts[id] = null;
        console.warn(id, e);
        notify();
      });
    };
    f.set = function (v) {
      clearTimeout(f.timer);
      if (f.points) f.points.visible = v;
      if (!v) return;
      var tick = function () { f.load().then(function () { f.timer = setTimeout(tick, f.ttl * 1000); }); };
      tick();
    };
    return f;
  }
  var planes = makeFleet("planes", "/api/planes", 0xffe3a0, 3.2);
  var milair = makeFleet("milair", "/api/milair", 0xff5a5a, 4.5);
  setInterval(function () { planes.place(); milair.place(); }, 250);

  // ------------------------------------------------------------ uydular (CelesTrak + SGP4, tarayıcıda)
  var SAT_COLORS = { starlink: 0x9fb4ff, oneweb: 0xc3a6ff, gnss: 0x6dffb0, geo: 0xffd36b, station: 0xff6bf0, other: 0x7ee6ff };
  var satDot = (function () {
    var c = document.createElement("canvas");
    c.width = c.height = 32;
    var x = c.getContext("2d"), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  var sats = { recs: null, points: null, timer: null, loading: null };

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error(src)); };
      document.body.appendChild(s);
    });
  }
  // Yüksek yörüngeler (GPS ~20.000 km, GEO ~36.000 km) gerçek ölçekte kameranın
  // arkasında kalır; 2.000 km üstü logaritmik sıkıştırılır.
  function satAlt(km) {
    var d = km / 6371;
    return d < 0.3 ? d : 0.3 + Math.log(d / 0.3) * 0.35;
  }
  function loadSats() {
    if (sats.loading) return sats.loading;
    sats.loading = Promise.all([
      window.satellite ? Promise.resolve() : loadScript("https://cdn.jsdelivr.net/npm/satellite.js@6.0.2/dist/satellite.min.js"),
      fetch("/api/sats").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    ]).then(function (res) {
      var j = res[1], S = window.satellite, recs = [];
      j.s.forEach(function (x) {
        try { recs.push({ rec: S.twoline2satrec(x[1], x[2]), cat: x[3], name: x[0] }); } catch (e) { /* bozuk kayıt */ }
      });
      sats.recs = recs;
      counts.sats = recs.length;
      var n = recs.length, geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      var col = new Float32Array(n * 3), c = new THREE.Color();
      recs.forEach(function (r, i) { c.set(SAT_COLORS[r.cat] || SAT_COLORS.other); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; });
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      sats.points = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 1.1, map: satDot, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true
      }));
      sats.points.raycast = function () {};
      sats.points.renderOrder = 13;
      globe.scene().add(sats.points);
      notify();
    }).catch(function (e) {
      counts.sats = null; sats.loading = null; console.warn("uydular", e); notify();
    });
    return sats.loading;
  }
  // ~16.000 uydunun hepsini tek seferde hesaplamak zayıf cihazda takılma yapar:
  // her 250 ms'de 1/8'i hesaplanır, her uydu ~2 sn'de bir güncellenir.
  var SAT_SLICES = 8, satSlice = 0;
  function placeSats(all) {
    if (!sats.points || !on.sats) return;
    var S = window.satellite, now = new Date(), gmst = S.gstime(now);
    var pos = sats.points.geometry.attributes.position.array;
    var n = sats.recs.length, per = Math.ceil(n / SAT_SLICES);
    var from = all ? 0 : satSlice * per, to = all ? n : Math.min(n, from + per);
    satSlice = (satSlice + 1) % SAT_SLICES;
    for (var i = from; i < to; i++) {
      var p = null;
      try { p = S.propagate(sats.recs[i].rec, now).position; } catch (e) { p = null; }
      if (!p || isNaN(p.x)) { pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = 0; continue; }   // merkeze gizle
      var g = S.eciToGeodetic(p, gmst);
      var c = globe.getCoords(S.degreesLat(g.latitude), S.degreesLong(g.longitude), satAlt(g.height));
      pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z;
    }
    sats.points.geometry.attributes.position.needsUpdate = true;
    sats.points.geometry.computeBoundingSphere();
  }
  function setSats(v) {
    clearInterval(sats.timer);
    if (sats.points) sats.points.visible = v;
    if (!v) return;
    loadSats().then(function () {
      if (!on.sats || !sats.points) return;
      sats.points.visible = true;
      placeSats(true);
      sats.timer = setInterval(function () { placeSats(false); }, 250);
    });
  }

  // ------------------------------------------------------------ depremler + ISS (globe.gl nokta katmanı)
  var quakes = [], iss = null, quakeTimer = null, issTimer = null;
  function pointData() {
    var arr = [];
    if (on.quakes) arr = arr.concat(quakes);
    if (on.iss && iss) arr.push(iss);
    if (on.events) arr = arr.concat(events);
    globe.pointsData(arr);
    globe.pathsData(on.events ? stormPaths : []);
    globe.ringsData(on.quakes ? quakes.filter(function (q) { return q.mag >= 4.5; }) : []);
  }
  globe
    .pointLat("lat").pointLng("lng")
    .pointAltitude(function (d) { return d.kind === "iss" ? 0.066 : d.kind === "event" ? 0.02 : 0.012; })
    .pointRadius(function (d) {
      if (d.kind === "iss") return 0.9;
      if (d.kind === "event") return d.cat === "severeStorms" ? 0.4 : 0.32;
      return 0.15 + Math.max(0, d.mag - 2.5) * 0.18;
    })
    .pointColor(function (d) {
      if (d.kind === "iss") return "#7ef9ff";
      if (d.kind === "event") return d.cat === "severeStorms" ? catColor(d.unit === "kts" ? d.mag : null, 0.9) : EV_COLORS[d.cat];
      // Depremler kırmızı tonlarda: büyüdükçe koyulaşır
      return d.mag >= 6 ? "#d90000" : d.mag >= 4.5 ? "#ff1f1f" : "#ff5a5a";
    })
    .pointsMerge(false)
    .pointLabel(function (d) {
      if (d.kind === "iss") {
        return '<div class="tip">' + esc(t("issTip", { a: nfmt(d.alt), v: nfmt(d.vel) })) + "</div>";
      }
      if (d.kind === "event") {
        var m = "";
        if (d.mag != null && d.unit === "kts") m = " · " + esc(catLabel(d.mag)) + " · " + nfmt(d.mag * 1.852) + " km/h";
        else if (d.mag != null) m = " · " + nfmt(d.mag, 1) + " " + esc(d.unit || "");
        return '<div class="tip" dir="auto"><b>' + esc(t("ev_" + d.cat)) + "</b> · " + esc(d.title) + m +
          " · " + esc(agoTxt(new Date(d.date).getTime())) + "</div>";
      }
      return '<div class="tip" dir="auto"><b>M' + nfmt(d.mag, 1) + "</b> · " + esc(d.place || "") + " · " + esc(agoTxt(d.time)) +
        (d.depth != null ? " · " + esc(t("depth")) + " " + nfmt(d.depth) + " km" : "") + "</div>";
    })
    .ringLat("lat").ringLng("lng")
    .ringColor(function (d) { return function (k) { return "rgba(255,30,30," + (1 - k) + ")"; }; })
    .ringMaxRadius(function (d) { return 1.5 + (d.mag - 4.5) * 1.6; })
    .ringPropagationSpeed(2.2)
    .ringRepeatPeriod(1400)
    .ringAltitude(0.013);

  function loadQuakes() {
    return fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        quakes = j.features.map(function (f) {
          var c = f.geometry.coordinates;
          return { kind: "quake", lng: c[0], lat: c[1], depth: c[2], mag: f.properties.mag, place: f.properties.place, time: f.properties.time };
        }).filter(function (q) { return q.mag != null; });
        counts.quakes = quakes.length;
        pointData(); notify();
      }).catch(function (e) { counts.quakes = null; console.warn("deprem", e); notify(); });
  }
  function loadIss() {
    return fetch("https://api.wheretheiss.at/v1/satellites/25544")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        iss = { kind: "iss", lat: j.latitude, lng: j.longitude, alt: j.altitude, vel: j.velocity };
        pointData();
      }).catch(function (e) { console.warn("iss", e); });
  }

  // ------------------------------------------------------------ tropik fırtınalar: Saffir-Simpson kategorisi
  function stormCat(kts) {
    if (kts == null) return null;
    if (kts < 34) return 0;   // tropik çöküntü
    if (kts < 64) return 0.5; // tropik fırtına
    if (kts < 83) return 1;
    if (kts < 96) return 2;
    if (kts < 113) return 3;
    if (kts < 137) return 4;
    return 5;
  }
  var CAT_RGB = { 0: [120, 200, 255], 0.5: [90, 230, 200], 1: [255, 235, 120], 2: [255, 190, 80], 3: [255, 130, 60], 4: [255, 60, 80], 5: [230, 70, 255] };
  function catColor(kts, a) {
    var c = CAT_RGB[stormCat(kts)] || [255, 92, 240];
    return "rgba(" + c.join(",") + "," + (a == null ? 1 : a) + ")";
  }
  function catLabel(kts) {
    var c = stormCat(kts);
    if (c == null) return "";
    if (c === 0) return t("stormTD");
    if (c === 0.5) return t("stormTS");
    return t("stormCat", { n: c });
  }

  // Dönen sarmal bulut dokusu: 3 kollu logaritmik sarmal + duvar bulutu + göz
  var spiralTex = (function () {
    var S = 512, raw = document.createElement("canvas");
    raw.width = raw.height = S;
    var x = raw.getContext("2d");
    x.translate(S / 2, S / 2);
    x.lineCap = "round";
    for (var arm = 0; arm < 3; arm++) {
      var prev = null;
      for (var k = 0; k <= 220; k++) {
        var tt = k / 220, ang = arm * Math.PI * 2 / 3 + tt * Math.PI * 3.1, r = 26 + Math.pow(tt, 1.15) * (S / 2 - 40);
        var p = [Math.cos(ang) * r, Math.sin(ang) * r];
        if (prev) {
          x.strokeStyle = "rgba(255,255,255," + (0.85 * Math.pow(1 - tt, 0.7) + 0.05) + ")";
          x.lineWidth = 34 * (1 - tt) + 6;
          x.beginPath(); x.moveTo(prev[0], prev[1]); x.lineTo(p[0], p[1]); x.stroke();
        }
        prev = p;
      }
    }
    // dış hale
    var g = x.createRadialGradient(0, 0, 40, 0, 0, S / 2 - 10);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, S / 2 - 10, 0, Math.PI * 2); x.fill();
    // duvar bulutu
    x.strokeStyle = "rgba(255,255,255,1)"; x.lineWidth = 22;
    x.beginPath(); x.arc(0, 0, 30, 0, Math.PI * 2); x.stroke();
    // yumuşatma
    var c = document.createElement("canvas");
    c.width = c.height = S;
    var y = c.getContext("2d");
    y.filter = "blur(6px)";
    y.drawImage(raw, 0, 0);
    y.filter = "none";
    // göz: ortayı boşalt
    y.globalCompositeOperation = "destination-out";
    var e = y.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 18);
    e.addColorStop(0, "rgba(0,0,0,1)");
    e.addColorStop(1, "rgba(0,0,0,0)");
    y.fillStyle = e; y.beginPath(); y.arc(S / 2, S / 2, 18, 0, Math.PI * 2); y.fill();
    return new THREE.CanvasTexture(c);
  })();
  var cyclones = [];
  function buildCyclones() {
    cyclones.forEach(function (cy) { globe.scene().remove(cy.mesh); cy.mesh.geometry.dispose(); cy.mesh.material.dispose(); });
    cyclones = [];
    if (!on.events) return;
    events.filter(function (e) { return e.cat === "severeStorms"; }).forEach(function (e) {
      var kts = e.unit === "kts" ? e.mag : null, cat = stormCat(kts);
      // çap: rüzgâr hızıyla büyür (yaklaşık 3-9 derece)
      var deg = 4 + Math.min(7, Math.max(0, ((kts || 40) - 34) / 15));
      var size = deg * Math.PI / 180 * globe.getGlobeRadius() * 2;
      var col = CAT_RGB[cat] || [255, 255, 255];
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
        map: spiralTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        color: new THREE.Color("rgb(" + col.map(function (v) { return Math.round(255 - (255 - v) * 0.25); }).join(",") + ")")
      }));
      var p = globe.getCoords(e.lat, e.lng, 0.03);
      mesh.position.set(p.x, p.y, p.z);
      mesh.lookAt(p.x * 2, p.y * 2, p.z * 2);
      mesh.raycast = function () {};
      mesh.renderOrder = 15;
      globe.scene().add(mesh);
      // Kuzey Yarımküre saat yönünün tersine, güney saat yönünde döner; güçlü fırtına daha hızlı
      cyclones.push({ mesh: mesh, base: mesh.quaternion.clone(), dir: e.lat >= 0 ? 1 : -1, speed: 0.4 + (cat || 0) * 0.25, ang: 0 });
    });
  }
  (function spin(ts) {
    requestAnimationFrame(spin);
    if (!cyclones.length) return;
    var q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1);
    cyclones.forEach(function (cy) {
      cy.ang = (ts / 1000) * cy.speed * cy.dir;
      cy.mesh.quaternion.copy(cy.base).multiply(q.setFromAxisAngle(z, cy.ang));
    });
  })(0);

  // ------------------------------------------------------------ doğal olaylar (NASA EONET)
  var events = [], stormPaths = [], eventTimer = null;
  var EV_COLORS = { wildfires: "#ff7a2f", severeStorms: "#ff5cf0", volcanoes: "#ff3838", seaLakeIce: "#d8f3ff", other: "#ffe066" };
  function loadEvents() {
    return fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        events = []; stormPaths = [];
        (j.events || []).forEach(function (e) {
          var cat = (e.categories && e.categories[0] && e.categories[0].id) || "other";
          var pts = (e.geometry || []).filter(function (g) { return g.type === "Point"; });
          if (!pts.length) return;
          var last = pts[pts.length - 1];
          events.push({
            kind: "event", cat: EV_COLORS[cat] ? cat : "other", title: e.title,
            lng: last.coordinates[0], lat: last.coordinates[1], date: last.date,
            mag: last.magnitudeValue, unit: last.magnitudeUnit, link: e.sources && e.sources[0] && e.sources[0].url
          });
          if (cat === "severeStorms" && pts.length > 1) {
            stormPaths.push({
              title: e.title,
              coords: pts.map(function (g) { return [g.coordinates[1], g.coordinates[0]]; }),
              kts: pts.map(function (g) { return g.magnitudeUnit === "kts" ? g.magnitudeValue : null; })
            });
          }
        });
        counts.events = events.length;
        pointData(); buildCyclones(); notify();
      }).catch(function (e) { counts.events = null; console.warn("eonet", e); notify(); });
  }
  globe
    .pathPoints("coords").pathPointLat(function (p) { return p[0]; }).pathPointLng(function (p) { return p[1]; })
    .pathPointAlt(0.014)
    // Rota, her noktadaki fırtına kategorisinin rengiyle boyanır
    .pathColor(function (p) {
      var n = p.kts.length;
      return p.kts.map(function (k, i) { return catColor(k, 0.25 + 0.75 * (i + 1) / n); });
    })
    .pathStroke(1.6)
    .pathDashLength(0.06).pathDashGap(0.03).pathDashAnimateTime(6000)
    .pathLabel(function (p) { return '<div class="tip" dir="auto">' + esc(p.title) + "</div>"; });

  // ------------------------------------------------------------ dışa açık
  window.LiveLayers = {
    ids: ["daynight", "planes", "planeInfo", "planeTrails", "milair", "sats", "quakes", "events", "iss"],
    fleets: { planes: planes, milair: milair },
    isOn: function (id) { return !!on[id]; },
    count: function (id) { return counts[id]; },
    set: function (id, v) {
      on[id] = v;
      if (id === "daynight") setNight(v);
      if (id === "planes") planes.set(v);
      if (id === "milair") milair.set(v);
      if (id === "sats") setSats(v);
      if ((id === "planeInfo" || id === "planeTrails" || id === "planes" || id === "milair") && window.FlightUI) window.FlightUI.update();
      if (id === "events") {
        clearInterval(eventTimer);
        if (v) { loadEvents(); eventTimer = setInterval(loadEvents, 30 * 60000); }
        pointData();
        buildCyclones();
      }
      if (id === "quakes") {
        clearInterval(quakeTimer);
        if (v) { loadQuakes(); quakeTimer = setInterval(loadQuakes, 5 * 60000); }
        pointData();
      }
      if (id === "iss") {
        clearInterval(issTimer);
        if (v) { loadIss(); issTimer = setInterval(loadIss, 10000); }
        pointData();
      }
    }
  };
  document.dispatchEvent(new Event("liveready"));
})();
