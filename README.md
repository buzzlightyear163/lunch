# LUNCH ($LUNCH)

"Bots ate your lunch." En sandwich-scanner för pump.fun och PumpSwap. Allt körs i webbläsaren mot publik Solana RPC, utan backend och utan API-nycklar.

## Vad som fungerar på riktigt
- **Lunch Check**: klistra in en wallet. Sajten läser de senaste transaktionerna, hittar swappar på pump.funs kurva och PumpSwap, letar efter samma wallet som köper före och säljer efter i samma block, och räknar ut förlusten genom att spela om traden på poolens reserver från före front-runnen. Varje träff länkar front-run, din tx och back-run på Solscan.
- **Slippage Tuner**: läser tokenens senaste ~24 trades, plockar bort bot-rundturer och föreslår snävaste slippage som brukar gå igenom.
- **Live monitor (beta)**: läser senaste blocket var 6:e sekund och flaggar sandwichar.

## Design
- `src/scenes.js`: 3D (three.js r128 från cdnjs). Hero med tre matta plattor som stängs till en sandwich när man scrollar, och en låst scroll-sekvens som visar attacken i ett block. Faller tillbaka till statiska bilder om WebGL saknas.
- `src/motion.js`: grain, sektioner som glider in, siffror som räknas upp och staplar som växer.

## Märkt som kommande
- LUNCHBOX (skyddat köp via Jito, fas 2) och Lunch money (fas 3). Inga siffror är påhittade.

## Innan launch
Öppna `src/app.js` och fyll i `CONFIG` högst upp: `ca`, `x`, `pumpfun`, `site`. Kör sedan `python3 build.py` så byggs `index.html` om.

## Deploy
`index.html` är hela sajten i en fil. Lägg mappen i ett GitHub-repo och importera i Vercel (inga build-steg behövs).

## RPC
Publik RPC (`api.mainnet-beta.solana.com`) är gratis men långsam och kan rate-limita. Vill du ha snabbare skanningar: lägg en egen endpoint i `CONFIG.rpc` (t.ex. Helius gratisnivå), eller låt besökare klistra in sin egen under "RPC endpoint" på sajten.

## Test
`node tests/engine.test.js` kör detektionen mot syntetiska pump.fun- och PumpSwap-transaktioner.
