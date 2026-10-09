import { Decimal as DecimalJS } from 'decimal.js'

export * from './errors'
export * from './nullTypes'

/**
 * Prisma's `Decimal` (re-exported to users as `Prisma.Decimal`) is decimal.js,
 * whose `valueOf()` returns a *string*. Relational operators (`<`, `>`, `<=`,
 * `>=`) and `Number()` coerce operands with the `"number"` hint, which without
 * this override falls back to `valueOf()`/`toString()` — so
 * `new Decimal('10.1') < new Decimal('9.99')` compared the strings `'10.1' <
 * '9.99'` and evaluated to `true` (the wrong answer).
 *
 * Overriding `Symbol.toPrimitive` (which takes precedence over `valueOf`)
 * resolves the `"number"` hint to the actual numeric value while leaving the
 * `"string"` and `"default"` hints on the existing string representation, so
 * `toString()`, `toJSON()`, template literals, string concatenation and
 * `JSON.stringify` are all unchanged. Only the comparison contexts that were
 * wrong become numerically correct.
 *
 * The class subclasses `decimal.js` (which constructs internally via
 * `x.constructor`, so subclassing is supported) rather than mutating the shared
 * `decimal.js` prototype, so third-party `import Decimal from 'decimal.js'`
 * usage in the same process is unaffected.
 *
 * https://github.com/prisma/prisma/issues/29882
 */
export class Decimal extends DecimalJS {
  [Symbol.toPrimitive](hint: 'default' | 'number' | 'string'): number | bigint | string {
    if (hint === 'number') {
      const numeric = Number(this.toString())
      // Number() is a double: it rounds integers beyond Number.MAX_SAFE_INTEGER
      // (9007199254740992 and 9007199254740993 collapse to the same double) and
      // overflows to Infinity past ~1.8e308 (1e1000 and 1e1001 both become
      // Infinity). For those integers return an exact BigInt instead — JS
      // relational operators compare Number/BigInt operands exactly, so
      // `<`/`>`/`<=`/`>=` stay correct for large values too.
      if (this.isInteger() && !Number.isSafeInteger(numeric)) {
        return BigInt(this.toFixed(0))
      }
      return numeric
    }
    return this.toString()
  }
}

export { empty, join, raw, type RawValue, Sql, default as sql, type Value } from 'sql-template-tag'
