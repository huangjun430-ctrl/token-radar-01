// Token Radar (radar-4): reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// runs the deterministic 7-model value bake-off (5-fold CV, walk-forward, LOO) with P5-P95 winsorized
// multiples and residual-based ranges, fits the IRLS logistic launch-propensity model on all snapshot
// protocols, computes risk-adjusted values, numeric farm costs/hours, $/hr and data-derived verdicts,
// writes /output/board.json, /output/data.js, /output/dashboard/00-validation.json, copies dashboard/
// and screenshots/, and builds /output/dossier.json via the unmodified vendored make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, validationReportJson } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// Embed build-time bake-off (5-fold/WF/LOO), ablation, odds model validation, verdicts, and
// exclusion counts into /output/dashboard/00-validation.json so dossier.json carries them verbatim.
writeFileSync(join(out, 'dashboard', '00-validation.json'), validationReportJson(radar));

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const cal = radar.calibration;
const om = cal.odds_model;
const ex = radar.exclusions;
const vc = cal.verdicts.counts;
process.stdout.write(
  `token radar (${radar.model_version}): ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ${board.length} rows ranked (${radar.early_size} additional rankable, ${ex.excluded_total} excluded, ${radar.live_size} live tokens)\n` +
    `token radar: value winner=${cal.winner} (5-fold MAPE ${cal.winner_mape.toFixed(2)}% vs median ${cal.median_mape.toFixed(2)}%), odds 5-fold AUC=${om.cv5.auc.toFixed(3)} Brier=${om.cv5.brier.toFixed(4)} (base ${om.cv5.base_brier.toFixed(4)})\n` +
    `token radar: verdicts at $${cal.verdicts.default_deposit_usd}: ${vc['FARM NOW']} FARM NOW, ${vc.SELECTIVE} SELECTIVE, ${vc.THIN} THIN, ${vc.SKIP} SKIP (T1=$${cal.verdicts.t1_farm_now}/h, T2=$${cal.verdicts.t2_selective}/h)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);

// Token Radar v7 (radar-4) — submit build.
