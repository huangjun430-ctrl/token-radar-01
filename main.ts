// Token Radar (radar-4): read the sealed snapshot, fit the calibrated value
// model (7-model bake-off, 5-fold / walk-forward / leave-one-out) with P5–P95
// winsorized multiples and residual-based ranges, fit the IRLS logistic
// launch-propensity model on all 758 protocols, then score risk-adjusted
// values, numeric farm costs and hours, $/hr and data-derived verdicts.
// Writes board.json, data.js, dashboard/00-validation.json, copies the
// dashboard and screenshots, and builds dossier.json from the vendored
// make.fun library. Two runs are byte-identical by construction: no
// randomness, no wall-clock, no unseeded sampling anywhere.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, validationReportJson } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Caps the scorer applies to the dossier; only the text cap shapes the bytes. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
/** A plain file name, as the dossier requires for screenshots and dashboard files. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of --name <value>, or the fallback when the flag is absent. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Copy every regular file from src into dst (creating dst); returns the names copied. */
function copyDir(src: string, dst: string): string[] {
  mkdirSync(dst, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(src).sort()) {
    const from = join(src, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(dst, name));
    copied.push(name);
  }
  return copied;
}

/** Copy the screenshots, refusing any name the dossier would refuse. */
function copyScreenshots(src: string, dst: string): string[] {
  mkdirSync(dst, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(src).sort()) {
    if (!PLAIN_NAME.test(name)) throw new Error(`screenshot name not plain: ${name}`);
    const from = join(src, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(dst, name));
    copied.push(name);
  }
  if (copied.length === 0) throw new Error('screenshots/ is empty');
  return copied;
}

function main(): void {
  const input = arg('input', '/input/snapshot.json');
  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const inputPath = existsSync(input) && statSync(input).isDirectory() ? join(input, 'snapshot.json') : input;
  const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error('board invalid: ' + issue);

  mkdirSync(out, { recursive: true });
  const boardPath = join(out, 'board.json');
  const dataPath = join(out, 'data.js');
  const dashboardDir = join(out, 'dashboard');
  const screenshotsDir = join(out, 'screenshots');
  mkdirSync(dashboardDir, { recursive: true });
  writeFileSync(boardPath, JSON.stringify({ rows: board }, null, 2) + '\n');
  writeFileSync(dataPath, dataScript(radar));
  writeFileSync(join(dashboardDir, '00-validation.json'), validationReportJson(radar));
  copyDir(join(here, 'dashboard'), dashboardDir);
  const shots = copyScreenshots(join(here, 'screenshots'), screenshotsDir);
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS }));

  const rows = board;
  const verdicts: Record<string, number> = {};
  for (const row of rows) verdicts[row.verdict] = (verdicts[row.verdict] ?? 0) + 1;
  const cal = radar.calibration;
  process.stdout.write(
    `token radar (radar-4): ${snapshot.protocols.length} protocols, ${rows.length} rows ranked\n` +
    `token radar: value winner=${cal.winner} (5-fold MAPE ${cal.winner_mape}%), odds 5-fold AUC=${cal.odds_model.cv5.auc} Brier=${cal.odds_model.cv5.brier}\n` +
    `token radar: verdicts at $${cal.verdicts.default_deposit_usd}: ${verdicts['FARM NOW'] ?? 0} FARM NOW, ${verdicts.SELECTIVE ?? 0} SELECTIVE, ${verdicts.THIN ?? 0} THIN, ${verdicts.SKIP ?? 0} SKIP (T1=$${cal.verdicts.t1_farm_now}/h, T2=$${cal.verdicts.t2_selective}/h)\n` +
    `token radar: wrote ${boardPath}, ${dataPath}, ${dashboardDir}, ${screenshotsDir} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

main();

// Token Radar v7 (radar-4) — submit build: entrypoint authored in two passes.
