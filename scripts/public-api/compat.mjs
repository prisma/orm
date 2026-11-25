// Checks one package against its last release: generates a type test for each export the release
// declares itself, and an existence test for each name it forwards from another package, compiles
// them, and sorts the results into breaks, undecided comparisons and problems with the run. The
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
import { createCompareHost } from './compat-declarations.mjs';
import { COMPILER_OPTIONS } from './compiler-options.mjs';
import { entryPointsOf } from './read-api.mjs';
import { readExports } from './read-exports.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(here, 'compat-structural.ts');
const ROOT = realpathSync(resolve(here, '..', '..'));

export const RECORDS_FILE = 'api-breaks.json';
export const STAMP = 'last-release';
export const TWIN_STAMP = 'twin';

const EXCESSIVELY_DEEP = 2589;
const EXCESSIVE_STACK_DEPTH = 2321;
const SUSPECT_BATCH = 32;
const OUT_OF_TIME =
  'not decided: compared after a comparison too deep to finish, which may have let it pass, and the time for comparing it again ran out';
const UNCONFIRMED =
  "not decided: TypeScript's own comparison fails, and the time for comparing it again ran out";
const OUT_OF_STACK = 'not decided: TypeScript ran out of stack comparing it';
const UNRELATABLE =
  "not decided: TypeScript's own comparison fails between the last release and a copy of it too, so it cannot compare the two copies, and the structural comparison is too deep";

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
// the first, so the release's copy gets a version of its own, and so does its twin. The manifest
// is replaced, not written in place, because pnpm hard-links it from its global store.
export function stampVersion(packageDir, stamp = STAMP) {
  const file = join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const version = manifest.version.replace(new RegExp(`-(${STAMP}|${TWIN_STAMP})$`), '');
  if (manifest.version === `${version}-${stamp}`) return;
  manifest.version = `${version}-${stamp}`;
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

const isRestricted = (modifier) =>
  modifier.kind === ts.SyntaxKind.PrivateKeyword ||
  modifier.kind === ts.SyntaxKind.ProtectedKeyword;

// A class users can construct: one whose constructor is neither private nor protected.
const isConstructible = (symbol) =>
  !(symbol.declarations ?? []).some((declaration) =>
    (declaration.members ?? []).some(
      (member) => ts.isConstructorDeclaration(member) && member.modifiers?.some(isRestricted),
    ),
  );

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

// The comparisons of one export, in the order they are tried: TypeScript's own assignability, then
// with generic signatures erased one level deep, then the structural mapping.
const comparisons = (newer, older) => ({
  native: `requireAssignableTo<${newer}, ${older}>`,
  erase: `requireAssignableTo<EraseNew<${newer}>, EraseOld<${older}>>`,
  structural: `requireAssignableTo<StructuralNew<${newer}>, StructuralOld<${older}>>`,
});

// The tests for one package, as entries that render() turns into a file.
export function generateTests({
  releaseDir,
  releaseSpecifier,
  currentSpecifier,
  twinSpecifier,
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
    const importOf = (specifier) =>
      `import type * as ${current} from '${specifierFor(specifier, subpath)}';`;
    entries.push({
      kind: 'import',
      path: subpath,
      release: `import type * as ${release} from '${specifierFor(releaseSpecifier, subpath)}';`,
      current: importOf(currentSpecifier),
      twin: twinSpecifier && importOf(twinSpecifier),
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
          segments.push({
            id: id++,
            test: 'exists',
            texts: { native: `typeof ${current}.${name}` },
          });
        } else if (target && target.flags & TYPE_FLAGS) {
          segments.push({
            id: id++,
            test: 'exists',
            texts: { native: `${current}.${name}${typeArguments(target)}` },
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
              texts: comparisons(`${current}.${name}${args}`, `${release}.${name}${args}`),
            },
            {
              id: id++,
              test: 'type',
              probe: true,
              texts: {
                native: `requireAssignableTo<IsNeverOrAny<${release}.${name}${args}>, false>`,
              },
            },
          );
        }
        if (symbol && symbol.flags & VALUE_FLAGS) {
          segments.push(
            {
              id: id++,
              test: 'value',
              texts: comparisons(`typeof ${current}.${name}`, `typeof ${release}.${name}`),
            },
            {
              id: id++,
              test: 'value',
              probe: true,
              texts: {
                native: `requireAssignableTo<IsNeverOrAny<typeof ${release}.${name}>, false>`,
              },
            },
          );
        }
        // Parameters of a constructor declaration compare in both directions, as a method's do.
        if (symbol && symbol.flags & ts.SymbolFlags.Class && isConstructible(symbol)) {
          const value = comparisons(`typeof ${current}.${name}`, `typeof ${release}.${name}`);
          segments.push({
            id: id++,
            test: 'constructor',
            texts: {
              native: `requireAssignableTo<ConstructorParameters<typeof ${release}.${name}>, ConstructorParameters<typeof ${current}.${name}>>`,
              erase: value.erase,
              structural: value.structural,
            },
          });
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

// One test file: the imports of `side` ('current' or 'twin') against the release's, and the
// comparisons of `stage` for the given export entries.
export function render(entries, { stage = 'native', side = 'current', mustFail = true } = {}) {
  const lines = [
    "import type { EraseNew, EraseOld, IsNeverOrAny, requireAssignableTo, StructuralNew, StructuralOld } from 'HELPERS';",
  ];
  const cases = new Map();
  const add = (testCase, line) => {
    if (testCase) cases.set(lines.length + 1, testCase);
    lines.push(line);
  };
  for (const entry of entries) {
    if (entry.kind === 'import') {
      add(undefined, entry.release);
      add({ kind: 'import', entry }, entry[side]);
      continue;
    }
    const segments = entry.segments.filter((segment) => segment.texts[stage]);
    const prefix = `type t${lines.length + 1} = [`;
    let column = prefix.length;
    const positions = segments.map((segment) => {
      const text = segment.texts[stage];
      const position = { segment, start: column, end: column + text.length };
      column += text.length + 2;
      return position;
    });
    add(
      { kind: 'export', entry, positions },
      `${prefix}${segments.map((segment) => segment.texts[stage]).join(', ')}];`,
    );
  }
  if (mustFail) add({ kind: 'mustFail' }, 'type mustFail = requireAssignableTo<string, number>;');
  return { lines, cases };
}

export function packageNameOf(fileName, cache) {
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
// is compared, and imports in our packages that do not resolve, whose types compare as `any` and
// always pass. Third-party declarations are the same on both sides, so their optional imports
// (vite's `less`, for one) are left alone.
function programProblems(program, testFile, ownNames, names) {
  const problems = [];
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
    if (!ownNames.has(packageNameOf(importer, names))) return;
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

const isDeep = (code) => code === EXCESSIVELY_DEEP || code === EXCESSIVE_STACK_DEPTH;
const deepOnly = (outcome) => [...outcome.codes].every(isDeep);

function compileOnce({ testFile, entries, stage, side, mustFail, options, host, oldProgram }) {
  const { lines, cases } = render(entries, { stage, side, mustFail });
  const helpers = relative(dirname(testFile), HELPERS).split(sep).join('/').replace(/\.ts$/, '.js');
  lines[0] = lines[0].replace('HELPERS', helpers.startsWith('.') ? helpers : `./${helpers}`);
  writeFileSync(testFile, `${lines.join('\n')}\n`);
  // A program made from the last one reuses the files that did not change, but has a new checker.
  const program = ts.createProgram({
    rootNames: [testFile],
    options,
    host,
    oldProgram,
  });
  const bySegment = new Map();
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
    else if (testCase?.kind === 'import') {
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
      if (!isDeep(diagnostic.code) && !found.codes.has(diagnostic.code) && deepOnly(found)) {
        found.message = message;
      }
      found.codes.add(diagnostic.code);
      bySegment.set(position.segment.id, found);
    } else other.push(`line ${line + 1} of the generated test: TS${diagnostic.code} ${message}`);
  }
  return { program, cases, bySegment, importFailures, other, mustFailFailed };
}

// Compiles the comparisons of one stage. The result maps each segment that did not pass to its
// codes and message; a segment absent from it passed.
//
// When TypeScript gives up on an instantiation that is too deep (TS2589), it keeps an error type
// for it that is assignable both ways, so every later test that reaches the same type passes. The
// tests after the first TS2589 are therefore compiled again in a new program, without the ones
// already decided, until a pass has no new TS2589 or the time runs out. A test that overflows the
// stack takes the whole program with it, so a batch that overflows is halved until the test that
// does it is alone, and that test is not decided.
export function compileTests({
  testFile,
  imports,
  entries,
  stage,
  side,
  ownNames,
  options,
  host,
  deadline,
  mustFail = true,
}) {
  mkdirSync(dirname(testFile), { recursive: true });
  let queue = entries;
  const outcomes = new Map();
  const problems = new Set();
  const names = new Map();
  let importFailures = [];
  let passes = 0;
  let oldProgram;
  let size = queue.length;
  let overflowed = false;
  const undecided = (entry, message) => {
    for (const segment of entry.segments) {
      outcomes.set(segment.id, { codes: new Set([EXCESSIVELY_DEEP]), message });
    }
  };
  while (queue.length > 0 || passes === 0) {
    if (passes > 0 && performance.now() > deadline) break;
    const batch = queue.slice(0, size);
    let pass;
    try {
      pass = compileOnce({
        testFile,
        entries: [...imports, ...batch],
        stage,
        side,
        mustFail,
        options,
        host,
        oldProgram,
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      oldProgram = undefined;
      overflowed = true;
      if (batch.length <= 1) {
        if (batch.length === 1) undecided(batch[0], OUT_OF_STACK);
        queue = queue.slice(1);
        passes = Math.max(passes, 1);
      } else size = Math.ceil(batch.length / 2);
      continue;
    }
    oldProgram = pass.program;
    if (passes === 0) {
      for (const problem of programProblems(pass.program, testFile, ownNames, names)) {
        problems.add(problem);
      }
      importFailures = pass.importFailures;
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
      const deep = testCase.entry.segments.some((segment) => {
        const outcome = pass.bySegment.get(segment.id);
        return outcome && [...outcome.codes].some(isDeep);
      });
      if (deep) cut = Math.min(cut, line);
    }
    const suspects = [];
    for (const [line, testCase] of pass.cases) {
      if (testCase.kind !== 'export') continue;
      const { entry } = testCase;
      for (const segment of entry.segments) {
        if (pass.bySegment.has(segment.id))
          outcomes.set(segment.id, pass.bySegment.get(segment.id));
      }
      if (line < cut) continue;
      const passed = entry.segments.filter((segment) => !pass.bySegment.has(segment.id));
      if (passed.length > 0) suspects.push({ ...entry, segments: passed });
    }
    queue = [...suspects, ...queue.slice(batch.length)];
    // The tests after a TS2589 go again in small batches, so that the next one too deep poisons
    // few others; a batch with none doubles the size of the next, unless one has overflowed.
    if (cut !== Number.POSITIVE_INFINITY) size = Math.min(size, SUSPECT_BATCH);
    else if (!overflowed) size *= 2;
  }
  for (const entry of queue) undecided(entry, OUT_OF_TIME);
  return { outcomes, problems, importFailures, passes };
}

// Generates and compiles the tests for one package. `strict` is whether a break fails the run;
// exports named preview_* or ea_* never do. `twinSpecifier` imports a second copy of the release;
// `budgetMs` is the time for the whole package.
//
// Each comparison is first TypeScript's own, on declarations rewritten as compat-declarations.mjs
// describes. A failure is a break when the same comparison passes between the release and its
// twin. Otherwise TypeScript cannot compare the two copies there, and the comparison is made again
// with generic signatures erased one level deep, where a pass is a pass, and then with the
// structural mapping, which decides it unless it too is too deep.
export function checkPackage({
  name,
  releaseDir,
  currentDir,
  releaseSpecifier,
  currentSpecifier,
  twinSpecifier,
  testFile,
  records,
  version,
  strict,
  ownNames,
  mustFail = true,
  budgetMs = 120_000,
}) {
  const started = performance.now();
  const deadline = started + budgetMs;
  const owners = new Map();
  const own = new Set(ownNames);
  const generated = generateTests({
    releaseDir,
    releaseSpecifier,
    currentSpecifier,
    twinSpecifier,
    records,
    version,
  });
  const options = compilerOptions(dirname(testFile));
  const host = createCompareHost(options, (fileName) => own.has(packageNameOf(fileName, owners)));
  const imports = generated.entries.filter(({ kind }) => kind === 'import');
  const exported = generated.entries.filter(({ kind }) => kind === 'export');
  const problems = new Set(generated.problems);
  let passes = 0;
  const stageFile = (stage) =>
    testFile.replace(/\.ts$/, stage === 'native' ? '.ts' : `.${stage}.ts`);
  const run = (stage, entries, side = 'current') => {
    const result = compileTests({
      testFile: stageFile(side === 'twin' ? 'twin' : stage),
      imports,
      entries,
      stage,
      side,
      ownNames: own,
      options,
      host,
      deadline,
      mustFail,
    });
    for (const problem of result.problems) problems.add(problem);
    passes += result.passes;
    return result;
  };

  const native = run('native', exported);
  const fallbacks = [];
  const breaks = [];
  const undecided = [];
  const notCompared = [];
  const currentExports =
    JSON.parse(readFileSync(join(currentDir, 'package.json'), 'utf8')).exports ?? {};
  const brokenPaths = new Set();
  for (const { entry, code, message } of native.importFailures) {
    if (Object.hasOwn(currentExports, entry.path)) {
      problems.add(
        `${entry.path}: the current build cannot be imported (TS${code} ${message}). Run \`pnpm build\`.`,
      );
    } else {
      brokenPaths.add(entry.path);
      breaks.push({ path: entry.path, name: '*', test: 'path', code, message });
    }
  }

  const failure = (entry, segment) => ({ path: entry.path, name: entry.name, test: segment.test });
  let pending = [];
  for (const entry of exported) {
    for (const segment of entry.segments.filter((each) => !each.probe)) {
      const outcome = native.outcomes.get(segment.id);
      const probe = entry.segments.find((each) => each.probe && each.test === segment.test);
      const probeOutcome = probe && native.outcomes.get(probe.id);
      if (outcome && deepOnly(outcome)) {
        undecided.push({
          ...failure(entry, segment),
          code: EXCESSIVELY_DEEP,
          message: outcome.message,
        });
      } else if (outcome && segment.test === 'exists') {
        breaks.push({
          ...failure(entry, segment),
          code: [...outcome.codes][0],
          message: outcome.message,
        });
      } else if (outcome) {
        pending.push({ entry, segment, native: outcome });
      } else if (probeOutcome && deepOnly(probeOutcome)) {
        undecided.push({
          ...failure(entry, segment),
          code: EXCESSIVELY_DEEP,
          message: probeOutcome.message,
        });
      } else if (probeOutcome) {
        notCompared.push({
          ...failure(entry, segment),
          reason: 'the last release has it as never or any',
        });
      }
    }
  }

  const asEntries = (list) => list.map(({ entry, segment }) => ({ ...entry, segments: [segment] }));
  const outOfTime = () => performance.now() > deadline;
  const settle = (list, message) => {
    for (const each of list) {
      undecided.push({ ...failure(each.entry, each.segment), code: EXCESSIVELY_DEEP, message });
    }
    return [];
  };

  if (pending.length > 0 && twinSpecifier !== undefined) {
    if (outOfTime()) pending = settle(pending, UNCONFIRMED);
    else {
      const twin = run('native', asEntries(pending), 'twin');
      for (const { entry } of twin.importFailures) {
        problems.add(`${entry.path}: the copy of the last release cannot be imported.`);
      }
      pending = pending.filter((each) => {
        if (twin.outcomes.has(each.segment.id)) return true;
        breaks.push({
          ...failure(each.entry, each.segment),
          code: [...each.native.codes][0],
          message: each.native.message,
        });
        return false;
      });
    }
  }
  for (const stage of ['erase', 'structural']) {
    if (pending.length === 0) break;
    if (outOfTime()) {
      pending = settle(pending, UNCONFIRMED);
      break;
    }
    const result = run(stage, asEntries(pending));
    pending = pending.filter((each) => {
      const outcome = result.outcomes.get(each.segment.id);
      if (!outcome) {
        fallbacks.push({ ...failure(each.entry, each.segment), passedIn: stage });
        return false;
      }
      if (stage === 'erase') return true;
      if (deepOnly(outcome)) {
        const message = outcome.message === OUT_OF_TIME ? UNCONFIRMED : UNRELATABLE;
        undecided.push({ ...failure(each.entry, each.segment), code: EXCESSIVELY_DEEP, message });
      } else {
        breaks.push({
          ...failure(each.entry, each.segment),
          code: [...outcome.codes][0],
          message: outcome.message,
        });
      }
      return false;
    });
  }

  // A recorded break stands for every failure of its export; one that no longer fails, and is
  // decided, must be removed.
  const isBroken = (entry) =>
    breaks.some((each) => each.path === entry.path && each.name === (entry.name ?? '*'));
  const isUndecided = (entry) =>
    undecided.some((each) => each.path === entry.path && each.name === entry.name);
  const recordedEntries = generated.entries.filter(({ record }) => record);
  for (const entry of recordedEntries) {
    if (!isBroken(entry) && !isUndecided(entry)) {
      problems.add(
        `${entry.path} ${entry.name ?? '*'}: the recorded break is no longer a break. Remove the record.`,
      );
    }
  }
  const recordedKeys = new Set(
    recordedEntries.map((entry) => recordKey(entry.path, entry.name ?? '*')),
  );
  const unrecorded = breaks.filter(
    (each) =>
      !recordedKeys.has(recordKey(each.path, each.name)) &&
      !(
        each.name !== '*' &&
        brokenPaths.has(each.path) &&
        recordedKeys.has(recordKey(each.path, '*'))
      ),
  );

  const recorded = recordedEntries.map((entry) => ({
    path: entry.path,
    name: entry.name ?? '*',
    reason: entry.record.reason,
  }));
  const allNotCompared = [...generated.notCompared, ...notCompared];
  return {
    name,
    version,
    strict,
    counts: { ...generated.counts, notCompared: allNotCompared.length },
    breaks: unrecorded.map((each) => ({ ...each, failsRun: strict && !isExemptExport(each.name) })),
    undecided,
    notCompared: allNotCompared,
    recorded,
    removable: generated.removable,
    problems: [...problems],
    fallbacks,
    passes,
    ms: Math.round(performance.now() - started),
  };
}
