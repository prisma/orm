import type { AnyCodecDescriptor, DataType } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { assertUniqueCodecOwner } from '@internal/framework-components/control';
import { findSqlDataTypeCollision, isSqlDataType } from '@internal/sql-contract/data-type';
import { assertNothingCastsFromSqlExpression } from '@internal/sql-contract/sql-expression';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { CodecControlHooks } from './migrations/types';

type CodecControlHooksMap = Record<string, CodecControlHooks>;

function hasCodecControlHooks(descriptor: unknown): descriptor is {
  readonly id: string;
  readonly types: {
    readonly codecTypes: {
      readonly controlPlaneHooks: CodecControlHooksMap;
    };
  };
} {
  if (typeof descriptor !== 'object' || descriptor === null) {
    return false;
  }
  const d = blindCast<
    { types?: { codecTypes?: { controlPlaneHooks?: unknown } } },
    'object check proves descriptor is property-readable, nested optional fields are probed defensively'
  >(descriptor);
  const hooks = d.types?.codecTypes?.controlPlaneHooks;
  return hooks !== null && hooks !== undefined && typeof hooks === 'object';
}

export function extractCodecControlHooks(
  descriptors: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): Map<string, CodecControlHooks> {
  const hooks = new Map<string, CodecControlHooks>();
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    if (typeof descriptor !== 'object' || descriptor === null) {
      continue;
    }
    if (!hasCodecControlHooks(descriptor)) {
      continue;
    }
    const controlPlaneHooks = descriptor.types.codecTypes.controlPlaneHooks;
    for (const [codecId, hook] of Object.entries(controlPlaneHooks)) {
      assertUniqueCodecOwner({
        codecId,
        owners,
        descriptorId: descriptor.id,
        entityLabel: 'control hooks',
        entityOwnershipLabel: 'owner',
      });
      hooks.set(codecId, hook);
      owners.set(codecId, descriptor.id);
    }
  }

  return hooks;
}

interface DeclaredDataType {
  readonly type: DataType;
  readonly contributedBy: string;
}

/**
 * The SQL family's checks of the stack's data types and codecs, each naming the contributor:
 * no two SQL data types would both recognise one reported type, by colliding claiming texts or by
 * claiming the same kind; no data type casts from `sql/expression`; and every codec represents a
 * SQL data type, because a codec represents a column's type and `sql/expression` is the one data
 * type no column has.
 */
export function enforceSqlDataTypeInvariants(
  declaredDataTypes: ReadonlyArray<DeclaredDataType>,
  codecDescriptors: ReadonlyArray<Pick<AnyCodecDescriptor, 'codecId' | 'dataType'>>,
): void {
  const declaredById = new Map(declaredDataTypes.map((declared) => [declared.type.id, declared]));
  const describe = (type: DataType): string =>
    `data type "${type.id}" contributed by "${declaredById.get(type.id)?.contributedBy ?? '<unknown>'}"`;

  const collision = findSqlDataTypeCollision(declaredDataTypes.map(({ type }) => type));
  if (collision !== undefined) {
    const { first, second, claims } = collision;
    if (claims.by === 'kind') {
      throw new InternalError(
        `The ${describe(first)} and the ${describe(second)} both claim the kind "${claims.kind}".`,
      );
    }
    throw new InternalError(
      `The ${describe(first)} claims the text "${claims.first}", which collides with the text "${claims.second}" claimed by the ${describe(second)}.`,
    );
  }

  assertNothingCastsFromSqlExpression(declaredDataTypes);

  for (const codec of codecDescriptors) {
    const represented = declaredById.get(codec.dataType)?.type;
    if (represented === undefined || isSqlDataType(represented)) continue;
    throw new InternalError(
      `Codec "${codec.codecId}" represents ${describe(represented)}, which is not a SQL data type. In a SQL stack a codec represents a column's type, so its data type is declared with sqlDataType.`,
    );
  }
}
