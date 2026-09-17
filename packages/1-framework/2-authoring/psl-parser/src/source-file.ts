import type { PslSpan } from '@internal/framework-components/psl-ast';
import { InternalError } from '@internal/utils/internal-error';
import type { SyntaxNode } from './syntax/red';

const CARRIAGE_RETURN = 13;
const LINE_FEED = 10;

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export class SourceFile {
  readonly #filename: string;
  readonly #text: string;
  readonly #lineStarts: readonly number[];

  constructor(filename: string, text: string) {
    this.#filename = filename;
    this.#text = text;
    const lineStarts: number[] = [0];
    for (let offset = 0; offset < text.length; offset++) {
      if (text.charCodeAt(offset) === LINE_FEED) {
        lineStarts.push(offset + 1);
      }
    }
    this.#lineStarts = lineStarts;
  }

  get filename(): string {
    return this.#filename;
  }

  get text(): string {
    return this.#text;
  }

  get length(): number {
    return this.#text.length;
  }

  get lineCount(): number {
    return this.#lineStarts.length;
  }

  lineStartOffsets(): readonly number[] {
    return this.#lineStarts;
  }

  lineStartOffset(line: number): number {
    if (line <= 0) {
      return 0;
    }
    return this.#lineStarts[line] ?? this.#text.length;
  }

  lineEndOffset(line: number): number {
    if (line < 0) {
      return 0;
    }

    const nextLineStart = this.#lineStarts[line + 1];
    if (nextLineStart === undefined) {
      return this.#text.length;
    }

    const lineFeedOffset = nextLineStart - 1;
    const carriageReturnOffset = lineFeedOffset - 1;
    return this.#text.charCodeAt(carriageReturnOffset) === CARRIAGE_RETURN
      ? carriageReturnOffset
      : lineFeedOffset;
  }

  positionAt(offset: number): Position {
    const clamped = clamp(offset, 0, this.#text.length);
    const line = this.#lineIndexAt(clamped);
    return { line, character: clamped - this.#lineStartAt(line) };
  }

  offsetAt(position: Position): number {
    const line = clamp(position.line, 0, this.#lineStarts.length - 1);
    const lineStart = this.#lineStartAt(line);
    const lineEnd = this.#lineEndAt(line);
    return clamp(lineStart + position.character, lineStart, lineEnd);
  }

  offsetToPslPosition(offset: number): PslSpan['start'] {
    const position = this.positionAt(offset);
    return { offset, line: position.line + 1, column: position.character + 1 };
  }

  rangeToPslSpan(range: Range): PslSpan {
    return {
      start: this.offsetToPslPosition(this.offsetAt(range.start)),
      end: this.offsetToPslPosition(this.offsetAt(range.end)),
    };
  }

  pslSpanToRange(span: PslSpan): Range {
    return {
      start: this.positionAt(span.start.offset),
      end: this.positionAt(span.end.offset),
    };
  }

  #lineStartAt(line: number): number {
    return this.#lineStarts[line] ?? 0;
  }

  #lineEndAt(line: number): number {
    return line + 1 < this.#lineStarts.length ? this.#lineStartAt(line + 1) - 1 : this.#text.length;
  }

  #lineIndexAt(offset: number): number {
    const lineStarts = this.#lineStarts;
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      if ((lineStarts[mid] ?? 0) <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }
}

export class PslSources {
  readonly #sourcesByRoot = new Map<SyntaxNode, SourceFile>();

  constructor(entries: Iterable<readonly [SyntaxNode, SourceFile]>) {
    for (const [root, sourceFile] of entries) {
      this.#sourcesByRoot.set(root, sourceFile);
    }
  }

  sourceFileNamed(filename: string): SourceFile {
    let match: SourceFile | undefined;
    for (const sourceFile of this.#sourcesByRoot.values()) {
      if (sourceFile.filename !== filename) continue;
      if (match !== undefined && match.text !== sourceFile.text) {
        throw new InternalError(
          `Ambiguous PSL diagnostic filename "${filename}": registered sources have different text`,
        );
      }
      match = sourceFile;
    }
    if (match === undefined) {
      throw new InternalError(`No SourceFile registered for PSL diagnostic filename "${filename}"`);
    }
    return match;
  }

  sourceFileFor(node: SyntaxNode): SourceFile {
    const root = node.root();
    const sourceFile = this.#sourcesByRoot.get(root);
    if (sourceFile === undefined) {
      throw new InternalError('No SourceFile registered for PSL syntax root');
    }
    return sourceFile;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
