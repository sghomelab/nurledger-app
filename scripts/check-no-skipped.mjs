#!/usr/bin/env node
/**
 * Pre-merge / CI gate: run the FULL jest suite and FAIL when any test is
 * skipped or pending.
 *
 * Why: on Node < 22.5 the node:sqlite-based suites (money/sync/config, incl.
 * the cloud-config service-key scrub) skip via `describe.skip` — the run is
 * green but those suites NEVER ran. A green result with skips is a lie, so a
 * merge/CI step must fail on skipped > 0. (Run with Node >= 22.5, where 0 is
 * the expected skip count.)
 *
 * Run: npm run test:strict
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jest = path.join(root, 'node_modules', '.bin', 'jest');

const child = spawn(process.execPath, [jest, '--json', '--silent'], { cwd: root });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => process.stderr.write(d));

const code = await new Promise((resolve) => child.on('close', resolve));

// jest --json prints one JSON object (possibly after non-JSON noise)
const start = out.indexOf('{');
const summary = start >= 0 ? JSON.parse(out.slice(start)) : null;
if (!summary) {
  console.error('test:strict: could not parse jest output');
  process.exit(2);
}

console.log(
  `jest: ${summary.numPassedTests} passed, ${summary.numPendingTests} skipped, ${summary.numFailedTests} failed (${summary.numTotalTests} total, node ${process.version})`,
);
if (summary.numPendingTests > 0) {
  console.error(`test:strict: FAIL — ${summary.numPendingTests} test(s) skipped. ` + 'On Node < 22.5 the node:sqlite suites are not running; use Node >= 22.5.');
  process.exit(1);
}
if (summary.numFailedTests > 0 || code !== 0) {
  console.error(`test:strict: FAIL — ${summary.numFailedTests} failed test(s).`);
  process.exit(1);
}
console.log('test:strict: OK (0 skipped)');
