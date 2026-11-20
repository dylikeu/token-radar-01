# Token Launch Radar — v3

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Every protocol in the snapshot that records no token — all 342 of them, the
40-protocol watchlist included — ranked by an implied value that is **fitted
from the snapshot's own traded protocols**, not a hand-picked multiple.

## The model

`fitCompsCurve` (in `lib/radar.ts`) regresses log market cap on log TVL, its
square, clamped 7-day growth, log age since listing, and one dummy per
category with at least five traded comps, ridge-regularised (λ = 3). It trains
on the snapshot's 128 traded protocols at run time; no coefficient is chosen
by hand and no protocol name is ever special-cased.

`impliedValueFromComps` prices each pre-token protocol from that curve and
gives a P10–P90 range from the fit's residual spread. `tokenOddsByAge` gives
the empirical share of protocols that record a token in each age-since-listing
bucket. The verdict is expected value — implied value × token odds — under the
rule stated on the dashboard: FARM at $15,000,000 or more, THIN at $3,000,000 or
more, otherwise SKIP.

`validateCompsFit` checks the fit two ways and the dashboard shows both:
a held-out fifth of traded comps (every 5th by slug) and leave-one-out refits
over all comps. On this snapshot the fit reports R² 0.256, a held-out median
error of 74.5% and a leave-one-out median error of 87.6% — wide, and the
dashboard says so plainly instead of hiding it behind a point estimate.

## Farm plans

`buildFarmPlan` derives seven steps per protocol from its own record —
category picks the action verb (vault deposit, LP, lending supply+borrow,
staking, bridging, perps margin, and so on), the primary chain picks where,
the TVL tier picks the deposit size, age picks the hold window, and 7-day
growth picks the urgency. Every step states a cost in dollars and a time,
and the protocol's name appears in every step.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

`main.ts` reads the snapshot, writes `board.json` (342 rows) and `data.js`
from the same in-memory rows, copies `dashboard/` and `screenshots/` to the
output, and writes `dossier.json` with `buildDossier` from
`vendor/makefun-board.ts`. Node 22, standard library only, no network, and
two runs write byte-identical output.

## Layout

- `main.ts` — entrypoint
- `lib/radar.ts` — snapshot parsing, the fitted comps model, token odds, farm plans, board building
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`
- `screenshots/` — board, detail and filtered views

MIT licensed. A protocol "records no token" when its market cap, CoinGecko id
and symbol are all null in the snapshot — that is not proof it has none.
Nothing here is investment advice.
