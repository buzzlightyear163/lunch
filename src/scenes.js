/* LUNCH 3D. Hero plates that close into a sandwich on scroll, and a pinned scroll sequence of a
   sandwich attack inside one block. Uses three.js r128 (global THREE). Falls back to static art
   when WebGL is missing. */
(function () {
  'use strict';
  var doc = document.documentElement;
  var mq = function (q) { return window.matchMedia ? window.matchMedia(q).matches : false; };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var small = mq('(max-width: 760px)');
  var coarse = mq('(pointer: coarse)');
  var THREE = window.THREE;

  function glOK() {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); }
    catch (e) { return false; }
  }

  // ---------- numbers for the attack illustration (pump.fun curve, 10 real SOL in it) ----------
  var CURVE = (function () {
    var x0 = 40, y0 = 879.9e6, bot = 2, you = 1;
    var botTok = y0 * bot / (x0 + bot), x1 = x0 + bot, y1 = y0 - botTok;
    var quote = y0 * you / (x0 + you), got = y1 * you / (x1 + you);
    var x2 = x1 + you, y2 = y1 - got;
    var botOut = x2 * botTok / (y2 + botTok), x3 = x2 - botOut, y3 = y2 + botTok;
    var p0 = x0 / y0;
    return {
      bot: bot, you: you, quoteM: quote / 1e6, gotM: got / 1e6, fewer: (1 - got / quote) * 100,
      p1: ((x1 / y1) / p0 - 1) * 100, p2: ((x2 / y2) / p0 - 1) * 100, p3: ((x3 / y3) / p0 - 1) * 100,
      botOut: botOut, profit: botOut - bot
    };
  })();

  // ---------- math ----------
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function seg(p, a, b) { return clamp((p - a) / (b - a), 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeBack(t) { var c1 = 1.3, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function damp(cur, target, k, dt) { return lerp(cur, target, 1 - Math.exp(-k * dt)); }

  // ---------- the HTML that the 3D drives (works even without WebGL) ----------
  var attackEl = document.getElementById('attack');
  var ui = attackEl ? {
    steps: Array.prototype.slice.call(attackEl.querySelectorAll('.atk-step')),
    price: document.getElementById('atkPrice'),
    tokens: document.getElementById('atkTokens'),
    profit: document.getElementById('atkProfit'),
    rail: document.getElementById('atkRail'),
    line: document.getElementById('atkLine'),
    dots: Array.prototype.slice.call(attackEl.querySelectorAll('.atk-dot')),
    count: document.getElementById('atkCount'),
    last: {}
  } : null;

  function attackProgress() {
    if (!attackEl) return 0;
    var r = attackEl.getBoundingClientRect();
    var total = attackEl.offsetHeight - window.innerHeight;
    return total > 0 ? clamp(-r.top / total, 0, 1) : 0;
  }
  function attackState(p) {
    return {
      p: p,
      step: p < 0.2 ? 0 : p < 0.45 ? 1 : p < 0.7 ? 2 : 3,
      wF: ease(seg(p, 0.22, 0.40)),
      wY: ease(seg(p, 0.47, 0.62)),
      wB: ease(seg(p, 0.72, 0.86)),
      comp: ease(seg(p, 0.86, 0.98)),
      gain: easeOut(seg(p, 0.74, 0.94))
    };
  }
  var CH = { base: 78, top: 8, max: 18 };
  function chY(pct) { return CH.base - (CH.base - CH.top) * pct / CH.max; }
  function setText(el, key, v) { if (el && ui.last[key] !== v) { ui.last[key] = v; el.textContent = v; } }
  function renderAttackUI(s) {
    if (!ui) return;
    if (ui.last.step !== s.step) {
      ui.last.step = s.step;
      ui.steps.forEach(function (li, i) { li.classList.toggle('on', i === s.step); li.classList.toggle('past', i < s.step); });
      setText(ui.count, 'count', '0' + (s.step + 1));
    }
    var lv1 = CURVE.p1 * s.wF, lv2 = lv1 + (CURVE.p2 - CURVE.p1) * s.wY, lv3 = lv2 + (CURVE.p3 - CURVE.p2) * s.wB;
    var now = s.wB > 0 ? lv3 : s.wY > 0 ? lv2 : lv1;
    setText(ui.price, 'price', (now >= 0.05 ? '+' : '') + now.toFixed(1) + '%');
    setText(ui.tokens, 'tok', lerp(CURVE.quoteM, CURVE.gotM, s.wY).toFixed(2) + 'M');
    setText(ui.profit, 'pro', '+' + (CURVE.profit * s.gain).toFixed(3) + ' SOL');
    if (ui.line) {
      var d = 'M0 ' + chY(0) + 'H75V' + chY(lv1).toFixed(2) + 'H150V' + chY(lv2).toFixed(2) + 'H225V' + chY(lv3).toFixed(2) + 'H300';
      if (ui.last.d !== d) { ui.last.d = d; ui.line.setAttribute('d', d); }
      var ys = [chY(lv1), chY(lv2), chY(lv3)], ws = [s.wF, s.wY, s.wB];
      ui.dots.forEach(function (c, i) { c.setAttribute('cy', ys[i].toFixed(2)); c.style.opacity = ws[i] > 0.02 ? 1 : 0; });
    }
    if (ui.rail) ui.rail.style.transform = 'scaleY(' + s.p.toFixed(4) + ')';
  }

  if (!THREE || !glOK()) {
    doc.classList.add('no-3d');
    if (ui) {
      var tick = function () { renderAttackUI(attackState(attackProgress())); };
      window.addEventListener('scroll', tick, { passive: true });
      window.addEventListener('resize', tick);
      tick();
    }
    return;
  }
  doc.classList.add('has-3d');

  // ---------- three helpers ----------
  function lin(h) { return new THREE.Color(h).convertSRGBToLinear(); }
  var COL = { bone: 0xefe8db, red: 0xe6492f, slab: 0x2c2924 };

  function makeRenderer(canvas) {
    var r = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    return r;
  }

  // A small studio built in code: dark room, two warm softboxes and a strip light.
  function makeEnv(renderer) {
    var pm = new THREE.PMREMGenerator(renderer);
    var s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: lin(0x1a1714), side: THREE.BackSide })));
    function panel(w, h, x, y, z, k, col) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
    }
    panel(9, 5, -7, 8, 6, 3.2, 0xfff0dc);
    panel(5, 7, 9, 2, -3, 1.4, 0xffe2d4);
    panel(14, 1.4, 0, 10, -9, 1.6, 0xffffff);
    panel(6, 3, 2, -6, 8, 0.5, 0xffe9dc);
    var tex = pm.fromScene(s, 0.04).texture;
    pm.dispose();
    return tex;
  }

  function addLights(scene, renderer, box, shadowSize) {
    scene.environment = makeEnv(renderer);
    scene.add(new THREE.HemisphereLight(0xfff3e4, 0x17120e, 0.35));
    var key = new THREE.DirectionalLight(0xfff4e8, 1.45);
    key.position.set(-5.5, 10, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    var c = key.shadow.camera;
    c.left = -box; c.right = box; c.top = box; c.bottom = -box; c.near = 1; c.far = 40;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.025;
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xffc7b2, 0.55);
    rim.position.set(7, 3, -8);
    scene.add(rim);
  }

  function ground(scene, y, opacity) {
    var g = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: opacity }));
    g.rotation.x = -Math.PI / 2; g.position.y = y; g.receiveShadow = true;
    scene.add(g);
    return g;
  }

  function roundRect(w, d, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // Extrude a flat shape into a slab of height h with a soft bevel. Top face faces +y.
  function slabGeo(shape, h, bevel) {
    var core = Math.max(0.01, h - 2 * bevel);
    var g = new THREE.ExtrudeGeometry(shape, {
      depth: core, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel,
      bevelSegments: small ? 3 : 5, curveSegments: small ? 10 : 18
    });
    g.translate(0, 0, -core / 2);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  // The red plate with two tooth marks out of its right edge, plus the piece that was bitten off.
  function bittenShapes(W, D, r) {
    var R = D * 0.34, c = D * 0.19, k = R * 0.12;
    function depth(y) {
      var v = 0;
      [c, -c].forEach(function (cc) { var d = y - cc; if (Math.abs(d) < R) v = Math.max(v, Math.sqrt(R * R - d * d) - k); });
      return v;
    }
    var N = small ? 28 : 48, pts = [], i;
    for (i = 0; i <= N; i++) { var y = -D / 2 + D * i / N; pts.push([W / 2 - depth(y), y]); }
    var plate = new THREE.Shape();
    plate.moveTo(-W / 2 + r, -D / 2);
    plate.lineTo(pts[0][0], -D / 2);
    for (i = 1; i <= N; i++) plate.lineTo(pts[i][0], pts[i][1]);
    plate.lineTo(-W / 2 + r, D / 2);
    plate.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - r);
    plate.lineTo(-W / 2, -D / 2 + r);
    plate.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + r, -D / 2);
    var chunk = new THREE.Shape();
    chunk.moveTo(pts[0][0], -D / 2);
    chunk.lineTo(W / 2 - r, -D / 2);
    chunk.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + r);
    chunk.lineTo(W / 2, D / 2 - r);
    chunk.quadraticCurveTo(W / 2, D / 2, W / 2 - r, D / 2);
    chunk.lineTo(pts[N][0], D / 2);
    for (i = N - 1; i >= 0; i--) chunk.lineTo(pts[i][0], pts[i][1]);
    return { plate: plate, chunk: chunk };
  }

  function mesh(geo, mat) { var m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }
  function matte(hex, rough) { return new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: 0, envMapIntensity: 0.7 }); }

  // ---------- render loop shared by both scenes ----------
  var stages = [];
  var running = false, lastT = 0;
  function loop(now) {
    var t = now / 1000, dt = Math.min(0.05, lastT ? t - lastT : 0.016);
    lastT = t;
    pointer.x = damp(pointer.x, pointer.tx, 4, dt); pointer.y = damp(pointer.y, pointer.ty, 4, dt);
    var any = false;
    stages.forEach(function (s) { if (s.visible && !document.hidden) { s.frame(t, dt); any = true; } });
    if (any) requestAnimationFrame(loop); else { running = false; lastT = 0; }
  }
  function wake() { if (!running) { running = true; requestAnimationFrame(loop); } }
  function register(stage, box) {
    stages.push(stage);
    stage.visible = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (e) { stage.visible = e.isIntersecting; }); if (stage.visible) wake(); }, { rootMargin: '120px 0px' }).observe(box);
    } else { stage.visible = true; }
    var resize = function () { stage.resize(box.clientWidth, box.clientHeight); if (stage.visible) wake(); };
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(box); else window.addEventListener('resize', resize);
    resize();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
  window.addEventListener('scroll', wake, { passive: true });

  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!coarse) window.addEventListener('pointermove', function (e) {
    pointer.tx = e.clientX / window.innerWidth - 0.5; pointer.ty = e.clientY / window.innerHeight - 0.5; wake();
  }, { passive: true });

  // ---------- HERO ----------
  function Hero(canvas, box, hero) {
    var renderer = makeRenderer(canvas);
    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    addLights(scene, renderer, 5.5, small ? 1024 : 2048);

    var W = 4.4, D = 2.5, H = 0.62, R = 0.18, BV = 0.085;
    var bone = matte(COL.bone, 0.66), red = matte(COL.red, 0.52);
    var plain = slabGeo(roundRect(W, D, R), H, BV);
    var b = bittenShapes(W, D, R);
    var plateGeo = slabGeo(b.plate, H, BV), chunkGeo = slabGeo(b.chunk, H, BV);
    chunkGeo.computeBoundingBox();
    var cc = new THREE.Vector3(); chunkGeo.boundingBox.getCenter(cc);
    chunkGeo.translate(-cc.x, -cc.y, -cc.z);

    var group = new THREE.Group(); scene.add(group);
    var top = mesh(plain, bone), bot = mesh(plain, bone);
    var midG = new THREE.Group(), mid = mesh(plateGeo, red), chunk = mesh(chunkGeo, red);
    midG.add(mid, chunk); chunk.position.copy(cc);
    group.add(top, midG, bot);
    ground(scene, -2.15, 0.38);

    var hp = 0, intro = reduce ? 1 : 0, t0 = null;
    function heroP() { var r = hero.getBoundingClientRect(); return clamp(-r.top / Math.max(1, Math.min(r.height * 0.5, window.innerHeight * 0.55)), 0, 1); }

    this.resize = function (w, h) {
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      var tan = Math.tan(cam.fov * Math.PI / 360);
      var dist = Math.max(7.8 / (2 * tan * cam.aspect), 5.8 / (2 * tan));
      var dir = new THREE.Vector3(0.52, 0.36, 0.78).normalize();
      cam.position.copy(dir.multiplyScalar(dist));
      cam.lookAt(0, -0.15, 0);
      cam.updateProjectionMatrix();
    };
    this.frame = function (t, dt) {
      if (t0 === null) t0 = t;
      if (intro < 1) intro = Math.min(1, (t - t0) / 1.8);
      var target = heroP();
      hp = reduce ? target : damp(hp, target, 7, dt);
      var close = ease(hp);
      var gap = lerp(0.62, 0.03, close);
      var idle = reduce ? 0 : (1 - close);
      function drop(i) { return (1 - easeBack(seg(intro, i * 0.13, i * 0.13 + 0.62))) * 3.4; }
      top.position.y = H + gap + Math.sin(t * 1.1 + 0.6) * 0.06 * idle + drop(0);
      midG.position.y = Math.sin(t * 1.1 + 1.5) * 0.05 * idle + drop(1);
      bot.position.y = -(H + gap) + Math.sin(t * 1.1 + 2.4) * 0.06 * idle + drop(2);
      top.rotation.z = Math.sin(t * 0.7) * 0.012 * idle;
      bot.rotation.z = Math.sin(t * 0.7 + 1) * 0.012 * idle;

      var ct = ease(seg(hp, 0.22, 0.8));
      chunk.position.set(cc.x + ct * 1.5, cc.y + Math.sin(ct * Math.PI) * 0.9 + ct * 1.3, cc.z + ct * 2.4);
      chunk.rotation.set(ct * 1.3, ct * 2.4, -ct * 1.9);
      var sc = 1 - ease(seg(hp, 0.45, 0.9));
      chunk.scale.setScalar(Math.max(0.001, sc));
      chunk.visible = sc > 0.01;

      group.rotation.y = -0.5 + close * 0.62 + pointer.x * 0.22 + (reduce ? 0 : Math.sin(t * 0.32) * 0.05 * idle) + (1 - easeOut(intro)) * -0.5;
      group.rotation.x = pointer.y * 0.1;
      group.position.y = close * 0.25;
      renderer.render(scene, cam);
    };
    register(this, box);
    var self = this;
    self.frame(performance.now() / 1000, 0.016);
  }

  // ---------- ATTACK SEQUENCE ----------
  function Attack(canvas, box) {
    var renderer = makeRenderer(canvas);
    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
    addLights(scene, renderer, 7.5, small ? 1024 : 2048);

    var W = 4.2, D = 1.2, H = 0.24, BV = 0.045;
    var geo = slabGeo(roundRect(W, D, 0.09), H, BV);
    var fontsReady = false;
    var labels = [];

    function drawLabel(c, parts, bg, fg, dim) {
      var x = c.getContext('2d');
      x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
      var mid = c.height / 2 + 2;
      x.textBaseline = 'middle';
      x.textAlign = 'left';
      x.font = '400 40px "Martian Mono", ui-monospace, Menlo, monospace';
      x.fillStyle = dim; x.fillText(parts[0], 64, mid);
      x.font = '600 46px "Martian Mono", ui-monospace, Menlo, monospace';
      x.fillStyle = fg; x.fillText(parts[1], 236, mid);
      x.textAlign = 'right';
      x.font = '500 44px "Martian Mono", ui-monospace, Menlo, monospace';
      x.fillText(parts[2], c.width - 64, mid);
    }
    function slab(sideHex, bg, fg, dim, parts) {
      var c = document.createElement('canvas');
      c.width = 1024; c.height = Math.round(1024 * D / W);
      drawLabel(c, parts, bg, fg, dim);
      var tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(1 / W, 1 / D);
      tex.offset.set(0.5, 0.5);
      var topM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.74, metalness: 0, envMapIntensity: 0.5 });
      var sideM = new THREE.MeshStandardMaterial({ color: lin(sideHex), roughness: 0.74, metalness: 0, envMapIntensity: 0.5 });
      var m = mesh(geo, [topM, sideM]);
      labels.push({ c: c, tex: tex, parts: parts, bg: bg, fg: fg, dim: dim });
      m.userData.mats = [topM, sideM];
      scene.add(m);
      return m;
    }
    var GREY = ['#2c2924', '#8f887c', '#5f5a51'];
    var g = [
      slab(COL.slab, GREY[0], GREY[1], GREY[2], ['#722', 'pump.fun · BUY', '0.31 SOL']),
      slab(COL.slab, GREY[0], GREY[1], GREY[2], ['#724', 'Jupiter · SELL', '0.44 SOL']),
      slab(COL.slab, GREY[0], GREY[1], GREY[2], ['#729', 'Vote', '—']),
      slab(COL.slab, GREY[0], GREY[1], GREY[2], ['#731', 'PumpSwap · BUY', '1.90 SOL'])
    ];
    var F = slab(COL.red, '#e6492f', '#0d0c0b', 'rgba(13,12,11,.62)', ['#726', 'BOT · BUY', CURVE.bot.toFixed(2) + ' SOL']);
    var Y = slab(COL.bone, '#efe8db', '#0d0c0b', '#7a7368', ['#727', 'YOU · BUY', CURVE.you.toFixed(2) + ' SOL']);
    var B = slab(COL.red, '#e6492f', '#0d0c0b', 'rgba(13,12,11,.62)', ['#728', 'BOT · SELL', CURVE.botOut.toFixed(2) + ' SOL']);
    g.forEach(function (m) { m.userData.mats.forEach(function (mt) { mt.transparent = true; }); });
    var order = [g[0], g[1], F, Y, B, g[2], g[3]];
    var floor = ground(scene, -3.6, 0.34);

    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('600 46px "Martian Mono"'), document.fonts.load('400 40px "Martian Mono"')]).then(function () {
        labels.forEach(function (l) { drawLabel(l.c, l.parts, l.bg, l.fg, l.dim); l.tex.needsUpdate = true; });
        wake();
      }).catch(function () {});
    }

    var p = 0, aspect = 1;
    var camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
    var dir = new THREE.Vector3(0.36, 0.47, 0.8).normalize();

    this.resize = function (w, h) {
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      aspect = w / h; cam.aspect = aspect; cam.updateProjectionMatrix();
    };
    this.frame = function (t, dt) {
      var target = attackProgress();
      p = reduce ? target : damp(p, target, 6, dt);
      var s = attackState(p);
      renderAttackUI(s);

      var S = 0.92, tight = H + 0.014;
      var wts = [1, 1, s.wF, s.wY, s.wB, 1, 1];
      var ys = [], y = 0;
      for (var i = 0; i < order.length; i++) {
        ys.push(y);
        var gap = S;
        if (order[i] === F || order[i] === Y) gap = lerp(S, tight, s.comp);
        y -= gap * wts[i];
      }
      var off = -ys[ys.length - 1] / 2;
      var side = small ? 3.9 : 4.7;
      var idle = reduce ? 0 : 1;
      order.forEach(function (m, i) { m.position.set(0, ys[i] + off, 0); m.rotation.set(0, 0, 0); });
      // front-run drops in from above
      F.visible = s.wF > 0.001;
      F.position.y += (1 - s.wF) * 3.6;
      F.rotation.z = (1 - s.wF) * 0.22;
      F.rotation.x = (1 - s.wF) * -0.18;
      // your trade waits at the side, then slides into the block
      Y.position.x = (1 - s.wY) * side;
      Y.position.y += Math.sin(t * 2.2) * 0.07 * (1 - s.wY) * idle + (1 - s.wY) * 0.25;
      Y.rotation.y = (1 - s.wY) * -0.25;
      // back-run slides in from the left
      B.visible = p > 0.705;
      B.position.x = -(1 - s.wB) * (side + 1.2);
      B.rotation.y = (1 - s.wB) * 0.3;
      // the rest of the block steps back when the sandwich closes
      var fade = 1 - s.comp * 0.72;
      g.forEach(function (m, i) {
        m.userData.mats.forEach(function (mt) { mt.opacity = fade; });
        m.position.y += s.comp * (i < 2 ? 0.7 : -0.7);
      });

      // camera: wide on the block, shifted toward your pending trade, then close on the sandwich
      var shift = (1 - s.wY) * (small ? 1.7 : 2.2);
      var ty = Y.position.y * s.comp;
      camTarget.set(shift * (1 - s.comp), lerp(-0.05, ty, s.comp), 0);
      var tan = Math.tan(cam.fov * Math.PI / 360);
      var wide = Math.max(7.4 / (2 * tan), 6.8 / (2 * tan * aspect));
      var close = Math.max(4.6 / (2 * tan), 5.6 / (2 * tan * aspect));
      var dist = lerp(wide, close, s.comp);
      camPos.copy(dir).multiplyScalar(dist).add(camTarget);
      camPos.x += (coarse ? 0 : pointer.x * 0.9); camPos.y += (coarse ? 0 : -pointer.y * 0.6);
      cam.position.copy(camPos);
      cam.lookAt(camTarget);
      renderer.render(scene, cam);
    };
    register(this, box);
    var self = this;
    var warm = function () { self.frame(performance.now() / 1000, 0.016); };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 1500 }); else setTimeout(warm, 600);
  }

  function boot() {
    var hc = document.getElementById('heroCanvas');
    if (hc) { try { new Hero(hc, hc.parentElement, document.querySelector('.hero')); } catch (e) { doc.classList.add('no-3d-hero'); } }
    var ac = document.getElementById('attackCanvas');
    if (ac) { try { new Attack(ac, ac.parentElement); } catch (e) { doc.classList.add('no-3d-attack'); } }
    if (ui) renderAttackUI(attackState(attackProgress()));
    wake();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
