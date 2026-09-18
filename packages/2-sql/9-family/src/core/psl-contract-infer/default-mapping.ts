import type { ColumnDefault, ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { LiteralTypeDeclaration } from '@internal/framework-components/codec';
import { writeLiteral } from '@internal/framework-components/codec';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'autoincrement()': '@default(autoincrement())',
  'now()': '@default(now())',
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
  readonly fallbackFunctionAttribute?: ((expression: string) => string | undefined) | undefined;
  /**
   * What the column's codec accepts as a literal default. A value none of these types writes has no
   * PSL literal, and the caller falls back to the raw database default.
   */
  readonly literalTypes?: readonly LiteralTypeDeclaration[];
  /**
   * Whether the column is a list, whose elements are each written against the element codec's
   * scalar declarations. A scalar column whose codec declares `{ list: [...] }` — `pg/vector@1` —
   * writes its list through {@link writeLiteral} instead.
   */
  readonly list?: boolean;
}

export type DefaultMappingResult = { readonly attribute: string } | { readonly comment: string };

export function mapDefault(
  columnDefault: ColumnDefault,
  options?: DefaultMappingOptions,
): DefaultMappingResult {
  switch (columnDefault.kind) {
    case 'literal': {
      const text = writeDefaultLiteral(
        columnDefault.value,
        options?.literalTypes ?? [],
        options?.list === true,
      );
      return text === undefined
        ? { comment: `// Literal default: ${JSON.stringify(columnDefault.value)}` }
        : { attribute: `@default(${text})` };
    }
    case 'function': {
      const attribute =
        options?.functionAttributes?.[columnDefault.expression] ??
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression] ??
        options?.fallbackFunctionAttribute?.(columnDefault.expression);
      return attribute
        ? { attribute }
        : { comment: `// Raw default: ${columnDefault.expression.replace(/[\r\n]+/g, ' ')}` };
    }
  }
}

function writeDefaultLiteral(
  value: ColumnDefaultLiteralInputValue,
  declarations: readonly LiteralTypeDeclaration[],
  list: boolean,
): string | undefined {
  if (value instanceof Date) return undefined;
  if (!list) return writeLiteral(value, declarations)?.text;
  if (!Array.isArray(value)) return undefined;
  const scalars = declarations.filter((declaration) => typeof declaration === 'string');
  const parts: string[] = [];
  for (const element of value) {
    const written = writeLiteral(element, scalars);
    if (written === undefined) return undefined;
    parts.push(written.text);
  }
  return `[${parts.join(', ')}]`;
}
