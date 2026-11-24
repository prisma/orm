// Rewrites declaration text so it does not depend on how the declaration build printed a
// type: the members of every union are sorted, and `import("…").Name` becomes `Name`.

import ts from 'typescript';

export class TypeTextError extends Error {}

const compareCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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

function render(node, file) {
  if (ts.isUnionTypeNode(node)) {
    return node.types
      .map((member) => render(member, file))
      .sort(compareCodeUnits)
      .join(' | ');
  }
  if (ts.isImportTypeNode(node) && node.qualifier) {
    const typeArguments = node.typeArguments
      ? `<${node.typeArguments.map((argument) => render(argument, file)).join(', ')}>`
      : '';
    return `${node.isTypeOf ? 'typeof ' : ''}${node.qualifier.getText(file)}${typeArguments}`;
  }
  let text = '';
  let cursor = node.getStart(file);
  ts.forEachChild(node, (child) => {
    text += file.text.slice(cursor, child.getStart(file)) + render(child, file);
    cursor = child.end;
  });
  return text + file.text.slice(cursor, node.end);
}

// `context` says what `text` is: 'declaration', 'interface member', 'class member' or 'enum member'.
export function normalizeTypes(text, context) {
  const [prefix, suffix] = wrapperFor(text, context);
  const source = `${prefix}${text}${suffix}`;
  const file = ts.createSourceFile('type.d.ts', source, ts.ScriptTarget.Latest, true);
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
  const rendered = render(statement, file);
  return rendered.slice(prefix.length, rendered.length - suffix.length);
}
