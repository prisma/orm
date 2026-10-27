import type {
  AuthoringStorageTypeTemplate,
  AuthoringTypeAliasDescriptor,
} from './framework-authoring';
import type { MutationDefaultGeneratorDescriptor } from './mutation-default-types';

/**
 * Canonical id for the wall-clock-now mutation default generator. It flows to the control-plane descriptor, to each family's runtime generator, and to the `now()` binding of the codecs that store it.
 */
export const TIMESTAMP_NOW_GENERATOR_ID = 'timestampNow' as const;

/** Builds the control-plane descriptor for the wall-clock-now mutation default generator. */
export function timestampNowControlDescriptor(): MutationDefaultGeneratorDescriptor {
  return { id: TIMESTAMP_NOW_GENERATOR_ID };
}

const NOW_CALL = { name: 'now', args: {} } as const;

/**
 * Builds the `temporal.{CreatedAt,UpdatedAt}` type alias pair for a target's timestamp column type. `CreatedAt` calls `now()` on create; `UpdatedAt` calls it on create and on update. The target's `now()` binding for the codec picks the generator. `value` names the value the codec gives in TypeScript, such as `a JavaScript Date`, and ends each alias's documentation.
 */
/* @__NO_SIDE_EFFECTS__ */
export function temporalTypeAliases<const Type extends AuthoringStorageTypeTemplate>(
  type: Type,
  value: string,
) {
  return {
    CreatedAt: {
      kind: 'typeAlias',
      documentation: `A timestamp the client sets to now when a row is created. Its value is ${value}.`,
      output: { type, onCreate: NOW_CALL },
    },
    UpdatedAt: {
      kind: 'typeAlias',
      documentation: `A timestamp the client sets to now when a row is created and every time it is updated. Its value is ${value}.`,
      output: { type, onCreate: NOW_CALL, onUpdate: NOW_CALL },
    },
  } as const satisfies Record<string, AuthoringTypeAliasDescriptor>;
}
