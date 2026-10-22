// Run: node tests/engine.test.js
// Builds pump.fun-style transactions from constant-product math and checks that the engine
// finds the sandwich, prices the loss correctly and ignores normal trades.
const assert = require('assert');
const E = require('../src/engine.js');

const USER = 'User1111111111111111111111111111111111111111';
const BOT = 'Bot11111111111111111111111111111111111111111';
const OTHER = 'Other111111111111111111111111111111111111111';
const CURVE = 'Curve11111111111111111111111111111111111111';
const POOL = 'Pool111111111111111111111111111111111111111';
const MINT = 'Mint1111111111111111111111111111111111111pump';

let n = 0;
const sig = (s) => s + '_' + (++n);

// --- a tiny pump.fun curve simulator (virtual reserves, no fees on the curve itself) ---
function curve(realSol, realTok) {
  return { sol: realSol, tok: realTok };
}
function vx(c) { return c.sol + E.CURVE_SOL_OFFSET; }
function vy(c) { return c.tok + E.CURVE_TOK_OFFSET; }

function buyOnCurve(c, owner, solIn, holdings, s, slot, extra = {}) {
  const x = vx(c), y = vy(c);
  const out = Math.floor(y - (x * y) / (x + solIn));
  const pre = { sol: c.sol, tok: c.tok };
  c.sol += solIn; c.tok -= out;
  const hPre = holdings[owner] || 0; holdings[owner] = hPre + out;
  return mk(s, slot, owner, pre, c, [[owner, hPre, holdings[owner]]], -solIn - 5000, extra);
}
function sellOnCurve(c, owner, tokIn, holdings, s, slot, extra = {}) {
  const x = vx(c), y = vy(c);
  const out = Math.floor(x - (x * y) / (y + tokIn));
  const pre = { sol: c.sol, tok: c.tok };
  c.sol -= out; c.tok += tokIn;
  const hPre = holdings[owner] || 0; holdings[owner] = hPre - tokIn;
  return mk(s, slot, owner, pre, c, [[owner, hPre, holdings[owner]]], out - 5000, extra);
}
function mk(s, slot, owner, poolPre, poolPost, holders, ownerLamDelta, extra) {
  // keys: owner (signer), curve, mint, pump program  -> "json" encoding (strings)
  const keys = [owner, CURVE, MINT, E.PUMP];
  const preB = [10e9, poolPre.sol + 1e6, 1e6, 1];
  const postB = [10e9 + ownerLamDelta, poolPost.sol + 1e6, 1e6, 1];
  const tb = (acctIdx, mint, own, amt) => ({ accountIndex: acctIdx, mint, owner: own, uiTokenAmount: { amount: String(amt), decimals: 6 } });
  const preT = [tb(10, MINT, CURVE, poolPre.tok)];
  const postT = [tb(10, MINT, CURVE, poolPost.tok)];
  holders.forEach(([o, a, b], i) => { preT.push(tb(11 + i, MINT, o, a)); postT.push(tb(11 + i, MINT, o, b)); });
  return {
    slot, blockTime: 1760000000 + slot,
    transaction: { signatures: [s], message: { accountKeys: keys } },
    meta: { err: extra.err || null, fee: 5000, preBalances: preB, postBalances: postB, preTokenBalances: preT, postTokenBalances: postT, loadedAddresses: { writable: [], readonly: [] } }
  };
}

// ---------- 1. unit: sandwich on the bonding curve ----------
{
  const c = curve(10e9, 600e12);
  const h = {};
  const SLOT = 400000100;
  const f = buyOnCurve(c, BOT, 2e9, h, sig('front'), SLOT);
  const xAfterFront = vx(c), yAfterFront = vy(c);
  const u = buyOnCurve(c, USER, 1e9, h, sig('user'), SLOT);
  const b = sellOnCurve(c, BOT, h[BOT], h, sig('back'), SLOT);

  const pf = E.parseTx(f), pu = E.parseTx(u), pb = E.parseTx(b);
  const sw = E.swapFor(pu, USER);
  assert(sw, 'user swap detected');
  assert.strictEqual(sw.side, 'buy');
  assert.strictEqual(sw.pool, CURVE);
  assert.strictEqual(sw.kind, 'curve');
  assert.strictEqual(sw.sizeLamports, 1e9);

  const front = E.matchFront(pf, sw, USER);
  assert(front && front.owner === BOT, 'front-run matched to bot');
  const back = E.matchBack(pb, sw, BOT);
  assert(back, 'back-run matched');
  assert.strictEqual(E.matchFront(pb, sw, USER), null, 'a sell is not a front-run of a buy');

  // expected loss: SOL the user would have needed for the same tokens before the bot moved the price
  const tokensGot = h[USER];
  const x0 = 10e9 + E.CURVE_SOL_OFFSET, y0 = 600e12 + E.CURVE_TOK_OFFSET;
  const s0 = (x0 * tokensGot) / (y0 - tokensGot);
  const expected = 1e9 - s0;
  const loss = E.lossFor(pf, sw);
  assert(Math.abs(loss - expected) / expected < 1e-3, `loss ${loss} ≈ ${expected}`);
  console.log('curve sandwich: user lost', (loss / 1e9).toFixed(6), 'SOL on a 1 SOL buy (bot bought 2 SOL first)');

  const net = E.botNet(pf, pb, BOT);
  assert(net > 0, 'bot made money');
  console.log('bot net', (net / 1e9).toFixed(6), 'SOL');

  // block scan finds it, and only it
  const noise = buyOnCurve(c, OTHER, 0.3e9, h, sig('noise'), SLOT);
  const res = E.sandwichesInBlock([pf, pu, pb, E.parseTx(noise)]);
  assert.strictEqual(res.swaps, 4);
  assert.strictEqual(res.hits.length, 1, 'one sandwich in block');
  assert.strictEqual(res.hits[0].bot, BOT);
  assert.strictEqual(res.hits[0].victim, USER);
  assert(Math.abs(res.hits[0].lossLamports - expected) / expected < 1e-3);
}

// ---------- 2. unit: two normal buyers in a row are not a sandwich ----------
{
  const c = curve(5e9, 700e12);
  const h = {};
  const a = E.parseTx(buyOnCurve(c, OTHER, 1e9, h, sig('a'), 5));
  const u = E.parseTx(buyOnCurve(c, USER, 1e9, h, sig('u'), 5));
  const z = E.parseTx(buyOnCurve(c, BOT, 1e9, h, sig('z'), 5));
  const res = E.sandwichesInBlock([a, u, z]);
  assert.strictEqual(res.hits.length, 0, 'no false positive');
}

// ---------- 3. unit: sandwich on a PumpSwap pool (WSOL quote, 0.25% LP fee kept in pool) ----------
{
  const FEE = 0.0025;
  let X = 80e9, Y = 200e12; // WSOL, tokens
  const tb = (i, mint, owner, amt) => ({ accountIndex: i, mint, owner, uiTokenAmount: { amount: String(Math.round(amt)), decimals: mint === E.WSOL ? 9 : 6 } });
  function swapAmm(owner, side, amount, holdings, s) {
    const preX = X, preY = Y;
    let dx, dy;
    if (side === 'buy') { const inEff = amount * (1 - FEE); dy = Y - (X * Y) / (X + inEff); X += amount; Y -= dy; dx = amount; }
    else { const inEff = amount * (1 - FEE); dx = X - (X * Y) / (Y + inEff); Y += amount; X -= dx; dy = amount; }
    const hPre = holdings[owner] || 0;
    holdings[owner] = side === 'buy' ? hPre + dy : hPre - amount;
    return {
      slot: 77, blockTime: 1760000077,
      transaction: { signatures: [s], message: { accountKeys: [{ pubkey: owner }, { pubkey: POOL }, { pubkey: E.PUMP_AMM }] } },
      meta: {
        err: null, preBalances: [5e9, 1e6, 1], postBalances: [5e9, 1e6, 1],
        preTokenBalances: [tb(3, E.WSOL, POOL, preX), tb(4, MINT, POOL, preY), tb(5, MINT, owner, hPre)],
        postTokenBalances: [tb(3, E.WSOL, POOL, X), tb(4, MINT, POOL, Y), tb(5, MINT, owner, holdings[owner])]
      }
    };
  }
  const h = {};
  const x0 = X, y0 = Y;
  const f = E.parseTx(swapAmm(BOT, 'buy', 5e9, h, sig('af')));
  const u = E.parseTx(swapAmm(USER, 'buy', 2e9, h, sig('au')));
  const b = E.parseTx(swapAmm(BOT, 'sell', h[BOT], h, sig('ab')));
  const sw = E.swapFor(u, USER);
  assert.strictEqual(sw.kind, 'amm');
  assert.strictEqual(sw.pool, POOL);
  const loss = E.lossFor(f, sw);
  // reference: SOL the user would have paid (fee included) for the same tokens on the untouched pool
  const tokGot = h[USER];
  const refLossSol = 2e9 - ((x0 * tokGot) / (y0 - tokGot)) / (1 - FEE);
  assert(Math.abs(loss - refLossSol) / refLossSol < 0.02, `amm loss ${loss} ≈ ${refLossSol}`);
  const res = E.sandwichesInBlock([f, u, b]);
  assert.strictEqual(res.hits.length, 1);
  console.log('PumpSwap sandwich: user lost', (loss / 1e9).toFixed(6), 'SOL on a 2 SOL buy');
}

// ---------- 4. integration: scanWallet against a fake RPC ----------
(async () => {
  const c = curve(20e9, 500e12);
  const h = {};
  const txs = new Map();
  const blocks = new Map();      // slot -> ordered signatures
  const byAddr = new Map();      // address -> [{signature, slot, err}] newest first
  function put(tx, addrs) {
    const s = tx.transaction.signatures[0];
    txs.set(s, tx);
    if (!blocks.has(tx.slot)) blocks.set(tx.slot, []);
    blocks.get(tx.slot).push(s);
    addrs.forEach((a) => { if (!byAddr.has(a)) byAddr.set(a, []); byAddr.get(a).unshift({ signature: s, slot: tx.slot, err: tx.meta.err }); });
  }
  // slot 100: clean user buy
  put(buyOnCurve(c, OTHER, 0.5e9, h, sig('o1'), 100), [OTHER, CURVE]);
  put(buyOnCurve(c, USER, 0.4e9, h, sig('u1'), 100), [USER, CURVE]);
  // slot 101: sandwiched user buy
  put(buyOnCurve(c, BOT, 3e9, h, sig('f'), 101), [BOT, CURVE]);
  put(buyOnCurve(c, USER, 1.5e9, h, sig('u2'), 101), [USER, CURVE]);
  put(sellOnCurve(c, BOT, h[BOT], h, sig('b'), 101), [BOT, CURVE]);
  put(buyOnCurve(c, OTHER, 0.2e9, h, sig('o2'), 101), [OTHER, CURVE]);
  // slot 102: a failed tx and a non-swap
  put(buyOnCurve(c, USER, 0.1e9, h, sig('fail'), 102, { err: { InstructionError: [0, 'x'] } }), [USER]);

  const calls = {};
  const fakeFetch = async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls[method] = (calls[method] || 0) + 1;
    let result = null;
    if (method === 'getSignaturesForAddress') {
      const [addr, o] = params;
      let list = (byAddr.get(addr) || []).slice();
      if (o.before) { const i = list.findIndex((x) => x.signature === o.before); list = i === -1 ? [] : list.slice(i + 1); }
      if (o.until) { const i = list.findIndex((x) => x.signature === o.until); list = i === -1 ? list : list.slice(0, i); }
      result = list.slice(0, o.limit || 1000);
    } else if (method === 'getTransaction') {
      result = txs.get(params[0]) || null;
    } else if (method === 'getBlock') {
      result = { signatures: blocks.get(params[0]) || [], blockTime: 1 };
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
  const rpc = E.createRpc(() => 'http://fake', { fetch: fakeFetch, gap: 0, sleep: async () => {} });
  const st = await E.scanWallet(rpc, USER, { depth: 50 });
  assert.strictEqual(st.swaps.length, 2, 'two successful swaps');
  assert.strictEqual(st.hits.length, 1, 'one sandwich');
  assert.strictEqual(st.hits[0].front.owner, BOT);
  assert(st.hits[0].lossLamports > 0);
  console.log('scanWallet: swaps', st.swaps.length, 'sandwiches', st.hits.length, 'loss', (st.hits[0].lossLamports / 1e9).toFixed(6), 'SOL', 'rpc calls', JSON.stringify(calls));

  // tuner on the same curve
  byAddr.set(MINT, [...txs.values()].filter((t) => !t.meta.err).map((t) => ({ signature: t.transaction.signatures[0], slot: t.slot, err: null })).reverse());
  const tr = await E.tune(rpc, MINT, { sizeSol: 0.5, side: 'buy', currentPct: 20 });
  assert(tr && tr.pool === CURVE && tr.recPct >= 1, 'tuner result');
  console.log('tuner:', JSON.stringify({ rec: tr.recPct, impact: tr.impactPct.toFixed(3), p90: tr.p90Pct.toFixed(3), trades: tr.trades, quiet: tr.quiet }));

  // rate-limit handling: 429 twice then success
  let k = 0;
  const flaky = async (u, init) => (++k <= 2 ? { ok: false, status: 429, json: async () => ({}) } : fakeFetch(u, init));
  const rpc2 = E.createRpc(() => 'x', { fetch: flaky, gap: 0, sleep: async () => {} });
  const r2 = await rpc2.call('getTransaction', [sig('nope')]);
  assert.strictEqual(r2, null);
  // network failure surfaces as fatal
  const rpc3 = E.createRpc(() => 'x', { fetch: async () => { throw new TypeError('Failed to fetch'); }, gap: 0, sleep: async () => {} });
  await assert.rejects(() => rpc3.call('getSlot', []), (e) => e.fatal && e.kind === 'network');
  console.log('all engine tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
