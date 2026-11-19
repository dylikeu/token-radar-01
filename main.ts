// Token Radar v2 — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the
// model in lib/radar.ts, and writes the entry's outputs:
//
//   /output/board.json     the ranked board (the gate reads this)
//   /output/data.js        the same board, as window.RADAR, for the page
//   /output/dashboard/    a copy of this repo's dashboard/
//   /output/screenshots/  a copy of this repo's screenshots/
//   /output/dossier.json  buildDossier's summary, written last
//
// Run it outside the grader with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
//
// It is deterministic: the same snapshot bytes always write the same
// output bytes, so the grader's two runs agree.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1]!;
    if (args[i]!.startsWith(`--${name}=`)) return args[i]!.slice(name.length + 3);
  }
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(`token-radar-v2: ${message}\n`);
  process.exit(1);
}

const inputGiven = flag('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory>`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
} catch (err) {
  fail(`cannot read the snapshot: ${(err as Error).message}`);
}
const radar = buildRadar(snapshot);
const problem = boardIssue(radar, snapshot);
if (problem !== null) fail(`the board fails its own gate: ${problem}`);

/** Copy a directory's regular files, skipping dot-names, and list what landed. */
function copyDir(fromDir: string, toDir: string): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const landed: string[] = [];
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const from = join(fromDir, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(toDir, name));
    landed.push(name);
  }
  return landed;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: radar.rows, meta: radar.meta })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dashFiles = copyDir(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashFiles.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashFiles.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no .js file');

const shots = copyDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
}
const shotName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) if (!shotName.test(name)) fail(`screenshots/${name} is not a plain file name`);

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const watchRows = radar.rows.filter((r) => r.status === 'watchlist').length;
process.stdout.write(
  `token-radar-v2: ${radar.meta.scanned} protocols scanned, ${radar.meta.pre_token} record no token, ` +
    `${radar.meta.watchlist} on the watchlist, ${radar.rows.length} rows ranked (${watchRows} watchlist)\n` +
    `token-radar-v2: rank 1 is ${radar.rows[0]!.slug} at $${radar.rows[0]!.implied_value_usd.toLocaleString('en-US')}, ` +
    `total implied $${radar.meta.total_implied_usd.toLocaleString('en-US')}\n` +
    `token-radar-v2: wrote ${outDir}/board.json, ${outDir}/data.js, dashboard (${dashFiles.length} files), ` +
    `screenshots (${shots.length}) and dossier.json\n`,
);
