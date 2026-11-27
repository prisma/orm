// Rewrites declaration text so it does not depend on how the declaration build printed a
// type: the members of every union are sorted, and `import("…").Name` becomes `Name`.

import ts from 'typescript';
import { compareCodeUnits } from './api-lines.mjs';

export class TypeTextError extends Error {}

// `import("x").A.B` written as an expression, as in a class's `extends` or `implements`.
function importedName(node) {
  if (!ts.isPropertyAccessExpression(node) || ts.isPropertyAccessExpression(node.parent)) {
    return undefined;
  }
  const names = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = current.expression;
  }
  const isImportCall =
    ts.isCallExpression(current) &&
    current.expression.kind === ts.SyntaxKind.ImportKeyword &&
    current.arguments.length === 1 &&
    ts.isStringLiteral(current.arguments[0]);
  return isImportCall ? { specifier: current.arguments[0].text, names } : undefined;
}

function checkSpecifier(specifier) {
  if (/^(\.|\/|[A-Za-z]:)/.test(specifier)) {
    throw new TypeTextError(
      `import("${specifier}") names a file, not a package. Declarations must refer to another package by its name, so check how the declaration build wrote this type.`,
    );
  }
}

function leftmostName(name) {
  return ts.isQualifiedName(name) ? leftmostName(name.left) : name;
}

const CONTAINER_DECLARATION = /^(abstract class|class|const enum|enum|namespace|module) /;

function wrapperFor(text, context) {
  switch (context) {
    case 'declaration':
      if (text.startsWith('interface ')) return ['', ' {}'];
      return CONTAINER_DECLARATION.test(text) ? ['declare ', ' {}'] : ['declare ', ';'];
    case 'interface member':
      return ['interface Member {\n', ';\n}'];
    case 'class member':
      return ['declare class Member {\n', ';\n}'];
    case 'enum member':
      return ['declare enum Member {\n', '\n}'];
    default:
      throw new TypeTextError(`unknown context ${context}`);
  }
}

function isTypeName(node) {
  const { parent } = node;
  if (!ts.isIdentifier(node) || parent === undefined) return false;
  if (ts.isTypeReferenceNode(parent)) return parent.typeName === node;
  if (ts.isQualifiedName(parent)) return parent.left === node;
  if (ts.isTypeQueryNode(parent)) return parent.exprName === node;
  if (ts.isExpressionWithTypeArguments(parent)) return parent.expression === node;
  return false;
}

// Prints `node` with the members of every union sorted and `import("…").Name` as `Name`, or with
// the module kept when `keepImportModules` is set. `qualify(name, specifier)` may give a module to
// print before the name, and `rename` the printed name of an identifier that names a type.
export function renderNode(node, file, options = {}) {
  const {
    rename = () => undefined,
    keepImportModules = false,
    qualify = () => undefined,
  } = options;
  if (isTypeName(node)) return rename(node) ?? node.getText(file);
  if (ts.isUnionTypeNode(node)) {
    return node.types
      .map((member) => renderNode(member, file, options))
      .sort(compareCodeUnits)
      .join(' | ');
  }
  const imported = importedName(node);
  if (imported) {
    checkSpecifier(imported.specifier);
    if (keepImportModules) return node.getText(file);
    const module = qualify(imported.names[0], imported.specifier);
    return `${module ? `${module}.` : ''}${imported.names.join('.')}`;
  }
  if (ts.isImportTypeNode(node)) checkSpecifier(node.argument.literal.text);
  if (ts.isImportTypeNode(node) && node.qualifier && !keepImportModules) {
    const typeArguments = node.typeArguments
      ? `<${node.typeArguments.map((argument) => renderNode(argument, file, options)).join(', ')}>`
      : '';
    const leftmost = ts.isQualifiedName(node.qualifier)
      ? leftmostName(node.qualifier)
      : node.qualifier;
    const qualified = qualify(leftmost.text, node.argument.literal.text);
    const module = qualified ? `${qualified}.` : '';
    return `${node.isTypeOf ? 'typeof ' : ''}${module}${node.qualifier.getText(file)}${typeArguments}`;
  }
  let text = '';
  let cursor = node.getStart(file);
  ts.forEachChild(node, (child) => {
    text += file.text.slice(cursor, child.getStart(file)) + renderNode(child, file, options);
    cursor = child.end;
  });
  return text + file.text.slice(cursor, node.end);
}

// `context` says what `text` is: 'declaration', 'interface member', 'class member' or
// 'enum member'.
export function normalizeTypes(text, context, { keepImportModules = false, qualify } = {}) {
  const [prefix, suffix] = wrapperFor(text, context);
  const source = `${prefix}${text}${suffix}`;
  const file = ts.createSourceFile('type.d.ts', source, ts.ScriptTarget.Latest, true);
  // parseDiagnostics is internal to TypeScript; it is the only way to learn a parse failed without
  // building a program.
  if (!Array.isArray(file.parseDiagnostics)) {
    throw new TypeTextError('this TypeScript version does not expose parse diagnostics');
  }
  const [statement] = file.statements;
  if (
    file.parseDiagnostics.length > 0 ||
    file.statements.length !== 1 ||
    statement.getStart(file) !== 0 ||
    statement.end !== source.length
  ) {
    throw new TypeTextError(`cannot parse "${text}" as a ${context}`);
  }
  const rendered = renderNode(statement, file, { keepImportModules, qualify });
  return rendered.slice(prefix.length, rendered.length - suffix.length);
}
