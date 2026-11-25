// Token Radar entrypoint: read the sealed snapshot, score every pre-token
// protocol with lib/model.ts, and write the ranked board plus the dashboard
// data, the dashboard files, the screenshots and the dossier to the output
// directory. Everything is deterministic: the same snapshot always yields
// byte-identical board.json, data.js and dossier.json.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
//
// With no --input it reads /input/snapshot.json (the grader's mount);
// with no --output it writes /output (MAKEFUN_OUTPUT_DIR overrides both).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The scorer's own caps: the text cap shapes the dossier bytes, the rest refuse.
const TEXT_CAP_BYTES = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// Pull `--name <value>` (or `--name=<value>`) out of argv, else the fallback.
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const glued = process.argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

const inputGiven = flag('input', '/input');
const inputPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const outputDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
// A snapshot with nothing to score is not a snapshot to score: refuse it
// before any output is written, so a bad input never leaves a stale board behind.
if (snapshot.protocols.length === 0) {
  process.stderr.write(`token radar: snapshot at ${inputPath} holds no protocols\n`);
  process.exit(2);
}
if (snapshot.watchlist.length === 0) {
  process.stderr.write(`token radar: snapshot at ${inputPath} has an empty watchlist\n`);
  process.exit(2);
}
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1);
}

// Copy one directory's plain files into `dest`, skipping dotfiles; returns names.
function copyDir(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(dest, name));
    names.push(name);
  }
  return names;
}

// Write every output file for a scored board, in a fixed order, and return the
// screenshot names that were copied. The board and data go first, then the
// dashboard and screenshots, and the dossier goes last: the scorer rebuilds it
// from this output and compares bytes, so nothing may be written after it.
function writeOutputs(outputDir: string, board: typeof board, radar: typeof radar): string[] {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

  copyDir(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
  const shots = copyDir(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(
      `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
    );
    process.exit(1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      process.stderr.write(
        `token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`,
      );
      process.exit(1);
    }
  }

  writeFileSync(
    join(outputDir, 'dossier.json'),
    buildDossier(outputDir, {
      text_max_bytes: TEXT_CAP_BYTES,
      screenshots: SHOT_CAP,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );
  return shots;
}

const shots = writeOutputs(outputDir, board, radar);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outputDir, 'board.json')}, ${join(outputDir, 'data.js')}, ${join(outputDir, 'dashboard')}, ${join(outputDir, 'screenshots')} (${shots.length} images) and ${join(outputDir, 'dossier.json')}\n`,
);
