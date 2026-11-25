# Token Radar — radar-4: calibrated launch pricing, launch odds, risk-adjusted value & farming verdicts

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/huangjun430-ctrl/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/huangjun430-ctrl/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A deterministic, offline token launch radar that ranks every rankable pre-token protocol by calibrated implied value, pairs it with snapshot-calibrated launch propensity (`launch_odds`), risk-adjusted expected value (`implied × odds`), live what-if farming `$/hr` economics, and data-derived verdicts (`FARM NOW`, `SELECTIVE`, `THIN`, `SKIP`).

## How the board is built

### Calibrated value model (radar-3 foundation)
At build time, `main.ts` reads the sealed snapshot and calibrates the valuation model exclusively on non-CEX, market-cap-bearing live-token protocols (TVL > 0, market cap > 0) using a deterministic 7-model bake-off: category/global median (`median`), log-linear global OLS (`ols-global`), per-category OLS for categories with ≥10 peers (`ols-category`), global and per-category OLS with `log(n_chains)` (`ols-global-chains`, `ols-category-chains`), TVL-quartile median (`binned-median`), and global quadratic log-TVL OLS (`ols-quad`). Inside every non-median candidate (both in cross-validation and final scoring), predicted multiples are winsorized to the peer group's `[P5, P95]` band. The winner is selected by lowest 5-fold held-out median absolute percentage error (MAPE, sorted by slug, `fold = index mod 5`), breaking ties within 1 percentage point in favor of fewer parameters.

Each pre-token protocol is priced as `TVL × winsorized fitted multiple × growth × maturity` (7-day TVL growth clamped −60%…+120% at half weight; maturity 0.6→1.0 over 3 years; unknown age = 365 days). Uncertainty ranges (`implied_low_usd`–`implied_high_usd`) express the model's typical held-out error as `fitted value ÷/× (1 + held-out MAPE)`, using category held-out MAPE whenever measured and the winning model's global MAPE otherwise (this is a median prediction-error band holding roughly half of outcomes, not a formal confidence interval; peer P25–P75 market spread remains visible in each detail view's peer table). The board ranks every watchlist slug plus every other rankable pre-token protocol (keeping wrapped/staked/bridged, versioned-pool, and exchange exclusions intact and audited in `dossier.json`).

### New in v6 (`radar-4`): launch odds, risk-adjusted value, farming verdicts & 3-way validation
- **Launch odds (honest snapshot propensity):** A deterministic IRLS logistic regression is fitted on **all** snapshot protocols (`has token = 1`, `pre-token = 0`) using 6 features: intercept, `log10(max(TVL, 1))`, `log10(max(age_days, 1))`, 7-day TVL change (decimal), chain count, and category launch rate (categories with <5 protocols fall back to the global launch rate). Because the target is *has a token in the snapshot*, a pre-token protocol that launches later is coded as `0`; `launch_odds` is therefore a **launch propensity measured on the snapshot — a lower bound on true launch probability**, never presented as "the probability it will launch". Predictions are clipped to `[0.01, 0.99]`.
- **Risk-adjusted value:** Every row reports `risk_adj_usd = round(implied_value_usd × launch_odds)` as its own sortable column and detail formula clause, while the board remains ranked strictly by `implied_value_usd` (with 5-fold refit rank ranges `#N (min–max)`).
- **Verdicts & farming `$/hr` (with live what-if deposit picker):** Each 6-step farm plan carries explicit gas-only sunk `cost_usd` (capital is never counted as a cost) and active `hours` over the plan's hold window. Using four stated assumptions — **airdrop pool = 5% of implied value, farming deposits = 20% of TVL, opportunity cost = 5% APR over 90 days, deposit = user-selected what-if amount (default `$5,000`)** — each row computes `expected_airdrop = pool × (deposit / farming_deposits) × odds`, `net = expected_airdrop − farm_cost − opp_cost`, and `$/hr = net / farm_hours`. Thresholds `T1 = max($25/hr, P80)` and `T2 = min(T1, max($0, P50))` are derived from the default `$5,000` distribution (`≥ T1 → FARM NOW`, `≥ T2 → SELECTIVE`, `≥ $0 → THIN`, else `SKIP`) and stay fixed when the user switches deposit (`$1K / $5K / $10K / $25K`) live in the browser.
- **Three validation protocols & ablation:** Both the value model (MAPE) and the odds model (ROC AUC & Brier vs base rate) are evaluated across **5-fold CV** (slug-sorted, `index mod 5`), **walk-forward** (split at median listing date; missing dates in train), and **leave-one-out (LOO)** across all protocols, alongside a 5-fold quintile odds calibration table and a model ablation table (including an evaluated `ols-global + odds` variant). All validation outputs are written deterministically to `out/dashboard/00-validation.json` and embedded into `dossier.json`. Open the offline dashboard at [`dashboard/index.html`](dashboard/index.html) after building.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=pybzwbka&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
