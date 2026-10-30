#!/usr/bin/env node
/**
 * Rewrites the removed MongoDB field helpers of TypeScript contracts to `field.scalar(type.X())`: `field.objectId()` becomes `field.scalar(type.ObjectId())`, `field.scalar('mongo/string@1')` becomes `field.scalar(type.String())`, and `field.vector({ typeParams: { length: 3 } })` becomes `field.scalar(type.Vector(3))`.
 *
 * It rewrites a call only where its `field` is the MongoDB builder's: imported or required from a MongoDB contract builder entry under any name, destructured from the helpers of a `defineContract` imported from one, or read as `helpers.field` from them, which becomes `helpers.field.scalar(helpers.type.Int32())`. Where a rewritten call reads `type` by itself, the script adds `type` to the import or destructuring that gives the call its `field`. A `field` of another builder, such as a SQL `defineContract`'s, is left alone.
 *
 * Usage: node rewrite-mongo-field-types.ts [file or directory ...]
 *
 * The paths default to the working directory. In a directory the script reads every TypeScript and JavaScript file outside `node_modules`, `.git`, `dist` and `build`. It rewrites only code: comments and strings stay as they are, and the contract each file builds does not change. It reads the files with the `typescript` package of the project, or of the folder the script is in. It prints one line per file it changes, and one line per call it leaves for a person: a call it cannot carry over, such as a codec id with no type constructor; a call where `type` already names another value; and a removed helper called on a `field` it cannot tell is the MongoDB builder's, such as one imported from a module of the project.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import type * as TypeScript from 'typescript';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const BUILDER_MODULE =
  /^(?:@prisma\/orm-mongo|@prisma\/orm-family-mongo\/contract-ts|@internal\/mongo|@internal\/mongo-contract-ts)\/contract-builder$/;
const TYPE_EXPORTING_MODULE = /^(?:@prisma\/orm-mongo|@internal\/mongo)\/contract-builder$/;
const WRITE_BY_HAND = 'write it as field.scalar(type.X(...))';

const TYPE_OF_HELPER: Readonly<Record<string, string>> = {
  objectId: 'ObjectId',
  string: 'String',
  double: 'Double',
  int32: 'Int32',
  bool: 'Bool',
  date: 'Date',
  int64: 'Int64',
  int64Number: 'Int64Number',
  decimal128: 'Decimal128',
  binary: 'Binary',
  json: 'Json',
  bson: 'Bson',
  vector: 'Vector',
};

const TYPE_OF_CODEC: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TYPE_OF_HELPER).map(([helper, typeName]) => [`mongo/${helper}@1`, typeName]),
);

function loadTypeScript(): typeof TypeScript {
  for (const from of [join(process.cwd(), 'package.json'), import.meta.url]) {
    try {
      return createRequire(from)('typescript');
    } catch {}
  }
  console.error(
    'The script reads files with the "typescript" package, which this project does not have. Install it, for example with "pnpm add -D typescript", and run the script again.',
  );
  process.exit(1);
}

const ts = loadTypeScript();

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** What a name binds `field` to: the MongoDB builder's, another builder's, or something the script cannot tell. */
type Origin =
  | {
      readonly kind: 'mongo';
      /** The `type` the rewritten call reads, such as `type` or `helpers.type`. */
      readonly typeText: string;
      /** Adds `type` beside the `field` binding, once; undefined when the rewrite reads a `type` already there. */
      readonly bind: (() => void) | undefined;
      /** The declaration of the `type` this origin reads or adds, which is not a conflict. */
      readonly ownType: TypeScript.Node | undefined;
    }
  | { readonly kind: 'other' }
  | { readonly kind: 'unknown' };

/** A binding of a name and the code it reaches. */
interface Scoped<Value> {
  readonly value: Value;
  readonly scope: TypeScript.Node;
}

interface FileResult {
  readonly text: string;
  readonly rewritten: number;
  readonly reports: readonly string[];
}

function moduleOf(node: TypeScript.Node): string | undefined {
  if (ts.isImportDeclaration(node)) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length === 1
  ) {
    const [specifier] = node.arguments;
    return specifier !== undefined && ts.isStringLiteralLike(specifier)
      ? specifier.text
      : undefined;
  }
  return undefined;
}

function propertyNameOf(element: TypeScript.BindingElement | TypeScript.ImportSpecifier) {
  const name = element.propertyName ?? element.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** The code a declaration reaches: a parameter's function, an import's file, and otherwise the nearest block. */
function scopeOf(declaration: TypeScript.Node): TypeScript.Node {
  let node: TypeScript.Node = declaration;
  while (
    ts.isBindingElement(node) ||
    ts.isObjectBindingPattern(node) ||
    ts.isArrayBindingPattern(node)
  ) {
    node = node.parent;
  }
  if (ts.isParameter(node)) return node.parent;
  while (
    !ts.isBlock(node) &&
    !ts.isSourceFile(node) &&
    !ts.isCaseClause(node) &&
    !ts.isFunctionLike(node) &&
    node.parent !== undefined
  ) {
    node = node.parent;
  }
  return node;
}

function rewrite(file: TypeScript.SourceFile): FileResult {
  const edits: Edit[] = [];
  const reports: string[] = [];
  const fields = new Map<string, Scoped<Origin>[]>();
  const helpersObjects = new Map<string, Scoped<'mongo' | 'other'>[]>();
  const typeDeclarations: Scoped<TypeScript.Node>[] = [];
  const mongoDefines = new Set<string>();
  const otherDefines = new Set<string>();
  const mongoNamespaces = new Map<string, string>();
  const knownPatterns = new Set<TypeScript.Node>();
  let rewritten = 0;

  const report = (node: TypeScript.Node, why: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    const call = node.getText(file).replace(/\s+/g, ' ');
    reports.push(
      `line ${line}: ${call.length > 100 ? `${call.slice(0, 97)}...` : call}: not rewritten, as ${why}; ${WRITE_BY_HAND}.`,
    );
  };
  const contains = (scope: TypeScript.Node, node: TypeScript.Node) =>
    scope.getStart(file) <= node.getStart(file) && node.end <= scope.end;
  function innermost<Value>(
    bindings: readonly Scoped<Value>[] | undefined,
    node: TypeScript.Node,
  ): Value | undefined {
    const reaching = (bindings ?? []).filter(({ scope }) => contains(scope, node));
    reaching.sort(
      (a, b) => a.scope.end - a.scope.getStart(file) - (b.scope.end - b.scope.getStart(file)),
    );
    return reaching[0]?.value;
  }
  const add = <Value>(map: Map<string, Scoped<Value>[]>, name: string, binding: Scoped<Value>) => {
    map.set(name, [...(map.get(name) ?? []), binding]);
  };

  /** The origin of `field` bound in `elements`, beside which `type` is added when needed. */
  function mongoOrigin(
    elements: TypeScript.NodeArray<TypeScript.BindingElement | TypeScript.ImportSpecifier>,
    exportsType: boolean,
    where: TypeScript.Node,
  ): Origin {
    const existing = elements.find((element) => propertyNameOf(element) === 'type');
    if (existing !== undefined && ts.isIdentifier(existing.name)) {
      return { kind: 'mongo', typeText: existing.name.text, bind: undefined, ownType: existing };
    }
    let bound = false;
    return {
      kind: 'mongo',
      typeText: 'type',
      ownType: undefined,
      bind: () => {
        if (bound) return;
        bound = true;
        const last = elements[elements.length - 1];
        if (!exportsType || last === undefined) {
          const line = file.getLineAndCharacterOfPosition(where.getStart(file)).line + 1;
          reports.push(
            `line ${line}: this module does not export type; import type from @prisma/orm-mongo/contract-builder.`,
          );
          return;
        }
        if (ts.isBindingElement(last) && last.dotDotDotToken !== undefined) {
          edits.push({ start: last.getStart(file), end: last.getStart(file), text: 'type, ' });
        } else {
          edits.push({ start: last.end, end: last.end, text: ', type' });
        }
      },
    };
  }

  /** Records what an import or `require` of a builder entry binds. */
  function bindModule(
    module: string,
    names:
      | TypeScript.NamedImports
      | TypeScript.ObjectBindingPattern
      | TypeScript.Identifier
      | undefined,
    where: TypeScript.Node,
  ): void {
    if (names === undefined) return;
    const isMongo = BUILDER_MODULE.test(module);
    const isOtherBuilder = !isMongo && /\/contract-builder$/.test(module);
    if (ts.isObjectBindingPattern(names)) knownPatterns.add(names);
    if (ts.isIdentifier(names)) {
      if (isMongo) mongoNamespaces.set(names.text, module);
      return;
    }
    for (const element of names.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const imported = propertyNameOf(element);
      if (imported === 'defineContract') {
        (isMongo ? mongoDefines : otherDefines).add(element.name.text);
      }
      if (imported === 'field') {
        add(fields, element.name.text, {
          value: isMongo
            ? mongoOrigin(names.elements, TYPE_EXPORTING_MODULE.test(module), where)
            : { kind: isOtherBuilder ? 'other' : 'unknown' },
          scope: file,
        });
      }
    }
  }

  function collectModules(node: TypeScript.Node): void {
    if (ts.isImportDeclaration(node)) {
      const module = moduleOf(node);
      const bindings = node.importClause?.namedBindings;
      if (module !== undefined && node.importClause?.isTypeOnly !== true) {
        if (bindings !== undefined && ts.isNamedImports(bindings))
          bindModule(module, bindings, node);
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          bindModule(module, bindings.name, node);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const module = moduleOf(node.initializer);
      if (
        module !== undefined &&
        (ts.isObjectBindingPattern(node.name) || ts.isIdentifier(node.name))
      ) {
        bindModule(module, node.name, node);
      }
    }
    ts.forEachChild(node, collectModules);
  }

  /** Whether `callee` is a `defineContract` of the MongoDB builder, of another builder, or neither. */
  function defineOf(callee: TypeScript.Expression): 'mongo' | 'other' | undefined {
    if (ts.isIdentifier(callee)) {
      if (mongoDefines.has(callee.text)) return 'mongo';
      return otherDefines.has(callee.text) ? 'other' : undefined;
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'defineContract' &&
      ts.isIdentifier(callee.expression)
    ) {
      return mongoNamespaces.has(callee.expression.text) ? 'mongo' : undefined;
    }
    return undefined;
  }

  /** Records the bindings of `field`, of a helpers object, and of other values named `type`. */
  function collectBindings(node: TypeScript.Node): void {
    if (ts.isCallExpression(node)) {
      const define = defineOf(node.expression);
      if (define !== undefined) {
        for (const argument of node.arguments) {
          if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) continue;
          const [helpers] = argument.parameters;
          if (helpers === undefined) continue;
          if (ts.isIdentifier(helpers.name)) {
            add(helpersObjects, helpers.name.text, { value: define, scope: argument });
          }
          if (ts.isObjectBindingPattern(helpers.name)) bindHelpers(helpers.name, define, argument);
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer)
    ) {
      const origin = innermost(helpersObjects.get(node.initializer.text), node);
      if (origin !== undefined) bindHelpers(node.name, origin, scopeOf(node));
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === 'field') {
      if (!isHelpersParameter(node))
        add(fields, 'field', { value: { kind: 'unknown' }, scope: node.parent });
    }
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      propertyNameOf(node) === 'field' &&
      !isKnownPattern(node.parent)
    ) {
      add(fields, node.name.text, { value: { kind: 'unknown' }, scope: scopeOf(node) });
    }
    const declared = declaredName(node);
    if (declared === 'type') typeDeclarations.push({ value: node, scope: scopeOf(node) });
    ts.forEachChild(node, collectBindings);
  }

  function isKnownPattern(pattern: TypeScript.Node): boolean {
    return knownPatterns.has(pattern);
  }
  function isHelpersParameter(parameter: TypeScript.ParameterDeclaration): boolean {
    const owner = parameter.parent;
    return ts.isCallExpression(owner.parent) && defineOf(owner.parent.expression) !== undefined;
  }

  function bindHelpers(
    pattern: TypeScript.ObjectBindingPattern,
    define: 'mongo' | 'other',
    scope: TypeScript.Node,
  ): void {
    knownPatterns.add(pattern);
    for (const element of pattern.elements) {
      if (propertyNameOf(element) !== 'field' || !ts.isIdentifier(element.name)) continue;
      add(fields, element.name.text, {
        value:
          define === 'mongo' ? mongoOrigin(pattern.elements, true, pattern) : { kind: 'other' },
        scope,
      });
    }
  }

  /** The name a declaration binds, when it is one. */
  function declaredName(node: TypeScript.Node): string | undefined {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node) ||
      ts.isImportClause(node)
    ) {
      return node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : undefined;
    }
    return undefined;
  }

  /** The origin of the `field` a call reads through `receiver`. */
  function originOf(receiver: TypeScript.Expression): Origin | undefined {
    if (ts.isIdentifier(receiver)) return innermost(fields.get(receiver.text), receiver);
    if (
      ts.isPropertyAccessExpression(receiver) &&
      receiver.name.text === 'field' &&
      ts.isIdentifier(receiver.expression)
    ) {
      const object = receiver.expression.text;
      const helpers = innermost(helpersObjects.get(object), receiver);
      const module = mongoNamespaces.get(object);
      if (helpers === 'other') return { kind: 'other' };
      if (helpers === 'mongo' || (module !== undefined && TYPE_EXPORTING_MODULE.test(module))) {
        return { kind: 'mongo', typeText: `${object}.type`, bind: undefined, ownType: undefined };
      }
      return { kind: 'unknown' };
    }
    return undefined;
  }

  /** The length a `{ typeParams: { length } }` object gives, as written, or undefined when it holds anything else. */
  function lengthOf(argument: TypeScript.Expression): string | undefined {
    if (!ts.isObjectLiteralExpression(argument) || argument.properties.length !== 1)
      return undefined;
    const [typeParams] = argument.properties;
    if (
      typeParams === undefined ||
      !ts.isPropertyAssignment(typeParams) ||
      typeParams.name.getText(file) !== 'typeParams' ||
      !ts.isObjectLiteralExpression(typeParams.initializer) ||
      typeParams.initializer.properties.length !== 1
    ) {
      return undefined;
    }
    const [length] = typeParams.initializer.properties;
    if (length === undefined || length.name?.getText(file) !== 'length') return undefined;
    if (ts.isShorthandPropertyAssignment(length)) return 'length';
    return ts.isPropertyAssignment(length) ? length.initializer.getText(file) : undefined;
  }

  /** The type call a removed-helper call becomes, the reason it cannot be rewritten, or `keep` for a call that is not a removed helper. */
  function typeCallOf(
    helper: string,
    args: readonly TypeScript.Expression[],
  ): { readonly typeName: string; readonly argument: string } | string {
    if (helper === 'scalar') {
      const [codec, options] = args;
      if (
        codec === undefined ||
        ts.isCallExpression(codec) ||
        ts.isObjectLiteralExpression(codec)
      ) {
        return 'keep';
      }
      if (!ts.isStringLiteralLike(codec)) {
        return 'its argument is not a codec id string or a type.X() call';
      }
      const typeName = TYPE_OF_CODEC[codec.text];
      if (typeName === undefined) return `codec "${codec.text}" has no type constructor here`;
      if (args.length === 1) return { typeName, argument: '' };
      const length = typeName === 'Vector' && options !== undefined ? lengthOf(options) : undefined;
      if (args.length === 2 && length !== undefined) return { typeName, argument: length };
      return 'its options are not { typeParams: { length } }';
    }
    const typeName = TYPE_OF_HELPER[helper];
    if (typeName === undefined) return 'keep';
    if (args.length === 0) return { typeName, argument: '' };
    const [options] = args;
    const length = helper === 'vector' && options !== undefined ? lengthOf(options) : undefined;
    if (args.length === 1 && length !== undefined) return { typeName, argument: length };
    return 'its arguments are not { typeParams: { length } }';
  }

  /** Whether a `type` other than the builder's reaches `node`. */
  function typeIsTaken(
    node: TypeScript.Node,
    origin: Origin & { readonly kind: 'mongo' },
  ): boolean {
    return typeDeclarations.some(
      ({ value, scope }) => value !== origin.ownType && contains(scope, node),
    );
  }

  function visit(node: TypeScript.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      const origin = originOf(callee.expression);
      const typeCall = origin === undefined ? 'keep' : typeCallOf(callee.name.text, node.arguments);
      if (origin !== undefined && typeCall !== 'keep' && origin.kind !== 'other') {
        if (origin.kind === 'unknown') {
          report(node, "the script cannot tell this field is the MongoDB builder's");
        } else if (typeof typeCall === 'string') {
          report(node, typeCall);
        } else if (origin.typeText === 'type' && typeIsTaken(node, origin)) {
          report(node, 'type names another value here');
        } else {
          origin.bind?.();
          rewritten += 1;
          edits.push({
            start: node.getStart(file),
            end: node.end,
            text: `${callee.expression.getText(file)}.scalar(${origin.typeText}.${typeCall.typeName}(${typeCall.argument}))`,
          });
          for (const argument of node.arguments) ts.forEachChild(argument, visit);
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  collectModules(file);
  collectBindings(file);
  visit(file);
  const text = edits
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      file.text,
    );
  return { text, rewritten, reports };
}

function sourceFilesIn(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFilesIn(join(directory, entry.name));
    }
    return entry.isFile() && SOURCE_FILE.test(entry.name) ? [join(directory, entry.name)] : [];
  });
}

function scriptKindOf(file: string): TypeScript.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function main(args: readonly string[]): void {
  const root = process.cwd();
  let changed = 0;
  const paths = args.length === 0 ? ['.'] : args;
  const files = paths.flatMap((path) =>
    statSync(path).isDirectory() ? sourceFilesIn(path) : [path],
  );
  for (const file of files) {
    const name = relative(root, file) || file;
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindOf(file),
    );
    const result = rewrite(source);
    if (result.text !== text) {
      writeFileSync(file, result.text);
      changed += 1;
      console.log(
        `${name}: rewrote ${result.rewritten} field helper call${result.rewritten === 1 ? '' : 's'}.`,
      );
    }
    for (const line of result.reports) console.log(`${name}: ${line}`);
  }
  console.log(`Changed ${changed} file${changed === 1 ? '' : 's'}.`);
}

main(process.argv.slice(2));
