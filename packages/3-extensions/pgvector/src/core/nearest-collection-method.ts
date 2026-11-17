import type {
  CollectionMethodBody,
  CollectionMethodContribution,
  CollectionMethodContributionId,
  CollectionMethodContributionType,
  CollectionMethodModelType,
} from '@internal/sql-relational-core/collection-methods';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { Vector } from '../types/codec-types';
import { VECTOR_CODEC_ID } from './constants';

type VectorFieldNames<Fields> = {
  [Name in keyof Fields]: Fields[Name] extends { readonly many: object }
    ? never
    : Fields[Name] extends { readonly type: { readonly codecId: typeof VECTOR_CODEC_ID } }
      ? Name
      : never;
}[keyof Fields];

type VectorLength<Field> = Field extends {
  readonly type: { readonly typeParams: { readonly length: infer Length extends number } };
}
  ? Length
  : number;

type NearestMethodTable<Model extends CollectionMethodModelType> = {
  readonly [Name in VectorFieldNames<Model['fields']> & string as `${Name}_nearest`]: {
    readonly parameters: readonly [
      vector: Vector<VectorLength<Model['fields'][Name & keyof Model['fields']]>>,
      maxDistance?: number,
    ];
    readonly filters: false;
    readonly orders: true;
  };
};

/** One method for each vector field of a model, named `<field>_nearest`: the rows nearest to a vector by cosine distance, nearest first, optionally only those within `maxDistance`. Without `maxDistance` it only orders, so rows whose field is null come back too, last. It declares no filter, because it filters only when `maxDistance` is given. */
export interface PgvectorNearestMethods extends CollectionMethodContributionType {
  readonly methods: NearestMethodTable<this['model']>;
}

declare module '@internal/sql-relational-core/collection-methods' {
  interface CollectionMethodRegistry {
    readonly 'pgvector/nearest': PgvectorNearestMethods;
  }
}

interface Distance {
  asc(): unknown;
  lt(limit: number): unknown;
}

type VectorFields = Readonly<
  Record<string, { cosineDistance(vector: readonly number[]): Distance }>
>;

function distanceTo(model: unknown, field: string, vector: readonly number[]): Distance {
  const accessor = blindCast<
    VectorFields,
    'a vector field of the ORM model accessor has cosineDistance'
  >(model)[field];
  if (accessor === undefined) {
    throw new InternalError(`The model accessor has no vector field "${field}".`);
  }
  return accessor.cosineDistance(vector);
}

function nearestMethod(field: string): CollectionMethodBody {
  return (collection, ...args) => {
    const [vector, maxDistance] = blindCast<
      readonly [readonly number[], number | undefined],
      'the type half declares a vector and an optional distance'
    >(args);
    let shared: Distance | undefined;
    const distance = (model: unknown): Distance => {
      shared ??= distanceTo(model, field, vector);
      return shared;
    };
    const ordered = collection.orderBy((model) => distance(model).asc());
    return maxDistance === undefined
      ? ordered
      : ordered.where((model) => distance(model).lt(maxDistance));
  };
}

/** The run-time half of `PgvectorNearestMethods`. */
export const pgvectorNearestMethods: CollectionMethodContribution = {
  id: 'pgvector/nearest' satisfies CollectionMethodContributionId,
  methodsFor: (model) =>
    Object.fromEntries(
      Object.entries(model.fields).flatMap(([name, field]) =>
        !field.many && field.type.kind === 'scalar' && field.type.codecId === VECTOR_CODEC_ID
          ? [[`${name}_nearest`, nearestMethod(name)]]
          : [],
      ),
    ),
};
