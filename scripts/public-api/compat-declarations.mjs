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

const marker = (node, packageName) =>
  f.createPropertyDeclaration(
    [f.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
    f.createStringLiteral(`private ${packageName}:${node.name?.text ?? 'default'}`),
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
    if (ts.isVariableDeclaration(node) && isUniqueSymbol(node.type)) {
      return f.updateVariableDeclaration(
        node,
        node.name,
        node.exclamationToken,
        symbolLiteral(symbolName(node.name.getText())),
        node.initializer,
      );
    }
    if (ts.isPropertyDeclaration(node) && isUniqueSymbol(node.type)) {
      const owner = ts.isClassDeclaration(node.parent) ? `${node.parent.name?.text}.` : '';
      return f.updatePropertyDeclaration(
        node,
        node.modifiers,
        node.name,
        node.questionToken,
        symbolLiteral(symbolName(`${owner}${nameText(node.name)}`)),
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

// The unique symbols a package declares, as the files that declare each name: `Class.name` for a
// class's static ones; and, under `class Name`, the files that declare a class with private
// members, whose marker is named after the class.
function uniqueSymbolsOf(packageRoot) {
  const found = new Map();
  for (const file of declarationFiles(packageRoot)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const add = (name) => found.set(name, [...new Set([...(found.get(name) ?? []), file])]);
    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name && node.members.some(isPrivate)) {
        add(`class ${node.name.text}`);
      }
      if (ts.isVariableDeclaration(node) && isUniqueSymbol(node.type)) add(node.name.getText());
      else if (ts.isPropertyDeclaration(node) && isUniqueSymbol(node.type)) {
        const owner = ts.isClassDeclaration(node.parent) ? node.parent.name?.text : undefined;
        add(`${owner ? `${owner}.` : ''}${nameText(node.name)}`);
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
      symbolsByRoot.set(root, uniqueSymbolsOf(root));
      for (const [key, files] of symbolsByRoot.get(root)) {
        if (key.startsWith('class ') && files.length > 1) {
          host.mergedClasses.add(`${name}:${key.slice('class '.length)}`);
        }
      }
    }
    return (symbol) => {
      if ((symbolsByRoot.get(root).get(symbol) ?? []).length > 1) {
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
