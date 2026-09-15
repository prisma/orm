import { ColumnRef, IdentifierRef } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import type { FieldProxy } from '../expression';
import type { Scope, ScopeTable } from '../scope';
import { ExpressionImpl } from './expression-impl';

export function createFieldProxy<S extends Scope>(scope: S): FieldProxy<S> {
  return new Proxy(
    blindCast<FieldProxy<S>, 'proxy populates field expressions dynamically from scope'>({}),
    {
      get(_target, prop: string) {
        if (Object.hasOwn(scope.topLevel, prop)) {
          const topField = scope.topLevel[prop];
          if (topField) {
            return new ExpressionImpl(IdentifierRef.of(prop), topField);
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
