// What each import path of a package exports, as the TypeScript compiler sees it. This uses the
// repository's TypeScript; API Extractor brings its own copy, which reads the same files.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { SourceMapper } from '@microsoft/api-extractor/lib/collector/SourceMapper';
import ts from 'typescript';
import { COMPILER_OPTIONS } from './compiler-options.mjs';

const isBare = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('/');
const SIGNATURE_MEMBERS = new Set(['__call', '__new', '__index', '__constructor']);

export class CompilerOptionsError extends Error {}

function compilerOptions(packageDir) {
  const { options, errors } = ts.convertCompilerOptionsFromJson(COMPILER_OPTIONS, packageDir);
  if (errors.length > 0) {
    throw new CompilerOptionsError(ts.flattenDiagnosticMessageText(errors[0].messageText, ' '));
  }
  return { ...options, noEmit: true };
}

function moduleSpecifierOf(declaration) {
  if (ts.isImportSpecifier(declaration)) return declaration.parent.parent.parent.moduleSpecifier;
  if (ts.isExportSpecifier(declaration)) return declaration.parent.parent.moduleSpecifier;
  if (ts.isImportClause(declaration)) return declaration.parent.moduleSpecifier;
  if (ts.isNamespaceImport(declaration)) return declaration.parent.parent.moduleSpecifier;
  return undefined;
}

function isTypeOnly(declaration) {
  if (ts.isImportSpecifier(declaration)) {
    return declaration.isTypeOnly || declaration.parent.parent.isTypeOnly;
  }
  if (ts.isExportSpecifier(declaration)) {
    return declaration.isTypeOnly || declaration.parent.parent.isTypeOnly;
  }
  if (ts.isImportClause(declaration)) return declaration.isTypeOnly;
  if (ts.isNamespaceImport(declaration)) return declaration.parent.isTypeOnly;
  return false;
}

// The symbols that are types, and those users can use as values.
export const TYPE_FLAGS =
  ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum;
export const VALUE_FLAGS =
  ts.SymbolFlags.Variable |
  ts.SymbolFlags.Function |
  ts.SymbolFlags.Class |
  ts.SymbolFlags.Enum |
  ts.SymbolFlags.ValueModule;

// Whether a forwarded name is a type, and whether users can use it as a value: a value that is not
// exported type-only on the way, by its own export or by an `export type *` that forwards it. A
// value exported type-only can still be named in `typeof`.
function kindsOf(checker, exported, forwardedTypeOnly = false) {
  const target =
    exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const isValue = (target.flags & VALUE_FLAGS) !== 0;
  return {
    type: (target.flags & TYPE_FLAGS) !== 0,
    value: isValue && !forwardedTypeOnly && !isTypeOnlyExport(checker, exported),
    typeOnlyValue: isValue && (forwardedTypeOnly || isTypeOnlyExport(checker, exported)),
    target,
  };
}

// Whether any import or export between a path and the declaration it exports is type-only.
function isTypeOnlyExport(checker, symbol) {
  let current = symbol;
  const seen = new Set();
  while (current && current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
    seen.add(current);
    if ((current.declarations ?? []).some(isTypeOnly)) return true;
    current = checker.getImmediateAliasedSymbol(current);
  }
  return false;
}

const packageNames = new Map();

// The package that declares what is in a file: the name in the package.json nearest above it, and
// that package.json's folder.
export function packageOf(fileName) {
  for (let folder = dirname(fileName); dirname(folder) !== folder; folder = dirname(folder)) {
    if (!packageNames.has(folder)) {
      const manifest = join(folder, 'package.json');
      packageNames.set(
        folder,
        existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : undefined,
      );
    }
    const name = packageNames.get(folder);
    if (name !== undefined) return { name, root: folder };
  }
  return undefined;
}

// The module that declares what an exported symbol names, after following its aliases: the
// `declare module "…"` around the declaration (how @types/node declares `fs`), or else the package
// whose files hold it. Unknown when the import does not resolve.
function declaringPackage(checker, symbol) {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = target.declarations?.[0];
  if (declaration === undefined) return undefined;
  for (let node = declaration.parent; node; node = node.parent) {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return node.name.text;
  }
  return packageOf(realpathSync(declaration.getSourceFile().fileName))?.name;
}

// Follows an export through imports and re-exports to the first non-relative module it passes:
// that module, the name the export has there, and whether any step on the way is type-only.
function traceForward(checker, symbol) {
  let current = symbol;
  let typeOnly = false;
  const seen = new Set();
  while (current && current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
    seen.add(current);
    for (const declaration of current.declarations ?? []) {
      typeOnly ||= isTypeOnly(declaration);
      const specifier = moduleSpecifierOf(declaration)?.text;
      if (specifier === undefined || !isBare(specifier)) continue;
      if (ts.isImportClause(declaration)) {
        return { from: specifier, originalName: 'default', typeOnly };
      }
      if (ts.isNamespaceImport(declaration)) {
        return { from: specifier, originalName: undefined, typeOnly };
      }
      const originalName = (declaration.propertyName ?? declaration.name).text;
      return { from: specifier, originalName, typeOnly };
    }
    current = checker.getImmediateAliasedSymbol(current);
  }
  return undefined;
}

const nameText = (name) =>
  ts.isComputedPropertyName(name) ? `[${name.expression.getText()}]` : name.text;

// A member's key: its name, or `__call`, `__new`, `__index` or `__constructor` for signatures.
function memberKey(member) {
  const raw = ts.unescapeLeadingUnderscores(member.escapedName);
  if (SIGNATURE_MEMBERS.has(member.escapedName)) return member.escapedName;
  const name = member.declarations?.map(ts.getNameOfDeclaration).find(Boolean);
  return name ? nameText(name) : raw;
}

function isPrivate(declaration) {
  const name = ts.getNameOfDeclaration(declaration);
  return (
    (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Private) !== 0 ||
    (name !== undefined && ts.isPrivateIdentifier(name))
  );
}

// Members a `declare module` block adds are listed as augmentation lines of the path that loads it.
function inAugmentation(declaration) {
  for (let node = declaration.parent; node; node = node.parent) {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return true;
  }
  return false;
}

const CONTAINER_FLAGS = {
  class: ts.SymbolFlags.Class,
  interface: ts.SymbolFlags.Interface,
  enum: ts.SymbolFlags.Enum,
  namespace: ts.SymbolFlags.NamespaceModule | ts.SymbolFlags.ValueModule,
};

// The keys of the public members that a class, interface, enum or namespace declares in this
// package, or undefined when the symbol is not that kind of container.
function ownMemberKeys(symbol, kind, isOwn) {
  if (!(symbol.flags & CONTAINER_FLAGS[kind])) return undefined;
  const members = [];
  const statics = new Set();
  if (kind === 'enum' || kind === 'namespace') members.push(...(symbol.exports?.values() ?? []));
  else {
    members.push(...(symbol.members?.values() ?? []));
    if (kind === 'class') {
      for (const member of symbol.exports?.values() ?? []) {
        if (member.declarations?.some(ts.isClassElement)) statics.add(member);
      }
      members.push(...statics);
    }
  }
  const keys = new Set();
  for (const member of members) {
    if (member.flags & ts.SymbolFlags.TypeParameter) continue;
    const own = (member.declarations ?? []).filter(
      (declaration) => isOwn(declaration) && !inAugmentation(declaration),
    );
    if (own.length === 0 || own.every(isPrivate)) continue;
    keys.add(`${statics.has(member) ? 'static ' : ''}${memberKey(member)}`);
  }
  return keys;
}

// The classes, interfaces, enums and namespaces declared at the top of the package's files, by
// the file API Extractor records for them and their name. API Extractor follows the declaration
// files' source maps to name that file, so the same mapper is used here.
function containersByLocation(program, checker, isOwn, packageDir) {
  const mapper = new SourceMapper();
  const byLocation = new Map();
  for (const file of program.getSourceFiles()) {
    if (!isOwn(file)) continue;
    for (const statement of file.statements) {
      const container =
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        (ts.isModuleDeclaration(statement) &&
          ts.isIdentifier(statement.name) &&
          !ts.isGlobalScopeAugmentation(statement));
      const symbol =
        container && statement.name ? checker.getSymbolAtLocation(statement.name) : undefined;
      if (symbol === undefined) continue;
      const { sourceFilePath } = mapper.getSourceLocation({ sourceFile: file, pos: statement.pos });
      const location = `${relative(packageDir, sourceFilePath).split(sep).join('/')}\0${statement.name.text}`;
      const symbols = byLocation.get(location) ?? new Set();
      symbols.add(symbol);
      byLocation.set(location, symbols);
    }
  }
  return byLocation;
}

function reachableFiles(program, entry, packageDir) {
  const options = program.getCompilerOptions();
  const seen = new Set([entry.fileName]);
  const stack = [entry];
  const files = [];
  while (stack.length > 0) {
    const file = stack.pop();
    files.push(file);
    for (const statement of file.statements) {
      const imports = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
      const specifier = imports ? statement.moduleSpecifier?.text : undefined;
      if (!specifier?.startsWith('.')) continue;
      const mode = program.getModeForUsageLocation(file, statement.moduleSpecifier);
      const resolved = ts.resolveModuleName(
        specifier,
        file.fileName,
        options,
        ts.sys,
        undefined,
        undefined,
        mode,
      ).resolvedModule?.resolvedFileName;
      if (resolved === undefined) continue;
      const path = resolve(resolved);
      if (seen.has(path) || !path.startsWith(`${packageDir}${sep}`)) continue;
      seen.add(path);
      const next = program.getSourceFile(path);
      if (next) stack.push(next);
    }
  }
  return files;
}

function augmentationsOf(files, problems) {
  const found = [];
  for (const file of files) {
    for (const statement of file.statements) {
      if (!ts.isModuleDeclaration(statement)) continue;
      if (ts.isGlobalScopeAugmentation(statement)) {
        problems.push('has a declare global block, which this script cannot list');
        continue;
      }
      if (!ts.isStringLiteral(statement.name)) continue;
      if (!statement.body || !ts.isModuleBlock(statement.body)) continue;
      for (const declaration of statement.body.statements) {
        if (!ts.isInterfaceDeclaration(declaration)) {
          problems.push(
            `declare module "${statement.name.text}" contains a ${ts.SyntaxKind[declaration.kind]}, which this script cannot list`,
          );
          continue;
        }
        found.push({
          module: statement.name.text,
          name: declaration.name.text,
          typeParameters: declaration.typeParameters?.length ?? 0,
          head: `augments ${statement.name.text} interface ${declaration.name.text}`,
          heritage: [...(declaration.heritageClauses ?? [])],
          members: [...declaration.members],
          file,
        });
      }
    }
  }
  return found;
}

function readPath(checker, program, file, packageDir) {
  const isOwn = (declaration) =>
    declaration.getSourceFile().fileName.startsWith(`${packageDir}${sep}`);
  const info = {
    exportNames: [],
    groups: new Map(),
    namedForwards: [],
    namespaceForwards: [],
    starForwards: [],
    starCovered: new Set(),
    forwardedFrom: new Map(),
    forwardKinds: new Map(),
    augmentations: [],
    problems: [],
  };
  const starNames = new Map();
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || statement.exportClause !== undefined) continue;
    const specifier = statement.moduleSpecifier?.text;
    if (specifier === undefined || !isBare(specifier)) {
      info.problems.push(`export * from "${specifier}" is not a forward of another package`);
      continue;
    }
    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!module) {
      info.problems.push(`cannot resolve "${specifier}", which it forwards`);
      continue;
    }
    info.starForwards.push(specifier);
    // A name a regular star forwards stays a value, whatever type-only star also forwards it.
    for (const exported of checker.getExportsOfModule(module)) {
      if (statement.isTypeOnly && starNames.get(exported.name)?.typeOnly === false) continue;
      starNames.set(exported.name, { exported, typeOnly: statement.isTypeOnly });
    }
  }

  const module = checker.getSymbolAtLocation(file);
  for (const exported of module ? checker.getExportsOfModule(module) : []) {
    const name = exported.name;
    info.exportNames.push(name);
    const here = exported.declarations?.find((declaration) => declaration.getSourceFile() === file);
    if (here === undefined) {
      if (starNames.has(name)) {
        info.starCovered.add(name);
        const star = starNames.get(name);
        info.forwardedFrom.set(name, declaringPackage(checker, star.exported));
        info.forwardKinds.set(name, kindsOf(checker, star.exported, star.typeOnly));
      } else info.problems.push(`cannot tell where the export ${name} comes from`);
      continue;
    }
    const target =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const own = (target.declarations ?? []).filter(
      (declaration) => isOwn(declaration) && !ts.isSourceFile(declaration),
    );
    if (own.length > 0) {
      const group = info.groups.get(target) ?? {
        symbol: target,
        names: [],
        declaredNames: new Set(
          own.map((declaration) => ts.getNameOfDeclaration(declaration)?.getText()).filter(Boolean),
        ),
        items: [],
        typeOnly: new Map(),
      };
      group.names.push(name);
      group.typeOnly.set(name, isTypeOnlyExport(checker, exported));
      info.groups.set(target, group);
      continue;
    }
    const forward = traceForward(checker, exported);
    info.forwardKinds.set(name, kindsOf(checker, exported));
    if (forward === undefined) {
      info.problems.push(
        `cannot list the export ${name}: it is neither declared in this package nor forwarded from another`,
      );
    } else if (forward.originalName === undefined) {
      info.namespaceForwards.push({
        exportName: name,
        from: forward.from,
        typeOnly: forward.typeOnly,
      });
    } else {
      info.forwardedFrom.set(name, declaringPackage(checker, exported));
      info.namedForwards.push({
        exportName: name,
        originalName: forward.originalName,
        from: forward.from,
        typeOnly: forward.typeOnly,
      });
    }
  }
  info.augmentations = augmentationsOf(reachableFiles(program, file, packageDir), info.problems);
  return info;
}

// Returns, for each path, its export names, the package's own exported declarations grouped by
// symbol, its forwards and its augmentations, plus the checker that resolves names in them.
export function readExports(packageDir, entryPoints) {
  const options = compilerOptions(packageDir);
  const program = ts.createProgram(
    entryPoints.map(({ declarationFile }) => declarationFile),
    options,
    ts.createCompilerHost(options),
  );
  const checker = program.getTypeChecker();
  const isOwn = (node) => node.getSourceFile().fileName.startsWith(`${packageDir}${sep}`);
  const paths = new Map();
  for (const { subpath, declarationFile } of entryPoints) {
    paths.set(
      subpath,
      readPath(checker, program, program.getSourceFile(declarationFile), packageDir),
    );
  }
  return {
    program,
    checker,
    paths,
    isOwn,
    containers: containersByLocation(program, checker, isOwn, packageDir),
    memberKeysOf: (symbol, kind) => ownMemberKeys(symbol, kind, isOwn),
  };
}
