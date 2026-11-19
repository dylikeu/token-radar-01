# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dylikeu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it ranks pre-token protocols by implied value and gives each one a farm plan.

Implied value comes from the snapshot's own figures. Each protocol's TVL is priced off the median market-cap / TVL of the live-token protocols in its category — the comparables — then adjusted for seven-day growth, for how long it has run with no token, and for how many chains it runs on. The board holds 198 pre-token rows: the 40 on the watchlist plus the 158 below the floor that the radar exists to find. Live-token protocols are set aside with their market caps shown instead of modelled. Every row carries a seven-step farm plan with what each step costs and how long it takes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That reads the sealed snapshot, writes `out/board.json` and `out/data.js`, copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json` last. It needs Node 22 or later, standard library only, nothing to install.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, scores it, writes the output.
- `lib/model.ts` — the value model and the farm plans.
- `dashboard/` — the page: `index.html`, `app.js`, `app.css`.
- `screenshots/` — the board, a detail view and a filtered view.
- `vendor/makefun-board.ts` — the vendored make.fun dossier library.

## License

Licensed under the terms in `LICENSE`.
