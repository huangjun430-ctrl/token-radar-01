# Token Radar (radar-4)

[![Token Radar on make.fun](https://make.fun/badge/competition/token-radar-01)](https://make.fun/c/token-radar-01)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)

Token Radar ranks all 198 rankable pre-token protocols from the sealed
2026-11-14 snapshot by calibrated implied value, and answers "should I farm
this?" with launch odds, risk-adjusted value, a $/hr verdict, and a costed
6-step farm plan per row. The value model is a 7-model bake-off picked by
held-out error; the odds model is a logistic fit on all 758 protocols; every
number on the page is computed from the snapshot at build time.

## How the board is built

**Value (radar-3).** Seven candidates — category/global median, OLS global,
OLS per-category, OLS + chains (global and per-category), binned TVL-quartile
median, OLS quadratic — are fit on the 119 non-CEX live-token protocols and
compared by 5-fold held-out median absolute percentage error (folds:
slug-sorted, index mod 5). The winner (ols-global, 83.6%) sets the fitted
multiple, winsorized to the peer P5–P95 band; implied value = TVL × fitted
multiple × growth × maturity. The range is residual-based: fitted value
÷/× (1 + held-out MAPE), the model's typical error, not a confidence
interval. Coverage is all 198 rankable pre-token protocols (40 watchlist +
158 additional); 144 live tokens anchor the fit, the scatter and the
calibration plots.

**Launch odds, risk-adjusted value, verdicts (radar-4, new).** Launch odds
come from a deterministic IRLS logistic regression on all 758 protocols
(features: log10 TVL, log10 age, 7d change, chain count, category launch
rate), validated by 5-fold / walk-forward / leave-one-out AUC and Brier
score. The odds are a **snapshot-based launch propensity, a lower bound** —
the target is "has a token in the snapshot", so a protocol that launches
later still counts as 0; they are not the probability it will launch.
Risk-adjusted value = implied × odds. Each row's verdict (FARM NOW /
SELECTIVE / THIN / SKIP) comes from $/hr at the selected deposit (default
$5,000): airdrop pool 5% of implied value, farming deposits 20% of TVL,
opportunity cost 5% annual over 90 days, thresholds T1/T2 from the $/hr
distribution. Those four figures are assumptions, stated on the page.

**Validation.** The value bake-off reports 5-fold, walk-forward and
leave-one-out MAPE per candidate; the odds model reports AUC and Brier on
the same three splits; an ablation table lists every tried variant with
its MAPE and kept/rejected note. Nothing is hard-coded.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

The dashboard is offline-only: open `dashboard/index.html` in a browser.
