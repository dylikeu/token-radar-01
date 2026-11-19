// Token Radar: read the sealed snapshot and turn it into a ranked launch radar.
//
// The snapshot lists every protocol DefiLlama tracks at or above $5M of TVL, plus
// the house watchlist of pre-token protocols at or above the $50M floor. This
// program scores each pre-token protocol with the model in lib/model.ts — implied
// value from the snapshot's own TVL, growth, age and chain breadth, priced off
// the live-token comparables — and writes the ranked board to board.json. It
// copies the dashboard and its screenshots into the output directory, writes
// the dashboard's data as data.js, and writes dossier.json last, using the
// vendored make.fun library, so the judge reads exactly the page the program built.
//
// On a developer machine the sealed paths do not exist, so MAKEFUN_OUTPUT_DIR
// stands in for /output, for example:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

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
import {
  assertBoardUsable,
  assertSnapshotUsable,
  boardIssue,
  buildRadar,
  dataScript,
  parseSnapshot,
  summarizeRun,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The most bytes of dashboard source the dossier's text may carry. */
const TEXT_MAX_BYTES = 65536;
const SCREENSHOT_CAPS = {
  max: 4,
  max_bytes: 524288,
};
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Write one error line to stderr and stop with the given exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value of a `--name value` or `--name=value` flag, or `fallback` when absent. */
function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  for (let i = 2; i < process.argv.length; i++) {
    const item = process.argv[i]!;
    if (item === flag) {
      const next = process.argv[i + 1];
      if (next !== undefined) return next;
    } else if (item.startsWith(`${flag}=`)) {
      return item.slice(flag.length + 1);
    }
  }
  return fallback;
}

/**
 * Copy the regular files of one directory into another, skipping dotfiles.
 * A missing source copies nothing. Returns the names copied, in directory order.
 */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outputFallback = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const out = arg('output', outputFallback);

const snapshotText = readFileSync(inputFile, 'utf8');
const snapshot = parseSnapshot(snapshotText);
const unusable = assertSnapshotUsable(snapshot);
if (unusable !== null) {
  fail(`snapshot unusable: ${unusable}`, 1);
}
const built = buildRadar(snapshot);
const board = built.board;
const radar = built.radar;
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`the model wrote a board the gate refuses: ${issue}`, 1);
}
const usable = assertBoardUsable(board, snapshot);
if (usable !== null) {
  fail(`the model wrote a board the gate refuses: ${usable}`, 1);
}

mkdirSync(out, { recursive: true });
const boardText = JSON.stringify({ rows: board });
writeFileSync(join(out, 'board.json'), `${boardText}\n`, 'utf8');
const dataText = dataScript(radar);
writeFileSync(join(out, 'data.js'), dataText, 'utf8');

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  const word = shots.length === 1 ? 'image' : 'images';
  fail(`screenshots/ holds ${shots.length} ${word}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

const dossier = buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4194304 },
});
writeFileSync(join(out, 'dossier.json'), dossier);

const lines = summarizeRun(snapshot, board, radar, shots, dashboardFiles, out);
for (const line of lines) process.stdout.write(`${line}\n`);
