#!/usr/bin/env node
/**
 * Rewrites the removed MongoDB field helpers of TypeScript contracts to `field.scalar(type.X())`: `field.objectId()` becomes `field.scalar(type.ObjectId())`, `field.scalar('mongo/string@1')` becomes `field.scalar(type.String())`, and `field.vector({ typeParams: { length: 3 } })` becomes `field.scalar(type.Vector(3))`. A call on a helpers object, such as `helpers.field.int32()`, becomes `helpers.field.scalar(helpers.type.Int32())`. It finds `field` under any name the file gives it: `import { field as f }` from a MongoDB contract builder entry, or `({ field: f })` in a destructuring. Where a rewritten call reads `type` by itself, the script adds `type` to the destructuring or the import that gives the call its `field`.
 *
 * Usage: node rewrite-mongo-field-types.ts [file or directory ...]
 *
 * The paths default to the working directory. In a directory the script reads every TypeScript and JavaScript file outside `node_modules`, `.git`, `dist` and `build`. It rewrites only files that import from a MongoDB contract builder entry, and only code: comments and strings stay as they are. The contract each file builds does not change. It reads the files with the project's `typescript` package. It prints one line per file it changes, and one line per thing it leaves for a person: a call it cannot carry over, such as a codec id with no type constructor, a file that already binds the name `type` some other way, which it leaves unchanged, and a file whose `type` no import can give.
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

/** Where a call's `field` comes from, and what reads its `type`. */
interface Receiver {
  /** The `type` the rewritten call reads, such as `type` or `helpers.type`. */
  readonly typeText: string;
  /** Adds the `type` binding this receiver needs, once; undefined when the receiver needs none. */
  readonly bind: (() => void) | undefined;
}

/** A receiver, and the code its binding of `field` reaches: the function a parameter belongs to, the block a declaration is in, or the file for an import. */
interface ScopedReceiver {
  readonly receiver: Receiver;
  readonly scope: TypeScript.Node;
}

interface FileResult {
  readonly text: string;
  readonly rewritten: number;
  readonly reports: readonly string[];
  readonly typeConflict: boolean;
}

function isBuilderImport(node: TypeScript.Node): node is TypeScript.ImportDeclaration {
  return (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    BUILDER_MODULE.test(node.moduleSpecifier.text)
  );
}

function propertyNameOf(element: TypeScript.BindingElement | TypeScript.ImportSpecifier) {
  const name = element.propertyName ?? element.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function rewrite(file: TypeScript.SourceFile): FileResult {
  const text = file.text;
  const edits: Edit[] = [];
  const reports: string[] = [];
  const receivers = new Map<string, ScopedReceiver[]>();
  let bindsOtherType = false;
  let addsType = false;
  let rewritten = 0;
  const lineOf = (node: TypeScript.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const report = (node: TypeScript.Node, why: string) => {
    const call = node.getText(file).replace(/\s+/g, ' ');
    reports.push(
      `line ${lineOf(node)}: ${call.length > 100 ? `${call.slice(0, 97)}...` : call}: ${why}`,
    );
  };
  const addReceiver = (name: string, receiver: Receiver, scope: TypeScript.Node) => {
    receivers.set(name, [...(receivers.get(name) ?? []), { receiver, scope }]);
  };

  function scopeOf(pattern: TypeScript.ObjectBindingPattern): TypeScript.Node {
    if (ts.isParameter(pattern.parent)) return pattern.parent.parent;
    let node: TypeScript.Node = pattern.parent;
    while (!ts.isBlock(node) && !ts.isSourceFile(node) && node.parent !== undefined) {
      node = node.parent;
    }
    return node;
  }

  function bindingReceiver(pattern: TypeScript.ObjectBindingPattern): Receiver {
    const existing = pattern.elements.find((element) => propertyNameOf(element) === 'type');
    if (existing !== undefined && ts.isIdentifier(existing.name)) {
      return { typeText: existing.name.text, bind: undefined };
    }
    let bound = false;
    return {
      typeText: 'type',
      bind: () => {
        if (bound) return;
        bound = true;
        addsType = true;
        const last = pattern.elements[pattern.elements.length - 1];
        if (last === undefined) return;
        edits.push({ start: last.end, end: last.end, text: ', type' });
      },
    };
  }

  function importReceiver(declaration: TypeScript.ImportDeclaration): Receiver {
    const bindings = declaration.importClause?.namedBindings;
    const module = ts.isStringLiteral(declaration.moduleSpecifier)
      ? declaration.moduleSpecifier.text
      : '';
    const elements = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : [];
    const existing = elements.find((element) => propertyNameOf(element) === 'type');
    if (existing !== undefined) return { typeText: existing.name.text, bind: undefined };
    let bound = false;
    return {
      typeText: 'type',
      bind: () => {
        if (bound) return;
        bound = true;
        addsType = true;
        const last = elements[elements.length - 1];
        if (!TYPE_EXPORTING_MODULE.test(module) || last === undefined) {
          reports.push(
            `line ${lineOf(declaration)}: ${module} does not export type; import type from @prisma/orm-mongo/contract-builder.`,
          );
          return;
        }
        edits.push({ start: last.end, end: last.end, text: ', type' });
      },
    };
  }

  function collect(node: TypeScript.Node): void {
    if (isBuilderImport(node)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (propertyNameOf(element) === 'field') {
            addReceiver(element.name.text, importReceiver(node), file);
          }
        }
      }
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      if (propertyNameOf(node) === 'field' && ts.isIdentifier(node.name)) {
        addReceiver(node.name.text, bindingReceiver(node.parent), scopeOf(node.parent));
      }
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'type'
    ) {
      bindsOtherType = true;
    }
    ts.forEachChild(node, collect);
  }

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || isBuilderImport(statement)) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    const importsType =
      clause?.isTypeOnly !== true &&
      (clause?.name?.text === 'type' ||
        (bindings !== undefined &&
          (ts.isNamespaceImport(bindings)
            ? bindings.name.text === 'type'
            : bindings.elements.some(
                (element) => !element.isTypeOnly && element.name.text === 'type',
              ))));
    if (importsType) bindsOtherType = true;
  }

  /** The receiver of `expression`, a `field` the file binds, or `<object>.field`. */
  function receiverOf(expression: TypeScript.Expression): Receiver | undefined {
    if (ts.isIdentifier(expression)) {
      const position = expression.getStart(file);
      const reaching = (receivers.get(expression.text) ?? []).filter(
        ({ scope }) => scope.getStart(file) <= position && position < scope.end,
      );
      const innermost = reaching.sort(
        (a, b) => a.scope.end - a.scope.getStart(file) - (b.scope.end - b.scope.getStart(file)),
      )[0];
      return innermost?.receiver;
    }
    if (
      ts.isPropertyAccessExpression(expression) &&
      expression.name.text === 'field' &&
      ts.isIdentifier(expression.expression)
    ) {
      return { typeText: `${expression.expression.text}.type`, bind: undefined };
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

  /** The type call a removed-helper call becomes, or the reason it cannot be rewritten. */
  function typeCallOf(
    helper: string,
    args: readonly TypeScript.Expression[],
  ): { readonly typeName: string; readonly argument: string } | string {
    if (helper === 'scalar') {
      const [codec, options] = args;
      if (codec === undefined || !ts.isStringLiteralLike(codec)) return 'keep';
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

  function visit(node: TypeScript.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      const receiver = receiverOf(callee.expression);
      const helper = callee.name.text;
      if (receiver !== undefined) {
        const typeCall = typeCallOf(helper, node.arguments);
        if (typeof typeCall === 'string') {
          if (typeCall !== 'keep')
            report(node, `not rewritten, as ${typeCall}; write it as field.scalar(type.X(...)).`);
        } else {
          receiver.bind?.();
          rewritten += 1;
          edits.push({
            start: node.getStart(file),
            end: node.end,
            text: `${callee.expression.getText(file)}.scalar(${receiver.typeText}.${typeCall.typeName}(${typeCall.argument}))`,
          });
          for (const argument of node.arguments) ts.forEachChild(argument, visit);
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  collect(file);
  visit(file);
  const next = edits
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      text,
    );
  return { text: next, rewritten, reports, typeConflict: addsType && bindsOtherType };
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
  for (const file of paths.flatMap((path) =>
    statSync(path).isDirectory() ? sourceFilesIn(path) : [path],
  )) {
    const name = relative(root, file) || file;
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindOf(file),
    );
    if (!source.statements.some(isBuilderImport)) continue;
    const result = rewrite(source);
    if (result.typeConflict) {
      console.log(
        `${name}: already binds the name "type", which the rewrite needs for the MongoDB type helpers; left unchanged. Rename the other binding and run the script again.`,
      );
      continue;
    }
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
