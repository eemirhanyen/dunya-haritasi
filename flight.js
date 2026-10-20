/* Uçak bilgi kutusu (üzerine gelince / tıklayınca), seçili uçağın rotası ve
   tüm uçakların akan izleri. Veri live.js'teki filolardan okunur. */
(function () {
  "use strict";

  var APP = window.WorldApp, THREE = window.THREE, t = APP.t, L = window.LiveLayers;
  var globe = APP.globe(), cam = globe.camera(), canvas = globe.renderer().domElement;
  var FLEETS = [["planes", L.fleets.planes], ["milair", L.fleets.milair]];
  var MOBILE = Math.min(window.innerWidth, window.innerHeight) < 700;

  var tip = document.createElement("div");
  tip.className = "ftip";
  tip.hidden = true;
  document.body.appendChild(tip);

  var hover = null, pinned = null;      // { fleetId, key }
  var v3 = new THREE.Vector3();

  function nf(n, d) { return new Intl.NumberFormat(APP.locale(), { maximumFractionDigits: d || 0 }).format(n); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function infoOn() { return L.isOn("planeInfo") && (L.isOn("planes") || L.isOn("milair")); }
  function fleet(id) { return id === "planes" ? L.fleets.planes : L.fleets.milair; }
  function indexOf(f, key) {
    for (var i = 0; i < f.data.length; i++) if (f.data[i][7] === key) return i;
    return -1;
  }

  // ------------------------------------------------------------ seçme (ekrana izdüşüm)
  function pick(cx, cy) {
    var rect = canvas.getBoundingClientRect(), w = rect.width, h = rect.height;
    var x = cx - rect.left, y = cy - rect.top, best = null, bd = 14 * 14;
    var cp = cam.position;
    FLEETS.forEach(function (fp) {
      var id = fp[0], f = fp[1];
      if (!L.isOn(id) || !f.points || !f.points.visible) return;
      var pos = f.points.geometry.attributes.position.array;
      for (var i = 0; i < f.data.length; i++) {
        var px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        // kürenin arkasındakileri atla
        if (px * (cp.x - px) + py * (cp.y - py) + pz * (cp.z - pz) <= 0) continue;
        v3.set(px, py, pz).project(cam);
        var sx = (v3.x + 1) / 2 * w, sy = (1 - v3.y) / 2 * h;
        var d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
        if (d < bd) { bd = d; best = { fleetId: id, key: f.data[i][7] || ("i" + i), i: i }; }
      }
    });
    return best;
  }

  function tipHtml(sel, pinnedTip) {
    var f = fleet(sel.fleetId), i = indexOf(f, sel.key);
    if (i < 0) return null;
    var a = f.data[i], mil = sel.fleetId === "milair";
    var vr = a[8] || 0, trend = vr > 1 ? "↗ " + t("climbing") : vr < -1 ? "↘ " + t("descending") : "→ " + t("level");
    var age = Math.max(0, Math.round((Date.now() - f.fetched) / 60000));
    var h = '<div class="ft-head"><b dir="ltr">' + esc(a[5] || "—") + "</b>" +
      '<span class="ft-tag' + (mil ? " mil" : "") + '">' + esc(mil ? t("tagMil") : t("tagCivil")) + "</span></div>";
    h += '<div class="ft-sub" dir="auto">' + esc(mil ? [a[6], a[9]].filter(Boolean).join(" · ") : a[6] || "") + "</div>";
    h += '<div class="ft-grid">' +
      "<span>" + esc(t("altitude")) + '</span><b dir="ltr">' + nf(a[2]) + " m · FL" + nf(Math.round(a[2] / 30.48)) + "</b>" +
      "<span>" + esc(t("speed")) + '</span><b dir="ltr">' + nf(a[3] * 3.6) + " km/h</b>" +
      "<span>" + esc(t("heading")) + '</span><b dir="ltr">' + nf(a[4]) + "°</b>" +
      "<span>" + esc(t("vertical")) + "</span><b>" + esc(trend) + "</b></div>";
    h += '<div class="ft-foot">' + esc(t("dataAge", { n: age })) +
      (pinnedTip ? " · " + esc(t(f.hist && f.hist[sel.key] ? "routeNote" : "routeNoteNoHist")) : "") + "</div>";
    return h;
  }

  function showTipAt(sel, x, y, pinnedTip) {
    var h = tipHtml(sel, pinnedTip);
    if (!h) { tip.hidden = true; return; }
    tip.innerHTML = h;
    tip.classList.toggle("pinned", !!pinnedTip);
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var left = Math.min(window.innerWidth - r.width - 8, x + 14), top = y + 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }

  var lastMove = 0;
  canvas.addEventListener("pointermove", function (e) {
    if (!infoOn() || pinned) return;
    var now = performance.now();
    if (now - lastMove < 40) return;
    lastMove = now;
    hover = pick(e.clientX, e.clientY);
    if (hover) { showTipAt(hover, e.clientX, e.clientY, false); canvas.style.cursor = "pointer"; }
    else { tip.hidden = true; }
  });
  canvas.addEventListener("pointerleave", function () { if (!pinned) tip.hidden = true; });

  // Tıklama: uçağa denk gelirse sabitle ve küre tıklamasını (ülke paneli) engelle
  var downAt = null;
  window.addEventListener("pointerdown", function (e) {
    downAt = e.target === canvas ? [e.clientX, e.clientY] : null;
  }, true);
  function onClickLike(e) {
    if (e.target !== canvas || !downAt) return;
    if (Math.abs(e.clientX - downAt[0]) + Math.abs(e.clientY - downAt[1]) > 6) return;   // sürükleme
    if (!infoOn()) return;
    var hit = pick(e.clientX, e.clientY);
    if (hit) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.type === "click") { pinned = hit; buildRoute(); }
    } else if (pinned && e.type === "click") {
      pinned = null; tip.hidden = true; clearRoute();
    }
  }
  window.addEventListener("pointerup", onClickLike, true);
  window.addEventListener("click", onClickLike, true);

  // ------------------------------------------------------------ seçili uçağın rotası
  var dotTex = (function () {
    var c = document.createElement("canvas");
    c.width = c.height = 16;
    var x = c.getContext("2d");
    x.fillStyle = "#fff"; x.beginPath(); x.arc(8, 8, 6, 0, Math.PI * 2); x.fill();
    return new THREE.CanvasTexture(c);
  })();
  var route = null;
  function segDots(a, b, step, out) {
    var dl = b[1] - a[1];
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    var dist = Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(dl * Math.cos(a[0] * Math.PI / 180), 2));
    var n = Math.max(1, Math.min(60, Math.round(dist / step)));
    for (var k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + dl * k / n]);
  }
  function clearRoute() {
    if (route) { globe.scene().remove(route); route.geometry.dispose(); route = null; }
  }
  function buildRoute() {
    clearRoute();
    if (!pinned) return;
    var f = fleet(pinned.fleetId), i = indexOf(f, pinned.key);
    if (i < 0) { pinned = null; tip.hidden = true; return; }
    var cur = f.where(i), alt = cur.alt;
    var past = [], fut = [];
    var hist = (f.hist && f.hist[pinned.key]) || [];
    var chain = hist.map(function (p) { return [p[1], p[0]]; }).concat([[f.data[i][1], f.data[i][0]], [cur.lat, cur.lng]]);
    for (var k = 0; k < chain.length - 1; k++) segDots(chain[k], chain[k + 1], 0.12, past);
    // önümüzdeki 20 dakika: mevcut hız ve yönle tahmin
    var now = Date.now();
    for (var m = 1; m <= 40; m++) { var w = f.where(i, now + m * 30000); fut.push([w.lat, w.lng]); }
    var all = past.concat(fut), n = all.length;
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    var cPast = new THREE.Color(pinned.fleetId === "milair" ? 0xff7070 : 0xffe3a0), cFut = new THREE.Color(0x9fd8ff);
    all.forEach(function (p, j) {
      var c = globe.getCoords(p[0], p[1], alt - 0.001);
      pos[j * 3] = c.x; pos[j * 3 + 1] = c.y; pos[j * 3 + 2] = c.z;
      var cc = j < past.length ? cPast : cFut;
      var fade = j < past.length ? 0.35 + 0.65 * j / Math.max(1, past.length) : 1 - (j - past.length) / fut.length * 0.8;
      col[j * 3] = cc.r * fade; col[j * 3 + 1] = cc.g * fade; col[j * 3 + 2] = cc.b * fade;
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    route = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.55, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true
    }));
    route.raycast = function () {};
    route.renderOrder = 14;
    globe.scene().add(route);
  }

  // ------------------------------------------------------------ tüm uçakların akan izleri
  var TRAIL_VERT = [
    "attribute float phase;",
    "attribute float fade;",
    "uniform float time;",
    "varying float vA;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  float pulse = 0.5 + 0.5 * sin(phase * 2.2 - time * 3.0);",
    "  vA = fade * (0.25 + 0.75 * pulse);",
    "  gl_PointSize = clamp(260.0 / -mv.z, 1.2, 3.5);",
    "  gl_Position = projectionMatrix * mv;",
    "}"
  ].join("\n");
  var TRAIL_FRAG = [
    "uniform vec3 color;",
    "varying float vA;",
    "void main() {",
    "  vec2 p = gl_PointCoord - 0.5;",
    "  if (dot(p, p) > 0.25) discard;",
    "  gl_FragColor = vec4(color, vA * 0.7);",
    "}"
  ].join("\n");
  var trails = null, trailMat = null;
  function buildTrails() {
    if (trails) { globe.scene().remove(trails); trails.geometry.dispose(); trails = null; }
    if (!L.isOn("planeTrails") || !L.isOn("planes")) return;
    var f = L.fleets.planes;
    if (!f.data.length || !f.hist) return;
    var pos = [], ph = [], fd = [], step = MOBILE ? 0.45 : 0.25;
    for (var i = 0; i < f.data.length; i++) {
      var a = f.data[i], hist = f.hist[a[7]];
      if (!hist || !hist.length) continue;
      var cur = f.where(i);
      var chain = hist.map(function (p) { return [p[1], p[0]]; }).concat([[a[1], a[0]], [cur.lat, cur.lng]]);
      var dots = [];
      for (var k = 0; k < chain.length - 1; k++) segDots(chain[k], chain[k + 1], step, dots);
      var n = dots.length;
      for (var j = 0; j < n; j++) {
        var c = globe.getCoords(dots[j][0], dots[j][1], cur.alt - 0.0015);
        pos.push(c.x, c.y, c.z);
        ph.push(n - j);                       // uçağa uzaklık (nokta sayısı)
        fd.push(0.15 + 0.85 * (j + 1) / n);   // eski kısım daha soluk
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("phase", new THREE.Float32BufferAttribute(ph, 1));
    geo.setAttribute("fade", new THREE.Float32BufferAttribute(fd, 1));
    if (!trailMat) {
      trailMat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0xffd98a) } },
        vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false
      });
    }
    trails = new THREE.Points(geo, trailMat);
    trails.raycast = function () {};
    trails.renderOrder = 11;
    globe.scene().add(trails);
  }

  // ------------------------------------------------------------ döngüler
  (function frame(ts) {
    requestAnimationFrame(frame);
    if (trailMat) trailMat.uniforms.time.value = ts / 1000;
    if (pinned) {
      var f = fleet(pinned.fleetId), i = indexOf(f, pinned.key);
      if (i < 0 || !f.points) return;
      var pos = f.points.geometry.attributes.position.array, cp = cam.position;
      var px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      // uçak kürenin arkasına geçtiyse kutuyu gizle (seçim ve rota kalır)
      if (px * (cp.x - px) + py * (cp.y - py) + pz * (cp.z - pz) <= 0) { tip.hidden = true; return; }
      v3.set(px, py, pz).project(cam);
      var rect = canvas.getBoundingClientRect();
      showTipAt(pinned, rect.left + (v3.x + 1) / 2 * rect.width, rect.top + (1 - v3.y) / 2 * rect.height, true);
    }
  })(0);
  setInterval(function () { if (pinned) buildRoute(); }, 5000);
  setInterval(buildTrails, 60000);
  document.addEventListener("fleetupdate", function () { buildTrails(); if (pinned) buildRoute(); });
  document.addEventListener("langchange", function () { if (!pinned) tip.hidden = true; });

  window.FlightUI = {
    update: function () {
      if (!infoOn()) { pinned = null; hover = null; tip.hidden = true; clearRoute(); }
      buildTrails();
    }
  };
  window.FlightUI.update();
})();
