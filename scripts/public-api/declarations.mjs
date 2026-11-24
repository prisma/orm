// What each import path of a package exports, as the TypeScript compiler sees it. This uses the
// repository's TypeScript; API Extractor brings its own copy, which reads the same files.

import { dirname, resolve, sep } from 'node:path';
import ts from 'typescript';

const isBare = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('/');
const SIGNATURE_MEMBERS = new Set(['__call', '__new', '__index', '__constructor']);

function compilerOptions() {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    strict: true,
    skipLibCheck: true,
    types: ['node'],
    noEmit: true,
  };
}

function moduleSpecifierOf(declaration) {
  if (ts.isImportSpecifier(declaration)) return declaration.parent.parent.parent.moduleSpecifier;
  if (ts.isExportSpecifier(declaration)) return declaration.parent.parent.moduleSpecifier;
  if (ts.isImportClause(declaration)) return declaration.parent.moduleSpecifier;
  if (ts.isNamespaceImport(declaration)) return declaration.parent.parent.moduleSpecifier;
  return undefined;
}

// Follows an export through imports and re-exports to the first non-relative module it passes,
// and the name it has there.
function traceForward(checker, symbol) {
  let current = symbol;
  const seen = new Set();
  while (current && current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
    seen.add(current);
    for (const declaration of current.declarations ?? []) {
      const specifier = moduleSpecifierOf(declaration)?.text;
      if (specifier === undefined || !isBare(specifier)) continue;
      if (ts.isImportClause(declaration)) return { from: specifier, originalName: 'default' };
      if (ts.isNamespaceImport(declaration)) return { from: specifier, originalName: undefined };
      return { from: specifier, originalName: (declaration.propertyName ?? declaration.name).text };
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
  if (kind === 'enum' || kind === 'namespace') members.push(...(symbol.exports?.values() ?? []));
  else {
    members.push(...(symbol.members?.values() ?? []));
    if (kind === 'class') {
      for (const member of symbol.exports?.values() ?? []) {
        if (member.escapedName !== 'prototype') members.push(member);
      }
    }
  }
  const keys = new Set();
  for (const member of members) {
    if (member.flags & ts.SymbolFlags.TypeParameter) continue;
    const own = (member.declarations ?? []).filter(
      (declaration) => isOwn(declaration) && !inAugmentation(declaration),
    );
    if (own.length === 0 || own.every(isPrivate)) continue;
    keys.add(memberKey(member));
  }
  return keys;
}

// The classes, interfaces, enums and namespaces declared at the top of the package's files, by name.
function containersByName(program, checker, isOwn) {
  const byName = new Map();
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
      const name = statement.name.text;
      const symbols = byName.get(name) ?? new Set();
      symbols.add(symbol);
      byName.set(name, symbols);
    }
  }
  return byName;
}

function reachableFiles(program, entry, packageDir) {
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
      const path = resolve(dirname(file.fileName), specifier.replace(/\.mjs$/, '.d.mts'));
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
          head: `augments ${statement.name.text} interface ${declaration.name.text}`,
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
    augmentations: [],
    problems: [],
  };
  const starNames = new Set();
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
    for (const exported of checker.getExportsOfModule(module)) starNames.add(exported.name);
  }

  const module = checker.getSymbolAtLocation(file);
  for (const exported of module ? checker.getExportsOfModule(module) : []) {
    const name = exported.name;
    info.exportNames.push(name);
    const here = exported.declarations?.find((declaration) => declaration.getSourceFile() === file);
    if (here === undefined) {
      if (starNames.has(name)) info.starCovered.add(name);
      else info.problems.push(`cannot tell where the export ${name} comes from`);
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
      };
      group.names.push(name);
      info.groups.set(target, group);
      continue;
    }
    const forward = traceForward(checker, exported);
    if (forward === undefined) {
      info.problems.push(
        `cannot list the export ${name}: it is neither declared in this package nor forwarded from another`,
      );
    } else if (forward.originalName === undefined) {
      info.namespaceForwards.push({ exportName: name, from: forward.from });
    } else {
      info.namedForwards.push({
        exportName: name,
        originalName: forward.originalName,
        from: forward.from,
      });
    }
  }
  info.augmentations = augmentationsOf(reachableFiles(program, file, packageDir), info.problems);
  return info;
}

// Returns, for each path, its export names, the package's own exported declarations grouped by
// symbol, its forwards and its augmentations, plus the checker that resolves names in them.
export function readDeclarations(packageDir, entryPoints) {
  const options = compilerOptions();
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
    checker,
    paths,
    isOwn,
    containers: containersByName(program, checker, isOwn),
    memberKeysOf: (symbol, kind) => ownMemberKeys(symbol, kind, isOwn),
  };
}
