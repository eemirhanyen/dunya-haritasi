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
        f.fetched = (j.time ? j.time * 1000 : Date.now());
        if (Date.now() - f.fetched > 3600e3) f.fetched = Date.now();
        f.ttl = Math.max(60, j.ttl || 120);
        f.error = false;
        counts[id] = f.data.length;
        f.build();
        notify();
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

  // ------------------------------------------------------------ depremler + ISS (globe.gl nokta katmanı)
  var quakes = [], iss = null, quakeTimer = null, issTimer = null;
  function pointData() {
    var arr = [];
    if (on.quakes) arr = arr.concat(quakes);
    if (on.iss && iss) arr.push(iss);
    globe.pointsData(arr);
    globe.ringsData(on.quakes ? quakes.filter(function (q) { return q.mag >= 4.5; }) : []);
  }
  globe
    .pointLat("lat").pointLng("lng")
    .pointAltitude(function (d) { return d.kind === "iss" ? 0.066 : 0.012; })
    .pointRadius(function (d) { return d.kind === "iss" ? 0.9 : 0.15 + Math.max(0, d.mag - 2.5) * 0.18; })
    .pointColor(function (d) {
      if (d.kind === "iss") return "#7ef9ff";
      return d.mag >= 6 ? "#ff3b3b" : d.mag >= 4.5 ? "#ff8a3d" : "#ffd166";
    })
    .pointsMerge(false)
    .pointLabel(function (d) {
      if (d.kind === "iss") {
        return '<div class="tip">' + esc(t("issTip", { a: nfmt(d.alt), v: nfmt(d.vel) })) + "</div>";
      }
      return '<div class="tip" dir="auto"><b>M' + nfmt(d.mag, 1) + "</b> · " + esc(d.place || "") + " · " + esc(agoTxt(d.time)) +
        (d.depth != null ? " · " + esc(t("depth")) + " " + nfmt(d.depth) + " km" : "") + "</div>";
    })
    .ringLat("lat").ringLng("lng")
    .ringColor(function (d) { return function (k) { return "rgba(255,90,60," + (1 - k) + ")"; }; })
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

  // ------------------------------------------------------------ dışa açık
  window.LiveLayers = {
    ids: ["daynight", "planes", "milair", "quakes", "iss"],
    count: function (id) { return counts[id]; },
    set: function (id, v) {
      on[id] = v;
      if (id === "daynight") setNight(v);
      if (id === "planes") planes.set(v);
      if (id === "milair") milair.set(v);
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
