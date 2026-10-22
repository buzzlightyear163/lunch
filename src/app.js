/* LUNCH site. Edit CONFIG before launch. */
var CONFIG = {
  ca: '',            // token contract address, shown in the header and the token section
  x: '',             // full URL of the project's X profile, e.g. https://x.com/yourhandle
  pumpfun: '',       // full URL of the coin's pump.fun page (enables the Buy button)
  site: '',          // domain shown in share posts, e.g. lunchcheck.fun
  rpc: 'https://api.mainnet-beta.solana.com'
};

(function () {
  'use strict';
  var E = window.LunchEngine;
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  // In a sandboxed preview the browser may not be allowed to reach Solana at all.
  var PREVIEW = /claude\.ai|claudeusercontent|anthropic/i.test(location.hostname);
  function explain(e) {
    if (PREVIEW && e && e.kind === 'network') return 'This preview cannot reach Solana. The live tools run on the deployed site.';
    return e && e.message ? e.message : 'Something went wrong.';
  }

  // ---------- storage-safe settings ----------
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var rpcUrl = load('lunch.rpc') || CONFIG.rpc;
  var rpc = E.createRpc(function () { return rpcUrl; });

  // ---------- formatting ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function short(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : '—'; }
  function sol(l, d) {
    if (l == null || isNaN(l)) return '—';
    var v = l / 1e9;
    if (d != null) return v.toFixed(d);
    if (v === 0) return '0';
    if (Math.abs(v) >= 100) return v.toFixed(1);
    if (Math.abs(v) >= 1) return v.toFixed(3);
    if (Math.abs(v) >= 0.0001) return v.toFixed(4);
    return '<0.0001';
  }
  function pct(v) { return (Math.round(v * 10) / 10).toString().replace(/\.0$/, '') + '%'; }
  function ago(ts) {
    if (!ts) return '';
    var s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }
  function clock(ts) {
    var d = ts ? new Date(ts * 1000) : new Date();
    return d.toTimeString().slice(0, 8);
  }
  var solUsd = null;
  function usd(l) { return solUsd && l != null ? '$' + Math.round(l / 1e9 * solUsd).toLocaleString('en-US') : null; }
  function solscan(kind, id) { return 'https://solscan.io/' + kind + '/' + id; }

  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }
  function copy(text, done) {
    var ok = function () { toast(done || 'Copied'); };
    try {
      navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text); ok(); });
    } catch (e) { fallbackCopy(text); ok(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  // ---------- header / config ----------
  function initConfig() {
    var caText = CONFIG.ca ? short(CONFIG.ca) : 'TBA';
    $('caChipText').textContent = caText;
    $('caFact').textContent = CONFIG.ca || 'TBA';
    function copyCa() { if (CONFIG.ca) copy(CONFIG.ca, 'Contract address copied'); else toast('Contract address is added at launch'); }
    $('caChip').addEventListener('click', copyCa);
    $('caFact').addEventListener('click', copyCa);
    if (CONFIG.x) { $('xLink').href = CONFIG.x; $('xLink').hidden = false; }
    if (CONFIG.pumpfun) { $('buyLink').href = CONFIG.pumpfun; $('buyLink').hidden = false; }
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.solana && j.solana.usd) { solUsd = j.solana.usd; if (lastReport) renderReport(lastReport); } })
      .catch(function () {});
  }

  // ---------- evidence chart ----------
  function renderChart() {
    var data = [
      ['Exact quote', 36], ['Under 0.5%', 27], ['0.5–1%', 17], ['1–3%', 8, 'best'],
      ['3–10%', 44], ['10–20%', 87], ['20–50%', 148, 'worst'], ['50% or more', 33]
    ];
    var html = data.map(function (d) {
      return '<div class="bar-row ' + (d[2] || '') + '"><span class="k">' + d[0] + '</span><div class="track"><i style="width:100%;transform:scaleX(' + (d[1] / 160) + ')"></i></div><span class="v">' + d[1] + '</span></div>';
    }).join('');
    $('barChart').innerHTML = html;
  }

  // ---------- Lunch Check ----------
  var lastReport = null;
  var scanning = false, cancelScan = false;

  var EXAMPLE = {
    mode: 'example', wallet: null, total: 50, read: 50,
    strip: [0,0,0,0,1,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
    incidents: [
      { side: 'buy', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', sizeLamports: 2.0e9, lossLamports: 0.214e9, time: null, bot: 'Ar5rQkM2mF8xN7QwLb4jYpZc1vT9sKdHqE6uR3gWkQ2m', when: '2d ago' },
      { side: 'buy', mint: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', sizeLamports: 1.2e9, lossLamports: 0.096e9, time: null, bot: 'Ar5rQkM2mF8xN7QwLb4jYpZc1vT9sKdHqE6uR3gWkQ2m', when: '5d ago' },
      { side: 'sell', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', sizeLamports: 0.8e9, lossLamports: 0.061e9, time: null, bot: 'B91piBSfCBRs5rUxCMRdJEGv7tNEnFxweWcdQJHJoFpi', when: '6d ago' },
      { side: 'buy', mint: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', sizeLamports: 0.3e9, lossLamports: 0.015e9, time: null, bot: 'Ar5rQkM2mF8xN7QwLb4jYpZc1vT9sKdHqE6uR3gWkQ2m', when: '9d ago' }
    ],
    unverified: 0
  };

  function modelFromState(st, mode, err) {
    var swaps = st.swaps.slice().reverse(); // oldest first
    return {
      mode: mode, wallet: st.wallet, total: st.total, read: st.read, err: err || null,
      strip: swaps.map(function (s) { return s.result && s.result.confirmed ? 1 : 0; }),
      incidents: st.hits.map(function (h) {
        return {
          side: h.swap.side, mint: h.swap.mint, sizeLamports: h.swap.sizeLamports, lossLamports: h.lossLamports,
          time: h.swap.time, bot: h.front.owner, front: h.front.sig, you: h.swap.sig, back: h.back.sig, botNet: h.botNetLamports
        };
      }),
      unverified: st.unverified.length
    };
  }

  function summarize(m) {
    var total = 0, biggest = 0, bots = {};
    m.incidents.forEach(function (i) {
      var l = i.lossLamports || 0;
      total += l; if (l > biggest) biggest = l;
      bots[i.bot] = (bots[i.bot] || 0) + l;
    });
    var top = null, topV = -1;
    Object.keys(bots).forEach(function (b) { if (bots[b] > topV) { topV = bots[b]; top = b; } });
    return { total: total, biggest: biggest, topBot: top, swaps: m.strip.length, hits: m.incidents.length };
  }

  function shareText(m, s) {
    var where = CONFIG.site ? ' ' + CONFIG.site : '';
    if (!s.hits) return 'Bots went hungry. 0 sandwiches in my last ' + s.swaps + ' pump.fun swaps. Check your wallet with $LUNCH' + where;
    return 'Bots ate ' + sol(s.total) + ' SOL of my lunch. ' + s.hits + ' of my last ' + s.swaps + ' pump.fun swaps got sandwiched. Check yours with $LUNCH' + where;
  }

  var renderQueued = false;
  function queueRender(m) {
    lastReport = m;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; renderReport(lastReport); });
  }

  function renderReport(m) {
    lastReport = m;
    var s = summarize(m);
    var example = m.mode === 'example', running = m.mode === 'running';
    var badge = example ? '<span class="badge example">Example report</span>'
      : running ? '<span class="badge live">Scanning</span>'
      : m.mode === 'error' ? '<span class="badge">Stopped</span>'
      : '<span class="badge done">Report</span>';
    var stateNote = example ? 'Sample numbers. Paste a wallet above to run a real check.'
      : running ? 'Reading transaction ' + m.read + ' of ' + m.total
      : m.mode === 'error' ? esc(m.err)
      : 'Checked ' + m.read + ' transactions · ' + new Date().toTimeString().slice(0, 5);

    var cleanBig = !s.hits && !running;
    var bigVal = s.hits ? sol(s.total) : '0';
    var usdVal = s.hits ? usd(s.total) : null;
    var sentence;
    if (example) sentence = '4 of the last 31 pump.fun swaps in this wallet were sandwiched.';
    else if (running && !s.swaps) sentence = 'Looking for pump.fun and PumpSwap trades…';
    else if (!s.swaps && !running) sentence = 'No pump.fun or PumpSwap swaps in the last ' + m.read + ' transactions. Try scanning 100.';
    else if (!s.hits) sentence = running ? 'No sandwiches yet in ' + s.swaps + ' swaps checked.' : 'None of your last ' + s.swaps + ' pump.fun swaps were sandwiched. Keep your slippage tight.';
    else sentence = s.hits + ' of your ' + (running ? 'swaps checked so far' : 'last ' + s.swaps + ' pump.fun swaps') + (s.hits === 1 ? ' was' : ' were') + ' sandwiched.';

    var progress = running ? '<div style="display:flex;flex-direction:column;gap:8px"><div class="progress"><i style="width:' + Math.round(100 * m.read / Math.max(1, m.total)) + '%"></i></div><span class="progress-text">' + m.read + ' / ' + m.total + ' transactions · ' + s.swaps + ' swaps · ' + s.hits + ' sandwiched</span></div>' : '';

    var kv = '<div class="kv">' +
      '<div><span class="label">Swaps checked</span><b class="num">' + s.swaps + '</b></div>' +
      '<div><span class="label">Sandwiched</span><b class="num' + (s.hits ? ' red' : '') + '">' + s.hits + '</b></div>' +
      '<div><span class="label">Biggest bite</span><b class="num">' + (s.biggest ? sol(s.biggest) + ' SOL' : '—') + '</b></div>' +
      '<div><span class="label">Hungriest bot</span><b>' + (s.topBot ? (example ? short(s.topBot) : '<a href="' + solscan('account', s.topBot) + '" target="_blank" rel="noopener" style="color:inherit">' + short(s.topBot) + ' ↗</a>') : '—') + '</b></div>' +
      '</div>';

    var actions = '';
    if (!running && m.mode !== 'error') {
      var text = shareText(m, s);
      actions = '<div class="report-actions">' +
        (example ? '<a class="btn btn-primary btn-sm" href="#top" data-act="focus">Check my wallet</a>'
          : '<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=' + encodeURIComponent(text) + '">Post on X</a>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-act="card">Save card</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-act="copy">Copy result</button>') +
        '<a class="btn btn-ghost btn-sm" href="#tuner" data-act="tune">Fix my slippage →</a>' +
        '</div>';
    } else if (running) {
      actions = '<div class="report-actions"><button class="btn btn-ghost btn-sm" type="button" data-act="stop">Stop scan</button></div>';
    }

    var strip = m.strip.length ? m.strip.map(function (h) { return '<i class="' + (h ? 'hit' : 'sw') + '"></i>'; }).join('') : '<i></i>';

    var incidents = m.incidents.length ? m.incidents.map(function (i) {
      var proof = example
        ? '<span>front-run tx</span><span>your tx</span><span>back-run tx</span><span class="botlink">bot ' + short(i.bot) + '</span>'
        : '<a href="' + solscan('tx', i.front) + '" target="_blank" rel="noopener">front-run ↗</a>' +
          '<a href="' + solscan('tx', i.you) + '" target="_blank" rel="noopener">your tx ↗</a>' +
          '<a href="' + solscan('tx', i.back) + '" target="_blank" rel="noopener">back-run ↗</a>' +
          '<a class="botlink" href="' + solscan('account', i.bot) + '" target="_blank" rel="noopener">bot ' + short(i.bot) + ' ↗</a>';
      return '<div class="inc">' +
        '<div class="inc-top"><span class="side-pill">' + i.side + '</span>' +
        (example ? '<span class="tok">' + short(i.mint) + '</span>' : '<a class="tok" href="' + solscan('token', i.mint) + '" target="_blank" rel="noopener" style="text-decoration:none">' + short(i.mint) + '</a>') +
        '<span class="when">' + sol(i.sizeLamports, 2) + ' SOL · ' + (i.when || ago(i.time)) + '</span></div>' +
        '<span class="lost">' + (i.lossLamports != null ? '−' + sol(i.lossLamports) + ' SOL' : 'loss n/a') + '</span>' +
        '<div class="proof">' + proof + '</div></div>';
    }).join('') : '<p class="empty-note">' + (running ? 'Sandwiches show up here as they are found.' : (s.swaps ? 'No sandwiches found. Every swap above traded at a clean price.' : 'Nothing to show yet.')) + '</p>';

    var unv = m.unverified ? '<p class="empty-note">' + m.unverified + ' swap' + (m.unverified > 1 ? 's' : '') + ' had a bot buy right before, but the RPC could not return the rest of the block to confirm. Not counted.</p>' : '';

    $('reportWrap').innerHTML =
      '<div class="report-state">' + badge + '<span class="label" style="text-transform:none;letter-spacing:.02em">' + stateNote + '</span></div>' +
      '<div class="panel report">' +
        '<div class="report-main">' +
          '<div class="report-who"><span class="label">Wallet</span><span class="mono" style="font-size:12px;color:var(--bone)">' + (m.wallet ? esc(short(m.wallet)) : 'Example wallet') + '</span></div>' +
          '<div class="eaten"><span class="label">Eaten by bots</span>' +
            '<div class="big num' + (cleanBig ? ' clean' : '') + '">' + bigVal + '<small>SOL</small></div>' +
            (usdVal ? '<span class="usd">≈ ' + usdVal + ' at today\'s SOL price</span>' : '') +
            '<p class="sentence">' + sentence + '</p></div>' +
          progress + kv + actions +
        '</div>' +
        '<div class="report-side">' +
          '<div style="display:flex;flex-direction:column;gap:12px"><span class="label">Your swaps, oldest to newest</span><div class="strip">' + strip + '</div>' +
          '<div class="strip-legend"><span style="--c:var(--mute)">Clean</span><span style="--c:var(--red)">Sandwiched</span></div></div>' +
          '<div><span class="label">Sandwiches</span><div class="incidents" style="margin-top:12px">' + incidents + '</div>' + unv + '</div>' +
        '</div>' +
      '</div>';
  }

  $('reportWrap').addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var act = t.getAttribute('data-act');
    if (act === 'stop') { cancelScan = true; t.disabled = true; t.textContent = 'Stopping…'; }
    if (act === 'focus') { e.preventDefault(); $('walletInput').focus(); window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); }
    if (act === 'copy' && lastReport) copy(shareText(lastReport, summarize(lastReport)), 'Result copied');
    if (act === 'card' && lastReport) saveCard(lastReport);
    if (act === 'tune' && lastReport && lastReport.incidents.length && lastReport.mode !== 'example') {
      var worst = lastReport.incidents.slice().sort(function (a, b) { return (b.lossLamports || 0) - (a.lossLamports || 0); })[0];
      $('tMint').value = worst.mint;
      $('tSize').value = (worst.sizeLamports / 1e9).toFixed(2);
    }
  });

  async function runCheck(wallet) {
    if (scanning) return;
    var depth = +$('depthSel').value || 50;
    scanning = true; cancelScan = false;
    rpc.hold();
    $('checkBtn').disabled = true;
    $('checkErr').textContent = '';
    var st = { wallet: wallet, total: depth, read: 0, swaps: [], hits: [], unverified: [] };
    queueRender(modelFromState(st, 'running'));
    document.getElementById('check').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    try {
      st = await E.scanWallet(rpc, wallet, {
        depth: depth,
        isCancelled: function () { return cancelScan; },
        onEvent: function (type, s) { st = s; queueRender(modelFromState(s, 'running')); }
      });
      queueRender(modelFromState(st, 'done'));
    } catch (e) {
      var partial = st.read > 0;
      renderReport(modelFromState(st, partial ? 'done' : 'error', explain(e)));
      $('checkErr').textContent = partial ? 'Scan stopped early: ' + explain(e) : explain(e);
      if (!PREVIEW && (e.kind === 'network' || e.kind === 'rate' || e.kind === 'denied')) $('rpcSet').open = true;
    } finally {
      scanning = false;
      rpc.release();
      $('checkBtn').disabled = false;
    }
  }

  $('checkForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var w = $('walletInput').value.trim();
    if (!B58.test(w)) {
      $('walletInput').classList.add('bad');
      $('checkErr').textContent = 'That does not look like a Solana address. Paste the full wallet address (32–44 characters).';
      return;
    }
    $('walletInput').classList.remove('bad');
    runCheck(w);
  });
  $('walletInput').addEventListener('input', function () { this.classList.remove('bad'); $('checkErr').textContent = ''; });

  // ---------- share card ----------
  var MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><rect x="6" y="13" width="52" height="10" rx="1" fill="#efe8db"/><path d="M7 27H43A4.2 4.2 0 0 0 43 32A4.2 4.2 0 0 0 43 37H7A1 1 0 0 1 6 36V28A1 1 0 0 1 7 27Z" fill="#e6492f"/><rect x="6" y="41" width="52" height="10" rx="1" fill="#efe8db"/></svg>';
  function markImage() {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { res(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(MARK_SVG);
    });
  }
  function fit(x, text, font, size, max) {
    var s = size;
    do { x.font = font.replace('{s}', s); s -= 2; } while (x.measureText(text).width > max && s > 20);
  }
  async function saveCard(m) {
    var s = summarize(m);
    var c = document.createElement('canvas'); c.width = 1200; c.height = 675;
    var x = c.getContext('2d');
    try { await Promise.all([document.fonts.load('850 100px Archivo'), document.fonts.load('400 20px "Martian Mono"')]); } catch (e) {}
    try { x.fontStretch = 'expanded'; } catch (e) {}
    var mark = await markImage();
    x.fillStyle = '#0d0c0b'; x.fillRect(0, 0, 1200, 675);
    x.strokeStyle = '#2a2723'; x.lineWidth = 2; x.strokeRect(28, 28, 1144, 619);
    if (mark) x.drawImage(mark, 60, 52, 56, 56);
    x.fillStyle = '#efe8db'; x.font = '850 28px Archivo, Arial, sans-serif'; x.fillText('LUNCH', 126, 93);
    x.fillStyle = '#9a9285'; x.font = '400 16px "Martian Mono", monospace'; x.fillText('LUNCH CHECK  ·  ' + short(m.wallet), 64, 188);
    x.fillStyle = '#efe8db'; x.font = '820 62px Archivo, Arial, sans-serif';
    x.fillText(s.hits ? 'Bots ate' : 'Bots went', 64, 270);
    var big = s.hits ? sol(s.total) + ' SOL' : 'hungry.';
    x.fillStyle = s.hits ? '#e6492f' : '#efe8db';
    fit(x, big, '860 {s}px Archivo, Arial, sans-serif', 150, 760);
    x.fillText(big, 60, 418);
    if (s.hits) { x.fillStyle = '#efe8db'; x.font = '820 62px Archivo, Arial, sans-serif'; x.fillText('of my lunch.', 64, 500); }
    x.fillStyle = '#9a9285'; x.font = '400 17px "Martian Mono", monospace';
    x.fillText(s.hits ? s.hits + ' of my last ' + s.swaps + ' pump.fun swaps were sandwiched' : '0 sandwiches in my last ' + s.swaps + ' pump.fun swaps', 64, 590);
    x.textAlign = 'right'; x.fillText(CONFIG.site || '$LUNCH', 1136, 590); x.textAlign = 'left';
    if (mark) x.drawImage(mark, 850, 150, 300, 300);
    c.toBlob(function (blob) {
      if (!blob) return;
      var u = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = u; a.download = 'lunch-check.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 3000);
    }, 'image/png');
  }

  // ---------- Slippage Tuner ----------
  var tSide = 'buy';
  function setSide(sd) {
    tSide = sd;
    $('tBuy').setAttribute('aria-pressed', sd === 'buy'); $('tSell').setAttribute('aria-pressed', sd === 'sell');
  }
  $('tBuy').addEventListener('click', function () { setSide('buy'); });
  $('tSell').addEventListener('click', function () { setSide('sell'); });

  function renderTuner(t, mode, note) {
    var example = mode === 'example';
    var curMax = Math.max(t.exposeCurrentLamports, t.exposeRecLamports, 1);
    var wCur = 100 * t.exposeCurrentLamports / curMax, wRec = 100 * t.exposeRecLamports / curMax;
    var tighter = t.recPct > t.currentPct;
    var span = t.spanSec != null ? (t.spanSec < 120 ? Math.round(t.spanSec) + 's' : t.spanSec < 7200 ? Math.round(t.spanSec / 60) + ' min' : Math.round(t.spanSec / 3600) + ' h') : '—';
    $('tunerOut').innerHTML =
      '<div class="rec"><div style="display:flex;flex-direction:column;gap:10px"><span class="label">Recommended slippage</span><div class="big num">' + pct(t.recPct).replace('%', '') + '<small>%</small></div></div>' +
      (example ? '<span class="badge example">Example</span>' : mode === 'running' ? '<span class="badge live">Reading trades</span>' : '<span class="badge done">' + (t.quiet ? 'Quiet market' : 'From ' + t.trades + ' trades') + '</span>') + '</div>' +
      '<div class="compare">' +
        '<div class="cmp-row you"><span class="k">You · ' + pct(t.currentPct) + '</span><div class="bar"><i style="width:' + wCur + '%"></i></div><span class="v">≤ ' + sol(t.exposeCurrentLamports) + ' SOL</span></div>' +
        '<div class="cmp-row rec"><span class="k">Tuned · ' + pct(t.recPct) + '</span><div class="bar"><i style="width:' + wRec + '%"></i></div><span class="v">≤ ' + sol(t.exposeRecLamports) + ' SOL</span></div>' +
        '<span class="label" style="text-transform:none;letter-spacing:.02em">Most a sandwich can take from a ' + sol(t.sizeLamports, 2) + ' SOL ' + t.side + ' at each setting</span>' +
      '</div>' +
      '<div class="kv">' +
        '<div><span class="label">Your price impact</span><b class="num">' + t.impactPct.toFixed(2) + '%</b></div>' +
        '<div><span class="label">Fast moves, 1s (p90)</span><b class="num">' + (t.quiet ? 'too few trades' : t.p90Pct.toFixed(2) + '%') + '</b></div>' +
        '<div><span class="label">Trades read</span><b class="num">' + t.trades + ' over ' + span + '</b></div>' +
        '<div><span class="label">Pool</span><b>' + (t.kind === 'amm' ? 'PumpSwap' : 'Bonding curve') + '</b></div>' +
      '</div>' +
      '<p class="tuner-note">' + (note || (t.capped
        ? 'This coin moves more than 15% within two seconds right now. Raising slippage further mostly feeds bots. Trade smaller, or wait for it to calm down.'
        : tighter
        ? 'Your current setting is tighter than recent price moves. Expect some failed transactions at ' + pct(t.currentPct) + '.'
        : 'Too tight and the trade fails instead of filling. If it fails twice in a row, raise it by half a percent at a time.')) +
      (t.botTrades ? ' Left out ' + t.botTrades + ' bot round-trip trade' + (t.botTrades > 1 ? 's' : '') + ' when measuring price moves.' : '') + '</p>';
  }

  var TUNE_EXAMPLE = { recPct: 3.5, currentPct: 20, exposeCurrentLamports: 0.1e9, exposeRecLamports: 0.0175e9, sizeLamports: 0.5e9, side: 'buy', impactPct: 0.91, p90Pct: 2.4, quiet: false, trades: 24, spanSec: 190, kind: 'curve' };

  var tuning = false;
  $('tunerForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (tuning) return;
    var mint = $('tMint').value.trim();
    var size = parseFloat(String($('tSize').value).replace(',', '.'));
    var cur = parseFloat(String($('tCur').value).replace(',', '.'));
    var err = $('tunerErr'); err.textContent = '';
    if (!B58.test(mint)) { err.textContent = 'Paste the token contract address (32–44 characters).'; $('tMint').classList.add('bad'); return; }
    if (!(size > 0 && size < 10000)) { err.textContent = 'Enter a trade size in SOL, for example 0.5.'; return; }
    if (!(cur > 0 && cur <= 100)) { err.textContent = 'Enter your current slippage as a percent between 0 and 100.'; return; }
    $('tMint').classList.remove('bad');
    tuning = true; rpc.hold(); $('tunerBtn').disabled = true;
    $('tunerOut').innerHTML = '<div style="display:flex;flex-direction:column;gap:12px"><span class="badge live" style="align-self:flex-start">Reading trades</span><div class="progress"><i id="tProg" style="width:4%"></i></div><span class="progress-text" id="tProgText">Fetching the latest trades for ' + esc(short(mint)) + '…</span></div>';
    try {
      var t = await E.tune(rpc, mint, {
        sizeSol: size, side: tSide, currentPct: cur,
        onProgress: function (i, n) { var p = $('tProg'); if (p) p.style.width = Math.round(100 * i / n) + '%'; var tt = $('tProgText'); if (tt) tt.textContent = 'Read ' + i + ' of ' + n + ' trades'; }
      });
      if (!t) {
        $('tunerOut').innerHTML = '<p class="tuner-note">No pump.fun or PumpSwap trades found for this token in its latest transactions. Check the address, or try a token that trades on pump.fun.</p>';
      } else renderTuner(t, 'done');
    } catch (ex) {
      err.textContent = explain(ex);
      renderTuner(TUNE_EXAMPLE, 'example', 'Showing the example again because the live read failed.');
      if (ex.fatal && !PREVIEW) $('rpcSet').open = true;
    } finally {
      tuning = false; rpc.release(); $('tunerBtn').disabled = false;
    }
  });
  $('tMint').addEventListener('input', function () { this.classList.remove('bad'); });

  // ---------- Live monitor ----------
  var mon = { blocks: 0, swaps: 0, hits: 0, lam: 0, spark: [] };
  function renderSpark() {
    var max = Math.max.apply(null, mon.spark.map(function (b) { return b.s; }).concat([1]));
    var items = mon.spark.slice(-48);
    while (items.length < 48) items.unshift(null);
    $('mSpark').innerHTML = items.map(function (b) {
      return b ? '<i class="' + (b.h ? 'hit' : '') + '" style="height:' + Math.max(4, 100 * b.s / max) + '%"></i>' : '<i style="height:3%;opacity:.4"></i>';
    }).join('');
  }
  function renderCounters() {
    $('mBlocks').textContent = mon.blocks.toLocaleString('en-US');
    $('mSwaps').textContent = mon.swaps.toLocaleString('en-US');
    $('mHits').textContent = mon.hits.toLocaleString('en-US');
    $('mSol').textContent = sol(mon.lam, mon.lam ? 3 : 0);
  }
  var monitor = E.createMonitor(rpc, {
    interval: 6000,
    paused: function () { return document.hidden; },
    onState: function (on) {
      $('monBtn').textContent = on ? 'Pause' : (mon.blocks ? 'Resume' : 'Start monitor');
      $('monBadge').className = on ? 'badge live' : 'badge';
      $('monBadge').textContent = on ? 'Live' : (mon.blocks ? 'Paused' : 'Off');
    },
    onBlock: function (b) {
      mon.blocks++; mon.swaps += b.swaps;
      mon.spark.push({ s: b.swaps, h: b.hits.length });
      if (mon.blocks === 1) {
        $('mEmpty').innerHTML = '<b>Reading blocks.</b><span>Swaps are being checked. Sandwiches appear here the moment one is found.</span>';
      }
      b.hits.forEach(function (h) {
        mon.hits++; mon.lam += h.lossLamports || 0;
        var row = document.createElement('div');
        row.className = 'feed-row';
        row.innerHTML = '<span class="t">' + clock(b.time) + '</span>' +
          '<div class="what"><b>' + h.side.toUpperCase() + ' ' + (h.sizeLamports != null ? sol(h.sizeLamports, 2) + ' SOL' : '') + ' · <a href="' + solscan('token', h.mint) + '" target="_blank" rel="noopener">' + short(h.mint) + '</a></b>' +
          '<span><a href="' + solscan('tx', h.front) + '" target="_blank" rel="noopener">front</a> · <a href="' + solscan('tx', h.victimSig) + '" target="_blank" rel="noopener">victim ' + short(h.victim) + '</a> · <a href="' + solscan('tx', h.back) + '" target="_blank" rel="noopener">back</a> · bot <a href="' + solscan('account', h.bot) + '" target="_blank" rel="noopener">' + short(h.bot) + '</a></span></div>' +
          '<span class="l">' + (h.lossLamports != null ? '−' + sol(h.lossLamports) + ' SOL' : '—') + '</span>';
        var feed = $('mFeed');
        var empty = $('mEmpty'); if (empty) empty.remove();
        feed.insertBefore(row, feed.firstChild);
        while (feed.children.length > 60) feed.lastChild.remove();
      });
      renderCounters(); renderSpark();
    },
    onError: function (e) {
      if (e.fatal) {
        var empty = $('mEmpty');
        var msg = '<b>Monitor stopped.</b><span>' + esc(explain(e)) + (PREVIEW ? '' : ' Block reads are heavy, and some public endpoints refuse them. A private RPC endpoint (set under Lunch Check) fixes this.') + '</span>';
        if (empty) empty.innerHTML = msg;
        else { var d = document.createElement('div'); d.className = 'feed-empty'; d.id = 'mEmpty'; d.innerHTML = msg; $('mFeed').insertBefore(d, $('mFeed').firstChild); }
      }
    }
  });
  $('monBtn').addEventListener('click', function () { if (monitor.running()) monitor.stop(); else monitor.start(); });

  // ---------- RPC settings ----------
  $('rpcInput').value = rpcUrl === CONFIG.rpc ? '' : rpcUrl;
  $('rpcSave').addEventListener('click', function () {
    var v = $('rpcInput').value.trim();
    if (!/^https:\/\/\S+$/.test(v)) { toast('Enter an https:// RPC URL'); return; }
    rpcUrl = v; store('lunch.rpc', v); toast('RPC endpoint saved in this browser');
  });
  $('rpcReset').addEventListener('click', function () { rpcUrl = CONFIG.rpc; store('lunch.rpc', null); $('rpcInput').value = ''; toast('Using public Solana RPC'); });

  // ---------- boot ----------
  initConfig();
  renderChart();
  renderReport(EXAMPLE);
  renderTuner(TUNE_EXAMPLE, 'example');
  renderSpark();
  try {
    var q = new URLSearchParams(location.search).get('w');
    if (q && B58.test(q)) { $('walletInput').value = q; runCheck(q); }
  } catch (e) {}
})();
