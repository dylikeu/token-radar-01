# Token Radar v2 — pre-token protocols ranked by implied value

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Token Radar v2 reads a frozen DefiLlama snapshot of 758 protocols, finds the ones
that record no token, and ranks 197 of them by an implied launch value computed
from their own numbers — TVL, 7-day growth, months run with no token, and chain
breadth — with a concrete 7-step farm plan (cost and time on every step) for each.
The dashboard is a static page: sortable, filterable, with a detail view per
protocol that shows the four value factors and recomputes the value live, plus a
separate table of already-trading protocols shown only as valuation comparables.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22 or later, standard library only, no network. `main.ts` writes
`board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the
output directory. Open `out/dashboard/index.html` in a browser to use the radar.

## The model

`impliedValue(tvl, growth7d, monthsNoToken, chainCount)` in `lib/radar.ts`
(and mirrored in `dashboard/app.js`): TVL times a size multiple (0.55 under
$100m, 0.38 to $1b, 0.26 above), times a growth factor from the 7-day TVL change,
times an age factor of +1.8% per month with no token recorded (capped at 36
months), times a breadth factor of +1.2% per chain (capped at 12). No protocol
is ranked by name. Board eligibility follows the snapshot's own watchlist rule
(no CEX, bridge, liquid (re)staking or restaked-BTC product, no versioned or
wrapped/staked name, no exchange-named protocol). The board covers the full
40-protocol watchlist, plus every other eligible pre-token protocol.

## Bounty

Built for [token-radar-01 on make.fun](https://make.fun/bounty/token-radar-01)
— $1,325, closes 14 Dec 2026 10:00 UTC. Implied values are this entry's own
claim, never make.fun's; "records no token" means the snapshot's record carries
no token, not proof a protocol has none.
