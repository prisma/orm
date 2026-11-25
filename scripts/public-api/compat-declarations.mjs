// The compiler host the generated compatibility tests are compiled with; see api-compat.mjs. It
// rewrites declaration files as they are read, so that TypeScript's own assignability compares
// two copies of a package the way a user of it relies on, and it reads each third-party package
// from one physical copy.

import { basename } from 'node:path';
import ts from 'typescript';

const f = ts.factory;

const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const TYPESCRIPT_LIB = /[\\/]typescript[\\/]lib[\\/]/;
const HIDDEN_MEMBERS = /#private|\b(private|protected)\s/;
const CHUNK_HASH = /-[A-Za-z0-9_-]{8}$/;

const hasModifier = (node, kind) => node.modifiers?.some((m) => m.kind === kind) ?? false;

const isHidden = (member) =>
  !ts.isConstructorDeclaration(member) &&
  (hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
    hasModifier(member, ts.SyntaxKind.ProtectedKeyword) ||
    (member.name !== undefined && ts.isPrivateIdentifier(member.name)));

// A bundler names a shared declaration chunk after its content hash, which changes from build to
// build; without it the name is the same in the release and the current build.
export function moduleName(fileName) {
  let name = basename(fileName).replace(DECLARATION_FILE, '');
  while (CHUNK_HASH.test(name)) name = name.replace(CHUNK_HASH, '');
  return name;
}

function methodGroups(members, isMethod) {
  const key = (member) =>
    `${member.name.getText()}\0${hasModifier(member, ts.SyntaxKind.StaticKeyword)}`;
  const groups = [];
  for (const member of members) {
    const last = groups.at(-1);
    if (isMethod(member) && last?.overloads && key(last.overloads[0]) === key(member)) {
      last.overloads.push(member);
    } else groups.push(isMethod(member) ? { overloads: [member] } : { member });
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

const classMembers = (members) =>
  methodGroups(
    members.filter((member) => !isHidden(member)),
    ts.isMethodDeclaration,
  ).map(({ member, overloads }) =>
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

const isUniqueSymbol = (type) =>
  type !== undefined &&
  ts.isTypeOperatorNode(type) &&
  type.operator === ts.SyntaxKind.UniqueKeyword;

const uniqueSymbolLiteral = (module, name) =>
  f.createLiteralTypeNode(f.createStringLiteral(`unique symbol ${module}:${name}`));

// Our packages' declarations: each method becomes a function-typed property (overloads a type
// literal of call signatures), so that its parameters compare contravariantly; private and
// protected members are dropped, since they make each copy of a class a type of its own; and each
// `unique symbol` constant becomes a string literal named after its module and itself, so that a
// key made from it is the same key in both copies.
export function rewriteOwnDeclarations(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const module = moduleName(fileName);
  return print(source, (node) => {
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
    if (ts.isClassDeclaration(node)) {
      return f.updateClassDeclaration(
        node,
        node.modifiers,
        node.name,
        node.typeParameters,
        node.heritageClauses,
        classMembers(node.members),
      );
    }
    if (ts.isVariableDeclaration(node) && isUniqueSymbol(node.type)) {
      return f.updateVariableDeclaration(
        node,
        node.name,
        node.exclamationToken,
        uniqueSymbolLiteral(module, node.name.getText()),
        node.initializer,
      );
    }
    if (ts.isPropertyDeclaration(node) && isUniqueSymbol(node.type)) {
      const owner = ts.isClassDeclaration(node.parent) ? `${node.parent.name?.getText()}.` : '';
      return f.updatePropertyDeclaration(
        node,
        node.modifiers,
        node.name,
        node.questionToken,
        uniqueSymbolLiteral(module, `${owner}${node.name.getText()}`),
        node.initializer,
      );
    }
    return node;
  });
}

// Third-party declarations keep their methods, whose bivariance code such as Array relies on; only
// their private and protected members are dropped.
export function rewriteThirdPartyDeclarations(fileName, text) {
  if (!HIDDEN_MEMBERS.test(text)) return text;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  return print(source, (node) =>
    ts.isClassDeclaration(node)
      ? f.updateClassDeclaration(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          node.members.filter((member) => !isHidden(member)),
        )
      : node,
  );
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

const packageRootOf = (fileName, name) => {
  const marker = `/node_modules/${name}/`;
  const at = fileName.lastIndexOf(marker);
  return at < 0 ? undefined : fileName.slice(0, at + marker.length);
};

// `isOwnFile` says whether a declaration file belongs to one of our packages. Source files are
// kept for the host's life, so the programs one package is compiled in share them; the test files
// themselves change between programs and are read afresh.
export function createCompareHost(options, isOwnFile) {
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile.bind(host);
  const files = new Map();
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (!DECLARATION_FILE.test(fileName)) {
      return readSourceFile(fileName, languageVersion, onError, shouldCreate);
    }
    const key = `${fileName}\0${JSON.stringify(languageVersion)}`;
    if (!files.has(key)) {
      const text = host.readFile(fileName);
      let file;
      if (text !== undefined) {
        const rewritten = TYPESCRIPT_LIB.test(fileName)
          ? text
          : isOwnFile(fileName)
            ? rewriteOwnDeclarations(fileName, text)
            : rewriteThirdPartyDeclarations(fileName, text);
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
      if (!id || isOwnFile(resolved.resolvedFileName)) return resolution;
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
