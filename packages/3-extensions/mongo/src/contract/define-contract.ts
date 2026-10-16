import mongoFamilyPack from '@internal/family-mongo/pack';
import type {
  ContractDefinition,
  ContractFactory,
  ContractScaffold,
  MongoContractResult,
} from '@internal/mongo-contract-ts/contract-builder';
import { buildBoundContract } from '@internal/mongo-contract-ts/contract-builder';
import mongoTargetPack from '@internal/target-mongo/pack';

type MongoFamilyPack = typeof mongoFamilyPack;
type MongoTargetPack = typeof mongoTargetPack;

// Helpers type derived from the exported ContractFactory rather than the
// un-exported ContractAuthoringHelpers, so we stay inside the public surface.
type MongoHelpers = Parameters<
  ContractFactory<
    Record<never, never>,
    Record<never, never>,
    undefined,
    MongoFamilyPack,
    MongoTargetPack,
    undefined
  >
>[0];

// Input types omit family + target AND explicitly forbid them so that
// `@ts-expect-error` tests can verify the fields are rejected. The result type omits them again:
// a `family?: never` left in the definition would make the whole definition type `never`.
type MongoDefinitionInput = Omit<
  ContractDefinition<MongoFamilyPack, MongoTargetPack>,
  'family' | 'target'
> & {
  readonly family?: never;
  readonly target?: never;
};

type MongoScaffoldInput = Omit<
  ContractScaffold<MongoFamilyPack, MongoTargetPack>,
  'family' | 'target'
> & {
  readonly family?: never;
  readonly target?: never;
};

// Overload 1: definition form — models / valueObjects inline in the definition object.
export function defineContract<const Definition extends MongoDefinitionInput>(
  definition: Definition,
): MongoContractResult<
  Omit<Definition, 'family' | 'target'> & {
    readonly family: MongoFamilyPack;
    readonly target: MongoTargetPack;
  }
>;

// Overload 2: factory form — models / valueObjects provided by a factory function.
export function defineContract<
  const Definition extends MongoScaffoldInput,
  const Built extends {
    readonly models?: Record<string, unknown>;
    readonly valueObjects?: Record<string, unknown>;
    readonly roots?: Record<string, string>;
  },
>(
  scaffold: Definition,
  factory: (helpers: MongoHelpers) => Built,
): MongoContractResult<
  Omit<Definition, 'family' | 'target'> &
    Built & { readonly family: MongoFamilyPack; readonly target: MongoTargetPack }
>;

// Implementation — delegates to buildBoundContract which pre-binds family/target
// and calls buildContractFromDefinition directly, carrying zero casts at this layer.
export function defineContract(
  definition: MongoDefinitionInput,
  factory?: ContractFactory<
    Record<string, never>,
    Record<string, never>,
    undefined,
    MongoFamilyPack,
    MongoTargetPack,
    undefined
  >,
) {
  if (factory !== undefined) {
    return buildBoundContract(mongoFamilyPack, mongoTargetPack, definition, factory);
  }
  return buildBoundContract(mongoFamilyPack, mongoTargetPack, definition);
}
