# The Farmable Radar — a token launch radar that ranks what can actually be farmed

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Entry for [Build the best token launch radar](https://make.fun/bounty/token-radar-01) on make.fun.

Every pre-token protocol in the sealed snapshot, ranked by **farmable expected value**: the fitted launch value, times the token odds from its peers' record, times a farmability gate of 1 or 0. A board ranked by size alone puts exchanges and bridges on top, and none of those can be farmed for a new launch. This board puts them at the bottom, with the reason shown, and ranks the farmable protocols first.

## Run

```sh
node main.ts --input <snapshot.json>
```

Reads the snapshot and writes `board.json`, `data.js`, `dashboard/` (index.html, app.css, app.js, validation.json), `screenshots/` (copied in) and `dossier.json` to `$MAKEFUN_OUTPUT_DIR` (default `/output`). Node 22, standard library only, no network, deterministic — two runs from the same snapshot bytes produce byte-identical output.

To build the screenshots first, open `dashboard/index.html` next to `data.js` in a browser (the data script is loaded with a relative path) and capture:

- `1-board.png` — the full board
- `2-detail.png` — `#detail/bittensor-dtao`
- `3-filtered.png` — `#filter/verdict=FARM`

at 1440×900, then run `main.ts` again so it copies them in and builds `dossier.json`.

## How the board is built

1. **Fitted value.** A ridge regression of log market cap on the snapshot's own figures, fitted at runtime on the 119 traded protocols (market cap recorded, exchanges excluded): `ln fitted = 11.2389 + 0.2750 × ln(TVL) − 0.0332 × g`, where g is the clamped seven-day growth divided by 100. λ = 30, chosen by leave-one-out cross-validation over the grid 0.03…100.
2. **Every term tested twice, or dropped.** Six candidate terms faced two blind tests each — leave-one-out and a walk-forward split (fit on the older half of traded protocols, predict the newer half). A term survives only when removing it makes *both* tests worse. Survivors: log TVL and seven-day growth. Dropped: log TVL squared, log age, log chain count, category dummies. Growth survives by 0.01–0.06 points — a marginal keep, not a driver; the dashboard says so.
3. **Token odds.** The share of mature peers in a protocol's own category (listed at least a year before the snapshot) that record a token, Laplace-smoothed (α = 10) toward the global mature rate of 0.567. Categories with fewer than three mature peers take the global rate.
4. **Farmability gate.** Farmable is 0 for exchanges, bridges (bridge / canonical bridge / cross chain bridge), wrapped or staked products of something that trades, and stablecoins — by a stated rule applied to every row alike, no name special-cased. A farmable-0 row has an expected value of $0, shown as $1 so the board stays a ranking, and sits at the bottom with its reason. 194 rows are farmable, 148 are not; the only watchlist protocol that is not farmable is USDD (a stablecoin that already trades).
5. **Conformal intervals.** The 80% interval on each row is the 80% quantile of the leave-one-out residuals, per category where the category has at least eight traded protocols, else the pooled quantile. Coverage on the traded protocols: 84% (target 80%).
6. **Verdicts.** FARM: farmable expected value ≥ $10M. THIN: $3M–$10M. SKIP: below $3M or not farmable. Thresholds are set from this snapshot's own distribution of expected values.

## The honest numbers (snapshot 2026-11-14, 342 pre-token protocols)

- R² (log scale, in-sample): **0.119**
- Leave-one-out median error: **81.18%**; walk-forward median error: **78.32%**
- The median-market-cap baseline errs by 82.57% — this model beats it by 1.02× leave-one-out and 1.05× walk-forward.
- Verdicts: **FARM 3, THIN 167, SKIP 172.** Top three: Bittensor dTAO ($12.94M), Figure Markets Prime ($10.70M), Veda ($10.18M).
- The board's strength is the farmability gate, the per-term blind tests, the conformal intervals and the per-row equation — not predictive power. Market cap is only weakly predictable from these figures, and the dashboard states that plainly.

## What's inside

- `main.ts` — the entrypoint: reads the snapshot, runs the model, writes every output file.
- `lib/linalg.ts` — the small linear-algebra helpers (Gauss–Jordan with partial pivoting).
- `lib/model.ts` — the whole model: parsing, ridge + leave-one-out + walk-forward, term selection, token odds, farmability, conformal intervals, farm steps, the board, the dossier inputs.
- `vendor/makefun-board.ts` — the house board validator and dossier builder (from the competition kit, unchanged).
- `dashboard/` — a static page: the ranked board, a detail view per protocol with its equation, a filter, the method with its validation tables, and the live tokens set aside.
- `screenshots/` — the three board captures the judge reads.

## License

MIT. Referral: https://make.fun/r/ec115nvc
