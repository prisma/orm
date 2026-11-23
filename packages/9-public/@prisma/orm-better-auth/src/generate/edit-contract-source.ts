import { isPrisma8Schema } from '@prisma/orm-framework/psl-parser';
import {
  type DocumentAst,
  type FieldAttributeAst,
  type ModelAttributeAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  parse,
  StringLiteralExprAst,
} from '@prisma/orm-framework/psl-parser/syntax';
import type { ContractComparison } from '../contract/compare';
import { type PrintedBlock, printPsl, renderBlocks } from '../contract/print-psl';
import { assertOnlyAdditions, listOf, notChanged } from './refusal';

export interface ContractSourceFile {
  /** The path `auth generate` shows and writes to. */
  readonly path: string;
  readonly text: string;
}

export interface ContractEdit<F extends ContractSourceFile = ContractSourceFile> {
  /** The source file the edit changes. */
  readonly file: F;
  /** The whole edited file. */
  readonly code: string;
  /** What is added where and what to do after the file is written, then a line for each note the printed PSL carries. */
  readonly summary: string;
}

interface DeclaredModel<F extends ContractSourceFile = ContractSourceFile> {
  readonly file: F;
  readonly namespaceId: string;
  readonly declaration: ModelDeclarationAst;
}

interface Insertion {
  readonly offset: number;
  readonly text: string;
}

function modelKey(namespaceId: string, name: string): string {
  return `${namespaceId}.${name}`;
}

function declaredModels<F extends ContractSourceFile>(
  file: F,
  document: DocumentAst,
  defaultNamespace: string,
  into: Map<string, DeclaredModel<F>[]>,
): void {
  const add = (namespaceId: string, declaration: ModelDeclarationAst) => {
    const name = declaration.name()?.name();
    if (name === undefined) return;
    const key = modelKey(namespaceId, name);
    into.set(key, [...(into.get(key) ?? []), { file, namespaceId, declaration }]);
  };
  for (const declaration of document.declarations()) {
    if (declaration instanceof ModelDeclarationAst) add(defaultNamespace, declaration);
    if (!(declaration instanceof NamespaceDeclarationAst)) continue;
    const namespaceId = declaration.name()?.name() ?? defaultNamespace;
    for (const member of declaration.declarations()) {
      if (member instanceof ModelDeclarationAst) add(namespaceId, member);
    }
  }
}

function parsedModels<F extends ContractSourceFile>(
  files: readonly F[],
  comparison: ContractComparison,
): Map<string, DeclaredModel<F>[]> {
  const models = new Map<string, DeclaredModel<F>[]>();
  for (const file of files) {
    if (!isPrisma8Schema(file.text)) {
      throw notChanged(comparison, `${file.path} does not start with \`// use prisma-8\`.`);
    }
    const { document, diagnostics } = parse(file.text, file.path);
    const [first] = diagnostics;
    if (first !== undefined) {
      throw notChanged(
        comparison,
        `${file.path} does not parse: ${first.message} (line ${first.range.start.line + 1}).`,
      );
    }
    declaredModels(file, document, comparison.defaultNamespace, models);
  }
  return models;
}

/** The string an attribute such as `@map("x")` or `@@map("x")` names, read from the syntax tree; `undefined` when the attributes have no such attribute with a string. */
function attributeString(
  attributes: Iterable<FieldAttributeAst | ModelAttributeAst>,
  name: string,
): string | undefined {
  for (const attribute of attributes) {
    const path = attribute.name()?.path() ?? [];
    if (path.length !== 1 || path[0] !== name) continue;
    for (const argument of attribute.argList()?.args() ?? []) {
      const argumentName = argument.name()?.name();
      if (argumentName !== undefined && argumentName !== 'name') continue;
      const value = argument.value();
      if (value instanceof StringLiteralExprAst) return value.value();
    }
  }
  return undefined;
}

interface StaleDeclaration {
  readonly name: string;
  readonly path: string;
}

/** The fields the model already declares that the block would add: by name, or stored in a column the block adds. */
function staleFields(
  block: PrintedBlock,
  { file, declaration }: DeclaredModel,
): StaleDeclaration[] {
  const additions = new Set(block.fieldNames);
  const columns = new Set(block.columns);
  return [...declaration.fields()].flatMap((field) => {
    const name = field.name()?.name();
    if (name === undefined) return [];
    if (additions.has(name)) return [{ name: `${block.modelName}.${name}`, path: file.path }];
    const column = attributeString(field.attributes(), 'map') ?? name;
    return columns.has(column)
      ? [
          {
            name: `${block.modelName}.${name} (stored in the column "${column}")`,
            path: file.path,
          },
        ]
      : [];
  });
}

/** The models of the namespace that the source already declares for a model the block would add: by name, or stored in its table. */
function staleModels(block: PrintedBlock, models: readonly DeclaredModel[]): StaleDeclaration[] {
  return models.flatMap(({ file, declaration }) => {
    const name = declaration.name()?.name();
    if (name === undefined) return [];
    if (name === block.modelName) return [{ name, path: file.path }];
    const table = attributeString(declaration.attributes(), 'map') ?? name;
    return table === block.table
      ? [{ name: `${name} (stored in the table "${table}")`, path: file.path }]
      : [];
  });
}

function uniquePaths(models: readonly DeclaredModel[]): string[] {
  return [...new Set(models.map(({ file }) => file.path))];
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** The offset of the line break that ends the line holding `offset`, before `\r\n` or `\n`, or the end of the text. */
function lineEnd(text: string, offset: number): number {
  const newline = text.indexOf('\n', offset);
  if (newline === -1) return text.length;
  return text[newline - 1] === '\r' ? newline - 1 : newline;
}

function indentationAt(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, offset)))?.[0] ?? '';
}

/** The indentation of a field relative to its model, from the first model of the file that has a field; two spaces when none has. */
function indentUnit(text: string, models: readonly DeclaredModel[]): string {
  for (const { declaration } of [...models].sort(
    (a, b) => a.declaration.syntax.offset - b.declaration.syntax.offset,
  )) {
    const [field] = declaration.fields();
    if (field === undefined) continue;
    const modelIndent = indentationAt(text, declaration.syntax.offset);
    const fieldIndent = indentationAt(text, field.syntax.offset);
    if (fieldIndent.length > modelIndent.length && fieldIndent.startsWith(modelIndent)) {
      return fieldIndent.slice(modelIndent.length);
    }
  }
  return '  ';
}

/** Printed PSL, indented two spaces a level, with each level indented by `unit` instead. */
function reindented(printed: string, unit: string): string {
  return printed.replace(/^(?: {2})+/gm, (spaces) => unit.repeat(spaces.length / 2));
}

/** Where the block's fields go: after the line of the model's last field, or after the `{` line of a model without fields. `undefined` when the model's `}` is on that line. */
function fieldInsertion(
  text: string,
  declaration: ModelDeclarationAst,
  block: PrintedBlock,
  eol: string,
  unit: string,
): Insertion | undefined {
  const last = [...declaration.fields()].at(-1);
  const anchorEnd = last?.syntax.endOffset ?? declaration.lbrace()?.endOffset;
  const rbrace = declaration.rbrace();
  if (anchorEnd === undefined || rbrace === undefined) return undefined;
  const offset = lineEnd(text, anchorEnd);
  if (rbrace.offset < offset) return undefined;
  const indent =
    last === undefined
      ? `${indentationAt(text, declaration.syntax.offset)}${unit}`
      : indentationAt(text, last.syntax.offset);
  return { offset, text: block.fieldLines.map((line) => `${eol}${indent}${line}`).join('') };
}

function separatorBefore(text: string, eol: string): string {
  if (text.endsWith(`${eol}${eol}`)) return '';
  return text.endsWith(eol) ? eol : `${eol}${eol}`;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function summaryOf(
  path: string,
  extended: readonly PrintedBlock[],
  added: readonly PrintedBlock[],
  notes: readonly string[],
): string {
  const parts = extended.map(
    (block) => `${countOf(block.fieldNames.length, 'field')} added to ${block.modelName}`,
  );
  if (added.length > 0) {
    parts.push(
      `model${added.length === 1 ? '' : 's'} ${listOf(added.map((block) => block.modelName))} added`,
    );
  }
  return [
    `Changes to ${path}: ${parts.join(', ')}. After the file is written, run \`prisma contract emit\` and update your database.`,
    ...notes.map((note) => `Note: ${note}`),
  ].join('\n');
}

/**
 * Adds what the comparison found missing to the PSL source files, as text inserted at positions from the syntax tree: missing fields after the last field of their model, missing models at the end of the file that holds the first model the edit extends. Every original line is kept as written. Throws the contract message, with the reason, when the edit cannot be made.
 */
export function editContractSource<F extends ContractSourceFile>(
  files: readonly F[],
  comparison: ContractComparison,
): ContractEdit<F> {
  assertOnlyAdditions(comparison);
  const withoutId = comparison.models.find(
    (model) => model.status === 'found' && model.missingFields.includes('id'),
  );
  if (withoutId?.status === 'found') {
    throw notChanged(
      comparison,
      `model ${withoutId.found.name} has no field named \`id\`. Add the \`id\` field above by hand, with \`@unique\` in place of \`@id\`.`,
    );
  }

  const declared = parsedModels(files, comparison);
  const printed = printPsl(comparison);
  const extended = printed.blocks.filter((block) => block.existing);
  const added = printed.blocks.filter((block) => !block.existing);

  const targets = extended.map((block) => {
    const matches = declared.get(modelKey(block.namespaceId, block.modelName)) ?? [];
    const [match] = matches;
    if (match === undefined) {
      throw notChanged(
        comparison,
        `no model ${block.modelName} is declared in ${listOf(files.map((file) => file.path))}.`,
      );
    }
    if (matches.length > 1) {
      throw notChanged(
        comparison,
        `model ${block.modelName} is declared more than once in ${listOf(uniquePaths(matches))}.`,
      );
    }
    return { block, ...match };
  });

  const newNamespace = comparison.namespace ?? comparison.defaultNamespace;
  const inNewNamespace = [...declared.values()]
    .flat()
    .filter(({ namespaceId }) => namespaceId === newNamespace);
  const stale = [
    ...targets.flatMap(({ block, ...model }) => staleFields(block, model)),
    ...added.flatMap((block) => staleModels(block, inNewNamespace)),
  ];
  if (stale.length > 0) {
    throw notChanged(
      comparison,
      `${listOf([...new Set(stale.map(({ path }) => path))])} already declares ${listOf(stale.map(({ name }) => name))}, which the emitted contract does not have. Run \`prisma contract emit\`, then update your database.`,
    );
  }

  const touched = uniquePaths(targets);
  if (touched.length > 1) {
    throw notChanged(
      comparison,
      `the additions belong in ${listOf(touched)}, and Better Auth writes one file. Add them by hand.`,
    );
  }
  const file = targets[0]?.file ?? files[0];
  if (file === undefined) throw notChanged(comparison, 'no contract file was found.');
  const eol = file.text.includes('\r\n') ? '\r\n' : '\n';
  const unit = indentUnit(
    file.text,
    [...declared.values()].flat().filter((model) => model.file === file),
  );

  const insertions = targets.map(({ block, declaration }) => {
    const insertion = fieldInsertion(file.text, declaration, block, eol, unit);
    if (insertion === undefined) {
      throw notChanged(
        comparison,
        `model ${block.modelName} is written on one line. Put its \`}\` on a line of its own and run \`auth generate\` again.`,
      );
    }
    return insertion;
  });
  if (added.length > 0) {
    const models = reindented(renderBlocks(added, comparison.namespace), unit)
      .split('\n')
      .join(eol);
    insertions.push({
      offset: file.text.length,
      text: `${separatorBefore(file.text, eol)}${models}${eol}`,
    });
  }

  let code = file.text;
  for (const { offset, text } of [...insertions].sort((a, b) => b.offset - a.offset)) {
    code = `${code.slice(0, offset)}${text}${code.slice(offset)}`;
  }
  return { file, code, summary: summaryOf(file.path, extended, added, printed.notes) };
}
