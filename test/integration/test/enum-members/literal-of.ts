/** The TypeScript literal type of a value a query read, or `undefined` when the value has none: a string, a finite number, a boolean or a bigint has one, and anything else does not. */
export function literalOf(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'number':
      return Number.isFinite(value) ? String(value) : undefined;
    default:
      return undefined;
  }
}
