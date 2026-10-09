import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { ifDefined } from '@internal/utils/defined';
import type { ContractDefinition } from './contract-definition';

/**
 * Resolves a deferred entity-ref column descriptor (e.g. a `pg.enum(handle)`
 * column) against the field's now-known owning namespace: attaches the
 * storage `valueSet` ref the collected entity's derived value-set is stored
 * under. `typeParams.typeName` stays bare here — schema
 * qualification (e.g. `auth.aal_level`) is a target concern applied in the
 * next step, `qualifyColumnDescriptor`. A descriptor with no `entityRef` (the
 * ordinary case) passes through unchanged.
 */
function resolveEntityRefDescriptor(
  descriptor: ColumnTypeDescriptor,
  namespaceId: string,
): ColumnTypeDescriptor {
  const entityRef = descriptor.entityRef;
  if (entityRef === undefined) return descriptor;

  return {
    ...descriptor,
    valueSet: {
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId,
      entityName: entityRef.entityName,
    },
  };
}

/**
 * A target's contract-construction-time column-type qualifier, contributed
 * through `target.authoring.qualifyColumnType`. Given a column's bare type
 * info and its owning `namespaceId`, it returns the type info the target's
 * schema semantics require (e.g. Postgres schema-qualifies a native-enum
 * column's type name to `auth.aal_level`). The dispatch keys off the codec
 * id, so every codec — including ones needing no change — is passed through
 * and the caller stays codec-blind. Targets without the hook leave every
 * column bare.
 */
export type ColumnTypeQualifier = (
  input: {
    readonly codecId: string;
    readonly typeParams?: Record<string, unknown>;
  },
  namespaceId: string,
) => { readonly typeParams?: Record<string, unknown> };

/**
 * Structural check for a target that contributes a `qualifyColumnType` hook
 * on its authoring contributions. Duck-typed (mirroring
 * `contract-psl`'s `hasColumnFromEntityHook`) so the SQL family stays blind
 * to the target's qualification logic and no framework/family interface has
 * to name the hook.
 */
function hasColumnTypeQualifier(
  authoring: AuthoringContributions,
): authoring is AuthoringContributions & { readonly qualifyColumnType: ColumnTypeQualifier } {
  return 'qualifyColumnType' in authoring && typeof authoring.qualifyColumnType === 'function';
}

/**
 * A target's contract-construction-time check renderer, contributed through
 * `target.authoring.renderCheckExpressions`. Given one column's shape it
 * returns the checks that column needs, each as a kind, the column it
 * constrains, and an opaque predicate body (no surrounding `CHECK (…)`). The
 * target owns the SQL — quoting, escaping, predicate choice — and nothing
 * else: naming is composed here, so the family never depends on a property of
 * text it cannot read. `memberValues` is
 * supplied only for a domain enum authored through an `enumType()` handle, so
 * a target cannot accidentally write a membership check for a column whose
 * native type already enforces its member set. Targets without the hook write
 * no checks.
 */
export type CheckExpressionRenderer = (input: {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: boolean;
  readonly elementNullable: boolean;
  readonly memberValues: readonly (string | number)[] | undefined;
}) => ReadonlyArray<{
  readonly kind: 'membership' | 'elementNotNull';
  readonly columnName: string;
  readonly expression: string;
}>;

/**
 * Structural check for a target that contributes a `renderCheckExpressions`
 * hook, duck-typed for the same reason {@link hasColumnTypeQualifier} is: the
 * SQL family stays blind to the target's predicate syntax.
 */
function hasCheckExpressionRenderer(
  authoring: AuthoringContributions,
): authoring is AuthoringContributions & {
  readonly renderCheckExpressions: CheckExpressionRenderer;
} {
  return (
    'renderCheckExpressions' in authoring && typeof authoring.renderCheckExpressions === 'function'
  );
}

export function resolveCheckExpressionRenderer(
  target: ContractDefinition['target'],
): CheckExpressionRenderer | undefined {
  const authoring = target.authoring;
  if (authoring === undefined) return undefined;
  return hasCheckExpressionRenderer(authoring) ? authoring.renderCheckExpressions : undefined;
}

export function resolveColumnTypeQualifier(
  target: ContractDefinition['target'],
): ColumnTypeQualifier | undefined {
  const authoring = target.authoring;
  if (authoring === undefined) return undefined;
  return hasColumnTypeQualifier(authoring) ? authoring.qualifyColumnType : undefined;
}

/**
 * Applies the target's `qualifyColumnType` hook to a scalar column descriptor.
 * A descriptor whose codec the target leaves unchanged passes through untouched.
 */
function qualifyColumnDescriptor(
  descriptor: ColumnTypeDescriptor,
  namespaceId: string,
  qualify: ColumnTypeQualifier | undefined,
): ColumnTypeDescriptor {
  if (qualify === undefined) return descriptor;
  const qualified = qualify(
    {
      codecId: descriptor.codecId,
      ...ifDefined('typeParams', descriptor.typeParams),
    },
    namespaceId,
  );
  if (qualified.typeParams === descriptor.typeParams) {
    return descriptor;
  }
  return {
    ...descriptor,
    ...ifDefined('typeParams', qualified.typeParams),
  };
}

/**
 * A column's descriptor as its namespace makes it: a deferred entity ref gets its storage value set, and the target's `qualifyColumnType` hook qualifies the type for the namespace.
 */
export function resolveColumnDescriptor(
  descriptor: ColumnTypeDescriptor,
  namespaceId: string,
  qualify: ColumnTypeQualifier | undefined,
): ColumnTypeDescriptor {
  return qualifyColumnDescriptor(
    resolveEntityRefDescriptor(descriptor, namespaceId),
    namespaceId,
    qualify,
  );
}
