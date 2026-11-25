// Checks one package against its last release: generates a type test for each export the release
// declares itself, compiles it, and sorts the errors into breaks, undecided comparisons and
// problems with the run. The design is in api-compat.mjs.

import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { COMPILER_OPTIONS } from './compiler-options.mjs';
import { entryPointsOf } from './read-api.mjs';
import { readExports } from './read-exports.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(here, 'compat-structural.ts');

export const RECORDS_FILE = 'api-breaks.json';
export const STAMP = 'last-release';

const EXCESSIVELY_DEEP = 2589;
const UNUSED_EXPECT_ERROR = 2578;

const TYPE_FLAGS =
  ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum;
const VALUE_FLAGS =
  ts.SymbolFlags.Variable |
  ts.SymbolFlags.Function |
  ts.SymbolFlags.Class |
  ts.SymbolFlags.Enum |
  ts.SymbolFlags.ValueModule;

export const isPrerelease = (version) => /^\d+\.\d+\.\d+-/.test(version);
export const isExemptExport = (name) => name.startsWith('preview_') || name.startsWith('ea_');

// TypeScript treats two copies of a package with the same name and version as one and reads only
// the first, so the release's copy gets a version of its own. The manifest is replaced, not
// written in place, because pnpm hard-links it from its global store.
export function stampVersion(packageDir) {
  const file = join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.version.endsWith(`-${STAMP}`)) return;
  manifest.version = `${manifest.version}-${STAMP}`;
  writeFileSync(`${file}.new`, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(`${file}.new`, file);
}

const specifierFor = (packageSpecifier, subpath) =>
  subpath === '.' ? packageSpecifier : `${packageSpecifier}${subpath.slice(1)}`;

const recordKey = (path, name) => `${path}\0${name}`;

function isForwarded(info, name) {
  return (
    info.starCovered.has(name) ||
    info.namedForwards.some((forward) => forward.exportName === name) ||
    info.namespaceForwards.some((forward) => forward.exportName === name)
  );
}

function typeArguments(symbol) {
  const parameters =
    symbol.declarations?.find((declaration) => declaration.typeParameters?.length)
      ?.typeParameters ?? [];
  const required = parameters.filter((parameter) => parameter.default === undefined);
  return required.length > 0 ? `<${required.map(() => 'never').join(', ')}>` : '';
}

// The test file for one package, and what each of its lines tests.
export function generateTests({
  releaseDir,
  releaseSpecifier,
  currentSpecifier,
  testFile,
  records,
  version,
}) {
  const releaseRoot = realpathSync(releaseDir);
  const entryPoints = entryPointsOf(releaseRoot);
  const { paths } = readExports(releaseRoot, entryPoints);
  const helpers = relative(dirname(testFile), HELPERS).split(sep).join('/').replace(/\.ts$/, '.js');
  const lines = [
    `import type { requireAssignableTo, StructuralNew, StructuralOld } from '${helpers.startsWith('.') ? helpers : `./${helpers}`}';`,
  ];
  const cases = new Map();
  const counts = { paths: 0, exports: 0, forwarded: 0, notCompared: 0, tests: 0 };
  const problems = [];
  const pending = new Map();
  for (const record of records) {
    if (record.release !== version) {
      problems.push(
        `${record.path} ${record.export}: the recorded break is for release ${record.release}, but the last release is ${version}. Remove the record.`,
      );
    } else pending.set(recordKey(record.path, record.export), record);
  }

  for (const [index, { subpath }] of entryPoints.entries()) {
    counts.paths++;
    const info = paths.get(subpath);
    const release = `r${index}`;
    const current = `c${index}`;
    cases.set(lines.length + 1, { kind: 'import', side: 'release', path: subpath });
    lines.push(`import type * as ${release} from '${specifierFor(releaseSpecifier, subpath)}';`);
    cases.set(lines.length + 1, { kind: 'import', side: 'current', path: subpath });
    lines.push(`import type * as ${current} from '${specifierFor(currentSpecifier, subpath)}';`);

    const symbols = new Map();
    for (const group of info.groups.values()) {
      for (const name of group.names) symbols.set(name, group.symbol);
    }
    for (const name of info.exportNames) {
      counts.exports++;
      if (isForwarded(info, name)) {
        counts.forwarded++;
        continue;
      }
      const symbol = symbols.get(name);
      const tests = [];
      if (symbol && symbol.flags & TYPE_FLAGS) {
        const args = typeArguments(symbol);
        tests.push({
          test: 'type',
          text: `requireAssignableTo<StructuralNew<${current}.${name}${args}>, StructuralOld<${release}.${name}${args}>>`,
        });
      }
      if (symbol && symbol.flags & VALUE_FLAGS) {
        tests.push({
          test: 'value',
          text: `requireAssignableTo<StructuralNew<typeof ${current}.${name}>, StructuralOld<typeof ${release}.${name}>>`,
        });
      }
      if (tests.length === 0) {
        counts.notCompared++;
        continue;
      }
      counts.tests += tests.length;
      const record = pending.get(recordKey(subpath, name));
      if (record) {
        pending.delete(recordKey(subpath, name));
        cases.set(lines.length + 1, { kind: 'record', path: subpath, name, record });
        lines.push(`// @ts-expect-error ${record.reason}`);
      }
      const prefix = `type t${lines.length + 1} = [`;
      const segments = [];
      let column = prefix.length;
      for (const { test, text } of tests) {
        segments.push({ test, start: column, end: column + text.length });
        column += text.length + 2;
      }
      cases.set(lines.length + 1, { kind: 'export', path: subpath, name, segments, record });
      lines.push(`${prefix}${tests.map(({ text }) => text).join(', ')}];`);
    }
  }
  for (const record of pending.values()) {
    problems.push(
      `${record.path} ${record.export}: a break is recorded for an export the last release does not declare in this package. Remove the record.`,
    );
  }
  cases.set(lines.length + 1, { kind: 'canary' });
  lines.push('type mustFail = requireAssignableTo<string, number>;');
  return { text: `${lines.join('\n')}\n`, cases, counts, problems };
}

const within = (file, folder) => file === folder || file.startsWith(`${folder}${sep}`);

function firstLine(message) {
  const text = ts.flattenDiagnosticMessageText(message, '\n').split('\n');
  return text.at(-1).trim();
}

// Compiles a generated test file and sorts its errors by the case on their line.
export function compileTests({ testFile, cases, releaseDir, currentDir }) {
  const { options } = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, dirname(testFile));
  const program = ts.createProgram([testFile], { ...options, noEmit: true });
  const sides = [realpathSync(releaseDir), realpathSync(currentDir)];
  const problems = [];
  const merged = program
    .getSourceFiles()
    .some((file) => file.redirectInfo && sides.some((side) => within(file.fileName, side)));
  if (merged) {
    problems.push(
      'TypeScript read the last release and the current build as one package, so nothing was compared. The two copies need different versions.',
    );
  }

  const failures = new Map();
  let canaryFailed = false;
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const message = firstLine(diagnostic.messageText);
    if (diagnostic.file?.fileName !== testFile) {
      problems.push(`${diagnostic.file?.fileName ?? 'compiler'}: TS${diagnostic.code} ${message}`);
      continue;
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const testCase = cases.get(line + 1);
    if (testCase?.kind === 'canary') canaryFailed = true;
    else if (testCase?.kind === 'record' && diagnostic.code === UNUSED_EXPECT_ERROR) {
      problems.push(
        `${testCase.path} ${testCase.name}: the recorded break is no longer a break. Remove the record.`,
      );
    } else if (testCase?.kind === 'import' && testCase.side === 'current') {
      failures.set(`${testCase.path}\0*`, {
        path: testCase.path,
        name: '*',
        test: 'path',
        code: diagnostic.code,
        message,
      });
    } else if (testCase?.kind === 'export') {
      const segment = testCase.segments.find(
        ({ start, end }) => character >= start && character < end,
      );
      const key = `${testCase.path}\0${testCase.name}\0${segment?.test}`;
      if (!failures.has(key) || diagnostic.code === EXCESSIVELY_DEEP) {
        failures.set(key, {
          path: testCase.path,
          name: testCase.name,
          test: segment?.test ?? 'unknown',
          code: diagnostic.code,
          message,
        });
      }
    } else problems.push(`line ${line + 1} of the generated test: TS${diagnostic.code} ${message}`);
  }
  if (!canaryFailed) {
    problems.push(
      'the test that must fail passed, so the generated tests were not compiled as expected.',
    );
  }
  const breaks = [];
  const undecided = [];
  for (const failure of failures.values()) {
    (failure.code === EXCESSIVELY_DEEP ? undecided : breaks).push(failure);
  }
  return { breaks, undecided, problems };
}

// Generates, writes and compiles the tests for one package. `strict` is whether a break fails the
// run; exports named preview_* or ea_* never do.
export function checkPackage({
  name,
  releaseDir,
  currentDir,
  releaseSpecifier,
  currentSpecifier,
  testFile,
  records,
  version,
  strict,
}) {
  const started = performance.now();
  const generated = generateTests({
    releaseDir,
    releaseSpecifier,
    currentSpecifier,
    testFile,
    records,
    version,
  });
  mkdirSync(dirname(testFile), { recursive: true });
  writeFileSync(testFile, generated.text);
  const compiled = compileTests({ testFile, cases: generated.cases, releaseDir, currentDir });
  const recorded = [...generated.cases.values()]
    .filter(({ kind }) => kind === 'record')
    .map(({ path, name: exportName, record }) => ({
      path,
      name: exportName,
      reason: record.reason,
    }));
  const breaks = compiled.breaks.map((failure) => ({
    ...failure,
    failsRun: strict && !isExemptExport(failure.name),
  }));
  return {
    name,
    version,
    strict,
    counts: generated.counts,
    breaks,
    undecided: compiled.undecided,
    recorded,
    problems: [...generated.problems, ...compiled.problems],
    ms: Math.round(performance.now() - started),
  };
}
