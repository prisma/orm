import mongoFamilyPack from '@internal/family-mongo/pack';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import type {
  ContractFactory,
  ContractInput,
  ContractScaffold,
  MongoContractResult,
} from '@internal/mongo-contract-ts/contract-builder';
import { buildBoundContract } from '@internal/mongo-contract-ts/contract-builder';
import mongoTargetPack from '@internal/target-mongo/pack';

type MongoFamilyPack = typeof mongoFamilyPack;
type MongoTargetPack = typeof mongoTargetPack;

type MongoExtensionPacks = Record<string, ExtensionPackRef<'mongo', string>>;
type ExtensionsConstraint = MongoExtensionPacks | undefined;

// Helpers type derived from the exported ContractFactory rather than the
// un-exported ContractAuthoringHelpers, so we stay inside the public surface.
type MongoHelpers<Extensions extends ExtensionsConstraint> = Parameters<
  ContractFactory<
    Record<never, never>,
    Record<never, never>,
    undefined,
    MongoFamilyPack,
    MongoTargetPack,
    Extensions
  >
>[0];

// Input types omit family + target AND explicitly forbid them so that
// `@ts-expect-error` tests can verify the fields are rejected. The result type omits them again:
// a `family?: never` left in the input would make the whole input type `never`.
type MongoContractInput<Extensions extends ExtensionsConstraint> = Omit<
  ContractInput<
    MongoFamilyPack,
    MongoTargetPack,
    Record<never, never>,
    Record<never, never>,
    Extensions
  >,
  'family' | 'target'
> & {
  readonly family?: never;
  readonly target?: never;
};

type MongoScaffoldInput<Extensions extends ExtensionsConstraint> = Omit<
  ContractScaffold<MongoFamilyPack, MongoTargetPack, Extensions>,
  'family' | 'target'
> & {
  readonly family?: never;
  readonly target?: never;
};

// Overload 1: input form — models / valueObjects inline in the input object.
export function defineContract<const Input extends MongoContractInput<ExtensionsConstraint>>(
  input: Input,
): MongoContractResult<
  Omit<Input, 'family' | 'target'> & {
    readonly family: MongoFamilyPack;
    readonly target: MongoTargetPack;
  }
>;

// Overload 2: factory form — models / valueObjects provided by a factory function.
export function defineContract<
  const Extensions extends ExtensionsConstraint,
  const Scaffold extends MongoScaffoldInput<Extensions>,
  const Built extends {
    readonly models?: Record<string, unknown>;
    readonly valueObjects?: Record<string, unknown>;
    readonly roots?: Record<string, string>;
  },
>(
  scaffold: Scaffold & { readonly extensions?: Extensions },
  factory: (helpers: MongoHelpers<Extensions>) => Built,
): MongoContractResult<
  Omit<Scaffold, 'family' | 'target'> &
    Built & { readonly family: MongoFamilyPack; readonly target: MongoTargetPack }
>;

// Implementation — delegates to buildBoundContract which pre-binds family/target
// and builds the contract, carrying zero casts at this layer.
export function defineContract(
  input: MongoContractInput<MongoExtensionPacks>,
  factory?: ContractFactory<
    Record<string, never>,
    Record<string, never>,
    undefined,
    MongoFamilyPack,
    MongoTargetPack,
    MongoExtensionPacks
  >,
) {
  if (factory !== undefined) {
    return buildBoundContract(mongoFamilyPack, mongoTargetPack, input, factory);
  }
  return buildBoundContract(mongoFamilyPack, mongoTargetPack, input);
}
