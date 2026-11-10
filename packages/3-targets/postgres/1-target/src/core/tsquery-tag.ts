import { postgresError } from './errors';
import { languageLiteral } from './full-text-options';
import { type TsqueryExpression, type TsqueryParserOptions, toTsquery } from './full-text-parsers';
import { DEFAULT_FULL_TEXT_SEARCH_LANGUAGE } from './text-search-languages';

export type TsqueryTag = (strings: TemplateStringsArray, ...values: string[]) => TsqueryExpression;

/**
 * An empty term, `''`, is a `tsquery` syntax error; a single space parses as a term with no words,
 * as a stop word does.
 */
function quotedTerm(value: string): string {
  return value === '' ? "' '" : `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}

function literalPart(strings: TemplateStringsArray, index: number): string {
  const part = strings[index];
  if (part === undefined) {
    throw postgresError(
      'RUNTIME.ARGUMENT_INVALID',
      `tsquery: literal part ${index} of the template has an invalid escape sequence.`,
      {
        why: 'JavaScript gives a template tag no text for a literal part with an invalid escape such as \\u or \\x, so the tsquery syntax written there would be lost.',
        fix: 'Write a literal backslash as \\\\, or remove the escape.',
        meta: {
          helper: 'tsquery',
          argument: `literal part ${index}`,
          received: strings.raw[index],
        },
      },
    );
  }
  return part;
}

function assemble(strings: TemplateStringsArray, values: readonly string[]): string {
  return values.reduce(
    (text, value, i) => `${text}${quotedTerm(value)}${literalPart(strings, i + 1)}`,
    literalPart(strings, 0),
  );
}

function isTemplate(
  value: TemplateStringsArray | TsqueryParserOptions,
): value is TemplateStringsArray {
  return Array.isArray(value);
}

/**
 * Builds a `tsquery` from `to_tsquery` syntax the application writes, with values such as user input
 * interpolated safely: `` tsquery`${term}:*` `` for a typeahead prefix match.
 *
 * The literal parts are trusted `tsquery` syntax and are used as written. Each interpolated value
 * becomes exactly one quoted term, so it cannot add operators or break the syntax, whatever it
 * contains; an empty value adds no words, like a stop word. The whole text is one bound parameter,
 * parsed by Postgres `to_tsquery`, which lowercases and stems every word.
 *
 * A value with several words becomes a phrase: `` tsquery`${'new y'}:*` `` gives
 * `'new':* <-> 'y':*`, so the words must be adjacent and in order, and `:*` applies to each word.
 * Do not put quotes around the interpolation yourself: `` tsquery`'${term}':*` `` is a syntax error
 * for every input.
 *
 * `` tsquery`...` `` uses `english`; `` tsquery({ language })`...` `` picks the configuration.
 */
export function tsquery(options: TsqueryParserOptions): TsqueryTag;
export function tsquery(strings: TemplateStringsArray, ...values: string[]): TsqueryExpression;
export function tsquery(
  first: TemplateStringsArray | TsqueryParserOptions,
  ...values: string[]
): TsqueryExpression | TsqueryTag {
  if (isTemplate(first)) {
    return toTsquery(assemble(first, values));
  }
  const language = first.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;
  languageLiteral('tsquery', language);
  return (strings, ...templateValues) => toTsquery(assemble(strings, templateValues), { language });
}
