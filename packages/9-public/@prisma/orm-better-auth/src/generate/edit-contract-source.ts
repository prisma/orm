import { isPrisma8Schema } from '@prisma/orm-framework/psl-parser';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  type FieldAttributeAst,
  GenericBlockDeclarationAst,
  MixinDeclarationAst,
  type ModelAttributeAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  parse,
  StringLiteralExprAst,
  TypesBlockAst,
} from '@prisma/orm-framework/psl-parser/syntax';
import type { ContractComparison } from '../contract/compare';
import { type PrintedBlock, printPsl, renderBlocks } from '../contract/print-psl';
import { isSearchedNamespace, modelNameCandidates } from '../models/model-lookup';
import { firstNewDiagnostic } from './check-edited-source';
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

/** A declaration other than a model that takes a name a model could take, as Prisma's symbol table claims names. */
interface OtherDeclaration {
  readonly path: string;
  readonly namespaceId: string;
  readonly name: string;
  readonly kind: string;
}

interface DeclaredMixin {
  readonly name: string;
  readonly fields: readonly string[];
}

interface Declarations<F extends ContractSourceFile> {
  readonly models: Map<string, DeclaredModel<F>[]>;
  readonly others: OtherDeclaration[];
  readonly mixins: DeclaredMixin[];
}

/** The kind of a declaration that shares the name slot of models, or `undefined` for a model or a declaration that does not. Read from `buildSymbolTable` in `psl-parser/src/symbol-table.ts`. */
function otherKind(declaration: unknown): string | undefined {
  if (declaration instanceof CompositeTypeDeclarationAst) return 'composite type';
  if (declaration instanceof MixinDeclarationAst) return 'mixin';
  if (declaration instanceof GenericBlockDeclarationAst) {
    return declaration.keyword()?.text ?? 'block';
  }
  return undefined;
}

function collectDeclarations<F extends ContractSourceFile>(
  file: F,
  document: DocumentAst,
  defaultNamespace: string,
  into: Declarations<F>,
): void {
  const add = (
    namespaceId: string,
    declaration:
      | ModelDeclarationAst
      | CompositeTypeDeclarationAst
      | GenericBlockDeclarationAst
      | MixinDeclarationAst,
  ) => {
    const name = declaration.name()?.name();
    if (name === undefined) return;
    if (declaration instanceof ModelDeclarationAst) {
      const key = modelKey(namespaceId, name);
      into.models.set(key, [...(into.models.get(key) ?? []), { file, namespaceId, declaration }]);
      return;
    }
    if (declaration instanceof MixinDeclarationAst) {
      const fields = [...declaration.fields()].flatMap((field) => field.name()?.name() ?? []);
      into.mixins.push({ name, fields });
    }
    const kind = otherKind(declaration);
    if (kind !== undefined) into.others.push({ path: file.path, namespaceId, name, kind });
  };
  for (const declaration of document.declarations()) {
    if (
      declaration instanceof ModelDeclarationAst ||
      declaration instanceof CompositeTypeDeclarationAst ||
      declaration instanceof GenericBlockDeclarationAst ||
      declaration instanceof MixinDeclarationAst
    ) {
      add(defaultNamespace, declaration);
      continue;
    }
    if (declaration instanceof TypesBlockAst) {
      for (const binding of declaration.declarations()) {
        const name = binding.name()?.name();
        if (name !== undefined) {
          into.others.push({
            path: file.path,
            namespaceId: defaultNamespace,
            name,
            kind: 'named type',
          });
        }
      }
      continue;
    }
    if (!(declaration instanceof NamespaceDeclarationAst)) continue;
    const namespaceName = declaration.name()?.name();
    if (namespaceName !== undefined) {
      into.others.push({
        path: file.path,
        namespaceId: defaultNamespace,
        name: namespaceName,
        kind: 'namespace',
      });
    }
    const namespaceId = namespaceName ?? defaultNamespace;
    for (const member of declaration.declarations()) {
      if (
        member instanceof ModelDeclarationAst ||
        member instanceof CompositeTypeDeclarationAst ||
        member instanceof GenericBlockDeclarationAst ||
        member instanceof MixinDeclarationAst
      ) {
        add(namespaceId, member);
      }
    }
  }
}

function parsedDeclarations<F extends ContractSourceFile>(
  files: readonly F[],
  comparison: ContractComparison,
): Declarations<F> {
  const declarations: Declarations<F> = { models: new Map(), others: [], mixins: [] };
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
    collectDeclarations(file, document, comparison.defaultNamespace, declarations);
  }
  return declarations;
}

/** The name `@map("x")` or `@@map("x")` gives, read as the contract emitter reads it: the first `map` attribute, and its first positional argument when that is a string. */
function mappedName(
  attributes: Iterable<FieldAttributeAst | ModelAttributeAst>,
): string | undefined {
  for (const attribute of attributes) {
    const path = attribute.name()?.path() ?? [];
    if (path.length !== 1 || path[0] !== 'map') continue;
    const [first] = [...(attribute.argList()?.args() ?? [])].filter(
      (argument) => argument.name() === undefined,
    );
    const value = first?.value();
    return value instanceof StringLiteralExprAst ? value.value() : undefined;
  }
  return undefined;
}

/** A declaration the adapter will find, which the emitted contract does not have yet. */
interface AheadOfEmit {
  readonly name: string;
  /** The namespace of a model, which the list names when two models have the same name. */
  readonly namespaceId: string | undefined;
  readonly path: string;
}

/** A declaration stored where Better Auth's model or field is stored, under a name the adapter does not look up. */
interface StoredUnderAnotherName {
  readonly path: string;
  /** The declaration as the developer wrote it: the model's name, or the field's name after its model's. */
  readonly declared: string;
  readonly storage: string;
  /** What Better Auth looks for, as the edit would have written it. */
  readonly lookedFor: string;
  readonly renameTo: string;
}

interface Conflicts {
  readonly aheadOfEmit: AheadOfEmit[];
  readonly storedUnderAnotherName: StoredUnderAnotherName[];
}

/** The name with only the ASCII letters A to Z lower-cased, the case SQLite ignores in table and column names. */
function foldAsciiCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function sameStorageName(a: string, b: string, comparison: ContractComparison): boolean {
  return comparison.storageNamesIgnoreCase ? foldAsciiCase(a) === foldAsciiCase(b) : a === b;
}

/** What the model already declares that conflicts with the fields the block would add. A Better Auth field is found by its exact name. */
function fieldConflicts(
  block: PrintedBlock,
  { file, declaration }: DeclaredModel,
  mixins: readonly DeclaredMixin[],
  comparison: ContractComparison,
  into: Conflicts,
): void {
  const additions = new Set(block.fieldNames);
  for (const inclusion of declaration.inclusions()) {
    const mixinName = inclusion.name()?.path().at(-1);
    for (const mixin of mixins.filter(({ name }) => name === mixinName)) {
      for (const name of mixin.fields.filter((field) => additions.has(field))) {
        into.aheadOfEmit.push({
          name: `${block.modelName}.${name} (from the mixin ${mixin.name})`,
          namespaceId: undefined,
          path: file.path,
        });
      }
    }
  }
  for (const field of declaration.fields()) {
    const name = field.name()?.name();
    if (name === undefined) continue;
    if (additions.has(name)) {
      into.aheadOfEmit.push({
        name: `${block.modelName}.${name}`,
        namespaceId: undefined,
        path: file.path,
      });
      continue;
    }
    const column = mappedName(field.attributes()) ?? name;
    const needed = block.columns.find((candidate) =>
      sameStorageName(candidate, column, comparison),
    );
    if (needed === undefined) continue;
    into.storedUnderAnotherName.push({
      path: file.path,
      declared: `${block.modelName}.${name}`,
      storage: `the column "${column}"`,
      lookedFor: `a field named ${needed} in ${block.modelName}`,
      renameTo: needed,
    });
  }
}

/**
 * The declared models that conflict with a model the block would add: one with a name the adapter looks the model up by, in a namespace the adapter searches; or one stored in its table, in the namespace the model goes into.
 */
function modelConflicts(
  block: PrintedBlock,
  models: readonly DeclaredModel[],
  comparison: ContractComparison,
  into: Conflicts,
): void {
  const { physicalName, table } = block;
  if (physicalName === undefined || table === undefined) return;
  const lookedUp = new Set(modelNameCandidates(physicalName));
  const newNamespace = comparison.namespace ?? comparison.defaultNamespace;
  for (const { file, namespaceId, declaration } of models) {
    const name = declaration.name()?.name();
    if (name === undefined) continue;
    if (lookedUp.has(name) && isSearchedNamespace(namespaceId, comparison.namespace)) {
      into.aheadOfEmit.push({ name, namespaceId, path: file.path });
      continue;
    }
    if (namespaceId !== newNamespace) continue;
    const stored = mappedName(declaration.attributes()) ?? name;
    if (!sameStorageName(stored, table, comparison)) continue;
    into.storedUnderAnotherName.push({
      path: file.path,
      declared: name,
      storage: `the table "${stored}"`,
      lookedFor: `a model named ${block.modelName}`,
      renameTo: block.modelName,
    });
  }
}

/** The listed names, each prefixed with its namespace when another listed name is the same. */
function aheadOfEmitNames(declarations: readonly AheadOfEmit[]): string[] {
  return declarations.map(({ name, namespaceId }) =>
    namespaceId !== undefined && declarations.filter((other) => other.name === name).length > 1
      ? `${namespaceId}.${name}`
      : name,
  );
}

function storedUnderAnotherNameReason({
  path,
  declared,
  storage,
  lookedFor,
  renameTo,
}: StoredUnderAnotherName): string {
  return `${path} stores ${declared} in ${storage}, but Better Auth looks for ${lookedFor}. Rename ${declared} to ${renameTo}, then run \`prisma contract emit\`, and \`auth generate\` again.`;
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

  const { models: declared, others, mixins } = parsedDeclarations(files, comparison);
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

  const allDeclared = [...declared.values()].flat();
  const conflicts: Conflicts = { aheadOfEmit: [], storedUnderAnotherName: [] };
  for (const { block, ...model } of targets) {
    fieldConflicts(block, model, mixins, comparison, conflicts);
  }
  for (const block of added) modelConflicts(block, allDeclared, comparison, conflicts);
  const { aheadOfEmit, storedUnderAnotherName } = conflicts;
  if (aheadOfEmit.length > 0) {
    throw notChanged(
      comparison,
      `${listOf([...new Set(aheadOfEmit.map(({ path }) => path))])} already declares ${listOf(aheadOfEmitNames(aheadOfEmit))}, which the emitted contract does not have. Run \`prisma contract emit\`, then update your database.`,
    );
  }
  if (storedUnderAnotherName.length > 0) {
    throw notChanged(
      comparison,
      storedUnderAnotherName.map(storedUnderAnotherNameReason).join(' '),
    );
  }
  const newNamespace = comparison.namespace ?? comparison.defaultNamespace;
  for (const block of added) {
    const other = others.find(
      ({ namespaceId, name }) => namespaceId === newNamespace && name === block.modelName,
    );
    if (other === undefined) continue;
    throw notChanged(
      comparison,
      `${other.path} declares the ${other.kind} ${other.name}, and Better Auth's model ${block.physicalName ?? block.modelName} needs that name. Rename the ${other.kind}, then run \`auth generate\` again.`,
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
  const rejected = firstNewDiagnostic(
    files,
    files.map((candidate) => (candidate === file ? { path: file.path, text: code } : candidate)),
    comparison.defaultNamespace,
  );
  if (rejected !== undefined) {
    throw notChanged(
      comparison,
      `Prisma would not accept the edited ${rejected.path}: ${rejected.message} (line ${rejected.line}).`,
    );
  }
  return { file, code, summary: summaryOf(file.path, extended, added, printed.notes) };
}
