import { and, type Condition, or } from '@prisma/orm-family-sql/orm-client';
import type { TextComparison, TextFunctions } from '../target-support';

interface Pattern {
  readonly fns: TextFunctions;
  readonly column: TextComparison['column'];
  readonly codecId: string;
}

function sensitivePattern(
  { fns, column, codecId }: Pattern,
  operator: 'contains' | 'starts_with' | 'ends_with',
  value: string,
): Condition {
  const expected = fns.raw`${value}`.returns(codecId);
  switch (operator) {
    case 'starts_with':
      return fns.eq(fns.raw`substr(${column}, 1, length(${value}))`.returns(codecId), expected);
    case 'ends_with':
      return fns.eq(
        fns.raw`substr(${column}, length(${column}) - length(${value}) + 1)`.returns(codecId),
        expected,
      );
    case 'contains':
      return fns.ne(
        fns.raw`replace(${column}, ${value}, '')`.returns(codecId),
        fns.raw`${column}`.returns(codecId),
      );
  }
}

function insensitivePattern(
  { fns, column, codecId }: Pattern,
  operator: 'eq' | 'ne' | 'contains' | 'starts_with' | 'ends_with',
  value: string,
): Condition {
  const expected = fns.raw`lower(${value})`.returns(codecId);
  switch (operator) {
    case 'eq':
      return fns.eq(fns.raw`lower(${column})`.returns(codecId), expected);
    case 'ne':
      return fns.ne(fns.raw`lower(${column})`.returns(codecId), expected);
    case 'starts_with':
      return fns.eq(
        fns.raw`substr(lower(${column}), 1, length(lower(${value})))`.returns(codecId),
        expected,
      );
    case 'ends_with':
      return fns.eq(
        fns.raw`substr(lower(${column}), length(lower(${column})) - length(lower(${value})) + 1)`.returns(
          codecId,
        ),
        expected,
      );
    case 'contains':
      return fns.ne(
        fns.raw`replace(lower(${column}), lower(${value}), '')`.returns(codecId),
        fns.raw`lower(${column})`.returns(codecId),
      );
  }
}

/**
 * Text comparisons for a database whose `substr` and `length` count characters and whose `=` respects case. Pattern operators compare substrings instead of using `LIKE`, so `%` and `_` in a value match only themselves. Case-insensitive comparisons compare `lower()` of both sides.
 */
export function compareTextBySubstring(comparison: TextComparison): Condition {
  const { column, insensitive } = comparison;
  switch (comparison.operator) {
    case 'eq':
      return insensitive
        ? insensitivePattern(comparison, 'eq', comparison.value)
        : column.eq(comparison.value);
    case 'ne':
      return insensitive
        ? insensitivePattern(comparison, 'ne', comparison.value)
        : column.neq(comparison.value);
    case 'in':
      return insensitive
        ? or(...comparison.values.map((value) => insensitivePattern(comparison, 'eq', value)))
        : column.in(comparison.values);
    case 'not_in':
      return insensitive
        ? and(...comparison.values.map((value) => insensitivePattern(comparison, 'ne', value)))
        : column.notIn(comparison.values);
    default:
      return insensitive
        ? insensitivePattern(comparison, comparison.operator, comparison.value)
        : sensitivePattern(comparison, comparison.operator, comparison.value);
  }
}
