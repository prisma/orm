import { parse } from '../parse';
import { emitDocument } from './emit';
import { pslError } from './error';
import { type FormatOptions, resolveFormatOptions } from './options';

export function format(source: string, options?: FormatOptions): string {
  const resolved = resolveFormatOptions(options);
  const { document, diagnostics } = parse(source, '<format-input>.psl');
  if (diagnostics.length > 0) {
    const summary = diagnostics[0]?.message ?? 'unknown parse error';
    const more = diagnostics.length > 1 ? ` (and ${diagnostics.length - 1} more)` : '';
    throw pslError('PSL.PARSE_FAILED', `Cannot format PSL with parse errors: ${summary}${more}`, {
      meta: { diagnostics },
    });
  }
  return emitDocument(document, resolved.indentUnit, resolved.newline);
}
