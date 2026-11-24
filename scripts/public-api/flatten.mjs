// Turns the API Extractor models of one package, plus what API Extractor leaves out
// (forwarded paths and `declare module` augmentations, read with the TypeScript compiler),
// into the sorted lines of the package's api.txt.

import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ApiItemKind, ApiPackage } from '@microsoft/api-extractor-model';
import ts from 'typescript';
import { normalizeTypes, TypeTextError } from './normalize-type.mjs';

export class ApiListError extends Error {}

export const compareCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();
const withoutBundlerSuffix = (name) => name.replace(/\$\d+$/, '');
const IDENTIFIER = /^[A-Za-z0-9_$]+$/;
const TOP_LEVEL_REFERENCE = /^(@?[^!]+)!~?([A-Za-z0-9_$]+):[a-z]+(\(\d+\))?$/;
const DECLARATION_HEAD =
  /^((?:export )?(?:declare )?(?:abstract )?(?:type|interface|class|function|const enum|const|let|var|enum|namespace|module) )([A-Za-z0-9_$]+)/;
const BARE_HEAD = /^([A-Za-z0-9_$]+)(?=[:<(?])/;
const MEMBER_MODIFIERS = /^((readonly|static|protected|abstract|public|declare|override) )+/;

const CONTAINER_WORDS = {
  [ApiItemKind.Class]: 'class',
  [ApiItemKind.Interface]: 'interface',
  [ApiItemKind.Namespace]: 'namespace',
  [ApiItemKind.Enum]: 'enum',
};

const MEMBER_KIND_WORDS = {
  [ApiItemKind.PropertySignature]: 'property',
  [ApiItemKind.Property]: 'property',
  [ApiItemKind.MethodSignature]: 'method',
  [ApiItemKind.Method]: 'method',
  [ApiItemKind.CallSignature]: 'call signature',
  [ApiItemKind.ConstructSignature]: 'construct signature',
  [ApiItemKind.IndexSignature]: 'index signature',
  [ApiItemKind.EnumMember]: 'member',
};

const isTopLevel = (item) =>
  item.parent?.kind === ApiItemKind.EntryPoint || item.parent?.kind === ApiItemKind.Namespace;

function declaredName(item) {
  const text = oneLine(item.excerpt.text);
  return DECLARATION_HEAD.exec(text)?.[2] ?? BARE_HEAD.exec(text)?.[1] ?? item.displayName;
}

const declarationKey = (item) => [item.fileUrlPath ?? '', item.kind, declaredName(item)].join('\0');

// Prints an item's declaration text. `nameOf` gives the printed name of a top-level item of
// this package from its canonical reference, and `ownName` the name this item is printed under.
function excerptText(item, nameOf, ownName) {
  let text = '';
  for (const token of item.excerpt.spannedTokens) {
    const reference = token.kind === 'Reference' ? token.canonicalReference?.toString() : undefined;
    if (reference === undefined || !IDENTIFIER.test(token.text)) {
      text += token.text;
      continue;
    }
    const local = nameOf(reference);
    const external = TOP_LEVEL_REFERENCE.exec(reference);
    text += local ?? (external && token.text.includes('$') ? external[2] : token.text);
  }
  text = oneLine(text)
    .replace(/^(export )?(declare )?/, '')
    .replace(/;$/, '');
  if (!isTopLevel(item)) return text;
  const head = DECLARATION_HEAD.exec(text);
  if (head)
    return `${head[1].replace(/^(export )?(declare )?/, '')}${ownName}${text.slice(head[0].length)}`;
  const bare = BARE_HEAD.exec(text);
  return bare ? `${ownName}${text.slice(bare[0].length)}` : text;
}

function signature(item, nameOf, ownName) {
  const text = excerptText(item, nameOf, ownName);
  if (item.kind === ApiItemKind.Variable) {
    return normalizeTypes(`${item.isReadonly ? 'const' : 'let'} ${text}`, 'declaration');
  }
  if (item.kind === ApiItemKind.Function && !text.startsWith('function ')) {
    return normalizeTypes(`const ${text}`, 'declaration');
  }
  return normalizeTypes(text, 'declaration');
}

function memberContext(item) {
  if (item.kind === ApiItemKind.EnumMember) return 'enum member';
  return item.parent?.kind === ApiItemKind.Class ? 'class member' : 'interface member';
}

function memberLine(item, nameOf) {
  const text = normalizeTypes(
    excerptText(item, nameOf, item.displayName),
    memberContext(item),
  ).replace(MEMBER_MODIFIERS, '');
  const words = [];
  if (item.isStatic) words.push('static');
  if (item.isAbstract) words.push('abstract');
  if (item.isProtected) words.push('protected');
  if (item.isReadonly) words.push('readonly');
  if ('isOptional' in item) words.push(item.isOptional ? 'optional' : 'required');
  if (item.kind !== ApiItemKind.Constructor) words.push(MEMBER_KIND_WORDS[item.kind] ?? item.kind);
  return [...words, text].join(' ');
}

class LineSet {
  #origins = new Map();

  add(line, origin) {
    const previous = this.#origins.get(line);
    if (previous !== undefined && previous !== origin) {
      throw new ApiListError(
        `two different items give the line "${line}" (${previous} and ${origin}). Rename one of them, or teach scripts/public-api/flatten.mjs to tell them apart.`,
      );
    }
    this.#origins.set(line, origin);
  }

  sorted() {
    return [...this.#origins.keys()].sort(compareCodeUnits);
  }
}

// Emits the lines of one item and its members. `ownName` is null for a member.
function emitItem(item, { prefix, context, ownName, nameOf, origin, lines }) {
  const itemOrigin = `${origin} ${item.canonicalReference.toString()}`;
  let own;
  try {
    own =
      ownName === null
        ? `${context}${memberLine(item, nameOf)}`
        : `${context}${signature(item, nameOf, ownName)}`;
  } catch (error) {
    if (!(error instanceof TypeTextError)) throw error;
    throw new ApiListError(`${prefix}${item.canonicalReference.toString()}: ${error.message}`);
  }
  lines.add(`${prefix}${own}`, itemOrigin);
  if (item.tsdocComment?.deprecatedBlock) lines.add(`${prefix}deprecated: ${own}`, itemOrigin);
  const containerWord = CONTAINER_WORDS[item.kind];
  if (!containerWord) return;
  const childContext = `${context}${containerWord} ${ownName ?? item.displayName}, `;
  const inNamespace = item.kind === ApiItemKind.Namespace;
  for (const member of item.members) {
    emitItem(member, {
      prefix,
      context: childContext,
      ownName: inNamespace ? member.displayName : null,
      nameOf,
      origin,
      lines,
    });
  }
}

function tsCompilerOptions() {
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

const isBare = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('/');

// Follows an exported name through imports and re-exports. Returns the first non-relative
// module it passes through, the name it has there, and the declaration it ends at.
function traceExport(checker, element, exportSpecifier) {
  let bare = exportSpecifier !== undefined && isBare(exportSpecifier) ? exportSpecifier : undefined;
  let originalName = element.propertyName?.text ?? element.name.text;
  let symbol = checker.getSymbolAtLocation(element.name);
  const seen = new Set();
  while (symbol && symbol.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) {
    seen.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      const specifier = moduleSpecifierOf(declaration)?.text;
      if (bare === undefined && specifier !== undefined && isBare(specifier)) {
        bare = specifier;
        originalName = ts.isImportClause(declaration)
          ? 'default'
          : ((declaration.propertyName ?? declaration.name)?.text ?? originalName);
      }
    }
    const next = checker.getImmediateAliasedSymbol(symbol);
    if (!next) break;
    symbol = next;
  }
  return { bare, originalName, symbol, declaration: symbol?.declarations?.[0] };
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

function augmentationMemberWords(member) {
  const words = [];
  if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)) {
    words.push('readonly');
  }
  if (ts.isPropertySignature(member) || ts.isMethodSignature(member)) {
    words.push(member.questionToken ? 'optional' : 'required');
  }
  if (ts.isPropertySignature(member)) words.push('property');
  else if (ts.isMethodSignature(member)) words.push('method');
  else if (ts.isCallSignatureDeclaration(member)) words.push('call signature');
  else if (ts.isConstructSignatureDeclaration(member)) words.push('construct signature');
  else if (ts.isIndexSignatureDeclaration(member)) words.push('index signature');
  else words.push(ts.SyntaxKind[member.kind]);
  return words.join(' ');
}

function augmentationMemberText(member) {
  const source = member.getSourceFile().text;
  const start = member.modifiers?.length
    ? member.modifiers[member.modifiers.length - 1].end
    : member.getStart();
  return oneLine(source.slice(start, member.end)).replace(/;$/, '');
}

function augmentationsOf(files) {
  const found = [];
  const problems = [];
  for (const file of files) {
    for (const statement of file.statements) {
      if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)) continue;
      if (!statement.body || !ts.isModuleBlock(statement.body)) continue;
      for (const declaration of statement.body.statements) {
        if (!ts.isInterfaceDeclaration(declaration)) {
          problems.push(
            `declare module "${statement.name.text}" contains a ${ts.SyntaxKind[declaration.kind]}, which this script cannot list`,
          );
          continue;
        }
        const head = `augments ${statement.name.text} interface ${declaration.name.text}`;
        found.push({ line: head, deprecated: false });
        for (const member of declaration.members) {
          try {
            const text = normalizeTypes(augmentationMemberText(member), 'interface member');
            found.push({
              line: `${head}, ${augmentationMemberWords(member)} ${text}`,
              deprecated: ts.getJSDocDeprecatedTag(member) !== undefined,
            });
          } catch (error) {
            if (!(error instanceof TypeTextError)) throw error;
            problems.push(`${head}: ${error.message}`);
          }
        }
      }
    }
  }
  return { found, problems };
}

// What API Extractor leaves out: forwarded paths, export names that differ from the
// declared name, and `declare module` augmentations.
function analyseDeclarations(packageDir, entryPoints) {
  const options = tsCompilerOptions();
  const program = ts.createProgram(
    entryPoints.map(({ declarationFile }) => declarationFile),
    options,
    ts.createCompilerHost(options),
  );
  const checker = program.getTypeChecker();
  const result = new Map();
  for (const { subpath, declarationFile } of entryPoints) {
    const file = program.getSourceFile(declarationFile);
    const info = {
      starForwards: [],
      namedForwards: [],
      renames: new Map(),
      augmentations: [],
      problems: [],
    };
    result.set(subpath, info);
    for (const statement of file.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier?.text;
      if (!statement.exportClause) {
        if (specifier !== undefined && isBare(specifier)) info.starForwards.push(specifier);
        else info.problems.push(`export * from "${specifier}" is not a forward of another package`);
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        info.problems.push(`cannot list ${oneLine(statement.getText())}`);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        const exportName = element.name.text;
        const traced = traceExport(checker, element, specifier);
        const targetFile = traced.declaration?.getSourceFile().fileName;
        const ownTarget = targetFile?.startsWith(`${packageDir}${sep}`) ?? false;
        if (traced.bare !== undefined && !ownTarget) {
          info.namedForwards.push({
            exportName,
            originalName: traced.originalName,
            from: traced.bare,
          });
        } else if (traced.declaration) {
          const declared = withoutBundlerSuffix(ts.symbolName(traced.symbol));
          if (traced.symbol.escapedName !== 'default' && declared !== exportName) {
            info.renames.set(declared, exportName);
          }
        } else {
          info.problems.push(`cannot resolve the export ${exportName}`);
        }
      }
    }
    const augmentations = augmentationsOf(reachableFiles(program, file, packageDir));
    info.augmentations = augmentations.found;
    info.problems.push(...augmentations.problems);
  }
  return result;
}

function loadModels(entryPoints) {
  return [...entryPoints]
    .sort((a, b) => compareCodeUnits(a.subpath, b.subpath))
    .map((entryPoint) => {
      const model = ApiPackage.loadFromJsonFile(entryPoint.modelFile).entryPoints[0];
      const byReference = new Map(
        model.members.map((item) => [item.canonicalReference.toString(), item]),
      );
      return { ...entryPoint, items: model.members, byReference };
    });
}

// Gives every declaration of the package one printed name: an export name for an
// exported declaration, and for the rest a name unique in the package, with `_2`, `_3`
// for declarations whose names clash. Declarations that print identically share one name.
function nameDeclarations(models, analysis) {
  const exportedNames = new Map();
  const taken = new Set();
  for (const model of models) {
    for (const item of model.items) {
      if (!item.isExported) continue;
      taken.add(item.displayName);
      const key = declarationKey(item);
      if (!exportedNames.has(key)) exportedNames.set(key, item.displayName);
    }
    for (const { exportName } of analysis.get(model.subpath).namedForwards) taken.add(exportName);
  }

  const locals = new Map();
  for (const model of models) {
    for (const item of model.items) {
      if (item.isExported) continue;
      const key = declarationKey(item);
      if (exportedNames.has(key)) continue;
      const local = locals.get(key) ?? { key, model, items: [] };
      if (local.model === model) local.items.push(item);
      locals.set(key, local);
    }
  }

  const sourceNameOf = (model) => (reference) => {
    const item = model.byReference.get(reference);
    return item === undefined ? undefined : withoutBundlerSuffix(declaredName(item));
  };
  const byBase = new Map();
  for (const local of locals.values()) {
    const base = withoutBundlerSuffix(declaredName(local.items[0]));
    const lines = new LineSet();
    for (const item of local.items) {
      emitItem(item, {
        prefix: '',
        context: '',
        ownName: base,
        nameOf: sourceNameOf(local.model),
        origin: local.key,
        lines,
      });
    }
    local.content = lines.sorted().join('\n');
    byBase.set(base, [...(byBase.get(base) ?? []), local]);
  }

  const localNames = new Map();
  for (const base of [...byBase.keys()].sort(compareCodeUnits)) {
    const group = byBase.get(base).sort((a, b) => compareCodeUnits(a.content, b.content));
    let suffix = 1;
    let previous;
    for (const local of group) {
      if (previous?.content === local.content) {
        localNames.set(local.key, localNames.get(previous.key));
        local.sameAs = previous;
        continue;
      }
      let name = suffix === 1 ? base : `${base}_${suffix}`;
      while (taken.has(name)) name = `${base}_${++suffix}`;
      suffix++;
      taken.add(name);
      localNames.set(local.key, name);
      previous = local;
    }
  }

  const nameOf = (model) => (reference) => {
    const item = model.byReference.get(reference);
    if (item === undefined) return undefined;
    if (item.isExported) return item.displayName;
    const key = declarationKey(item);
    return exportedNames.get(key) ?? localNames.get(key);
  };
  return { locals, localNames, nameOf };
}

export function portabilityProblems(lines, root) {
  return lines
    .filter((line) => line.includes(root) || /import\("(\.{1,2}\/|\/|[A-Za-z]:)/.test(line))
    .map((line) => `line names a local path: ${line}`);
}

function repositoryRoot(from) {
  let folder = from;
  while (!existsSync(join(folder, 'pnpm-workspace.yaml')) && dirname(folder) !== folder) {
    folder = dirname(folder);
  }
  return folder;
}

export function flattenPackage(packageDir, entryPoints) {
  const analysis = analyseDeclarations(packageDir, entryPoints);
  const problems = [...analysis].flatMap(([subpath, info]) =>
    info.problems.map((problem) => `${subpath}: ${problem}`),
  );
  if (problems.length > 0) {
    throw new ApiListError(`${relative(process.cwd(), packageDir)}:\n  ${problems.join('\n  ')}`);
  }

  let sorted;
  try {
    sorted = collectLines(loadModels(entryPoints), analysis);
  } catch (error) {
    if (!(error instanceof ApiListError)) throw error;
    throw new ApiListError(`${relative(process.cwd(), packageDir)}: ${error.message}`);
  }
  const portability = portabilityProblems(sorted, repositoryRoot(packageDir));
  if (portability.length > 0) {
    throw new ApiListError(
      `${relative(process.cwd(), packageDir)}:\n  ${portability.join('\n  ')}`,
    );
  }
  return sorted;
}

function collectLines(models, analysis) {
  const { locals, localNames, nameOf } = nameDeclarations(models, analysis);
  const lines = new LineSet();

  for (const local of locals.values()) {
    if (local.sameAs) continue;
    for (const item of local.items) {
      emitItem(item, {
        prefix: '(not exported) ',
        context: '',
        ownName: localNames.get(local.key),
        nameOf: nameOf(local.model),
        origin: local.key,
        lines,
      });
    }
  }

  for (const model of models) {
    const info = analysis.get(model.subpath);
    const pathPrefix = `${model.subpath}: `;
    for (const item of model.items) {
      if (!item.isExported) continue;
      const declared = withoutBundlerSuffix(declaredName(item));
      const exportName = info.renames.get(declared);
      const renamed = exportName !== undefined && exportName !== item.displayName;
      emitItem(item, {
        prefix: renamed ? `${pathPrefix}export ${exportName} = ` : pathPrefix,
        context: '',
        ownName: renamed ? declared : item.displayName,
        nameOf: nameOf(model),
        origin: model.subpath,
        lines,
      });
    }
    for (const specifier of info.starForwards) {
      lines.add(`${pathPrefix}everything from ${specifier}`, `${model.subpath} * ${specifier}`);
    }
    for (const forward of info.namedForwards) {
      const original =
        forward.originalName !== forward.exportName ? ` (as ${forward.originalName})` : '';
      lines.add(
        `${pathPrefix}export ${forward.exportName} from ${forward.from}${original}`,
        `${model.subpath} forward ${forward.exportName}`,
      );
    }
    for (const { line, deprecated } of info.augmentations) {
      lines.add(`${pathPrefix}${line}`, `${model.subpath} augmentation ${line}`);
      if (deprecated)
        lines.add(`${pathPrefix}deprecated: ${line}`, `${model.subpath} augmentation ${line}`);
    }
  }

  return lines.sorted();
}
