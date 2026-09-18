import { InternalError } from '@internal/utils/internal-error';
import { ModelAttributeAst } from '../syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../syntax/ast/declarations';
import { type SyntaxElement, SyntaxNode, type SyntaxToken } from '../syntax/red';
import type { TokenKind } from '../tokenizer';

export function emitDocument(document: DocumentAst, indentUnit: string, newline: string): string {
  const writer = new LineWriter(indentUnit, newline);
  emitTopLevel(writer, document);
  return writer.finish();
}

class LineWriter {
  readonly #indentUnit: string;
  readonly #newline: string;
  readonly #out: string[] = [];
  #depth = 0;
  #line = '';
  #lineOpen = false;
  #prevKind: TokenKind | undefined;
  #lastWasBlank = false;
  #hasContent = false;

  constructor(indentUnit: string, newline: string) {
    this.#indentUnit = indentUnit;
    this.#newline = newline;
  }

  indent(): void {
    this.#depth += 1;
  }

  unindent(): void {
    this.#depth = Math.max(0, this.#depth - 1);
  }

  lastIsBlank(): boolean {
    return this.#lastWasBlank;
  }

  lineOpen(): boolean {
    return this.#lineOpen;
  }

  prevKind(): TokenKind | undefined {
    return this.#prevKind;
  }

  newline(): void {
    if (!this.#lineOpen) return;
    this.#out.push(`${this.#indentUnit.repeat(this.#depth)}${this.#line}`);
    this.#line = '';
    this.#lineOpen = false;
    this.#prevKind = undefined;
    this.#lastWasBlank = false;
    this.#hasContent = true;
  }

  blank(): void {
    this.newline();
    if (!this.#hasContent || this.#lastWasBlank) return;
    this.#out.push('');
    this.#lastWasBlank = true;
  }

  write(token: SyntaxToken, space: boolean, padTo?: number): void {
    if (this.#lineOpen && padTo !== undefined) {
      this.#line = this.#line.padEnd(padTo);
    } else if (this.#lineOpen && space) {
      this.#line += ' ';
    }
    this.#line += token.text;
    this.#lineOpen = true;
    this.#prevKind = token.kind;
  }

  writeRaw(text: string): void {
    this.#line += text;
    this.#lineOpen = true;
  }

  comment(text: string): void {
    if (this.#lineOpen) this.#line += ` ${text}`;
    else this.#line = text;
    this.#lineOpen = true;
    this.newline();
  }

  finish(): string {
    this.newline();
    const body = this.#out.join(this.#newline);
    return body.length > 0 ? `${body}${this.#newline}` : '';
  }
}

// Qualified-name separators hug; argument/object colons keep the usual value space.
function spaceBetween(
  prev: TokenKind | undefined,
  cur: TokenKind,
  inQualifiedName: boolean,
): boolean {
  if (prev === undefined) return false;
  if (inQualifiedName) return false;
  // Only a tagged literal puts a string directly after an identifier, and its tag and string hug.
  if (prev === 'Ident' && cur === 'StringLiteral') return false;

  switch (cur) {
    case 'LParen':
    case 'LBracket':
    case 'RParen':
    case 'RBracket':
    case 'Comma':
    case 'Question':
    case 'Dot':
    case 'Colon':
      return false;
    case 'RBrace':
      return prev !== 'LBrace';
    default:
      break;
  }
  switch (prev) {
    case 'LParen':
    case 'LBracket':
    case 'Dot':
    case 'At':
    case 'DoubleAt':
      return false;
    default:
      return true;
  }
}

function streamNode(writer: LineWriter, node: SyntaxNode, padTo?: number): number {
  let continuation = 0;
  let first = true;
  let prevQualified = false;

  const walk = (parent: SyntaxNode, qualified: boolean): void => {
    for (const child of parent.children()) {
      if (child instanceof SyntaxNode) {
        walk(child, qualified || child.kind === 'QualifiedName');
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline') continue;
      if (child.kind === 'Comment') {
        writer.comment(child.text);
        writer.indent();
        continuation += 1;
        prevQualified = false;
        first = false;
        continue;
      }
      const pad = first ? padTo : undefined;
      const space = spaceBetween(writer.prevKind(), child.kind, qualified && prevQualified);
      writer.write(child, space, writer.lineOpen() ? pad : undefined);
      prevQualified = qualified;
      first = false;
    }
  };

  walk(node, false);
  return continuation;
}

function closeContinuation(writer: LineWriter, count: number): void {
  for (let i = 0; i < count; i++) writer.unindent();
}

function emitField(
  writer: LineWriter,
  field: FieldDeclarationAst,
  columns: AlignmentColumns | undefined,
): number {
  return streamRow(writer, field.syntax, columns);
}

function emitNamedType(writer: LineWriter, decl: NamedTypeDeclarationAst): number {
  return streamRow(writer, decl.syntax, undefined);
}

function streamRow(
  writer: LineWriter,
  row: SyntaxNode,
  columns: AlignmentColumns | undefined,
): number {
  let continuation = 0;
  let sawAttribute = false;

  for (const child of row.children()) {
    if (child instanceof SyntaxNode) {
      let padTo: number | undefined;
      if (child.kind === 'TypeAnnotation' && continuation === 0) {
        padTo = columns?.typeColumn;
      } else if (child.kind === 'FieldAttribute') {
        if (continuation > 0) writer.newline();
        else if (!sawAttribute) padTo = columns?.attributeColumn;
        sawAttribute = true;
      }
      continuation += streamNode(writer, child, padTo);
      continue;
    }
    if (child.kind === 'Whitespace' || child.kind === 'Newline') continue;
    if (child.kind === 'Comment') {
      writer.comment(child.text);
      writer.indent();
      continuation += 1;
      continue;
    }
    const space = spaceBetween(writer.prevKind(), child.kind, false);
    writer.write(child, space);
  }

  return continuation;
}

function emitBlockAttribute(writer: LineWriter, attribute: ModelAttributeAst): number {
  return streamNode(writer, attribute.syntax);
}

function emitKeyValue(writer: LineWriter, pair: KeyValuePairAst): number {
  return streamNode(writer, pair.syntax);
}

type MemberCategory = 'regular' | 'blockAttribute' | 'nestedBlock';

interface BlockMember {
  readonly category: MemberCategory;
  /** Stays on the source line it shares with the member that follows it. */
  readonly keepsSourceLine: boolean;
  emit(trailing: string | undefined, endLine: boolean): number;
}

function leafMember(
  writer: LineWriter,
  category: MemberCategory,
  print: () => number,
  keepsSourceLine = false,
): BlockMember {
  return {
    category,
    keepsSourceLine,
    emit(trailing, endLine) {
      const continuation = print();
      if (trailing !== undefined) writer.comment(trailing);
      else if (endLine) writer.newline();
      return continuation;
    },
  };
}

type MemberClassifier = (node: SyntaxNode) => BlockMember | undefined;

function emitModel(
  writer: LineWriter,
  model: ModelDeclarationAst,
  trailing: string | undefined,
): void {
  const columns = alignmentMap(model.syntax);
  emitBlockBody(writer, model.syntax, trailing, (node) => {
    const field = FieldDeclarationAst.cast(node);
    if (field) return leafMember(writer, 'regular', () => emitField(writer, field, columns));
    const attribute = ModelAttributeAst.cast(node);
    if (attribute)
      return leafMember(writer, 'blockAttribute', () => emitBlockAttribute(writer, attribute));
    return undefined;
  });
}

function emitCompositeType(
  writer: LineWriter,
  composite: CompositeTypeDeclarationAst,
  trailing: string | undefined,
): void {
  const columns = alignmentMap(composite.syntax);
  emitBlockBody(writer, composite.syntax, trailing, (node) => {
    const field = FieldDeclarationAst.cast(node);
    if (field) return leafMember(writer, 'regular', () => emitField(writer, field, columns));
    const attribute = ModelAttributeAst.cast(node);
    if (attribute)
      return leafMember(writer, 'blockAttribute', () => emitBlockAttribute(writer, attribute));
    return undefined;
  });
}

/**
 * With the `prisma7` grammar a `view` body holds `FieldDeclaration` members, so they print through
 * the model field path. With the `psl` grammar the same source line reads as several entries with
 * no `=`; those entries keep the source line they share, so `id Int` does not become two lines.
 */
function emitGenericBlock(
  writer: LineWriter,
  block: GenericBlockDeclarationAst,
  trailing: string | undefined,
): void {
  const alignment = alignmentMap(block.syntax);
  emitBlockBody(writer, block.syntax, trailing, (node) => {
    const field = FieldDeclarationAst.cast(node);
    if (field) return leafMember(writer, 'regular', () => emitField(writer, field, alignment));
    const entry = KeyValuePairAst.cast(node);
    if (entry)
      return leafMember(
        writer,
        'regular',
        () => emitKeyValue(writer, entry),
        entry.equals() === undefined,
      );
    const attribute = ModelAttributeAst.cast(node);
    if (attribute)
      return leafMember(writer, 'blockAttribute', () => emitBlockAttribute(writer, attribute));
    return undefined;
  });
}

function emitNamespace(
  writer: LineWriter,
  namespace: NamespaceDeclarationAst,
  trailing: string | undefined,
): void {
  emitBlockBody(writer, namespace.syntax, trailing, (node) => {
    const declaration = castBlockDeclaration(node);
    if (declaration) return nestedBlockMember(writer, declaration);
    return undefined;
  });
}

function emitTypesBlock(
  writer: LineWriter,
  block: TypesBlockAst,
  trailing: string | undefined,
): void {
  emitBlockBody(writer, block.syntax, trailing, (node) => {
    const named = NamedTypeDeclarationAst.cast(node);
    if (named) return leafMember(writer, 'regular', () => emitNamedType(writer, named));
    return undefined;
  });
}

function emitTopLevel(writer: LineWriter, document: DocumentAst): void {
  walkRegion(writer, Array.from(document.syntax.children()), undefined, (node) => {
    const declaration = castTopLevelDeclaration(node);
    if (declaration) return nestedBlockMember(writer, declaration);
    return undefined;
  });
}

type BlockEmitter = (writer: LineWriter, trailing: string | undefined) => void;

function nestedBlockMember(writer: LineWriter, block: BlockEmitter): BlockMember {
  return {
    category: 'nestedBlock',
    keepsSourceLine: false,
    emit(trailing) {
      block(writer, trailing);
      return 0;
    },
  };
}

function castBlockDeclaration(node: SyntaxNode): BlockEmitter | undefined {
  const model = ModelDeclarationAst.cast(node);
  if (model) return (writer, trailing) => emitModel(writer, model, trailing);
  const composite = CompositeTypeDeclarationAst.cast(node);
  if (composite) return (writer, trailing) => emitCompositeType(writer, composite, trailing);
  const generic = GenericBlockDeclarationAst.cast(node);
  if (generic) return (writer, trailing) => emitGenericBlock(writer, generic, trailing);
  return undefined;
}

function castTopLevelDeclaration(node: SyntaxNode): BlockEmitter | undefined {
  const block = castBlockDeclaration(node);
  if (block) return block;
  const namespace = NamespaceDeclarationAst.cast(node);
  if (namespace) return (writer, trailing) => emitNamespace(writer, namespace, trailing);
  const types = TypesBlockAst.cast(node);
  if (types) return (writer, trailing) => emitTypesBlock(writer, types, trailing);
  return undefined;
}

function emitBlockBody(
  writer: LineWriter,
  node: SyntaxNode,
  closingTrailing: string | undefined,
  classify: MemberClassifier,
): void {
  const children = Array.from(node.children());
  const openIndex = children.findIndex((el) => !(el instanceof SyntaxNode) && el.kind === 'LBrace');

  streamHeader(writer, node);
  const headerComment = sameLineCommentAfter(children, openIndex);
  if (headerComment !== undefined) writer.comment(headerComment);
  else writer.newline();

  writer.indent();
  walkRegion(writer, children, 'RBrace', classify);
  writer.unindent();

  writer.writeRaw('}');
  if (closingTrailing !== undefined) writer.comment(closingTrailing);
  else writer.newline();
}

function streamHeader(writer: LineWriter, node: SyntaxNode): void {
  let done = false;
  const walk = (parent: SyntaxNode): void => {
    for (const child of parent.children()) {
      if (done) return;
      if (child instanceof SyntaxNode) {
        walk(child);
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline' || child.kind === 'Comment') {
        continue;
      }
      const space = spaceBetween(writer.prevKind(), child.kind, false);
      writer.write(child, space);
      if (child.kind === 'LBrace') {
        done = true;
        return;
      }
    }
  };
  walk(node);
}

function walkRegion(
  writer: LineWriter,
  elements: readonly SyntaxElement[],
  closeKind: 'RBrace' | undefined,
  classify: MemberClassifier,
): void {
  let sawOpenBrace = closeKind === undefined;
  let sawContent = false;
  let lastWasRegular = false;
  let ledByComment = false;
  let newlines = 0;

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;

    if (element instanceof SyntaxNode) {
      if (!sawOpenBrace) continue;
      const member = classify(element);
      if (member === undefined) {
        throw new InternalError(
          `Formatter has no rule for a ${element.kind} node at offset ${element.offset}; formatting would drop its text`,
        );
      }
      if (!ledByComment) {
        if (newlines >= 2 && sawContent && !writer.lastIsBlank()) writer.blank();
        else if (separationBlankWanted(writer, member.category, sawContent, lastWasRegular)) {
          writer.blank();
        }
      }

      const trailing = sameLineTrailingComment(elements, i);
      const endLine = !member.keepsSourceLine || !memberFollowsOnSameLine(elements, i);
      closeContinuation(writer, member.emit(trailing.text, endLine));
      if (trailing.index !== undefined) i = trailing.index;
      sawContent = true;
      lastWasRegular = member.category !== 'blockAttribute';
      ledByComment = false;
      newlines = 0;
      continue;
    }

    if (element.kind === 'LBrace' && closeKind === 'RBrace' && !sawOpenBrace) {
      sawOpenBrace = true;
      newlines = 0;
      continue;
    }
    if (!sawOpenBrace) continue;
    if (closeKind === 'RBrace' && element.kind === 'RBrace') break;
    if (element.kind === 'Whitespace') continue;
    if (element.kind === 'Newline') {
      newlines += 1;
      continue;
    }
    if (element.kind === 'Comment') {
      if (closeKind === 'RBrace' && newlines === 0 && !sawContent) {
        // Same-line comment trailing the opening `{`: owned by the block header.
        continue;
      }
      if (newlines >= 2 && sawContent && !writer.lastIsBlank()) writer.blank();
      else if (!ledByComment) {
        const led = leadingMemberAfter(elements, i, classify);
        if (led && separationBlankWanted(writer, led, sawContent, lastWasRegular)) writer.blank();
      }
      writer.writeRaw(element.text);
      writer.newline();
      sawContent = true;
      ledByComment = true;
      newlines = 0;
    }
  }
}

function memberFollowsOnSameLine(elements: readonly SyntaxElement[], memberIndex: number): boolean {
  for (let i = memberIndex + 1; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;
    if (element instanceof SyntaxNode) return true;
    if (element.kind === 'Whitespace') continue;
    return false;
  }
  return false;
}

function separationBlankWanted(
  writer: LineWriter,
  category: MemberCategory,
  sawContent: boolean,
  lastWasRegular: boolean,
): boolean {
  if (!sawContent || writer.lastIsBlank()) return false;
  if (category === 'nestedBlock') return true;
  return category === 'blockAttribute' && lastWasRegular;
}

function leadingMemberAfter(
  elements: readonly SyntaxElement[],
  commentIndex: number,
  classify: MemberClassifier,
): MemberCategory | undefined {
  for (let i = commentIndex + 1; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;
    if (element instanceof SyntaxNode) return classify(element)?.category;
    if (element.kind === 'RBrace') return undefined;
  }
  return undefined;
}

function sameLineTrailingComment(
  elements: readonly SyntaxElement[],
  memberIndex: number,
): { text: string | undefined; index: number | undefined } {
  for (let i = memberIndex + 1; i < elements.length; i++) {
    const element = elements[i];
    if (element === undefined) continue;
    if (element instanceof SyntaxNode) break;
    if (element.kind === 'Whitespace') continue;
    if (element.kind === 'Comment') return { text: element.text, index: i };
    break;
  }
  return { text: undefined, index: undefined };
}

function sameLineCommentAfter(
  children: readonly SyntaxElement[],
  openIndex: number,
): string | undefined {
  for (let i = openIndex + 1; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;
    if (child instanceof SyntaxNode) return undefined;
    if (child.kind === 'Whitespace') continue;
    if (child.kind === 'Comment') return child.text;
    return undefined;
  }
  return undefined;
}

interface AlignmentColumns {
  readonly typeColumn: number;
  readonly attributeColumn: number;
}

function alignmentMap(block: SyntaxNode): AlignmentColumns | undefined {
  const fields: SyntaxNode[] = [];
  for (const element of block.children()) {
    if (!(element instanceof SyntaxNode)) continue;
    if (FieldDeclarationAst.cast(element) === undefined) continue;
    // Interior comments split rows into continuation lines, so those rows opt out of alignment.
    if (hasInteriorComment(element)) continue;
    fields.push(element);
  }
  if (fields.length === 0) return undefined;
  return alignmentColumns(fields);
}

function alignmentColumns(rows: readonly SyntaxNode[]): AlignmentColumns {
  let nameWidth = 0;
  for (const row of rows) {
    const field = FieldDeclarationAst.cast(row);
    if (!field) continue;
    nameWidth = Math.max(nameWidth, renderTokens(field.name()?.syntax).length);
  }
  const typeColumn = nameWidth + 1;
  let cellEnd = 0;
  for (const row of rows) {
    const field = FieldDeclarationAst.cast(row);
    if (!field) continue;
    const name = renderTokens(field.name()?.syntax);
    const type = renderTokens(field.typeAnnotation()?.syntax);
    cellEnd = Math.max(cellEnd, type.length > 0 ? typeColumn + type.length : name.length);
  }
  return { typeColumn, attributeColumn: cellEnd + 1 };
}

function hasInteriorComment(node: SyntaxNode): boolean {
  for (const token of node.tokens()) {
    if (token.kind === 'Comment') return true;
  }
  return false;
}

function renderTokens(node: SyntaxNode | undefined): string {
  if (!node) return '';
  let out = '';
  let prev: TokenKind | undefined;
  let prevQualified = false;
  const walk = (parent: SyntaxNode, qualified: boolean): void => {
    for (const child of parent.children()) {
      if (child instanceof SyntaxNode) {
        walk(child, qualified || child.kind === 'QualifiedName');
        continue;
      }
      if (child.kind === 'Whitespace' || child.kind === 'Newline' || child.kind === 'Comment') {
        continue;
      }
      if (spaceBetween(prev, child.kind, qualified && prevQualified)) out += ' ';
      out += child.text;
      prev = child.kind;
      prevQualified = qualified;
    }
  };
  walk(node, false);
  return out;
}
