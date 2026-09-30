import type { PslParserOptions } from '@internal/config/config-types';
import { type ParseResult, parse, type SourceFile } from '@internal/psl-parser/syntax';
import { normalizeFileUri } from './schema-inputs';

export class DocumentSnapshot {
  readonly uri: string;
  readonly text: string;
  readonly parserOptions: PslParserOptions;
  #parsed: ParseResult | undefined;

  constructor(uri: string, text: string, parserOptions: PslParserOptions = {}) {
    this.uri = normalizeFileUri(uri);
    this.text = text;
    this.parserOptions = parserOptions;
    Object.freeze(this);
  }

  parse(): ParseResult {
    this.#parsed ??= parse(this.text, this.uri, this.parserOptions);
    return this.#parsed;
  }

  get sourceFile(): SourceFile {
    const { document, sources } = this.parse();
    return sources.sourceFileFor(document.syntax);
  }
}
