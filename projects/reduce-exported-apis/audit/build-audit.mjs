// Joins the import census with the decisions and writes the tables of ../audit.md between its markers.
// Run from the repository root: node projects/reduce-exported-apis/audit/build-audit.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { facadeRules, gaPackages, overrides } from './dispositions.mjs';

const { rows } = JSON.parse(readFileSync('wip/ga3/census.json', 'utf8'));
const auditFile = 'projects/reduce-exported-apis/audit.md';
const bySpecifier = new Map(rows.map((row) => [row.specifier, row]));
const facades = [
  '@prisma/orm-postgres',
  '@prisma/orm-mysql',
  '@prisma/orm-mariadb',
  '@prisma/orm-sqlite',
  '@prisma/orm-mongo',
];
const extensionPacks = [
  '@prisma/orm-extension-pgvector',
  '@prisma/orm-extension-postgis',
  '@prisma/orm-extension-arktype-json',
  '@prisma/orm-postgres-contrib',
];
const outsideNames = {
  composer: 'Composer',
  'prisma-cli': 'the `prisma` tool',
  'pdp-control-plane': 'the control plane',
  'create-prisma': 'create-prisma',
};
const short = (shell) => shell.replace('@prisma/orm-', '');
const subpathOf = (row) => (row.subpath === '.' ? '.' : row.subpath.slice(2));
const isCode = (file) => !/\.(md|mdx|mdc)$/.test(file);
const isStoredSnapshot = (file) => /snapshots\//.test(file) || /upgrade-instructions/.test(file);

function evidence(row) {
  const found = {
    app: 0,
    generated: 0,
    stored: 0,
    docs: 0,
    strings: 0,
    extensions: new Set(),
    targets: new Set(),
    families: new Set(),
    facades: new Set(),
    toolchain: false,
    framework: false,
    outside: new Set(),
    outsideDocs: new Set(),
  };
  for (const [category, files] of Object.entries(row.importers)) {
    if (category === 'app') found.app += files.length;
    else if (category === 'docs') found.docs += files.length;
    else if (category === 'source-string') found.strings += files.length;
    else if (category === 'generated' || category.endsWith(':generated')) {
      const current = files.filter(
        (file) => !isStoredSnapshot(file) && !file.startsWith('wip/'),
      ).length;
      found.generated += current;
      found.stored += files.length - current;
    } else if (category.startsWith('ours:')) {
      const [, kind, shell] = category.split(':');
      if (kind === 'extension' || kind === 'integration') found.extensions.add(short(shell));
      else if (kind === 'facade') found.facades.add(short(shell));
      else if (shell.includes('orm-target-')) found.targets.add(short(shell));
      else if (shell.includes('orm-family-')) found.families.add(short(shell));
      else if (shell.endsWith('toolchain')) found.toolchain = true;
      else found.framework = true;
    } else if (category.startsWith('outside:')) {
      const name = outsideNames[category.split(':')[1]];
      if (files.some(isCode)) found.outside.add(name);
      else found.outsideDocs.add(name);
    }
  }
  return found;
}

function describe(found) {
  const parts = [];
  if (found.generated) parts.push('generated files');
  if (found.stored) parts.push('stored generated files');
  if (found.app) parts.push(`example applications (${found.app})`);
  if (found.docs || found.outsideDocs.size) parts.push('docs');
  if (found.extensions.size) parts.push(`our extensions (${[...found.extensions].join(', ')})`);
  if (found.targets.size) parts.push(`our targets (${[...found.targets].join(', ')})`);
  if (found.families.size) parts.push(`our families (${[...found.families].join(', ')})`);
  if (found.facades.size) parts.push(`our facades (${[...found.facades].join(', ')})`);
  if (found.toolchain) parts.push('the toolchain');
  if (found.framework) parts.push('the framework');
  if (found.strings) parts.push('named in package source');
  if (found.outside.size) parts.push([...found.outside].join(', '));
  return parts.length === 0 ? 'nobody' : parts.join('; ');
}

function firstRule(rules, subpath) {
  for (const [pattern, decision, reason] of rules ?? [])
    if (pattern.test(subpath)) return { decision, reason };
  return undefined;
}

const decisions = new Map();
function decideFacade(row) {
  const decided = firstRule(facadeRules.slice(0, -1), subpathOf(row));
  if (decided) return decided;
  // A facade below GA has paths the PostgreSQL facade lacks (MongoDB's query modules, for one): the same tests decide them.
  const found = evidence(row);
  if (row.package !== '@prisma/orm-postgres') {
    if (found.generated) return { decision: 'keep', reason: 'a generated file imports it' };
    if (row.forwardsTo === undefined)
      return { decision: 'keep', reason: 'the facade\u2019s own code' };
    const family = /^(orm|query-builder|value)$/.test(subpathOf(row));
    if (family)
      return { decision: 'keep', reason: 'the query types an application names; documented' };
  }
  return firstRule(facadeRules.slice(-1), subpathOf(row));
}

function decideByEvidence(row) {
  const override = firstRule(overrides[row.package], subpathOf(row));
  if (override) return override;
  const found = evidence(row);
  if (extensionPacks.includes(row.package)) {
    const leaf = subpathOf(row).split('/').pop();
    const standard = {
      'codec-types': 'a generated `contract.d.ts` imports it',
      'operation-types': 'a generated `contract.d.ts` imports it',
      control: 'the config lists it',
      runtime: 'the application passes it to its client',
      pack: 'a TypeScript contract names it',
      'column-types': 'a TypeScript contract imports its column types',
    }[leaf];
    if (standard)
      return { decision: 'keep', reason: `standard entry of an extension pack: ${standard}` };
  }
  if (found.generated) return { decision: 'keep', reason: 'a generated file imports it' };
  const forwardedKept = (row.forwardedBy ?? []).filter(
    (specifier) =>
      facades.some((facade) => specifier.startsWith(`${facade}/`)) &&
      decideFacade(bySpecifier.get(specifier)).decision === 'keep',
  );
  if (forwardedKept.length)
    return { decision: 'keep', reason: 'applications reach it through their facade' };
  if (found.extensions.size || found.targets.size)
    return {
      decision: 'keep',
      reason: 'extension and target authors: our own extensions or targets build on it',
    };
  if (found.outside.size)
    return { decision: 'keep', reason: `${[...found.outside].join(' and ')} imports it` };
  if (found.app) return { decision: 'keep', reason: 'an example application imports it' };
  if (found.families.size || found.facades.size || found.toolchain || found.framework)
    return {
      decision: 'keep',
      reason:
        'wiring: another package of ours imports it across the package boundary, so it cannot be unpublished',
    };
  const hasChildren = rows.some(
    (other) => other.package === row.package && other.subpath.startsWith(`${row.subpath}/`),
  );
  if (hasChildren && (found.docs || found.strings))
    return { decision: 'keep', reason: 'the name for the whole module, which the docs use' };
  if (found.strings)
    return { decision: 'keep', reason: 'package source names it for generated or loaded code' };
  if (found.docs || found.outsideDocs.size)
    return { decision: 'remove', reason: 'only documents name it; they change to a kept path' };
  return { decision: 'remove', reason: 'nothing outside its own package imports it' };
}

for (const row of rows)
  decisions.set(
    row.specifier,
    facades.includes(row.package) ? decideFacade(row) : decideByEvidence(row),
  );

const sections = [];
const totals = [];
for (const name of [...new Set(rows.map((row) => row.package))].sort(
  (a, b) =>
    (gaPackages.indexOf(a) + 1 || 99) - (gaPackages.indexOf(b) + 1 || 99) || a.localeCompare(b),
)) {
  const packageRows = rows.filter((row) => row.package === name);
  const count = (decision) =>
    packageRows.filter((row) => decisions.get(row.specifier).decision === decision).length;
  const reduced = gaPackages.includes(name) || facades.includes(name);
  totals.push(
    reduced
      ? `| \`${name}\` | ${gaPackages.includes(name) ? 'GA' : 'below GA'} | ${packageRows.length} | ${count('keep')} | ${count('rename')} | ${count('remove')} |`
      : `| \`${name}\` | below GA | ${packageRows.length} | not reduced path by path | | |`,
  );
  if (!reduced) {
    const named = packageRows.filter((row) => /internal/.test(row.subpath));
    if (named.length)
      sections.push(
        `### \`${name}\` (below GA)\n\nNot reduced path by path. Paths named "internal", which are renamed or removed: ${named.map((row) => `\`${subpathOf(row)}\``).join(', ')}.`,
      );
    continue;
  }
  const lines = packageRows.map((row) => {
    const { decision, reason } = decisions.get(row.specifier);
    return `| \`${subpathOf(row)}\` | ${describe(evidence(row))} | ${decision} | ${reason} |`;
  });
  const note =
    facades.includes(name) && name !== '@prisma/orm-postgres'
      ? ' (below GA; it follows the PostgreSQL facade’s list)'
      : '';
  sections.push(
    `### \`${name}\`${note}\n\n| Path | Who imports it today | Decision | Why |\n| --- | --- | --- | --- |\n${lines.join('\n')}`,
  );
}

const generated = `## Totals\n\n| Package | Level at release 8.0 | Paths today | Keep | Rename | Remove |\n| --- | --- | --- | --- | --- | --- |\n${totals.join('\n')}\n\n## Every path\n\n${sections.join('\n\n')}\n`;
const begin = '<!-- generated:begin -->';
const end = '<!-- generated:end -->';
const current = readFileSync(auditFile, 'utf8');
writeFileSync(
  auditFile,
  `${current.slice(0, current.indexOf(begin) + begin.length)}\n\n${generated}\n${current.slice(current.indexOf(end))}`,
);
const all = [...decisions.values()];
console.log(
  `keep ${all.filter((d) => d.decision === 'keep').length}, rename ${all.filter((d) => d.decision === 'rename').length}, remove ${all.filter((d) => d.decision === 'remove').length}`,
);
