#!/usr/bin/env node

// Prints what each published package is released as for a root version: package, level, version,
// tag, and the range it writes on each package of ours it names. Reads the workspace; writes
// nothing. Usage: node scripts/print-release-plan.ts [<root version>] [--ever-ga <name,...>]
// With no version, plans the root package.json's version.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatPlanTable, planWorkspace } from './release-plan-workspace.ts';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const everGaAt = args.indexOf('--ever-ga');
const everGa = new Set(
  everGaAt === -1 ? [] : (args[everGaAt + 1] ?? '').split(',').filter((name) => name.length > 0),
);
const positional = args.filter(
  (arg, index) => !arg.startsWith('--') && (everGaAt === -1 || index !== everGaAt + 1),
);
const version =
  positional[0] ?? JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')).version;

process.stdout.write(formatPlanTable(planWorkspace(rootDir, version, everGa)));
