/* LUNCH engine: reads public Solana transactions and finds sandwich attacks on pump.fun's bonding curve and PumpSwap.
   Pure functions + a throttled JSON-RPC client. No keys, no backend. */
(function (root) {
  'use strict';

  var PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';      // pump.fun bonding curve program
  var PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';  // PumpSwap AMM program
  var WSOL = 'So11111111111111111111111111111111111111112';
  // pump.fun curves trade on virtual reserves: real token reserves + 279.9M tokens, real SOL + 30 SOL.
  var CURVE_TOK_OFFSET = 279900000 * 1e6;
  var CURVE_SOL_OFFSET = 30 * 1e9;
  var LAMPORTS = 1e9;

  function keyStr(k) { return typeof k === 'string' ? k : (k && k.pubkey) || ''; }

  function accountKeysOf(tx) {
    var t = tx.transaction || {};
    var msg = t.message;
    var raw = (msg && msg.accountKeys) || t.accountKeys || [];
    var keys = raw.map(keyStr);
    // "json" encoding lists lookup-table accounts separately; parsed/"accounts" encodings already include them.
    var objectKeys = raw.length && typeof raw[0] === 'object';
    var la = tx.meta && tx.meta.loadedAddresses;
    if (!objectKeys && la) keys = keys.concat(la.writable || [], la.readonly || []);
    return keys;
  }

  function parseTx(tx, slotHint) {
    if (!tx || !tx.meta || !tx.transaction) return null;
    var keys = accountKeysOf(tx);
    var meta = tx.meta;
    var byIdx = {};
    function take(list, field) {
      (list || []).forEach(function (b) {
        if (!b || !b.mint || !b.owner) return;
        var e = byIdx[b.accountIndex] || (byIdx[b.accountIndex] = { mint: b.mint, owner: b.owner, pre: 0, post: 0, dec: 0 });
        var amt = Number((b.uiTokenAmount && b.uiTokenAmount.amount) || 0);
        e[field] = amt;
        e.dec = (b.uiTokenAmount && b.uiTokenAmount.decimals) || e.dec;
      });
    }
    take(meta.preTokenBalances, 'pre');
    take(meta.postTokenBalances, 'post');
    var tok = new Map();
    Object.keys(byIdx).forEach(function (i) {
      var e = byIdx[i];
      var m = tok.get(e.owner);
      if (!m) { m = new Map(); tok.set(e.owner, m); }
      var cur = m.get(e.mint);
      if (!cur) m.set(e.mint, { pre: e.pre, post: e.post, dec: e.dec });
      else { cur.pre += e.pre; cur.post += e.post; }
    });
    var sigs = tx.transaction.signatures || [];
    return {
      sig: sigs[0],
      slot: tx.slot != null ? tx.slot : slotHint,
      time: tx.blockTime || null,
      ok: !meta.err,
      keys: keys,
      pre: meta.preBalances || [],
      post: meta.postBalances || [],
      tok: tok,
      hasPump: keys.indexOf(PUMP) !== -1,
      hasAmm: keys.indexOf(PUMP_AMM) !== -1
    };
  }

  function tokDelta(p, owner, mint) {
    var m = p.tok.get(owner); if (!m) return 0;
    var e = m.get(mint); return e ? e.post - e.pre : 0;
  }
  function lamDelta(p, owner) {
    var i = p.keys.indexOf(owner);
    return i < 0 ? 0 : (p.post[i] || 0) - (p.pre[i] || 0);
  }
  function solEquivDelta(p, owner) { return lamDelta(p, owner) + tokDelta(p, owner, WSOL); }

  // The pool is the other party whose balance of the traded mint moved the opposite way.
  function findPool(p, mint, userDelta, exclude) {
    var best = null;
    p.tok.forEach(function (m, owner) {
      if (exclude.indexOf(owner) !== -1) return;
      var e = m.get(mint); if (!e) return;
      var d = e.post - e.pre;
      if (!d || Math.sign(d) === Math.sign(userDelta)) return;
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { owner: owner, d: d };
    });
    return best && best.owner;
  }

  function reservesOf(p, pool, mint) {
    if (!p || !pool) return null;
    var m = p.tok.get(pool); if (!m) return null;
    var t = m.get(mint); if (!t) return null;
    var w = m.get(WSOL);
    if (w) return { kind: 'amm', solPre: w.pre, solPost: w.post, tokPre: t.pre, tokPost: t.post };
    var i = p.keys.indexOf(pool); if (i < 0) return null;
    return {
      kind: 'curve',
      solPre: (p.pre[i] || 0) + CURVE_SOL_OFFSET, solPost: (p.post[i] || 0) + CURVE_SOL_OFFSET,
      tokPre: t.pre + CURVE_TOK_OFFSET, tokPost: t.post + CURVE_TOK_OFFSET
    };
  }

  function swapFor(p, wallet) {
    if (!p || !p.ok || !(p.hasPump || p.hasAmm)) return null;
    var mine = p.tok.get(wallet); if (!mine) return null;
    var best = null;
    mine.forEach(function (e, mint) {
      if (mint === WSOL) return;
      var d = e.post - e.pre;
      if (d && (!best || Math.abs(d) > Math.abs(best.d))) best = { mint: mint, d: d, dec: e.dec };
    });
    if (!best) return null;
    var pool = findPool(p, best.mint, best.d, [wallet]);
    if (!pool) return null;
    var res = reservesOf(p, pool, best.mint);
    var size = res ? Math.abs(res.solPost - res.solPre) : Math.abs(solEquivDelta(p, wallet));
    return {
      sig: p.sig, slot: p.slot, time: p.time, mint: best.mint, side: best.d > 0 ? 'buy' : 'sell',
      tokens: Math.abs(best.d), dec: best.dec, pool: pool, kind: res ? res.kind : null, res: res, sizeLamports: size
    };
  }

  function matchSide(p, sw, wantSign, onlyOwner, exclude) {
    if (!p || !p.ok || p.keys.indexOf(sw.pool) === -1) return null;
    var best = null;
    p.tok.forEach(function (m, owner) {
      if (exclude.indexOf(owner) !== -1) return;
      if (onlyOwner && owner !== onlyOwner) return;
      var e = m.get(sw.mint); if (!e) return;
      var d = e.post - e.pre;
      if (Math.sign(d) !== wantSign) return;
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { owner: owner, d: d };
    });
    return best && { owner: best.owner, tokens: Math.abs(best.d), sig: p.sig };
  }
  function matchFront(p, sw, wallet) { return matchSide(p, sw, sw.side === 'buy' ? 1 : -1, null, [wallet, sw.pool]); }
  function matchBack(p, sw, bot) { return matchSide(p, sw, sw.side === 'buy' ? -1 : 1, bot, [sw.pool]); }

  // What the victim lost: replay the same trade on the reserves from before the front-run.
  // f carries the pool's own fee so only the bot's price push counts.
  function lossFor(frontP, sw) {
    var r0 = reservesOf(frontP, sw.pool, sw.mint), r1 = sw.res;
    if (!r0 || !r1) return null;
    var x0 = r0.solPre, y0 = r0.tokPre, x1 = r1.solPre, y1 = r1.tokPre;
    if (!(x0 > 0 && y0 > 0 && x1 > 0 && y1 > 0)) return null;
    if (sw.side === 'buy') {
      var sIn = r1.solPost - r1.solPre, t = r1.tokPre - r1.tokPost;
      if (!(sIn > 0 && t > 0 && t < y0 && t < y1)) return null;
      var s0 = x0 * t / (y0 - t), s1 = x1 * t / (y1 - t);
      return Math.max(0, (sIn / s1) * (s1 - s0));
    }
    var tIn = r1.tokPost - r1.tokPre, a = r1.solPre - r1.solPost;
    if (!(tIn > 0 && a > 0)) return null;
    var a0 = x0 * tIn / (y0 + tIn), a1 = x1 * tIn / (y1 + tIn);
    return Math.max(0, (a / a1) * (a0 - a1));
  }

  function botNet(fp, bp, owner) { return solEquivDelta(fp, owner) + solEquivDelta(bp, owner); }

  // ---------- block scan (monitor) ----------
  function sandwichesInBlock(list) {
    var byMint = new Map(), swaps = 0;
    list.forEach(function (p, i) {
      if (!p || !p.ok || !(p.hasPump || p.hasAmm)) return;
      var counted = false;
      p.tok.forEach(function (m, owner) {
        m.forEach(function (e, mint) {
          if (mint === WSOL) return;
          var d = e.post - e.pre; if (!d) return;
          var arr = byMint.get(mint);
          if (!arr) { arr = []; byMint.set(mint, arr); }
          var ent = arr.length && arr[arr.length - 1].i === i ? arr[arr.length - 1] : null;
          if (!ent) { ent = { i: i, p: p, d: new Map() }; arr.push(ent); }
          ent.d.set(owner, (ent.d.get(owner) || 0) + d);
          counted = true;
        });
      });
      if (counted) swaps++;
    });

    var hits = [];
    byMint.forEach(function (arr, mint) {
      if (arr.length < 3) return;
      var count = new Map();
      arr.forEach(function (e) { e.d.forEach(function (d, o) { count.set(o, (count.get(o) || 0) + 1); }); });
      var pool = null, pc = 0;
      count.forEach(function (c, o) { if (c > pc) { pc = c; pool = o; } });
      var seq = [];
      arr.forEach(function (e) {
        if (!e.d.has(pool)) return;
        var trader = null, td = 0;
        e.d.forEach(function (d, o) { if (o !== pool && Math.abs(d) > Math.abs(td)) { td = d; trader = o; } });
        if (trader) seq.push({ p: e.p, trader: trader, side: td > 0 ? 'buy' : 'sell' });
      });
      for (var j = 1; j < seq.length - 1; j++) {
        var v = seq[j], found = null;
        for (var a = j - 1; a >= Math.max(0, j - 4) && !found; a--) {
          var f = seq[a];
          if (f.trader === v.trader || f.side !== v.side) continue;
          for (var b = j + 1; b <= Math.min(seq.length - 1, j + 4); b++) {
            if (seq[b].trader === f.trader && seq[b].side !== v.side) { found = { f: f, b: seq[b] }; break; }
          }
        }
        if (!found) continue;
        var sw = swapFor(v.p, v.trader);
        hits.push({
          mint: mint, side: v.side, victim: v.trader, bot: found.f.trader, slot: v.p.slot, time: v.p.time,
          front: found.f.p.sig, victimSig: v.p.sig, back: found.b.p.sig,
          sizeLamports: sw ? sw.sizeLamports : null,
          lossLamports: sw ? lossFor(found.f.p, sw) : null
        });
      }
    });
    return { swaps: swaps, hits: hits };
  }

  // ---------- slippage tuner ----------
  function quantile(arr, q) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function ceilHalf(x) { return Math.ceil(x * 2) / 2; }

  // list: parsed txs touching the mint, newest first (as RPC returns them)
  function tuneFromTxs(list, mint, sizeSol, side, currentPct) {
    var trades = list.filter(function (p) { return p && p.ok && (p.hasPump || p.hasAmm); });
    var count = new Map();
    trades.forEach(function (p) {
      p.tok.forEach(function (m, owner) { var e = m.get(mint); if (e && e.post !== e.pre) count.set(owner, (count.get(owner) || 0) + 1); });
    });
    var pool = null, pc = 0;
    count.forEach(function (c, o) { if (c > pc) { pc = c; pool = o; } });
    if (!pool) return null;
    var pts = [];
    trades.forEach(function (p) {
      var r = reservesOf(p, pool, mint);
      if (!r || r.tokPost === r.tokPre || !(r.tokPost > 0) || !(r.tokPre > 0)) return;
      var trader = null, td = 0;
      p.tok.forEach(function (m, owner) {
        if (owner === pool) return;
        var e = m.get(mint); if (!e) return;
        var d = e.post - e.pre;
        if (Math.abs(d) > Math.abs(td)) { td = d; trader = owner; }
      });
      pts.push({ slot: p.slot, time: p.time, price: r.solPost / r.tokPost, move: (r.solPost / r.tokPost) / (r.solPre / r.tokPre) - 1, trader: trader, side: td > 0 ? 'buy' : 'sell', r: r });
    });
    if (!pts.length) return null;
    pts.reverse(); // oldest first
    // Leave out round trips (same wallet buys and sells within 2 slots): those are bots, and their
    // price push is the thing we are protecting against, not normal market movement.
    pts.forEach(function (a) {
      pts.forEach(function (b) {
        if (a !== b && a.trader && a.trader === b.trader && a.side !== b.side && Math.abs(a.slot - b.slot) <= 2) { a.bot = true; b.bot = true; }
      });
    });
    var flow = pts.filter(function (q) { return !q.bot; });
    var latest = pts[pts.length - 1].r;
    var x = latest.solPost;
    var s = sizeSol * LAMPORTS;
    // Risk window: other traders' moves that land in the ~3 slots between your quote and your trade.
    var moves = [], paired = 0;
    for (var i = 0; i < flow.length; i++) {
      var sum = 0, has = false;
      for (var j = i + 1; j < flow.length && flow[j].slot - flow[i].slot <= 3; j++) {
        has = true;
        sum += side === 'buy' ? Math.max(0, flow[j].move) : Math.max(0, -flow[j].move);
      }
      if (has) { paired++; moves.push(sum); }
    }
    var impact = s / (x + s);
    var p90 = quantile(moves, 0.9);
    var quiet = paired < 4;
    var raw = quiet ? Math.max(1, ceilHalf(impact * 100 * 0.5 + 1)) : Math.max(1, ceilHalf(p90 * 100 * 1.2 + 0.5));
    var rec = Math.min(15, raw);
    var first = pts[0], last = pts[pts.length - 1];
    return {
      pool: pool, kind: latest.kind, trades: pts.length, paired: paired, quiet: quiet, capped: raw > 15,
      botTrades: pts.length - flow.length,
      spanSec: first.time && last.time ? Math.max(0, last.time - first.time) : null,
      impactPct: impact * 100, p90Pct: p90 * 100, recPct: rec, currentPct: currentPct,
      exposeCurrentLamports: s * currentPct / 100, exposeRecLamports: s * rec / 100, sizeLamports: s, side: side
    };
  }

  // ---------- RPC client ----------
  function rpcError(kind, message, code, fatal) {
    var e = new Error(message); e.kind = kind; e.code = code; e.fatal = !!fatal; return e;
  }

  function createRpc(getUrl, opts) {
    opts = opts || {};
    var GAP = opts.gap || 270; // ~3.7 requests/second keeps public RPC under its per-method limit
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
    var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var last = 0, chain = Promise.resolve(), holds = 0, cache = new Map();

    function gate() {
      var p = chain.then(function () {
        var w = last + GAP - Date.now();
        return (w > 0 ? sleep(w) : Promise.resolve()).then(function () { last = Date.now(); });
      });
      chain = p.catch(function () {});
      return p;
    }

    async function call(method, params, tries) {
      tries = tries || 5;
      var lastErr = null;
      for (var a = 0; a < tries; a++) {
        await gate();
        var res;
        try {
          res = await fetchFn(getUrl(), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
          });
        } catch (e) {
          lastErr = rpcError('network', 'Could not reach the RPC endpoint. Check your connection, or set a different endpoint under RPC endpoint.', null, true);
          await sleep(600 * (a + 1));
          continue;
        }
        if (res.status === 429) {
          lastErr = rpcError('rate', 'The public RPC is rate-limiting this browser. Wait a minute, or add your own RPC endpoint.', 429, true);
          await sleep(1500 * Math.pow(2, a));
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw rpcError('denied', 'The RPC endpoint refused the request (HTTP ' + res.status + '). Try a different endpoint.', res.status, true);
        }
        if (!res.ok) {
          lastErr = rpcError('http', 'The RPC endpoint returned HTTP ' + res.status + '.', res.status, a === tries - 1);
          await sleep(800 * (a + 1));
          continue;
        }
        var j;
        try { j = await res.json(); } catch (e) { lastErr = rpcError('parse', 'The RPC endpoint sent an unreadable response.', null, false); continue; }
        if (j.error) {
          var msg = j.error.message || 'RPC error';
          if (j.error.code === 429 || /rate limit|too many/i.test(msg)) {
            lastErr = rpcError('rate', 'The public RPC is rate-limiting this browser. Wait a minute, or add your own RPC endpoint.', 429, true);
            await sleep(1500 * Math.pow(2, a));
            continue;
          }
          throw rpcError('rpc', msg, j.error.code, false);
        }
        return j.result;
      }
      throw lastErr || rpcError('unknown', 'RPC request failed.', null, true);
    }

    function getTx(sig) {
      if (cache.has(sig)) return cache.get(sig);
      var p = call('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])
        .then(function (r) { if (!r) cache.delete(sig); return r; }, function (e) { cache.delete(sig); throw e; });
      cache.set(sig, p);
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      return p;
    }

    return {
      call: call, getTx: getTx,
      hold: function () { holds++; }, release: function () { holds = Math.max(0, holds - 1); },
      held: function () { return holds > 0; }
    };
  }

  // ---------- orchestration ----------
  async function checkSandwich(rpc, sw, wallet) {
    var before = await rpc.call('getSignaturesForAddress', [sw.pool, { before: sw.sig, limit: 6, commitment: 'confirmed' }]);
    var cands = (before || []).filter(function (b) { return b.slot === sw.slot && !b.err; }).slice(0, 3);
    var front = null, fp = null;
    for (var i = 0; i < cands.length && !front; i++) {
      var t = parseTx(await rpc.getTx(cands[i].signature), cands[i].slot);
      var m = matchFront(t, sw, wallet);
      if (m) { front = m; fp = t; }
    }
    if (!front) return null;

    var after = null;
    try {
      var blk = await rpc.call('getBlock', [sw.slot, { encoding: 'json', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      var arr = (blk && blk.signatures) || [];
      var k = arr.indexOf(sw.sig);
      if (k !== -1) after = arr.slice(k + 1, k + 7);
    } catch (e) { if (e.fatal) throw e; }
    if (!after) {
      try {
        var later = await rpc.call('getSignaturesForAddress', [sw.pool, { until: sw.sig, limit: 1000, commitment: 'confirmed' }]);
        var same = (later || []).filter(function (x) { return x.slot === sw.slot; }).reverse();
        var reached = (later || []).length < 1000 || (later.length && later[later.length - 1].slot <= sw.slot);
        if (reached) after = same.slice(0, 6).map(function (x) { return x.signature; });
      } catch (e2) { if (e2.fatal) throw e2; }
    }
    if (!after) {
      return { confirmed: false, unverified: true, swap: sw, front: { sig: fp.sig, owner: front.owner }, back: null, lossLamports: null, botNetLamports: null };
    }
    var back = null, bp = null;
    for (var n = 0; n < after.length && !back; n++) {
      var bt = parseTx(await rpc.getTx(after[n]), sw.slot);
      var bm = matchBack(bt, sw, front.owner);
      if (bm) { back = bm; bp = bt; }
    }
    if (!back) return null;
    return {
      confirmed: true, swap: sw,
      front: { sig: fp.sig, owner: front.owner }, back: { sig: bp.sig },
      lossLamports: lossFor(fp, sw), botNetLamports: botNet(fp, bp, front.owner)
    };
  }

  async function scanWallet(rpc, wallet, o) {
    o = o || {};
    var on = o.onEvent || function () {};
    var cancelled = o.isCancelled || function () { return false; };
    var sigs = await rpc.call('getSignaturesForAddress', [wallet, { limit: o.depth || 50, commitment: 'confirmed' }]);
    sigs = sigs || [];
    var st = { wallet: wallet, total: sigs.length, read: 0, swaps: [], hits: [], unverified: [], errors: 0, done: false };
    on('start', st);
    for (var i = 0; i < sigs.length; i++) {
      if (cancelled()) break;
      var s = sigs[i];
      st.read++;
      if (s.err) { on('progress', st); continue; }
      var p = null;
      try { p = parseTx(await rpc.getTx(s.signature), s.slot); } catch (e) { if (e.fatal) throw e; st.errors++; }
      var sw = swapFor(p, wallet);
      if (sw) {
        st.swaps.push(sw);
        on('swap', st, sw);
        try {
          var r = await checkSandwich(rpc, sw, wallet);
          if (r) {
            sw.result = r;
            (r.confirmed ? st.hits : st.unverified).push(r);
            on('hit', st, r);
          }
        } catch (e3) { if (e3.fatal) throw e3; st.errors++; }
      }
      on('progress', st);
    }
    st.done = true;
    on('done', st);
    return st;
  }

  async function tune(rpc, mint, o) {
    o = o || {};
    var on = o.onProgress || function () {};
    var sigs = await rpc.call('getSignaturesForAddress', [mint, { limit: 40, commitment: 'confirmed' }]);
    var ok = (sigs || []).filter(function (s) { return !s.err; }).slice(0, o.sample || 24);
    var parsed = [];
    for (var i = 0; i < ok.length; i++) {
      try { parsed.push(parseTx(await rpc.getTx(ok[i].signature), ok[i].slot)); } catch (e) { if (e.fatal) throw e; }
      on(i + 1, ok.length);
    }
    return tuneFromTxs(parsed, mint, o.sizeSol, o.side, o.currentPct);
  }

  function createMonitor(rpc, o) {
    var running = false, last = 0, timer = null, interval = o.interval || 6000;
    var sleep = o.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    function schedule(ms) { clearTimeout(timer); if (running) timer = setTimeout(tick, ms); }
    async function tick() {
      if (!running) return;
      if (rpc.held() || (o.paused && o.paused())) return schedule(1500);
      try {
        var slot = await rpc.call('getSlot', [{ commitment: 'confirmed' }]);
        var target = slot - 2;
        if (target <= last) return schedule(2500);
        if (last && target - last > 40) last = target - 1;
        var blk = null, tries = 0;
        while (!blk && tries < 4) {
          try {
            blk = await rpc.call('getBlock', [target, { encoding: 'json', transactionDetails: 'accounts', rewards: false, maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
          } catch (e) {
            if (e.fatal) throw e;
            if (/skipped|not available|cleaned up|missing/i.test(e.message) || e.code === -32007 || e.code === -32009 || e.code === -32004) { target--; tries++; continue; }
            throw e;
          }
        }
        if (!blk) return schedule(interval);
        last = Math.max(last, target);
        var parsed = (blk.transactions || []).map(function (t) { var p = parseTx(t, target); if (p) p.time = blk.blockTime || null; return p; });
        var res = sandwichesInBlock(parsed);
        o.onBlock && o.onBlock({ slot: target, swaps: res.swaps, hits: res.hits, time: blk.blockTime || null });
        if (!running) return;
      } catch (e) {
        o.onError && o.onError(e);
        if (e.fatal) { running = false; o.onState && o.onState(false); return; }
      }
      schedule(interval);
    }
    return {
      start: function () { if (running) return; running = true; o.onState && o.onState(true); tick(); },
      stop: function () { running = false; clearTimeout(timer); o.onState && o.onState(false); },
      running: function () { return running; }
    };
  }

  var api = {
    PUMP: PUMP, PUMP_AMM: PUMP_AMM, WSOL: WSOL, LAMPORTS: LAMPORTS,
    CURVE_TOK_OFFSET: CURVE_TOK_OFFSET, CURVE_SOL_OFFSET: CURVE_SOL_OFFSET,
    parseTx: parseTx, swapFor: swapFor, reservesOf: reservesOf, findPool: findPool,
    matchFront: matchFront, matchBack: matchBack, lossFor: lossFor, botNet: botNet,
    sandwichesInBlock: sandwichesInBlock, tuneFromTxs: tuneFromTxs, quantile: quantile,
    createRpc: createRpc, checkSandwich: checkSandwich, scanWallet: scanWallet, tune: tune, createMonitor: createMonitor
  };
  root.LunchEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
