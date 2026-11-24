// Turns one package's API into the sorted lines of its api.txt. The TypeScript compiler
// (declarations.mjs) says what each import path exports, under which names; API Extractor's
// models give the declarations' text and their members, and the types signatures use.

import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ApiItemKind, ApiPackage } from '@microsoft/api-extractor-model';
import ts from 'typescript';
import { readDeclarations } from './declarations.mjs';
import { compareCodeUnits, normalizeTypes, renderNode, TypeTextError } from './normalize-type.mjs';

export class ApiListError extends Error {}

export { compareCodeUnits };

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

function loadModels(entryPoints) {
  return [...entryPoints]
    .sort((a, b) => compareCodeUnits(a.subpath, b.subpath))
    .map((entryPoint) => {
      const model = ApiPackage.loadFromJsonFile(entryPoint.modelFile).entryPoints[0];
      const byReference = new Map(
        model.members.map((item) => [item.canonicalReference.toString(), item]),
      );
      return { ...entryPoint, packageName: model.parent.name, items: model.members, byReference };
    });
}

const AE_SIGNATURE_KEYS = {
  [ApiItemKind.CallSignature]: '__call',
  [ApiItemKind.ConstructSignature]: '__new',
  [ApiItemKind.IndexSignature]: '__index',
  [ApiItemKind.Constructor]: '__constructor',
};

const memberKeyOf = (member) =>
  AE_SIGNATURE_KEYS[member.kind] ?? member.displayName.replace(/^(["'])(.*)\1$/, '$2');

function forEachItem(items, visit) {
  for (const item of items) {
    visit(item);
    if (item.members) forEachItem(item.members, visit);
  }
}

// Matches each item API Extractor marks exported to the symbol TypeScript exports it as: by the
// declared name, and by the export name where two exported declarations share a declared name.
// API Extractor adds `_2` to a name a global also has.
function matchExports(model, info, problems) {
  const groups = [...info.groups.values()];
  const exported = new Map();
  for (const item of model.items) {
    if (!item.isExported) continue;
    let candidates = groups.filter((group) => group.declaredNames.has(declaredName(item)));
    if (candidates.length > 1) {
      const names = [item.displayName, item.displayName.replace(/_\d+$/, '')];
      candidates = candidates.filter((group) => names.some((name) => group.names.includes(name)));
    }
    if (candidates.length !== 1) {
      problems.push(
        `${model.subpath}: API Extractor lists ${item.displayName}, which matches ${candidates.length} exports TypeScript sees`,
      );
      continue;
    }
    candidates[0].items.push(item);
    exported.set(item, candidates[0]);
  }
  for (const group of groups) {
    const named = group.names.filter((name) => name !== 'default').sort(compareCodeUnits);
    group.referenceName = named[0] ?? withoutBundlerSuffix([...group.declaredNames][0]);
  }
  return exported;
}

// Names of types from elsewhere (other packages, the standard library) that the lines refer to.
function externalNames(models, packageName) {
  const names = new Set();
  for (const model of models) {
    forEachItem(model.items, (item) => {
      for (const token of item.excerpt?.spannedTokens ?? []) {
        const reference =
          token.kind === 'Reference' ? token.canonicalReference?.toString() : undefined;
        if (reference === undefined || reference.startsWith(`${packageName}!`)) continue;
        const external = TOP_LEVEL_REFERENCE.exec(reference);
        const name = external && token.text.includes('$') ? external[2] : token.text;
        if (IDENTIFIER.test(name)) names.add(name);
      }
    });
  }
  return names;
}

const MAX_NAMING_ROUNDS = 20;

// Gives every declaration one printed name: its export name if it is exported, otherwise a
// name unique in the package, with `_2`, `_3` for names that clash. Non-exported declarations
// are ordered by their printed text; those that print identically with the final names of
// what they refer to are one declaration copied into two files, and share one name.
function nameDeclarations(models, paths, packageName, problems) {
  const exportedByModel = new Map();
  const exportedNames = new Map();
  const taken = externalNames(models, packageName);
  for (const model of models) {
    const info = paths.get(model.subpath);
    for (const name of info.exportNames) taken.add(name);
    const exported = matchExports(model, info, problems);
    exportedByModel.set(model, exported);
    for (const [item, group] of exported) {
      const key = declarationKey(item);
      if (!exportedNames.has(key)) exportedNames.set(key, group.referenceName);
    }
  }

  const locals = new Map();
  for (const model of models) {
    const exported = exportedByModel.get(model);
    const own = new Map();
    for (const item of model.items) {
      if (exported.has(item)) continue;
      const key = declarationKey(item);
      if (exportedNames.has(key) || locals.has(key)) continue;
      own.set(key, [...(own.get(key) ?? []), item]);
    }
    for (const [key, items] of own) locals.set(key, { key, model, items });
  }

  let localNames = new Map();
  const nameOf = (model, fallback) => (reference) => {
    const item = model.byReference.get(reference);
    if (item === undefined) return undefined;
    const group = exportedByModel.get(model).get(item);
    if (group) return group.referenceName;
    const key = declarationKey(item);
    return exportedNames.get(key) ?? localNames.get(key) ?? fallback(item);
  };
  const sourceName = (item) => withoutBundlerSuffix(declaredName(item));

  for (let round = 0; ; round++) {
    const byBase = new Map();
    for (const local of locals.values()) {
      const base = sourceName(local.items[0]);
      const lines = new LineSet();
      for (const item of local.items) {
        emitItem(item, {
          prefix: '',
          context: '',
          ownName: base,
          nameOf: nameOf(local.model, sourceName),
          origin: local.key,
          lines,
        });
      }
      local.content = lines.sorted().join('\n');
      byBase.set(base, [...(byBase.get(base) ?? []), local]);
    }
    const next = new Map();
    const used = new Set(taken);
    for (const base of [...byBase.keys()].sort(compareCodeUnits)) {
      const group = byBase.get(base).sort((a, b) => compareCodeUnits(a.content, b.content));
      let suffix = 1;
      let previous;
      for (const local of group) {
        local.sameAs = previous?.content === local.content ? previous : undefined;
        if (local.sameAs) {
          next.set(local.key, next.get(local.sameAs.key));
          continue;
        }
        let name = suffix === 1 ? base : `${base}_${suffix}`;
        while (used.has(name)) name = `${base}_${++suffix}`;
        suffix++;
        used.add(name);
        next.set(local.key, name);
        previous = local;
      }
    }
    const stable = [...next].every(([key, name]) => localNames.get(key) === name);
    localNames = next;
    if (stable && round > 0) break;
    if (round === MAX_NAMING_ROUNDS) {
      throw new ApiListError('the names of non-exported declarations do not settle');
    }
  }

  return {
    locals,
    localNames,
    nameOf: (model) => nameOf(model, () => undefined),
  };
}

export function portabilityProblems(lines, root) {
  const problems = [];
  for (const line of lines) {
    if (line.includes(root) || /import\("(\.{1,2}\/|\/|[A-Za-z]:)/.test(line)) {
      problems.push(`line names a local path: ${line}`);
    }
    const outsideStrings = line.replace(
      /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
      '""',
    );
    if (/[A-Za-z0-9_]\$\d+\b/.test(outsideStrings)) {
      problems.push(`line has a name the bundler renamed: ${line}`);
    }
  }
  return problems;
}

function repositoryRoot(from) {
  let folder = from;
  while (!existsSync(join(folder, 'pnpm-workspace.yaml')) && dirname(folder) !== folder) {
    folder = dirname(folder);
  }
  return folder;
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

// Prints the name of a type an augmentation refers to, as the other lines print it.
function augmentationNames({ checker, isOwn, model, info, packageGroups, localNames }) {
  return (identifier) => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol === undefined) return undefined;
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if (target.flags & ts.SymbolFlags.TypeParameter) return undefined;
    const declarations = target.declarations ?? [];
    if (!declarations.some(isOwn)) return withoutBundlerSuffix(target.name);
    const group = info.groups.get(target) ?? packageGroups.get(target);
    if (group) return group.referenceName;
    const declared = new Set(
      declarations.map((declaration) => ts.getNameOfDeclaration(declaration)?.getText()),
    );
    const keys = new Set(
      model.items.filter((item) => declared.has(declaredName(item))).map(declarationKey),
    );
    const name = keys.size === 1 ? localNames.get([...keys][0]) : undefined;
    if (name === undefined) {
      throw new ApiListError(
        `refers to ${withoutBundlerSuffix(target.name)}, a type of this package that no line lists`,
      );
    }
    return name;
  };
}

function augmentationLines(augmentation, rename) {
  const lines = [{ line: augmentation.head, deprecated: false }];
  for (const member of augmentation.members) {
    const text = oneLine(renderNode(member, augmentation.file, rename))
      .replace(/;$/, '')
      .replace(MEMBER_MODIFIERS, '');
    lines.push({
      line: `${augmentation.head}, ${augmentationMemberWords(member)} ${text}`,
      deprecated: ts.getJSDocDeprecatedTag(member) !== undefined,
    });
  }
  return lines;
}

export function flattenPackage(packageDir, entryPoints) {
  const where = relative(process.cwd(), packageDir);
  const declarations = readDeclarations(packageDir, entryPoints);
  const problems = [...declarations.paths].flatMap(([subpath, info]) =>
    info.problems.map((problem) => `${subpath}: ${problem}`),
  );
  if (problems.length > 0) throw new ApiListError(`${where}:\n  ${problems.join('\n  ')}`);

  let sorted;
  try {
    sorted = collectLines(loadModels(entryPoints), declarations);
  } catch (error) {
    if (!(error instanceof ApiListError)) throw error;
    throw new ApiListError(`${where}: ${error.message}`);
  }
  const portability = portabilityProblems(sorted, repositoryRoot(packageDir));
  if (portability.length > 0) throw new ApiListError(`${where}:\n  ${portability.join('\n  ')}`);
  return sorted;
}

function collectLines(models, { checker, paths, isOwn }) {
  const problems = [];
  const packageName = models[0]?.packageName;
  const { locals, localNames, nameOf } = nameDeclarations(models, paths, packageName, problems);
  const lines = new LineSet();
  const covered = new Set();
  const cover = (subpath, name) => covered.add(`${subpath}\0${name}`);

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

  const packageGroups = new Map();
  for (const model of models) {
    for (const group of paths.get(model.subpath).groups.values()) {
      if (!packageGroups.has(group.symbol)) packageGroups.set(group.symbol, group);
    }
  }

  for (const model of models) {
    const info = paths.get(model.subpath);
    const pathPrefix = `${model.subpath}: `;
    for (const group of info.groups.values()) {
      for (const name of group.names) {
        for (const item of group.items) {
          const isDefault = name === 'default';
          emitItem(item, {
            prefix: isDefault ? `${pathPrefix}export default = ` : pathPrefix,
            context: '',
            ownName: isDefault ? withoutBundlerSuffix(declaredName(item)) : name,
            nameOf: nameOf(model),
            origin: `${model.subpath} ${name}`,
            lines,
          });
          cover(model.subpath, name);
        }
      }
      if (group.memberKeys === undefined) continue;
      const listed = new Set(group.items.flatMap((item) => (item.members ?? []).map(memberKeyOf)));
      for (const key of group.memberKeys) {
        if (!listed.has(key)) {
          problems.push(`${model.subpath}: member ${group.referenceName}.${key} has no line`);
        }
      }
    }
    for (const specifier of info.starForwards) {
      lines.add(`${pathPrefix}everything from ${specifier}`, `${model.subpath} * ${specifier}`);
    }
    for (const name of info.starCovered) cover(model.subpath, name);
    for (const forward of info.namespaceForwards) {
      lines.add(
        `${pathPrefix}export ${forward.exportName} = everything from ${forward.from}`,
        `${model.subpath} namespace ${forward.exportName}`,
      );
      cover(model.subpath, forward.exportName);
    }
    for (const forward of info.namedForwards) {
      const original =
        forward.originalName !== forward.exportName ? ` (as ${forward.originalName})` : '';
      lines.add(
        `${pathPrefix}export ${forward.exportName} from ${forward.from}${original}`,
        `${model.subpath} forward ${forward.exportName}`,
      );
      cover(model.subpath, forward.exportName);
    }
    const rename = augmentationNames({ checker, isOwn, model, info, packageGroups, localNames });
    for (const augmentation of info.augmentations) {
      let augmentationLinesOfPath;
      try {
        augmentationLinesOfPath = augmentationLines(augmentation, rename);
      } catch (error) {
        if (!(error instanceof ApiListError)) throw error;
        problems.push(`${model.subpath}: ${augmentation.head}: ${error.message}`);
        continue;
      }
      for (const { line, deprecated } of augmentationLinesOfPath) {
        const origin = `${model.subpath} augmentation ${line}`;
        lines.add(`${pathPrefix}${line}`, origin);
        if (deprecated) lines.add(`${pathPrefix}deprecated: ${line}`, origin);
      }
    }
    for (const name of info.exportNames) {
      if (!covered.has(`${model.subpath}\0${name}`)) {
        problems.push(`${model.subpath}: export ${name} has no line`);
      }
    }
  }
  if (problems.length > 0) throw new ApiListError(`\n  ${problems.join('\n  ')}`);
  return lines.sorted();
}
