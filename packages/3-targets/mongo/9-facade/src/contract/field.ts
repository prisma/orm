import mongoFamilyPack from '@internal/family-mongo/pack';
import {
  type ContractAuthoringHelpers,
  createContractAuthoringHelpers,
} from '@internal/mongo-contract-ts/contract-builder';
import mongoTargetPack from '@internal/target-mongo/pack';

type MongoHelpers = ContractAuthoringHelpers<typeof mongoFamilyPack, typeof mongoTargetPack>;

const helpers: MongoHelpers = createContractAuthoringHelpers({
  family: mongoFamilyPack,
  target: mongoTargetPack,
});

/**
 * The field builders of the `defineContract` callback for MongoDB: `field.scalar(type.ObjectId())`, `field.valueObject(Address)`, `field.namedType(Role)`. Use it outside a contract, for example to declare models passed to `defineContract({ models })`.
 */
export const field: MongoHelpers['field'] = helpers.field;

/**
 * The generator function calls of the `defineContract` callback for MongoDB, for `.onCreate(...)` and `.onUpdate(...)`. MongoDB declares one generator function, so this holds `gen.now()` only.
 */
export const gen: MongoHelpers['gen'] = helpers.gen;

/**
 * The type constructors and type aliases of the `defineContract` callback for MongoDB, for `field.scalar(...)`: `type.ObjectId()`, `type.String()`, `type.Vector(3)`, `type.temporal.CreatedAt()`.
 */
export const type: MongoHelpers['type'] = helpers.type;
