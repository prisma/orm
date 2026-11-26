// Checks one package against its last release: generates a type test for each export the release
// declares itself, and an existence test for each name it forwards from another package, compiles
// them, and sorts the results into breaks, undecided comparisons and problems with the run. The
// design is in api-compat.mjs.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createCompareHost, exportsReaching, nameText } from './compat-declarations.mjs';
import { COMPILER_OPTIONS } from './compiler-options.mjs';
import { apiFingerprint } from './fingerprint.mjs';
import { entryPointsOf } from './read-api.mjs';
import {
  heldByAnotherName,
  packageOf,
  readExports,
  TYPE_FLAGS,
  VALUE_FLAGS,
} from './read-exports.mjs';
import { BREAKS_FILE, byLastRelease, exportLabel, normaliseMessage } from './records.mjs';
import { isExemptExport } from './release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(here, 'compat-structural.ts');
const ROOT = realpathSync(resolve(here, '..', '..'));

const EXCESSIVELY_DEEP = 2589;
const EXCESSIVE_STACK_DEPTH = 2321;
const SUSPECT_BATCH = 32;
const OUT_OF_TIME =
  'not decided: compared after a comparison too deep to finish, which may have let it pass, and the time for comparing it again ran out';
const UNCONFIRMED =
  ' (not confirmed against the copy of the last release: the time ran out; raise the budget)';
const OUT_OF_STACK = 'not decided: TypeScript ran out of stack comparing it';
const OUTDATED =
  "a record for an earlier state of this export exists; the export, or a declaration it uses as a type in api.txt, has changed since, so it is judged again. If the break is still intended, replace the record with this one. TypeScript's message may name only the first difference; check the export's changed lines in api.txt.";
const UNRELATABLE =
  "TypeScript's own comparison fails between the last release and a copy of it too, so it cannot compare the two copies here";
const STRUCTURAL_ONLY = `not decided: ${UNRELATABLE}, and only the structural comparison, which instantiates generic signatures with their constraints, passes`;
const STRUCTURAL_DEEP = `not decided: ${UNRELATABLE}, and the structural comparison is too deep`;
const STRUCTURAL_LATE = `not decided: ${UNRELATABLE}, and the time for the structural comparison ran out`;
const PARTIAL =
  'not decided: its members pass one by one, but its call, construct or index signatures, or its symbol keys, could not be compared that way';

const withoutRoot = (text) => text.replaceAll(`${ROOT}${sep}`, '');

function compilerOptions(dir) {
  const { options } = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, dir);
  return { ...options, noEmit: true };
}

const specifierFor = (packageSpecifier, subpath) =>
  subpath === '.' ? packageSpecifier : `${packageSpecifier}${subpath.slice(1)}`;

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

// The abstract members of a class, its inherited ones included, which a subclass implements:
// each under its rewritten key, and in the form a subclass must give it: a getter stays a getter,
// and a method of another package keeps its method form there. A member keyed by a symbol has no
// key to compare by; the subclass can write it only when the symbol is a well-known one.
function abstractMembers(checker, symbol, ownNames) {
  const instance = checker.getDeclaredTypeOfSymbol(symbol);
  const members = [];
  for (const property of checker.getPropertiesOfType(instance)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (declaration === undefined) continue;
    const flags = ts.getCombinedModifierFlags(declaration);
    if (!(flags & ts.ModifierFlags.Abstract) || flags & ts.ModifierFlags.Private) continue;
    const isProtected = (flags & ts.ModifierFlags.Protected) !== 0;
    const own = ownNames.has(packageOf(declaration.getSourceFile().fileName)?.name);
    // The comparison host moves a protected member, computed ones included, to a string key.
    const symbolKey = !isProtected && property.escapedName.startsWith('__@');
    const key = isProtected ? `protected ${nameText(declaration.name)}` : property.name;
    members.push({
      key: symbolKey ? undefined : key,
      written: symbolKey ? wellKnownSymbolKey(declaration) : JSON.stringify(key),
      form: ts.isGetAccessorDeclaration(declaration)
        ? 'getter'
        : !own && ts.isMethodDeclaration(declaration)
          ? 'method'
          : 'property',
    });
  }
  return members;
}

function wellKnownSymbolKey(declaration) {
  const name = declaration.name;
  if (!name || !ts.isComputedPropertyName(name)) return undefined;
  const expression = name.expression;
  return ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'Symbol'
    ? `[Symbol.${expression.name.text}]`
    : undefined;
}

const isAbstractClass = (symbol) =>
  (symbol.declarations ?? []).some(
    (declaration) =>
      ts.isClassDeclaration(declaration) &&
      declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword),
  );

const hasConstructorWith = (symbol, isModifier) =>
  (symbol.declarations ?? []).some((declaration) =>
    (declaration.members ?? []).some(
      (member) => ts.isConstructorDeclaration(member) && member.modifiers?.some(isModifier),
    ),
  );
// A class users can construct: one whose constructor is neither private nor protected.
const isConstructible = (symbol) => !hasConstructorWith(symbol, isRestricted);
// A class users can extend: one whose constructor is not private.
const isExtensible = (symbol) =>
  !hasConstructorWith(symbol, (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword);

// The comparisons of one export or member: TypeScript's own assignability, and the structural
// mapping it falls back to.
const comparisons = (newer, older) => ({
  native: `requireAssignableTo<${newer}, ${older}>`,
  structural: `requireAssignableTo<StructuralNew<${newer}>, StructuralOld<${older}>>`,
});

const isRestrictedMember = (declaration) =>
  (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Private) !== 0 ||
  (declaration.name !== undefined && ts.isPrivateIdentifier(declaration.name));

// The members of a release type or value that can be compared one by one, under the keys the
// rewritten declarations give them, and whether it has more than those (call, construct or index
// signatures, or symbol keys). Undefined when it cannot be split: a union, or a generic type alias.
function membersOf(checker, symbol, test) {
  const isClass = (symbol.flags & ts.SymbolFlags.Class) !== 0;
  if (test === 'type') {
    const generic = symbol.declarations?.some((declaration) => declaration.typeParameters?.length);
    if (generic && !(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class)))
      return undefined;
  }
  const type =
    test === 'type' ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeOfSymbol(symbol);
  if (type.isUnion() || !(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)))
    return undefined;
  let partial =
    checker.getIndexInfosOfType(type).length > 0 ||
    type.getCallSignatures().length > 0 ||
    (!isClass && type.getConstructSignatures().length > 0);
  const keys = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (declaration && isRestrictedMember(declaration)) continue;
    if (isClass && test === 'value' && property.name === 'prototype') continue;
    if (property.escapedName.startsWith('__@')) {
      partial = true;
      continue;
    }
    const isProtected =
      declaration !== undefined &&
      (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Protected) !== 0;
    keys.push(isProtected ? `protected ${property.name}` : property.name);
  }
  return { keys, partial };
}

const memberName = (member) =>
  member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
    ? member.name.text
    : undefined;

// A module specifier for a declaration file, by its absolute path.
const specifierOfFile = (fileName) =>
  fileName
    .replace(/\.d\.mts$/, '.mjs')
    .replace(/\.d\.cts$/, '.cjs')
    .replace(/\.d\.ts$/, '.js');

function resolveFrom(module, containingFile) {
  const { options } = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, dirname(containingFile));
  return ts.resolveModuleName(module, containingFile, options, ts.sys).resolvedModule
    ?.resolvedFileName;
}

// The members a release adds with `declare module` to an interface of another of our packages:
// each must still be added, with a type the release's is assignable from. The augmented module is
// imported as each side resolves it, so that the release's augmentation is read on the release's
// copy of that package and the current build's on the current one.
function augmentationTests({
  paths,
  entries,
  counts,
  notCompared,
  problems,
  take,
  id,
  sides,
  hasTwin,
  ownNames,
}) {
  const seen = new Set();
  let index = 0;
  for (const [subpath, info] of paths) {
    for (const augmentation of info.augmentations) {
      const key = `${augmentation.file.fileName}\0${augmentation.head}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = augmentation.head;
      if (!ownNames.has(augmentation.module.replace(/^(@[^/]+\/[^/]+|[^@/][^/]*).*$/, '$1'))) {
        notCompared.push({
          path: subpath,
          name,
          test: 'augments',
          reason: 'it augments a third-party module, which both sides read from one copy',
        });
        continue;
      }
      const resolved = {
        release: resolveFrom(augmentation.module, augmentation.file.fileName),
        current:
          sides.current && resolveFrom(augmentation.module, join(sides.current, 'package.json')),
        twin:
          hasTwin && sides.twin
            ? resolveFrom(augmentation.module, join(sides.twin, 'package.json'))
            : undefined,
      };
      if (!resolved.release || !resolved.current) {
        problems.push(
          `${subpath} ${name}: the augmented module does not resolve, so the augmentation was not compared.`,
        );
        continue;
      }
      const alias = { release: `ra${index}`, current: `ca${index}` };
      index++;
      const importOf = (side) =>
        resolved[side] &&
        `import type * as ${alias.current} from '${specifierOfFile(resolved[side])}';`;
      entries.push({
        kind: 'import',
        augmentation: true,
        path: subpath,
        release: `import type * as ${alias.release} from '${specifierOfFile(resolved.release)}';`,
        current: importOf('current'),
        twin: importOf('twin'),
        records: [],
      });
      const args =
        augmentation.typeParameters > 0
          ? `<${Array(augmentation.typeParameters).fill('never').join(', ')}>`
          : '';
      const segments = augmentation.members
        .map(memberName)
        .filter((member) => member !== undefined)
        .map((member) => ({
          id: id++,
          test: 'augments',
          member,
          texts: comparisons(
            `${alias.current}.${augmentation.name}${args}[${JSON.stringify(member)}]`,
            `${alias.release}.${augmentation.name}${args}[${JSON.stringify(member)}]`,
          ),
        }));
      if (segments.length === 0) continue;
      counts.tests += segments.length;
      entries.push({ kind: 'export', path: subpath, name, segments, records: take(subpath, name) });
    }
  }
  return id;
}

// The tests for one package, as entries that render() turns into a file.
export function generateTests({
  releaseDir,
  currentDir,
  twinDir,
  releaseSpecifier,
  currentSpecifier,
  twinSpecifier,
  records,
  version,
  ownNames = new Set(),
}) {
  const releaseRoot = realpathSync(releaseDir);
  const entryPoints = entryPointsOf(releaseRoot);
  const { paths, checker, program } = readExports(releaseRoot, entryPoints);
  const entries = [];
  const counts = { paths: 0, exports: 0, forwarded: 0, tests: 0 };
  const notCompared = [];
  const problems = [];
  const sorted = byLastRelease(
    records,
    version,
    (record) => `${record.path} ${record.export} (${record.test})`,
  );
  const removable = sorted.removable;
  problems.push(...sorted.problems);
  const pending = new Set(sorted.current);
  const take = (path, name) => {
    const taken = [...pending].filter((record) => record.path === path && record.export === name);
    for (const record of taken) pending.delete(record);
    return taken;
  };

  let id = 0;
  for (const [index, { subpath }] of entryPoints.entries()) {
    counts.paths++;
    const info = paths.get(subpath);
    const release = `r${index}`;
    const current = `c${index}`;
    const values = `cv${index}`;
    const importOf = (specifier) =>
      `import type * as ${current} from '${specifierFor(specifier, subpath)}'; import * as ${values} from '${specifierFor(specifier, subpath)}';`;
    entries.push({
      kind: 'import',
      path: subpath,
      release: `import type * as ${release} from '${specifierFor(releaseSpecifier, subpath)}';`,
      current: importOf(currentSpecifier),
      twin: twinSpecifier && importOf(twinSpecifier),
      records: take(subpath, '*'),
    });
    // A value used through a value import fails when the current build exports it type-only.
    const valueUse = (name) => ({
      id: id++,
      test: 'value',
      use: true,
      texts: { native: `${values}.${name};` },
    });

    const own = new Map();
    const typeOnly = new Map();
    for (const group of info.groups.values()) {
      for (const name of group.names) {
        own.set(name, group.symbol);
        typeOnly.set(name, group.typeOnly.get(name));
      }
    }
    for (const name of info.exportNames) {
      counts.exports++;
      const segments = [];
      if (isForwarded(info, name)) {
        counts.forwarded++;
        const kinds = info.forwardKinds.get(name);
        // A class is both a type and a value: each must still be forwarded.
        if (kinds?.value) segments.push({ ...valueUse(name), test: 'exists' });
        if (kinds?.type) {
          segments.push({
            id: id++,
            test: 'exists',
            texts: { native: `${current}.${name}${typeArguments(kinds.target)}` },
          });
        } else if (kinds?.typeOnlyValue) {
          segments.push({
            id: id++,
            test: 'exists',
            texts: { native: `typeof ${current}.${name}` },
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
          if (!typeOnly.get(name)) segments.push(valueUse(name));
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
        // Parameters of a constructor declaration compare in both directions, as a method's do,
        // and a subclass must implement each abstract member as the release declares it.
        if (symbol && symbol.flags & ts.SymbolFlags.Class && isConstructible(symbol)) {
          const value = comparisons(`typeof ${current}.${name}`, `typeof ${release}.${name}`);
          segments.push({
            id: id++,
            test: 'constructor',
            texts: {
              native: `requireAssignableTo<ConstructorParameters<typeof ${release}.${name}>, ConstructorParameters<typeof ${current}.${name}>>`,
              structural: value.structural,
            },
          });
        }
        const members =
          symbol && symbol.flags & ts.SymbolFlags.Class
            ? abstractMembers(checker, symbol, ownNames)
            : [];
        const abstract = members.map(({ key }) => key).filter((key) => key !== undefined);
        // A subclass written against the release, implementing what the release's class leaves
        // abstract, must still compile: it fails when the current class adds an abstract member.
        if (
          symbol &&
          symbol.flags & ts.SymbolFlags.Class &&
          !typeOnly.get(name) &&
          isAbstractClass(symbol) &&
          isExtensible(symbol)
        ) {
          // Members are typed never, which fits whatever type the release gives them, even a type
          // parameter filled with never.
          const implementation = {
            getter: (key) => `get ${key}(): never { throw 0; }`,
            method: (key) => `${key}(..._: any[]): never { throw 0; }`,
            property: (key) => `declare ${key}: never;`,
          };
          const unwritable = members.filter(({ written }) => written === undefined);
          const body = members.map(({ written, form }) => implementation[form](written)).join(' ');
          const probe = id++;
          if (unwritable.length > 0) {
            notCompared.push({
              path: subpath,
              name,
              test: 'abstract',
              reason:
                'an abstract member is keyed by a symbol that is not a well-known one, so a subclass written here cannot implement it',
            });
          } else
            segments.push({
              id: probe,
              test: 'abstract',
              use: true,
              texts: {
                native: `class Subclass${probe} extends ${values}.${name}${typeArguments(symbol)} { ${body} }`,
              },
            });
        }
        if (abstract.length > 0) {
          const args = typeArguments(symbol);
          const member = (side, key) => `${side}.${name}${args}[${JSON.stringify(key)}]`;
          segments.push({
            id: id++,
            test: 'abstract',
            texts: {
              native: `[${abstract.map((key) => `requireAssignableTo<${member(release, key)}, ${member(current, key)}>`).join(', ')}]`,
              structural: `[${abstract.map((key) => `requireAssignableTo<StructuralNew<${member(release, key)}>, StructuralOld<${member(current, key)}>>`).join(', ')}]`,
            },
          });
        }
        counts.tests += segments.filter((segment) => !segment.probe && !segment.use).length;
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
      const records = take(subpath, name);
      for (const record of records) {
        if (!segments.some((segment) => !segment.probe && segment.test === record.test)) {
          problems.push(
            `${record.path} ${record.export}: a break is recorded for its ${record.test} test, which this export does not have. Remove the record or correct its test.`,
          );
        }
      }
      entries.push({
        kind: 'export',
        path: subpath,
        name,
        segments,
        records,
        symbol: own.get(name),
        release,
        current,
      });
    }
  }
  id = augmentationTests({
    paths,
    entries,
    counts,
    notCompared,
    problems,
    take,
    id,
    sides: { release: releaseRoot, current: currentDir, twin: twinDir },
    hasTwin: twinSpecifier !== undefined,
    ownNames,
  });
  for (const record of pending) {
    problems.push(
      `${record.path} ${record.export}: a break is recorded for an export the last release does not declare in this package. Remove the record.`,
    );
  }
  return {
    entries,
    counts,
    notCompared,
    problems,
    removable,
    checker,
    program,
    entryPoints,
    heldToGa: heldByAnotherName(checker, paths, isExemptExport),
    nextId: id,
  };
}

// One test file: the imports of `side` ('current' or 'twin') against the release's, and the
// comparisons of `stage` for the given export entries.
function render(entries, { stage = 'native', side = 'current', mustFail = true } = {}) {
  const lines = [
    "import type { IsNeverOrAny, requireAssignableTo, StructuralNew, StructuralOld } from 'HELPERS';",
  ];
  const cases = new Map();
  const add = (testCase, line) => {
    if (testCase) cases.set(lines.length + 1, testCase);
    lines.push(line);
  };
  for (const entry of entries) {
    if (entry.kind === 'import') {
      if (entry[side] === undefined) continue;
      add(undefined, entry.release);
      add({ kind: 'import', entry }, entry[side]);
      continue;
    }
    for (const segment of entry.segments.filter((each) => each.use && each.texts[stage])) {
      const text = segment.texts[stage];
      add({ kind: 'export', entry, positions: [{ segment, start: 0, end: text.length }] }, text);
    }
    const segments = entry.segments.filter((segment) => !segment.use && segment.texts[stage]);
    if (segments.length === 0) continue;
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

const packageNameOf = (fileName) => packageOf(fileName)?.name;

// The folder a package is installed in, as Node resolves it from a folder.
function installedFrom(dir, name) {
  for (let folder = dir; ; folder = dirname(folder)) {
    const candidate = join(folder, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(folder) === folder) return undefined;
  }
}

// Problems with the program itself: two copies of one of our packages read as one, so that nothing
// is compared, and imports in our packages that do not resolve, whose types compare as `any` and
// always pass. Third-party declarations are the same on both sides, so their optional imports
// (vite's `less`, for one) are left alone.
function programProblems(program, testFile, ownNames, names) {
  const problems = [];
  const merged = new Set();
  for (const file of program.getSourceFiles()) {
    if (!file.redirectInfo) continue;
    const name = packageNameOf(file.fileName);
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
    if (resolution.resolvedModule || ambient.has(name) || filePath === testPath) return;
    const importer = program.getSourceFileByPath(filePath)?.fileName ?? filePath;
    if (!ownNames.has(packageNameOf(importer))) return;
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

// V8 reports a stack overflow only as a RangeError with this message.
const isStackOverflow = (error) =>
  error instanceof RangeError && error.message === 'Maximum call stack size exceeded';

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
function compileTests({
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
  let importsChecked = false;
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
      if (!isStackOverflow(error)) throw error;
      oldProgram = undefined;
      const [first] = batch;
      if (batch.length > 1) size = Math.ceil(batch.length / 2);
      else if (first?.segments.length > 1) {
        queue = [
          ...first.segments.map((segment) => ({ ...first, segments: [segment] })),
          ...queue.slice(1),
        ];
      } else {
        if (first) undecided(first, OUT_OF_STACK);
        queue = queue.slice(1);
        passes = Math.max(passes, 1);
        size = 1;
      }
      continue;
    }
    oldProgram = pass.program;
    // The first program that compiles is the one the imports are checked in, even when the
    // comparisons before it overflowed.
    if (!importsChecked) {
      for (const problem of programProblems(pass.program, testFile, ownNames, names)) {
        problems.add(problem);
      }
      importFailures = pass.importFailures;
      importsChecked = true;
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
    // An entry can take several lines; it is a suspect once, when any of them is after the cut.
    const lastLine = new Map();
    for (const [line, testCase] of pass.cases) {
      if (testCase.kind !== 'export') continue;
      const { entry } = testCase;
      for (const segment of entry.segments) {
        if (pass.bySegment.has(segment.id))
          outcomes.set(segment.id, pass.bySegment.get(segment.id));
      }
      lastLine.set(entry, Math.max(lastLine.get(entry) ?? 0, line));
    }
    const suspects = [];
    for (const [entry, line] of lastLine) {
      if (line < cut) continue;
      const passed = entry.segments.filter((segment) => !pass.bySegment.has(segment.id));
      if (passed.length > 0) suspects.push({ ...entry, segments: passed });
    }
    queue = [...suspects, ...queue.slice(batch.length)];
    // The tests after a TS2589 go again in small batches, so that the next one too deep poisons
    // few others; a batch with none doubles the size of the next.
    if (cut !== Number.POSITIVE_INFINITY) size = Math.min(size, SUSPECT_BATCH);
    else size *= 2;
  }
  for (const entry of queue) {
    undecided(
      { ...entry, segments: entry.segments.filter((segment) => !outcomes.has(segment.id)) },
      OUT_OF_TIME,
    );
  }
  if (!importsChecked) {
    problems.add(
      'no program compiled, so the imports of the generated tests could not be checked.',
    );
  }
  return { outcomes, problems, importFailures, passes };
}

function currentProgram(dir) {
  const root = realpathSync(dir);
  const entryPoints = entryPointsOf(root);
  return {
    program: ts.createProgram(
      entryPoints.map(({ declarationFile }) => declarationFile),
      compilerOptions(root),
    ),
    entryPoints,
  };
}

// Generates and compiles the tests for one package. `strict` is whether a break fails the run;
// exports named preview_* or ea_* do not, unless the release also exports them under a name without
// such a prefix. `twinSpecifier` imports a second copy of the release;
// `budgetMs` is the time for the whole package.
//
// Each comparison is first TypeScript's own, on declarations rewritten as compat-declarations.mjs
// describes; the pipeline is described in api-compat.mjs.
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
  budgetMs = 600_000,
}) {
  const started = performance.now();
  const deadline = started + budgetMs;
  const own = new Set(ownNames);
  const generated = generateTests({
    releaseDir,
    currentDir,
    twinDir: twinSpecifier && installedFrom(dirname(testFile), twinSpecifier),
    releaseSpecifier,
    currentSpecifier,
    twinSpecifier,
    records,
    version,
    ownNames: own,
  });
  const options = compilerOptions(dirname(testFile));
  const host = createCompareHost(options, {
    packageOf,
    isOwn: (packageName) => own.has(packageName),
  });
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
  const breaks = [];
  const undecided = [];
  const notCompared = [];
  const decidedByMembers = [];
  const currentExports =
    JSON.parse(readFileSync(join(currentDir, 'package.json'), 'utf8')).exports ?? {};
  const failedImports = new Set();
  for (const { entry, code, message } of native.importFailures) {
    if (failedImports.has(entry)) continue;
    failedImports.add(entry);
    if (entry.augmentation) {
      problems.add(
        `${entry.path}: a module this package augments cannot be imported (TS${code} ${message}).`,
      );
    } else if (Object.hasOwn(currentExports, entry.path)) {
      problems.add(
        `${entry.path}: the current build cannot be imported (TS${code} ${message}). Run \`pnpm build\`.`,
      );
    } else {
      breaks.push({
        path: entry.path,
        name: '*',
        test: 'path',
        code,
        message: normaliseMessage(message),
      });
    }
  }

  const testOf = (entry, segment) => ({ path: entry.path, name: entry.name, test: segment.test });
  const broke = (entry, segment, outcome, note = '') =>
    breaks.push({
      ...testOf(entry, segment),
      code: [...outcome.codes][0],
      message: `${segment.member === undefined ? '' : `${segment.member}: `}${normaliseMessage(outcome.message)}${note}`,
    });
  const notDecided = (entry, segment, stage, message) =>
    undecided.push({
      ...testOf(entry, segment),
      stage,
      code: EXCESSIVELY_DEEP,
      message: normaliseMessage(message),
    });

  let failed = [];
  // A value removed outright fails its comparison too, so a failed use waits for that comparison's
  // verdict and is reported only when the comparison is not a break.
  const heldUses = [];
  for (const entry of exported) {
    for (const segment of entry.segments.filter((each) => !each.probe)) {
      const outcome = native.outcomes.get(segment.id);
      const probe = entry.segments.find((each) => each.probe && each.test === segment.test);
      const probeOutcome = probe && native.outcomes.get(probe.id);
      if (outcome && deepOnly(outcome)) notDecided(entry, segment, 'native', outcome.message);
      else if (outcome && (segment.test === 'exists' || segment.use)) {
        const compared = entry.segments.find(
          (other) => other !== segment && !other.probe && !other.use && other.test === segment.test,
        );
        if (!compared || !native.outcomes.has(compared.id)) broke(entry, segment, outcome);
        else heldUses.push({ entry, segment, outcome });
      } else if (outcome) failed.push({ entry, segment, outcome });
      else if (probeOutcome && deepOnly(probeOutcome)) {
        notDecided(entry, segment, 'native', probeOutcome.message);
      } else if (probeOutcome) {
        notCompared.push({
          ...testOf(entry, segment),
          reason: 'the last release has it as never or any',
        });
      }
    }
  }

  const asEntries = (list) => list.map(({ entry, segment }) => ({ ...entry, segments: [segment] }));
  const outOfTime = () => performance.now() > deadline;
  // A failure stands when the same comparison passes between the release and its twin. One with no
  // time left for that is reported as a break too, so that a slow run never passes one.
  const confirm = (list) => {
    if (list.length === 0) return [];
    if (outOfTime()) {
      for (const each of list) broke(each.entry, each.segment, each.outcome, UNCONFIRMED);
      return [];
    }
    const twin = run('native', asEntries(list), 'twin');
    for (const { entry } of twin.importFailures) {
      problems.add(`${entry.path}: the copy of the last release cannot be imported.`);
    }
    return list.filter((each) => {
      const outcome = twin.outcomes.get(each.segment.id);
      if (outcome === undefined) broke(each.entry, each.segment, each.outcome);
      else if (outcome.message === OUT_OF_TIME) {
        broke(each.entry, each.segment, each.outcome, UNCONFIRMED);
      } else return true;
      return false;
    });
  };
  failed = confirm(failed);

  // What TypeScript cannot compare between two copies goes to the structural mapping, whose failure
  // is a break and whose pass decides nothing; then it is compared member by member, each member
  // with the same twin rule, and a member that still cannot be compared goes to the structural
  // mapping in its turn.
  const structuralVerdicts = (list) => {
    const result = outOfTime() ? undefined : run('structural', asEntries(list));
    return list.map((each) => {
      const outcome = result?.outcomes.get(each.segment.id);
      const verdict =
        result === undefined || outcome?.message === OUT_OF_TIME
          ? STRUCTURAL_LATE
          : outcome === undefined
            ? STRUCTURAL_ONLY
            : deepOnly(outcome)
              ? STRUCTURAL_DEEP
              : undefined;
      return { ...each, verdict, structural: outcome };
    });
  };
  const unrelated = [];
  for (const each of failed.length > 0 ? structuralVerdicts(failed) : []) {
    if (each.verdict === undefined) broke(each.entry, each.segment, each.structural);
    else unrelated.push(each);
  }
  let nextId = generated.nextId;
  const split = [];
  for (const each of unrelated) {
    const { entry, segment } = each;
    const members =
      segment.test === 'type' || segment.test === 'value'
        ? membersOf(generated.checker, entry.symbol, segment.test)
        : undefined;
    if (members === undefined || members.keys.length === 0) {
      notDecided(entry, segment, 'structural', each.verdict);
      continue;
    }
    const args = segment.test === 'type' ? typeArguments(entry.symbol) : '';
    const side = (alias) =>
      segment.test === 'type' ? `${alias}.${entry.name}${args}` : `(typeof ${alias}.${entry.name})`;
    const memberSegments = members.keys.map((key) => ({
      id: nextId++,
      test: segment.test,
      member: key,
      texts: comparisons(
        `${side(entry.current)}[${JSON.stringify(key)}]`,
        `${side(entry.release)}[${JSON.stringify(key)}]`,
      ),
    }));
    split.push({ ...each, members: memberSegments, partial: members.partial });
  }
  const structural = [];
  const memberFailures = [];
  if (split.length > 0) {
    if (outOfTime()) {
      for (const each of split) notDecided(each.entry, each.segment, 'member', STRUCTURAL_LATE);
      split.length = 0;
    } else {
      const perMember = split.flatMap((each) =>
        each.members.map((member) => ({ entry: each.entry, segment: member, parent: each })),
      );
      const result = run('native', asEntries(perMember));
      const failing = [];
      for (const each of perMember) {
        const outcome = result.outcomes.get(each.segment.id);
        if (outcome === undefined) continue;
        if (deepOnly(outcome))
          memberFailures.push({ ...each, stage: 'member', message: outcome.message });
        else failing.push({ ...each, outcome });
      }
      structural.push(...confirm(failing));
    }
  }

  for (const each of structural.length > 0 ? structuralVerdicts(structural) : []) {
    if (each.verdict === undefined) broke(each.entry, each.segment, each.structural);
    else memberFailures.push({ ...each, stage: 'structural', message: each.verdict });
  }
  for (const each of split) {
    const key = (list) => list.filter((failure) => failure.parent === each);
    const broken = breaks.some(
      (failure) =>
        failure.path === each.entry.path &&
        failure.name === each.entry.name &&
        failure.test === each.segment.test,
    );
    const open = key(memberFailures);
    if (broken) continue;
    if (open.length > 0) {
      const stage = open.some((failure) => failure.stage === 'structural')
        ? 'structural'
        : 'member';
      notDecided(
        each.entry,
        each.segment,
        stage,
        `not decided for ${open.map((failure) => failure.segment.member).join(', ')}: ${open[0].message.replace(/^not decided: /, '')}`,
      );
    } else if (each.partial) notDecided(each.entry, each.segment, 'member', PARTIAL);
    else decidedByMembers.push(testOf(each.entry, each.segment));
  }

  for (const { entry, segment, outcome } of heldUses) {
    const isBroken = breaks.some(
      (each) => each.path === entry.path && each.name === entry.name && each.test === segment.test,
    );
    if (isBroken) continue;
    broke(entry, segment, outcome);
    const sameTest = (each) =>
      each.path === entry.path && each.name === entry.name && each.test === segment.test;
    for (const list of [undecided, decidedByMembers]) {
      for (let index = list.length - 1; index >= 0; index--) {
        if (sameTest(list[index])) list.splice(index, 1);
      }
    }
  }

  // Two classes or unique symbols with one name share one marker, so a comparison that reaches one
  // can pass where the other was swapped in. Such a pass decides nothing, on either side. A test
  // that only checks a name is still exported compares nothing, so it stands.
  const ambiguous = [
    ...[...host.mergedClasses].map((each) => ({ key: each, label: `private class ${each}` })),
    ...[...host.mergedSymbols].map((each) => ({ key: each, label: `unique symbol ${each}` })),
  ];
  if (ambiguous.length > 0) {
    const targets = { classes: host.mergedClasses, symbols: host.mergedSymbols };
    const current = currentProgram(currentDir);
    const reaching = new Set([
      ...exportsReaching(generated.program, generated.entryPoints, targets, packageOf),
      ...exportsReaching(current.program, current.entryPoints, targets, packageOf),
    ]);
    const labels = ambiguous.map(({ label }) => label).join(', ');
    const settled = (list, entry, segment) =>
      list.some(
        (each) =>
          each.path === entry.path && each.name === entry.name && each.test === segment.test,
      );
    for (const entry of exported) {
      if (!reaching.has(`${entry.path}\0${entry.name}`)) continue;
      const compares = (segment) =>
        !segment.probe && !segment.use && segment.test !== 'exists' && segment.test !== 'path';
      for (const segment of entry.segments.filter(compares)) {
        if (settled(breaks, entry, segment) || settled(undecided, entry, segment)) continue;
        if (settled(notCompared, entry, segment)) continue;
        undecided.push({
          ...testOf(entry, segment),
          stage: 'shared marker',
          message: `not decided: it uses one of ${labels}, which share one marker with another of that name, so a pass cannot tell them apart`,
        });
        const index = decidedByMembers.findIndex(
          (each) =>
            each.path === entry.path && each.name === entry.name && each.test === segment.test,
        );
        if (index !== -1) decidedByMembers.splice(index, 1);
      }
    }
  }

  // A record covers the breaks of one test of one export while the fingerprint of the export in
  // api.txt is the one it was recorded with. Otherwise the export is judged again: its breaks are
  // reported as unrecorded, with a note. A record whose test no longer breaks, where that test is
  // decided, must be removed.
  const apiText = existsSync(join(currentDir, 'api.txt'))
    ? readFileSync(join(currentDir, 'api.txt'), 'utf8')
    : undefined;
  const fingerprints = new Map();
  const fingerprintOf = (path, exported) => {
    const key = `${path}\0${exported}`;
    if (!fingerprints.has(key)) fingerprints.set(key, apiFingerprint(apiText, path, exported));
    return fingerprints.get(key);
  };
  const sameTest = (record) => (each) =>
    each.path === record.path && each.name === record.export && each.test === record.test;
  // Without api.txt every export has the fingerprint of nothing, which a record would match
  // whatever the export becomes.
  const hasApi =
    apiText !== undefined &&
    apiText.split(/\r?\n/).some((line) => line !== '' && !line.startsWith('#'));
  const applied = hasApi ? generated.entries.flatMap((entry) => entry.records) : [];
  if (!hasApi && generated.entries.some((entry) => entry.records.length > 0)) {
    problems.add(
      'the package has no api.txt, or an empty one, so its records cannot be checked. Run pnpm api:update.',
    );
  }
  const recordedBreaks = new Set();
  const outdated = new Set();
  const recorded = [];
  for (const record of applied) {
    const found = breaks.filter(sameTest(record));
    const label = `${exportLabel(name, record.path, record.export)} (${record.test})`;
    if (found.length === 0) {
      if (!undecided.some(sameTest(record))) {
        problems.add(
          `${label}: the recorded break is no longer a break. Remove the record from packages/9-public/${name}/${BREAKS_FILE}.`,
        );
      }
    } else if (record.fingerprint !== fingerprintOf(record.path, record.export)) {
      for (const each of found) outdated.add(each);
    } else {
      for (const each of found) recordedBreaks.add(each);
      recorded.push({
        path: record.path,
        name: record.export,
        test: record.test,
        kind: record.kind,
        reason: record.reason,
      });
    }
  }
  const unrecorded = breaks
    .filter((each) => !recordedBreaks.has(each))
    .map((each) => ({
      ...each,
      ...(outdated.has(each) ? { note: OUTDATED } : {}),
      ...(hasApi
        ? {
            record: {
              path: each.path,
              export: each.name,
              test: each.test,
              kind: 'break',
              lastRelease: version,
              fingerprint: fingerprintOf(each.path, each.name),
              reason: '…',
            },
          }
        : {}),
    }));
  const declaredHere = (marker) => marker.startsWith(`${name}:`);
  for (const className of [...host.mergedClasses].filter(declaredHere)) {
    notCompared.push({
      path: '*',
      name: `private class ${className}`,
      test: 'private class',
      reason:
        'the package declares two classes with private members and this name, which nothing stable tells apart, so both have one marker and one can stand in for the other',
    });
  }
  for (const symbol of [...host.mergedSymbols].filter(declaredHere)) {
    notCompared.push({
      path: '*',
      name: `unique symbol ${symbol}`,
      test: 'unique symbol',
      reason:
        'the package declares two unique symbols with this name, which nothing stable tells apart, so both have one name and the keys made from them are compared as one key',
    });
  }
  const allNotCompared = [...generated.notCompared, ...notCompared];
  return {
    name,
    version,
    strict,
    counts: { ...generated.counts, notCompared: allNotCompared.length },
    breaks: unrecorded.map((each) => ({
      ...each,
      failsRun:
        strict &&
        (!isExemptExport(each.name) || generated.heldToGa.has(`${each.path}\0${each.name}`)),
    })),
    undecided,
    notCompared: allNotCompared,
    recorded,
    removable: generated.removable,
    problems: [...problems],
    decidedByMembers,
    passes,
    ms: Math.round(performance.now() - started),
  };
}
