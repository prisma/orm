import { ColumnRef, IdentifierRef } from '@internal/sql-relational-core/ast';
import { ExpressionImpl } from '@internal/sql-relational-core/expression';
import { blindCast } from '@internal/utils/casts';
import type { FieldProxy } from '../expression';
import type { Scope, ScopeTable } from '../scope';

export function createFieldProxy<S extends Scope>(scope: S): FieldProxy<S> {
  return new Proxy(
    blindCast<FieldProxy<S>, 'proxy populates field expressions dynamically from scope'>({}),
    {
      get(_target, prop: string) {
        if (Object.hasOwn(scope.topLevel, prop)) {
          const topField = scope.topLevel[prop];
          if (topField) {
            // Qualify top-level fields with their table name so the reference
            // stays correct when the expression is used inside a subquery.
            // A bare IdentifierRef resolves against the nearest table in scope,
            // which is the inner table once inside a correlated subquery.
            // Fall back to IdentifierRef only for select-list aliases, which
            // exist in topLevel but not in any namespace.
            const namespaceName = Object.keys(scope.namespaces).find((ns) =>
              Object.hasOwn(scope.namespaces[ns]!, prop),
            );
            const ref =
              namespaceName !== undefined
                ? ColumnRef.of(namespaceName, prop)
                : IdentifierRef.of(prop);
            return new ExpressionImpl(ref, topField);
          }
        }

        if (Object.hasOwn(scope.namespaces, prop)) {
          const nsFields = scope.namespaces[prop];
          if (nsFields) return createNamespaceProxy(prop, nsFields);
        }

        return undefined;
      },
    },
  );
}

function createNamespaceProxy(
  namespaceName: string,
  fields: ScopeTable,
): Record<string, ExpressionImpl> {
  return new Proxy<Record<string, ExpressionImpl>>(
    {},
    {
      get(_target, prop: string) {
        if (Object.hasOwn(fields, prop)) {
          const field = fields[prop];
          if (field) return new ExpressionImpl(ColumnRef.of(namespaceName, prop), field);
        }
        return undefined;
      },
    },
  );
}
