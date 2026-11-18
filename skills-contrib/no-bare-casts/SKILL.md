---
name: no-bare-casts
description: >-
  Writing `as` in TypeScript or TSX production code, modifying a file that
  contains a bare `as` cast, silencing a type error with a cast,
  encountering `as unknown as`, or reviewing a cast site.
---

# No bare `as` casts

Any bare `as` in production TypeScript is a signal to stop and work through the decision tree below. Test files (`*.test.ts`, `*.test-d.ts`, `test/**/*.ts`) are exempt — tests use `as` for stubbing and type assertions and that's fine.

## Decision tree

Work through these in order before writing or keeping a cast:

1. **Tighten the input type.** Can the parameter, generic bound, or return type at the source be made more specific so the cast is unnecessary?
2. **Add a runtime check.** Can a type predicate (`function isUser(x): x is User`) narrow the type at runtime, eliminating the cast?
3. **Restructure a generic.** Can a bound or constraint carry the needed information, making the cast unnecessary?
4. **Use `satisfies`.** `expr satisfies T` checks the type without coercing it and is unaffected by this rule. Prefer it when you want a type-check, not a coercion.
5. **Use `castAs<T>(value)`.** When the value already satisfies `T` and the assertion is purely declarative, `castAs` is the right form.
6. **Only if none of the above: use `blindCast<T, "Reason">(value)`.** The `Reason` literal must name the specific compromise in language a reviewer can evaluate.

## Import

```typescript
import { blindCast, castAs } from '@internal/utils/casts';
```

## Helper signatures

```typescript
// Escape hatch — the value is genuinely opaque or unrelated to the target type.
// The Reason literal documents the compromise; the reviewer evaluates it.
function blindCast<TargetType, Reason extends string>(input: unknown): TargetType

// Declarative assertion — the value already satisfies T at runtime.
function castAs<T>(value: T): T
```

## The `Reason` bar

`blindCast` is the auditable escape hatch of last resort — not a convenience wrapper. Reach for it only after the decision tree above has been exhausted. The second type argument must be a string literal that a reviewer can act on:

```typescript
// ✅  Names the specific constraint
blindCast<User, "deserialized from contract validator; shape has already been checked">(raw)

// ❌  Adds no information — reviewer has nothing to evaluate
blindCast<User, "trust me">(raw)
```

A vague reason is the reviewer's signal to push back and the author's signal to revisit the type design.

## "Convert when you touch"

When you touch a file that contains a bare `as` cast — even as part of unrelated work — convert it to one of the accepted forms or eliminate it. The CI ratchet (`pnpm lint:ratchets`) rejects per-PR cast-count increases; converting on contact is how the total comes down over time.
