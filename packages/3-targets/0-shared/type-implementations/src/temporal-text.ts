import type { TemporalImplementation } from './temporal';

/** The `Symbol.toStringTag` of each Temporal kind a codec reads and writes. */
export type TemporalTag =
  | 'Temporal.Instant'
  | 'Temporal.PlainDate'
  | 'Temporal.PlainDateTime'
  | 'Temporal.PlainTime';

/** A Temporal value, of any kind and from any implementation. */
export interface TemporalValue {
  readonly calendarId?: string;
  toString: () => string;
}

export type TemporalFromTextResult<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'unreadable'; readonly detail: string; readonly cause: unknown };

/** Reads `text` as a Temporal value with `parse`, or says why `parse` refused it. */
export function temporalFromText<T>(
  temporal: TemporalImplementation,
  text: string,
  parse: (temporal: TemporalImplementation, text: string) => T,
): TemporalFromTextResult<T> {
  try {
    return { kind: 'value', value: parse(temporal, text) };
  } catch (cause) {
    return {
      kind: 'unreadable',
      detail: cause instanceof Error ? cause.message : String(cause),
      cause,
    };
  }
}

export type TemporalToTextResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'wrong-type'; readonly received: string }
  | { readonly kind: 'non-iso-calendar'; readonly calendarId: string };

/**
 * The ISO text of a Temporal value of the kind `temporalTag` names, as `isoText` writes it, by default its own `toString()`. A value of another kind, or in a calendar other than ISO 8601, is refused. The kind is read from `Symbol.toStringTag`, so a value made by any Temporal implementation is accepted.
 */
export function temporalToText(
  value: TemporalValue,
  temporalTag: TemporalTag,
  isoText: (value: TemporalValue) => string = (temporalValue) => temporalValue.toString(),
): TemporalToTextResult {
  const tag: unknown =
    typeof value === 'object' && value !== null
      ? Reflect.get(value, Symbol.toStringTag)
      : undefined;
  if (tag !== temporalTag) {
    return { kind: 'wrong-type', received: describeEncodeInput(value, tag) };
  }
  if (value.calendarId !== undefined && value.calendarId !== 'iso8601') {
    return { kind: 'non-iso-calendar', calendarId: value.calendarId };
  }
  return { kind: 'text', text: isoText(value) };
}

function describeEncodeInput(value: unknown, tag: unknown): string {
  if (typeof tag === 'string') {
    return `a ${tag}`;
  }
  if (value instanceof Date) {
    return 'a Date';
  }
  if (value === null) {
    return 'null';
  }
  return `a ${typeof value}`;
}

/** ISO text in UTC without its trailing `Z`. */
export function withoutUtcDesignator(isoText: string): string {
  return isoText.endsWith('Z') ? isoText.slice(0, -1) : isoText;
}
