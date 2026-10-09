# Slice 2b review fixes: findings

## Finding 1: A01's throw reaches the `@default` printer

Decision A01 says `printSqlExpressionLiteral` throws an internal error for text that does not read back. The review named three callers. There is a fourth: `mapDefault` in `packages/2-sql/9-family/src/core/psl-build/default-mapping.ts` printed every `function` column default through `printSqlExpressionLiteral`, for both `contract infer` and `contract print`, with no read-back check. With the throw alone, both commands would crash on a default such as `concat(E'a\n  \nb')` (a whitespace-only line inside a string constant).

Design section 11.2 and ADR 129 already decide that defaults print unconditionally, because a default is compared by parsing both sides, not byte for byte. So the decision is not wrong; it needs the default printer to stay off the checked function. What I did: `mapDefault` prints with `printTaggedLiteral(SQL_EXPRESSION_TAG, …)`, and `printSqlExpressionLiteral` throws as A01 says. A test in `default-mapping.test.ts` pins that such a default still prints. If you want defaults checked too, that is a new design decision.
