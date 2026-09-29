import { type ParseResult, parse, type SourceFile } from '@internal/psl-parser/syntax';
import { normalizeFileUri } from './schema-inputs';

export interface DocumentSnapshot {
  readonly uri: string;
  readonly text: string;
  readonly sourceFile: SourceFile;
  parse(): ParseResult;
}

class DocumentSnapshotImpl implements DocumentSnapshot {
  readonly uri: string;
  readonly text: string;
  #parsed: ParseResult | undefined;

  constructor(uri: string, text: string) {
    this.uri = normalizeFileUri(uri);
    this.text = text;
    Object.freeze(this);
  }

  parse(): ParseResult {
    this.#parsed ??= parse(this.text, this.uri);
    return this.#parsed;
  }

  get sourceFile(): SourceFile {
    const { document, sources } = this.parse();
    return sources.sourceFileFor(document.syntax);
  }
}

export function createDocumentSnapshot(uri: string, text: string): DocumentSnapshot {
  return new DocumentSnapshotImpl(uri, text);
}
