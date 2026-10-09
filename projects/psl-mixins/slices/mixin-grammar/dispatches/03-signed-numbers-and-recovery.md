# Brief: mixin-grammar D2 round 2 — signed numbers, member recovery, and removing the line-start rule

## Task

The operator rejected the rule that a `+` is an inclusion only at the start of a line. Replace it with the two changes the slice spec now describes: the tokenizer reads `+` followed by a digit as part of a number, and a member whose attribute arguments or value fail to parse consumes the rest of its line. Also fix review finding F1.

## Changes

1. **Remove the line-start condition** in `parseMixinInclusion`. An inclusion is read wherever a body member may start. `model User { +Timestamps }` and a `+Name` after another member on the same line follow whatever the member loop does for two members on one line today.
2. **Signed numbers.** In `scanNumber`, a `+` immediately followed by a digit starts a `NumberLiteral`, exactly as `-` does. `+1` and `+1.5` have the values `1` and `1.5` wherever a number is accepted. Check every place that converts a `NumberLiteral`'s text to a value (the `num`, `int` and `num-literal` combinators, default-value handling in the interpreters, the formatter and the PSL printer) and make sure a leading `+` gives the right value and prints back as written.
3. **Member recovery.** When parsing a field, a `key = value` entry, an enum member or a block attribute fails part-way through its attribute arguments or value, that member consumes the remaining tokens up to the sync point (`Newline`, `}` or end of file) into its own node and reports its own diagnostic. The member loop must not start a new member on the leftover of a failed one. `id Int @default(+foo)` reports the argument error only, with no `MixinInclusion` node.
4. **F1.** `language-server/src/folding-ranges.ts`: the doc comment listing the block kinds that fold omits mixin declarations, which now fold. Add them to the list. This is an edit to keep an existing comment true; add no other comments.

## Completed when

- [ ] Tokenizer tests: `+1`, `+1.5` are single `NumberLiteral` tokens; `+` followed by a letter, space, or nothing is `Plus`.
- [ ] A test at interpreter level shows `@default(+1)` on an `Int` field yields the default `1`, in the SQL `contract-psl` package.
- [ ] Parser tests: `model User { +Timestamps }` yields a `MixinInclusion`; `id Int @default(+foo)` yields one diagnostic and no `MixinInclusion`; the equivalent leftover case for a `key = value` entry and for a block attribute.
- [ ] Your report lists every pre-existing test assertion you changed, with the old and new expected diagnostics and one line on why the old one was a product of leftover tokens.
- [ ] `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check` and `lint` for each touched package pass, apart from the four known environment failures. No fixture changes.

## Halt conditions

- Change 3 alters the diagnostics of an input whose second diagnostic was not caused by leftover tokens of a failed member, or changes more than about ten existing assertions. Stop and report the list before changing them.
- A fixture or formatter snapshot changes.
- A consumer of number literals cannot represent a leading `+` without a change outside this slice's packages.
