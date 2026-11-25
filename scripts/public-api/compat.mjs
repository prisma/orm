// Checks one package against its last release: generates a type test for each export the release
// declares itself, and an existence test for each name it forwards from another package, compiles
// them, and sorts the errors into breaks, undecided comparisons and problems with the run. The
// design is in api-compat.mjs.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { COMPILER_OPTIONS } from './compiler-options.mjs';
import { entryPointsOf } from './read-api.mjs';
import { readExports } from './read-exports.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(here, 'compat-structural.ts');
const ROOT = realpathSync(resolve(here, '..', '..'));

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

function parseVersion(version) {
  const plain = version.split('+')[0];
  const dash = plain.indexOf('-');
  return {
    core: (dash < 0 ? plain : plain.slice(0, dash)).split('.').map(Number),
    pre: dash < 0 ? [] : plain.slice(dash + 1).split('.'),
  };
}

const isNumeric = (identifier) => /^\d+$/.test(identifier);

// Semver precedence.
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let index = 0; index < 3; index++) {
    if (x.core[index] !== y.core[index]) return x.core[index] - y.core[index];
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let index = 0; index < Math.min(x.pre.length, y.pre.length); index++) {
    const [p, q] = [x.pre[index], y.pre[index]];
    if (p === q) continue;
    if (isNumeric(p) && isNumeric(q)) return Number(p) - Number(q);
    if (isNumeric(p) !== isNumeric(q)) return isNumeric(p) ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

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

const withoutRoot = (text) => text.replaceAll(`${ROOT}${sep}`, '');

function compilerOptions(dir) {
  const { options } = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, dir);
  return { ...options, noEmit: true };
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

// What each import path exports, as symbols with their aliases followed. readExports keeps its
// program to itself, and its groups hold only the package's own declarations.
function exportedSymbols(entryPoints, releaseRoot) {
  const program = ts.createProgram(
    entryPoints.map(({ declarationFile }) => declarationFile),
    compilerOptions(releaseRoot),
  );
  const checker = program.getTypeChecker();
  return new Map(
    entryPoints.map(({ subpath, declarationFile }) => {
      const module = checker.getSymbolAtLocation(program.getSourceFile(declarationFile));
      const symbols = new Map(
        (module ? checker.getExportsOfModule(module) : []).map((symbol) => [
          symbol.name,
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
        ]),
      );
      return [subpath, symbols];
    }),
  );
}

// The tests for one package, as entries that render() turns into a file.
export function generateTests({
  releaseDir,
  releaseSpecifier,
  currentSpecifier,
  records,
  version,
}) {
  const releaseRoot = realpathSync(releaseDir);
  const entryPoints = entryPointsOf(releaseRoot);
  const { paths } = readExports(releaseRoot, entryPoints);
  const anyForwards = [...paths.values()].some((info) =>
    info.exportNames.some((name) => isForwarded(info, name)),
  );
  const symbolsByPath = anyForwards ? exportedSymbols(entryPoints, releaseRoot) : undefined;
  const entries = [];
  const counts = { paths: 0, exports: 0, forwarded: 0, tests: 0 };
  const notCompared = [];
  const problems = [];
  const removable = [];
  const pending = new Map();
  for (const record of records) {
    const order = compareVersions(record.release, version);
    if (order < 0)
      removable.push({ path: record.path, export: record.export, release: record.release });
    else if (order > 0) {
      problems.push(
        `${record.path} ${record.export}: the recorded break is for release ${record.release}, which is later than the last release, ${version}.`,
      );
    } else pending.set(recordKey(record.path, record.export), record);
  }
  const take = (path, name) => {
    const record = pending.get(recordKey(path, name));
    pending.delete(recordKey(path, name));
    return record;
  };

  let id = 0;
  for (const [index, { subpath }] of entryPoints.entries()) {
    counts.paths++;
    const info = paths.get(subpath);
    const release = `r${index}`;
    const current = `c${index}`;
    entries.push({
      kind: 'import',
      path: subpath,
      release: `import type * as ${release} from '${specifierFor(releaseSpecifier, subpath)}';`,
      current: `import type * as ${current} from '${specifierFor(currentSpecifier, subpath)}';`,
      record: take(subpath, '*'),
    });

    const own = new Map();
    for (const group of info.groups.values()) {
      for (const name of group.names) own.set(name, group.symbol);
    }
    for (const name of info.exportNames) {
      counts.exports++;
      const segments = [];
      if (isForwarded(info, name)) {
        counts.forwarded++;
        const target = symbolsByPath.get(subpath).get(name);
        if (target && target.flags & VALUE_FLAGS) {
          segments.push({ id: id++, test: 'exists', text: `typeof ${current}.${name}` });
        } else if (target && target.flags & TYPE_FLAGS) {
          segments.push({
            id: id++,
            test: 'exists',
            text: `${current}.${name}${typeArguments(target)}`,
          });
        }
      } else {
        const symbol = own.get(name);
        if (symbol && symbol.flags & TYPE_FLAGS) {
          const args = typeArguments(symbol);
          segments.push(
            {
              id: id++,
              test: 'type',
              text: `requireAssignableTo<StructuralNew<${current}.${name}${args}>, StructuralOld<${release}.${name}${args}>>`,
            },
            {
              id: id++,
              test: 'type',
              probe: true,
              text: `requireAssignableTo<IsNeverOrAny<${release}.${name}${args}>, false>`,
            },
          );
        }
        if (symbol && symbol.flags & VALUE_FLAGS) {
          segments.push(
            {
              id: id++,
              test: 'value',
              text: `requireAssignableTo<StructuralNew<typeof ${current}.${name}>, StructuralOld<typeof ${release}.${name}>>`,
            },
            {
              id: id++,
              test: 'value',
              probe: true,
              text: `requireAssignableTo<IsNeverOrAny<typeof ${release}.${name}>, false>`,
            },
          );
        }
        counts.tests += segments.filter((segment) => !segment.probe).length;
      }
      if (segments.length === 0) {
        notCompared.push({
          path: subpath,
          name,
          test: 'none',
          reason: 'neither a type nor a value that can be compared',
        });
        continue;
      }
      entries.push({ kind: 'export', path: subpath, name, segments, record: take(subpath, name) });
    }
  }
  for (const record of pending.values()) {
    problems.push(
      `${record.path} ${record.export}: a break is recorded for an export the last release does not declare in this package. Remove the record.`,
    );
  }
  return { entries, counts, notCompared, problems, removable };
}

export function render(entries, { mustFail = true } = {}) {
  const lines = [
    "import type { IsNeverOrAny, requireAssignableTo, StructuralNew, StructuralOld } from 'HELPERS';",
  ];
  const cases = new Map();
  const add = (testCase, line) => {
    if (testCase) cases.set(lines.length + 1, testCase);
    lines.push(line);
  };
  for (const entry of entries) {
    const recordCase = entry.record && {
      kind: 'record',
      path: entry.path,
      name: entry.name ?? '*',
      entry,
    };
    if (entry.kind === 'import') {
      add(undefined, entry.release);
      if (recordCase) add(recordCase, `// @ts-expect-error ${entry.record.reason}`);
      add({ kind: 'import', entry }, entry.current);
      continue;
    }
    if (recordCase) add(recordCase, `// @ts-expect-error ${entry.record.reason}`);
    const prefix = `type t${lines.length + 1} = [`;
    let column = prefix.length;
    const positions = entry.segments.map((segment) => {
      const position = { segment, start: column, end: column + segment.text.length };
      column += segment.text.length + 2;
      return position;
    });
    add(
      { kind: 'export', entry, positions },
      `${prefix}${entry.segments.map(({ text }) => text).join(', ')}];`,
    );
  }
  if (mustFail) add({ kind: 'mustFail' }, 'type mustFail = requireAssignableTo<string, number>;');
  return { lines, cases };
}

function packageNameOf(fileName, cache) {
  for (let folder = dirname(fileName); dirname(folder) !== folder; folder = dirname(folder)) {
    if (!cache.has(folder)) {
      const manifest = join(folder, 'package.json');
      cache.set(
        folder,
        existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : undefined,
      );
    }
    if (cache.get(folder) !== undefined) return cache.get(folder);
  }
  return undefined;
}

const isBare = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('/');

// Problems with the program itself: two copies of one of our packages read as one, so that nothing
// is compared, and imports that do not resolve, whose types compare as `any` and always pass.
function programProblems(program, testFile, ownNames) {
  const problems = [];
  const names = new Map();
  const merged = new Set();
  for (const file of program.getSourceFiles()) {
    if (!file.redirectInfo) continue;
    const name = packageNameOf(file.fileName, names);
    if (ownNames.has(name)) merged.add(name);
  }
  for (const name of merged) {
    problems.push(
      `TypeScript read two copies of ${name}, the last release's and the current build's, as one package, so they were not compared. The two copies need different versions.`,
    );
  }
  const ambient = new Set(
    program
      .getTypeChecker()
      .getAmbientModules()
      .map((module) => module.name.replace(/^"|"$/g, '')),
  );
  const unresolved = new Set();
  const testPath = program.getSourceFile(testFile)?.path;
  program.forEachResolvedModule((resolution, name, _mode, filePath) => {
    if (resolution.resolvedModule || ambient.has(name) || !isBare(name) || filePath === testPath) {
      return;
    }
    const importer = program.getSourceFileByPath(filePath)?.fileName ?? filePath;
    unresolved.add(`${name} (imported by ${withoutRoot(importer)})`);
  });
  if (unresolved.size > 0) {
    problems.push(
      `these imports do not resolve, so the types from them compare as any: ${[...unresolved].sort().join(', ')}`,
    );
  }
  return problems;
}

const lastMessageLine = (message) =>
  withoutRoot(ts.flattenDiagnosticMessageText(message, '\n').split('\n').at(-1).trim());

function compileOnce({ testFile, entries, mustFail }) {
  const { lines, cases } = render(entries, { mustFail });
  const helpers = relative(dirname(testFile), HELPERS).split(sep).join('/').replace(/\.ts$/, '.js');
  lines[0] = lines[0].replace('HELPERS', helpers.startsWith('.') ? helpers : `./${helpers}`);
  writeFileSync(testFile, `${lines.join('\n')}\n`);
  const program = ts.createProgram([testFile], compilerOptions(dirname(testFile)));
  const bySegment = new Map();
  const unusedRecords = new Set();
  const importFailures = [];
  const other = [];
  let mustFailFailed = false;
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const message = lastMessageLine(diagnostic.messageText);
    if (diagnostic.file?.fileName !== testFile) {
      other.push(
        `${withoutRoot(diagnostic.file?.fileName ?? 'compiler')}: TS${diagnostic.code} ${message}`,
      );
      continue;
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const testCase = cases.get(line + 1);
    if (testCase?.kind === 'mustFail') mustFailFailed = true;
    else if (testCase?.kind === 'record' && diagnostic.code === UNUSED_EXPECT_ERROR) {
      unusedRecords.add(testCase.entry);
    } else if (testCase?.kind === 'import') {
      importFailures.push({ entry: testCase.entry, code: diagnostic.code, message });
    } else if (testCase?.kind === 'export') {
      const position = testCase.positions.find(
        ({ start, end }) => character >= start && character < end,
      );
      if (!position) {
        other.push(`line ${line + 1} of the generated test: TS${diagnostic.code} ${message}`);
        continue;
      }
      const found = bySegment.get(position.segment.id) ?? { codes: new Set(), message };
      if (diagnostic.code !== EXCESSIVELY_DEEP && !found.codes.has(diagnostic.code)) {
        if ([...found.codes].every((code) => code === EXCESSIVELY_DEEP)) found.message = message;
      }
      found.codes.add(diagnostic.code);
      bySegment.set(position.segment.id, found);
    } else other.push(`line ${line + 1} of the generated test: TS${diagnostic.code} ${message}`);
  }
  return { program, cases, bySegment, unusedRecords, importFailures, other, mustFailFailed };
}

// When TypeScript gives up on an instantiation that is too deep (TS2589), it keeps an error type
// for it that is assignable both ways, so every later test that reaches the same type passes. The
// tests after the first TS2589 are therefore compiled again in a new program, without the ones
// already decided, until a pass has no new TS2589.
export function compileTests({ testFile, entries, ownNames, currentDir, mustFail = true }) {
  const imports = entries.filter(({ kind }) => kind === 'import');
  let remaining = entries.filter(({ kind }) => kind === 'export');
  const outcomes = new Map();
  const problems = new Set();
  const unusedRecords = new Set();
  let importFailures = [];
  let passes = 0;
  while (remaining.length > 0 || passes === 0) {
    const pass = compileOnce({ testFile, entries: [...imports, ...remaining], mustFail });
    if (passes === 0) {
      for (const problem of programProblems(pass.program, testFile, ownNames))
        problems.add(problem);
      importFailures = pass.importFailures;
      for (const entry of pass.unusedRecords) if (entry.kind === 'import') unusedRecords.add(entry);
    }
    passes++;
    for (const problem of pass.other) problems.add(problem);
    if (!pass.mustFailFailed) {
      problems.add(
        'the test that must fail passed, so the generated tests were not compiled as expected.',
      );
    }
    let cut = Number.POSITIVE_INFINITY;
    for (const [line, testCase] of pass.cases) {
      if (testCase.kind !== 'export') continue;
      const deep = testCase.entry.segments.some((segment) =>
        pass.bySegment.get(segment.id)?.codes.has(EXCESSIVELY_DEEP),
      );
      if (deep) cut = Math.min(cut, line);
    }
    const next = [];
    for (const [line, testCase] of pass.cases) {
      if (testCase.kind !== 'export') continue;
      const { entry } = testCase;
      if (line < cut) {
        if (pass.unusedRecords.has(entry)) unusedRecords.add(entry);
        for (const segment of entry.segments) {
          if (pass.bySegment.has(segment.id))
            outcomes.set(segment.id, pass.bySegment.get(segment.id));
        }
        continue;
      }
      const undecided = entry.segments.filter((segment) => !pass.bySegment.has(segment.id));
      for (const segment of entry.segments) {
        if (pass.bySegment.has(segment.id))
          outcomes.set(segment.id, pass.bySegment.get(segment.id));
      }
      if (undecided.length > 0) next.push({ ...entry, segments: undecided });
    }
    if (cut === Number.POSITIVE_INFINITY) break;
    remaining = next;
  }
  for (const entry of unusedRecords) {
    problems.add(
      `${entry.path} ${entry.name ?? '*'}: the recorded break is no longer a break. Remove the record.`,
    );
  }

  const exported = JSON.parse(readFileSync(join(currentDir, 'package.json'), 'utf8')).exports ?? {};
  const breaks = [];
  for (const { entry, code, message } of importFailures) {
    if (Object.hasOwn(exported, entry.path)) {
      problems.add(
        `${entry.path}: the current build cannot be imported (TS${code} ${message}). Run \`pnpm build\`.`,
      );
    } else breaks.push({ path: entry.path, name: '*', test: 'path', code, message });
  }
  const undecided = [];
  const notCompared = [];
  const deepOnly = (outcome) => [...outcome.codes].every((code) => code === EXCESSIVELY_DEEP);
  for (const entry of entries) {
    if (entry.kind !== 'export') continue;
    const tests = entry.segments.filter((segment) => !segment.probe);
    for (const segment of tests) {
      const failure = { path: entry.path, name: entry.name, test: segment.test };
      const outcome = outcomes.get(segment.id);
      const probe = entry.segments.find((other) => other.probe && other.test === segment.test);
      const probeOutcome = probe && outcomes.get(probe.id);
      if (outcome && !deepOnly(outcome)) {
        breaks.push({ ...failure, code: [...outcome.codes][0], message: outcome.message });
      } else if (outcome)
        undecided.push({ ...failure, code: EXCESSIVELY_DEEP, message: outcome.message });
      else if (probeOutcome && deepOnly(probeOutcome)) {
        undecided.push({ ...failure, code: EXCESSIVELY_DEEP, message: probeOutcome.message });
      } else if (probeOutcome) {
        notCompared.push({ ...failure, reason: 'the last release has it as never or any' });
      }
    }
  }
  return { breaks, undecided, notCompared, problems: [...problems], passes };
}

// Generates and compiles the tests for one package. `strict` is whether a break fails the run;
// exports named preview_* or ea_* never do.
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
  ownNames,
  mustFail = true,
}) {
  const started = performance.now();
  const generated = generateTests({
    releaseDir,
    releaseSpecifier,
    currentSpecifier,
    records,
    version,
  });
  mkdirSync(dirname(testFile), { recursive: true });
  const compiled = compileTests({
    testFile,
    entries: generated.entries,
    ownNames: new Set(ownNames),
    currentDir,
    mustFail,
  });
  const recorded = generated.entries
    .filter(({ record }) => record)
    .map((entry) => ({ path: entry.path, name: entry.name ?? '*', reason: entry.record.reason }));
  const breaks = compiled.breaks.map((failure) => ({
    ...failure,
    failsRun: strict && !isExemptExport(failure.name),
  }));
  const notCompared = [...generated.notCompared, ...compiled.notCompared];
  return {
    name,
    version,
    strict,
    counts: { ...generated.counts, notCompared: notCompared.length },
    breaks,
    undecided: compiled.undecided,
    notCompared,
    recorded,
    removable: generated.removable,
    problems: [...generated.problems, ...compiled.problems],
    passes: compiled.passes,
    ms: Math.round(performance.now() - started),
  };
}
