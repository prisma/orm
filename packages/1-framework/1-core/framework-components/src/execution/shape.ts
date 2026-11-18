/**
 * Phantom key an emitted model type carries to name its relation properties.
 * Never present at runtime; `Scalars` and `Shape` read it to tell relations from fields.
 */
export const RelationKeys: unique symbol = Symbol('RelationKeys');

/**
 * The relation names an emitted model type declares.
 */
export type RelationNamesOf<M> = Rel<M>;

/**
 * Without `exactOptionalPropertyTypes` the optional phantom infers `R | undefined`, so the
 * inferred type is filtered rather than constrained: `infer R extends string` would fall back to
 * `string` there.
 */
type Rel<M> = M extends { readonly [RelationKeys]?: infer R } ? Extract<R, string> : never;

/**
 * The scalar row of a model: every field, no relations, no phantom.
 * Distributes over a union, so the row of a polymorphic `Any<Base>` is the union of its variants' rows.
 */
export type Scalars<M> = M extends { readonly [RelationKeys]?: unknown }
  ? Omit<M, Rel<M> | typeof RelationKeys>
  : M;

/**
 * An application data structure derived from a model.
 *
 * At every level of `Spec`: `'+'` names scalars and relations to keep, and narrows the scalars only
 * when it names one; `'-'` names scalars to drop; any other key is a relation whose value is a spec
 * that narrows the related model. A relation named in `'+'` comes with all of its scalars and none of
 * its relations. Relations are absent unless asked for; cardinality and nullability come from the
 * model. Distributes over a union, so each variant of `Any<Base>` keeps only its own relations.
 */
export type Shape<M, Spec extends ShapeSpec<M, Spec> = Record<never, never>> = ShapeOf<M, Spec>;

/**
 * The constraint a `Shape` spec satisfies. A generic that forwards a spec needs it:
 * `type Response<S extends ShapeSpec<User, S>> = Shape<User, S>`.
 */
export type ShapeSpec<M, Spec> = {
  readonly [K in keyof Spec]: K extends '+'
    ? Exclude<PlusNames<M, Spec>, keyof Spec>
    : K extends '-'
      ? ScalarNamesOf<M>
      : K extends RelationNamesOf<M>
        ? ShapeSpec<RelatedModel<M, K>, Spec[K]>
        : UnknownSpecKey<M, K>;
};

type PlusNames<M, Spec> = '-' extends keyof Spec
  ? RelationNamesOf<M>
  : ScalarNamesOf<M> | RelationNamesOf<M>;

type UnknownSpecKey<M, K> = [RelationNamesOf<M>] extends [never]
  ? `'${K & string}' is not a relation of the model, which has none; try '+' or '-'`
  : `'${K & string}' is not a relation of the model; try '+', '-', or '${RelationNamesOf<M>}'`;

type ScalarNamesOf<M> = M extends unknown ? keyof Scalars<M> & string : never;

type RelatedModel<M, K> = M extends unknown
  ? K extends keyof M
    ? UnwrapRelation<M[K]>
    : never
  : never;

type UnwrapRelation<V> = V extends (infer Item)[] ? Item : NonNullable<V>;

type ShapeOf<M, Spec> = ShapeOfEach<M, Spec, PlusNamesAScalar<M, Spec>>;

type PlusNamesAScalar<M, Spec> = Spec extends { readonly '+': infer Keep }
  ? [Extract<Keep, ScalarNamesOf<M>>] extends [never]
    ? false
    : true
  : false;

type ShapeOfEach<M, Spec, Narrow extends boolean> = M extends unknown
  ? Flatten<
      KeptScalars<M, Spec, Narrow> & {
        [K in IncludedRelations<M, Spec>]: WrapLike<
          M[K],
          ShapeOf<RelatedModel<M, K>, NestedSpec<Spec, K>>
        >;
      }
    >
  : never;

type KeptScalars<M, Spec, Narrow extends boolean> = Narrow extends true
  ? Spec extends { readonly '+': infer Keep }
    ? Pick<Scalars<M>, Extract<Keep, keyof Scalars<M>>>
    : never
  : Spec extends { readonly '-': infer Drop extends PropertyKey }
    ? Omit<Scalars<M>, Drop>
    : Scalars<M>;

type IncludedRelations<M, Spec> = Extract<
  keyof Spec | (Spec extends { readonly '+': infer Keep } ? Keep : never),
  RelationNamesOf<M> & keyof M
>;

type NestedSpec<Spec, K> = K extends keyof Spec ? Spec[K] : Record<never, never>;

type WrapLike<V, R> = V extends unknown[] ? R[] : null extends V ? R | null : R;

type Flatten<T> = { [K in keyof T]: T[K] };
