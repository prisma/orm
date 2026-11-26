// The compiler host the generated compatibility tests are compiled with; see api-compat.mjs. It
// rewrites declaration files as they are read, so that TypeScript's own assignability compares
// two copies of a package the way a user of it relies on, and it reads each third-party package
// from one physical copy.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const f = ts.factory;

const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const TYPESCRIPT_LIB = /[\\/]typescript[\\/]lib[\\/]/;
const RESTRICTED_MEMBERS = /#private|\b(private|protected)\s/;

const hasModifier = (node, kind) => node.modifiers?.some((m) => m.kind === kind) ?? false;
const withoutModifier = (modifiers, kind) => modifiers?.filter((m) => m.kind !== kind);

const isPrivate = (member) =>
  !ts.isConstructorDeclaration(member) &&
  (hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
    (member.name !== undefined && ts.isPrivateIdentifier(member.name)));

const isProtected = (member) =>
  !ts.isConstructorDeclaration(member) && hasModifier(member, ts.SyntaxKind.ProtectedKeyword);

export const nameText = (name) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();

const isUniqueSymbol = (type) =>
  type !== undefined &&
  ts.isTypeOperatorNode(type) &&
  type.operator === ts.SyntaxKind.UniqueKeyword;

// Members in order, with the overloads of each method gathered where its first one stands, even
// when other members separate them.
function methodGroups(members, isMethod) {
  const key = (member) =>
    `${nameText(member.name)}\0${hasModifier(member, ts.SyntaxKind.StaticKeyword)}`;
  const groups = [];
  const byKey = new Map();
  for (const member of members) {
    if (!isMethod(member)) groups.push({ member });
    else if (byKey.has(key(member))) byKey.get(key(member)).overloads.push(member);
    else {
      const group = { overloads: [member] };
      byKey.set(key(member), group);
      groups.push(group);
    }
  }
  return groups;
}

function functionTypeOf(overloads) {
  const [only] = overloads;
  const returnType = (signature) =>
    signature.type ?? f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
  if (overloads.length === 1) {
    return f.createFunctionTypeNode(only.typeParameters, only.parameters, returnType(only));
  }
  return f.createTypeLiteralNode(
    overloads.map((overload) =>
      f.createCallSignature(overload.typeParameters, overload.parameters, returnType(overload)),
    ),
  );
}

const typeMembers = (members) =>
  methodGroups(members, ts.isMethodSignature).map(({ member, overloads }) =>
    member
      ? member
      : f.createPropertySignature(
          overloads[0].modifiers,
          overloads[0].name,
          overloads[0].questionToken,
          functionTypeOf(overloads),
        ),
  );

// A protected member is part of what a subclass relies on. Under a string key it compares across
// two copies of its class as a public member does.
function exposed(member) {
  if (!isProtected(member)) return member;
  const modifiers = withoutModifier(member.modifiers, ts.SyntaxKind.ProtectedKeyword);
  const name = f.createStringLiteral(`protected ${nameText(member.name)}`);
  if (ts.isMethodDeclaration(member)) {
    return f.updateMethodDeclaration(
      member,
      modifiers,
      member.asteriskToken,
      name,
      member.questionToken,
      member.typeParameters,
      member.parameters,
      member.type,
      member.body,
    );
  }
  if (ts.isPropertyDeclaration(member)) {
    return f.updatePropertyDeclaration(
      member,
      modifiers,
      name,
      member.questionToken ?? member.exclamationToken,
      member.type,
      member.initializer,
    );
  }
  if (ts.isGetAccessorDeclaration(member)) {
    return f.updateGetAccessorDeclaration(
      member,
      modifiers,
      name,
      member.parameters,
      member.type,
      member.body,
    );
  }
  if (ts.isSetAccessorDeclaration(member)) {
    return f.updateSetAccessorDeclaration(member, modifiers, name, member.parameters, member.body);
  }
  return member;
}

// Private members make each copy of a class a type of its own. They are replaced by one marker
// that names the class, so that two copies of a class match and two different classes do not.
function classMembers(node, packageName, rewriteMethods) {
  const visible = node.members.filter((member) => !isPrivate(member));
  const members =
    visible.length < node.members.length ? [marker(node, packageName), ...visible] : visible;
  const exposedMembers = members.map(exposed);
  if (!rewriteMethods) return exposedMembers;
  return methodGroups(exposedMembers, ts.isMethodDeclaration).map(({ member, overloads }) =>
    member
      ? member
      : f.createPropertyDeclaration(
          overloads[0].modifiers,
          overloads[0].name,
          overloads[0].questionToken,
          functionTypeOf(overloads),
          undefined,
        ),
  );
}

const className = (node) => node.name?.text ?? 'default';

// What a declaration's marker is named after: a class with private members, a unique symbol
// constant, or a static unique symbol, as `Class.name`. A node the rewrite built is named after the
// declaration it came from, which has a parent and its own name.
export function markedName(rewritten) {
  const node = ts.getOriginalNode(rewritten);
  if (ts.isClassDeclaration(node)) {
    return node.members.some(isPrivate) ? { kind: 'class', name: className(node) } : undefined;
  }
  if (!isUniqueSymbol(node.type)) return undefined;
  if (ts.isVariableDeclaration(node)) return { kind: 'symbol', name: nameText(node.name) };
  if (ts.isPropertyDeclaration(node)) {
    const owner = ts.isClassDeclaration(node.parent) ? `${className(node.parent)}.` : '';
    return { kind: 'symbol', name: `${owner}${nameText(node.name)}` };
  }
  return undefined;
}

const marker = (node, packageName) =>
  f.createPropertyDeclaration(
    [f.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
    f.createStringLiteral(`private ${packageName}:${className(node)}`),
    undefined,
    f.createLiteralTypeNode(f.createTrue()),
    undefined,
  );

const updateClass = (node, members) =>
  f.updateClassDeclaration(
    node,
    node.modifiers,
    node.name,
    node.typeParameters,
    node.heritageClauses,
    members,
  );

const symbolLiteral = (text) => f.createLiteralTypeNode(f.createStringLiteral(text));

// Rewrites one declaration file. In our packages (`own`), each method becomes a function-typed
// property (overloads a type literal of call signatures), so that its parameters compare
// contravariantly, and each `unique symbol` constant becomes the string literal `symbolName` gives
// it, so that a key made from it is the same key in both copies. In every package, private members
// become a marker naming their class and protected members move to a string key.
export function rewriteDeclarations(fileName, text, { own, packageName, symbolName }) {
  if (!own && !RESTRICTED_MEMBERS.test(text)) return text;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  return print(source, (node) => {
    if (ts.isClassDeclaration(node)) return updateClass(node, classMembers(node, packageName, own));
    if (!own) return node;
    if (ts.isInterfaceDeclaration(node)) {
      return f.updateInterfaceDeclaration(
        node,
        node.modifiers,
        node.name,
        node.typeParameters,
        node.heritageClauses,
        typeMembers(node.members),
      );
    }
    if (ts.isTypeLiteralNode(node)) {
      return f.updateTypeLiteralNode(node, f.createNodeArray(typeMembers(node.members)));
    }
    const marked = markedName(node);
    if (marked?.kind !== 'symbol') return node;
    if (ts.isVariableDeclaration(node)) {
      return f.updateVariableDeclaration(
        node,
        node.name,
        node.exclamationToken,
        symbolLiteral(symbolName(marked.name)),
        node.initializer,
      );
    }
    if (ts.isPropertyDeclaration(node)) {
      return f.updatePropertyDeclaration(
        node,
        node.modifiers,
        node.name,
        node.questionToken,
        symbolLiteral(symbolName(marked.name)),
        node.initializer,
      );
    }
    return node;
  });
}

function print(source, rewrite) {
  const transformer = (context) => {
    const visit = (node) => ts.visitEachChild(rewrite(node), visit, context);
    return (file) => ts.visitNode(file, visit);
  };
  const result = ts.transform(source, [transformer]);
  const text = ts.createPrinter({ removeComments: true }).printFile(result.transformed[0]);
  result.dispose();
  return text;
}

function declarationFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return declarationFiles(path);
    return DECLARATION_FILE.test(entry.name) ? [path] : [];
  });
}

// The names of the markers a package's declarations make, as `markedName` gives them, each with the
// files that declare it.
function markedNamesOf(packageRoot) {
  const found = { class: new Map(), symbol: new Map() };
  for (const file of declarationFiles(packageRoot)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      const marked = markedName(node);
      if (marked) {
        const names = found[marked.kind];
        names.set(marked.name, [...new Set([...(names.get(marked.name) ?? []), file])]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

const packageRootOf = (fileName, name) => {
  const marker = `/node_modules/${name}/`;
  const at = fileName.lastIndexOf(marker);
  return at < 0 ? undefined : fileName.slice(0, at + marker.length);
};

// `packageOf` gives the name and folder of the package a file belongs to, and `isOwn` whether a
// package name is one of ours. Source files are kept for the host's life, so the programs one
// package is compiled in share them; the test files themselves change between programs and are
// read afresh.
export function createCompareHost(options, { packageOf, isOwn }) {
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile.bind(host);
  const files = new Map();
  const symbolsByRoot = new Map();
  // Two unique symbols with one name in one package cannot be told apart by anything an edit to
  // the package does not change, so both get the one name; they are listed in `mergedSymbols`.
  host.mergedSymbols = new Set();
  // The same holds for two classes with private members and one name: they get one marker, and
  // are listed in `mergedClasses`.
  host.mergedClasses = new Set();
  const symbolNameIn = ({ name, root }) => {
    if (!symbolsByRoot.has(root)) {
      symbolsByRoot.set(root, markedNamesOf(root));
      for (const [className, files] of symbolsByRoot.get(root).class) {
        if (files.length > 1) host.mergedClasses.add(`${name}:${className}`);
      }
    }
    return (symbol) => {
      if ((symbolsByRoot.get(root).symbol.get(symbol) ?? []).length > 1) {
        host.mergedSymbols.add(`${name}:${symbol}`);
      }
      return `unique symbol ${name}:${symbol}`;
    };
  };
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (!DECLARATION_FILE.test(fileName)) {
      return readSourceFile(fileName, languageVersion, onError, shouldCreate);
    }
    const key = `${fileName}\0${JSON.stringify(languageVersion)}`;
    if (!files.has(key)) {
      const text = host.readFile(fileName);
      let file;
      if (text !== undefined) {
        const owner = TYPESCRIPT_LIB.test(fileName) ? undefined : packageOf(fileName);
        const own = owner !== undefined && isOwn(owner.name);
        const rewritten =
          owner === undefined
            ? text
            : rewriteDeclarations(fileName, text, {
                own,
                packageName: owner.name,
                symbolName: own ? symbolNameIn(owner) : undefined,
              });
        file = ts.createSourceFile(fileName, rewritten, languageVersion);
      }
      files.set(key, file);
    }
    return files.get(key);
  };

  // Two installs of one third-party version, with different peers, are two packages to
  // TypeScript, and their classes and generic types do not relate. The first copy read is used for
  // every import of that name and version.
  const cache = ts.createModuleResolutionCache(
    host.getCurrentDirectory(),
    host.getCanonicalFileName,
    options,
  );
  const copies = new Map();
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    redirectedReference,
    compilerOptions,
    containingSourceFile,
  ) =>
    literals.map((literal) => {
      const resolution = ts.resolveModuleName(
        literal.text,
        containingFile,
        compilerOptions,
        host,
        cache,
        redirectedReference,
        ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions),
      );
      const resolved = resolution.resolvedModule;
      const id = resolved?.packageId;
      if (!id || isOwn(id.name)) return resolution;
      const root = packageRootOf(resolved.resolvedFileName, id.name);
      if (root === undefined) return resolution;
      const key = `${id.name}@${id.version}`;
      if (!copies.has(key)) copies.set(key, root);
      const first = copies.get(key);
      if (first === root) return resolution;
      return {
        ...resolution,
        resolvedModule: {
          ...resolved,
          resolvedFileName: `${first}${resolved.resolvedFileName.slice(root.length)}`,
        },
      };
    });
  return host;
}

// The exports of a package, as `path\0name`, whose declarations reach, through the names they
// use, a declaration whose marker is in `targets`: `package:name`, with the name `markedName`
// gives, in `classes` or `symbols`. `packageOf` gives a file's package. The compiler's own library
// files are not followed. One walk records which declarations each one names, and a class its
// members; those that reach a target are then found backwards from the targets.
export function exportsReaching(program, entryPoints, { classes, symbols }, packageOf) {
  const checker = program.getTypeChecker();
  const isTarget = (declaration) => {
    const marked = markedName(declaration);
    if (!marked) return false;
    const owner = packageOf(declaration.getSourceFile().fileName)?.name;
    return (marked.kind === 'class' ? classes : symbols).has(`${owner}:${marked.name}`);
  };
  const declarationsOf = (symbol) => {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return resolved.declarations ?? [];
  };
  // What a node names: an identifier, or a member picked by a literal, as in `K[0]`, `K["id"]` and
  // `(typeof K)["id"]`.
  const namesAt = (node) => {
    if (ts.isIdentifier(node)) return [checker.getSymbolAtLocation(node)].filter(Boolean);
    const parent = node.parent;
    if (
      (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) &&
      parent &&
      ts.isElementAccessExpression(parent) &&
      parent.argumentExpression === node
    ) {
      return [checker.getSymbolAtLocation(node)].filter(Boolean);
    }
    if (
      ts.isLiteralTypeNode(node) &&
      (ts.isStringLiteral(node.literal) || ts.isNumericLiteral(node.literal)) &&
      parent &&
      ts.isIndexedAccessTypeNode(parent) &&
      parent.indexType === node
    ) {
      const property = checker
        .getTypeFromTypeNode(parent.objectType)
        .getProperty(node.literal.text);
      return property ? [property] : [];
    }
    return [];
  };
  const namedBy = new Map();
  const pending = [];
  const exportsByKey = new Map();
  for (const { subpath, declarationFile } of entryPoints) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(declarationFile));
    for (const exported of module ? checker.getExportsOfModule(module) : []) {
      const declarations = declarationsOf(exported);
      exportsByKey.set(`${subpath}\0${exported.name}`, declarations);
      pending.push(...declarations);
    }
  }
  while (pending.length > 0) {
    const declaration = pending.pop();
    if (namedBy.has(declaration)) continue;
    const named = new Set();
    namedBy.set(declaration, named);
    if (declaration.getSourceFile().hasNoDefaultLib) continue;
    const reach = (each) => {
      named.add(each);
      if (!namedBy.has(each)) pending.push(each);
    };
    const visit = (node) => {
      for (const found of namesAt(node)) declarationsOf(found).forEach(reach);
      // A class holds its members, whatever form their names take.
      if (ts.isClassLike(node)) node.members.forEach(reach);
      ts.forEachChild(node, visit);
    };
    visit(declaration);
  }
  const namers = new Map();
  for (const [declaration, named] of namedBy) {
    for (const each of named) {
      if (!namers.has(each)) namers.set(each, []);
      namers.get(each).push(declaration);
    }
  }
  const reaching = new Set();
  const backwards = [...namedBy.keys()].filter(isTarget);
  while (backwards.length > 0) {
    const declaration = backwards.pop();
    if (reaching.has(declaration)) continue;
    reaching.add(declaration);
    backwards.push(...(namers.get(declaration) ?? []));
  }
  return new Set(
    [...exportsByKey]
      .filter(([, declarations]) => declarations.some((each) => reaching.has(each)))
      .map(([key]) => key),
  );
}
