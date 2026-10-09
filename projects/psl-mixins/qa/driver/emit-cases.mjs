import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , cliEntry, projectDir, casesPath, only] = process.argv;
if (casesPath === undefined) {
  console.error('usage: node emit-cases.mjs <cli entry> <project dir> <cases.json> [case id]');
  process.exit(1);
}
const project = resolve(projectDir);
const { cases } = JSON.parse(readFileSync(resolve(casesPath), 'utf8'));

for (const entry of cases) {
  if (only !== undefined && entry.id !== only) continue;
  const lines = entry.schema;
  writeFileSync(resolve(project, 'contract.prisma'), `${lines.join('\n')}\n`);
  const run = spawnSync(
    'node',
    [
      resolve(cliEntry),
      'contract',
      'emit',
      '--output-path',
      'out',
      '--format',
      'human',
      '--no-color',
    ],
    { cwd: project, encoding: 'utf8' },
  );
  console.log(`\n[${entry.id}] ${entry.title}`);
  console.log(`  exit code: ${run.status}`);
  const output = `${run.stdout}${run.stderr}`;
  const findings = output
    .split('\n')
    .filter((line) => line.includes('[CONTRACT.SOURCE_DIAGNOSTIC]'));
  if (findings.length === 0 && run.status === 0) {
    console.log('  emitted; no diagnostic');
    for (const path of entry.print ?? []) {
      const contract = JSON.parse(readFileSync(resolve(project, 'out/contract.json'), 'utf8'));
      const value = path.split('/').reduce((node, key) => node?.[key], contract);
      console.log(`  ${path}: ${JSON.stringify(value)}`);
    }
    continue;
  }
  if (findings.length === 0) {
    console.log('  no source diagnostic; full output:');
    console.log(output.trimEnd().replaceAll(/^/gm, '    '));
    continue;
  }
  for (const finding of findings) {
    console.log(`  ${finding.replace(/^.*\[CONTRACT\.SOURCE_DIAGNOSTIC\] /, '')}`);
    const where = /contract\.prisma:(\d+):(\d+)/.exec(finding);
    if (where === null) continue;
    const line = lines[Number(where[1]) - 1] ?? '';
    console.log(`    line ${where[1]}: ${line}`);
    console.log(`    ${' '.repeat(`line ${where[1]}: `.length + Number(where[2]) - 1)}^`);
  }
}
