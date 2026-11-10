import { runtimeError } from './execution/runtime-error';

/**
 * The kinds of operations an annotation may apply to.
 *
 * - `'read'` — `SELECT` / `find` / `first` / `all` / `count` / aggregates.
 * - `'write'` — `INSERT` / `UPDATE` / `DELETE` / `create` / `update` / `delete` / `upsert`.
 *
 * Annotations declare which kinds they apply to via `defineAnnotation`'s
 * `applicableTo` option; lane terminals enforce the constraint at both the
 * type level (via `ValidAnnotations`) and at runtime (via
 * `assertAnnotationsApplicable`).
 *
 * Finer-grained kinds (`'select' | 'insert' | 'update' | 'delete' | 'upsert'`)
 * are deliberately deferred. The binary covers the common case (the cache
 * middleware applies to reads; an audit annotation would apply to writes;
 * tracing/OTel applies to both). When a real annotation surfaces that needs
 * a finer split, the union widens and existing handles remain typecheckable.
 */
export type OperationKind = 'read' | 'write';

/**
 * An applied annotation. Carries the namespace, the typed payload, and the
 * `applicableTo` set the underlying handle declared. The `__annotation`
 * brand lets `read` distinguish branded user annotations from arbitrary
 * data that may happen to live under the same namespace key in
 * `plan.meta.annotations` (e.g. framework-internal metadata such as
 * `meta.annotations.codecs`).
 *
 * Constructed by calling an `AnnotationHandle` directly (e.g.
 * `cacheAnnotation({ ttl: 60 })`); never instantiated by hand.
 */
export interface AnnotationValue<Payload, Kinds extends OperationKind> {
  readonly __annotation: true;
  readonly namespace: string;
  readonly value: Payload;
  readonly applicableTo: ReadonlySet<Kinds>;
}

/**
 * Handle returned by `defineAnnotation`. The handle is **callable**: the
 * call signature wraps a `Payload` into an `AnnotationValue` ready to
 * pass to a lane terminal's variadic `annotations` argument. The handle
 * also carries static metadata as own properties:
 *
 * - `namespace` — the namespace string the handle was declared with.
 * - `applicableTo` — the frozen `ReadonlySet<Kinds>` consumed by both
 *   the type-level `ValidAnnotations` gate and the runtime
 *   `assertAnnotationsApplicable` gate.
 * - `read(source)` — extract the `Payload` from a plan's `meta.annotations`
 *   or an activity's `annotations` if a value was previously written under
 *   this handle's namespace. Returns `undefined` when the annotation is
 *   absent or when the stored value is not a branded `AnnotationValue`
 *   (e.g. framework-internal metadata under the same namespace key).
 *
 * Handles are the only supported public entry point for reading and
 * writing annotations. Direct mutation of `plan.meta.annotations` is not
 * part of the public API.
 *
 * ```typescript
 * const cacheAnnotation = defineAnnotation<{ ttl: number }>()({
 *   namespace: 'cache',
 *   applicableTo: ['read'],
 * });
 *
 * // Call the handle to construct a value:
 * const applied = cacheAnnotation({ ttl: 60 });
 *
 * // Read a stored value off a plan:
 * const payload = cacheAnnotation.read(plan);
 * ```
 *
 * Note on the inherited `Function.prototype.apply`: because the handle is
 * a function, the property name `apply` resolves to JavaScript's built-in
 * `Function.prototype.apply` (which lets you invoke a function with an
 * array of arguments). This is **not** the construction entry point — to
 * build an `AnnotationValue`, call the handle directly. The
 * `AnnotationHandle` interface deliberately does not declare an `apply`
 * member of its own.
 */
export interface AnnotationHandle<Payload, Kinds extends OperationKind> {
  (value: Payload): AnnotationValue<Payload, Kinds>;
  readonly namespace: string;
  readonly applicableTo: ReadonlySet<Kinds>;
  read(source: AnnotationSource): Payload | undefined;
}

/** A plan, or an activity, whose annotations a handle reads. */
export type AnnotationSource =
  | { readonly meta: { readonly annotations?: Record<string, unknown> } }
  | { readonly annotations: ReadonlyMap<string, unknown> };

/**
 * Options accepted by `defineAnnotation`.
 *
 * `namespace` is the string key under which the annotation is stored in
 * `plan.meta.annotations`. **Reserved namespaces** include framework-
 * internal metadata keys; user handles must not use them:
 *
 * - `codecs` — used by the SQL emitter to record per-alias codec ids
 *   (`meta.annotations.codecs[alias] = 'pg/text@1'`); the SQL runtime's
 *   `decodeRow` reads from this key. A user `defineAnnotation('codecs')`
 *   handle is not structurally prevented, but its behavior with the
 *   emitter and the runtime is undefined and we make no compatibility
 *   guarantees about it.
 * - Target-specific keys such as `pg` (and equivalents on other
 *   targets) are similarly reserved for adapter / target use.
 *
 * `applicableTo` declares which operation kinds the annotation may attach
 * to. The lane terminals' type-level `ValidAnnotations<K, As>` gate rejects
 * annotations whose `Kinds` does not include the terminal's `K`; the
 * runtime helper `assertAnnotationsApplicable` does the equivalent at
 * runtime so casts and `any` cannot bypass the gate.
 */
export interface DefineAnnotationOptions<Kinds extends OperationKind> {
  readonly namespace: string;
  readonly applicableTo: readonly Kinds[];
}

/**
 * Defines a typed annotation handle.
 *
 * Two-step call form. The first step takes the `Payload` type argument
 * (TypeScript cannot infer `Payload` from anything in the options, so it
 * must be supplied explicitly); the second step takes the runtime options
 * and infers `Kinds` from the `applicableTo` array via a `const` type
 * parameter, so the operation kinds appear exactly once at the call site.
 *
 * @example
 * ```typescript
 * // Read-only annotation. Lane terminals like `db.User.first(...)` accept
 * // it; `db.User.create(...)` rejects it at the type level.
 * const cacheAnnotation = defineAnnotation<{ ttl?: number; skip?: boolean }>()({
 *   namespace: 'cache',
 *   applicableTo: ['read'],
 * }); // Kinds inferred as 'read'
 *
 * // Write-only annotation. Mirror image.
 * const auditAnnotation = defineAnnotation<{ actor: string }>()({
 *   namespace: 'audit',
 *   applicableTo: ['write'],
 * }); // Kinds inferred as 'write'
 *
 * // Annotation applicable to both kinds (e.g. tracing).
 * const otelAnnotation = defineAnnotation<{ traceId: string }>()({
 *   namespace: 'otel',
 *   applicableTo: ['read', 'write'],
 * }); // Kinds inferred as 'read' | 'write'
 * ```
 *
 * **Reserved namespaces.** See `DefineAnnotationOptions.namespace` for the
 * list of framework-internal namespaces (`codecs`, target-specific keys).
 * `defineAnnotation` does not structurally prevent a user from naming a
 * reserved namespace, but the framework makes no compatibility guarantee
 * about handles that do.
 */
export function defineAnnotation<Payload>(): <const Kinds extends OperationKind>(
  options: DefineAnnotationOptions<Kinds>,
) => AnnotationHandle<Payload, Kinds> {
  return <const Kinds extends OperationKind>(
    options: DefineAnnotationOptions<Kinds>,
  ): AnnotationHandle<Payload, Kinds> => {
    const namespace = options.namespace;
    const applicableTo: ReadonlySet<Kinds> = Object.freeze(new Set(options.applicableTo));

    function handle(value: Payload): AnnotationValue<Payload, Kinds> {
      return Object.freeze({
        __annotation: true as const,
        namespace,
        value,
        applicableTo,
      });
    }

    function read(source: AnnotationSource): Payload | undefined {
      const stored =
        'meta' in source ? source.meta.annotations?.[namespace] : source.annotations.get(namespace);
      if (!isAnnotationValue(stored)) {
        return undefined;
      }
      if (stored.namespace !== namespace) {
        // Defensive: a different handle wrote under our namespace key.
        return undefined;
      }
      return stored.value as Payload;
    }

    return Object.freeze(
      Object.assign(handle, {
        namespace,
        applicableTo,
        read,
      }),
    );
  };
}

/**
 * Type-level applicability gate consumed by lane terminals.
 *
 * Maps a tuple of `AnnotationValue`s to a tuple where each element either
 * keeps its annotation type (when the annotation's declared `Kinds`
 * includes the terminal's operation kind `K`) or resolves to `never`
 * (when the kinds are incompatible). A `never` element makes the entire
 * tuple unassignable, surfacing the mismatch as a type error at the call
 * site of the terminal.
 *
 * The SQL DSL builders constrain their variadic `...annotations`
 * parameter via `As & ValidAnnotations<K, As>`. **The intersection is
 * load-bearing** — see the note below. The ORM terminals deliberately
 * sidestep this trick by taking one annotation per `meta.annotate(...)`
 * call (no variadic-tuple inference involved), so `ValidAnnotations` is
 * consumed only by the SQL DSL today.
 *
 * @example
 * ```typescript
 * class SelectQuery<Row> {
 *   annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
 *     ...annotations: As & ValidAnnotations<'read', As>
 *   ): SelectQuery<Row>;
 * }
 *
 * class InsertQuery<Row> {
 *   annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
 *     ...annotations: As & ValidAnnotations<'write', As>
 *   ): InsertQuery<Row>;
 * }
 *
 * db.users.select('id').annotate(cacheAnnotation({ ttl: 60 }));
 * // ✓ cacheAnnotation declares 'read'; SelectQuery.annotate requires 'read'.
 *
 * db.users
 *   .insert([{ id: 1, name: 'Alice', email: 'alice@example.com' }])
 *   .annotate(cacheAnnotation({ ttl: 60 }));
 * // ✗ cacheAnnotation declares 'read'; InsertQuery.annotate requires 'write'.
 * //   Element resolves to `never` → tuple unassignable → type error.
 * ```
 *
 * **Why `As & ValidAnnotations<K, As>` and not `ValidAnnotations<K, As>`
 * alone.** TypeScript's variadic-tuple inference is too forgiving when
 * the parameter type refers to `As` only through `ValidAnnotations`: it
 * will pick an `As` that makes the call valid even when the gated tuple
 * would contain `never` for an inapplicable element. The intersection
 * pins `As` to the actual call-site tuple AND requires it to be
 * assignable to the gated form. A `never` element in the gated tuple
 * then collapses the corresponding intersection position to `never`,
 * and the inapplicable argument fails to assign — surfacing the mismatch
 * as a type error at the call site.
 *
 * The runtime helper `assertAnnotationsApplicable` covers the equivalent
 * check at runtime so casts and `any` cannot bypass this gate.
 */
export type ValidAnnotations<
  K extends OperationKind,
  As extends readonly AnnotationValue<unknown, OperationKind>[],
> = {
  readonly [I in keyof As]: As[I] extends AnnotationValue<infer P, infer Kinds>
    ? K extends Kinds
      ? AnnotationValue<P, Kinds>
      : never
    : never;
};

/**
 * Runtime applicability gate. Throws `RUNTIME.ANNOTATION_INAPPLICABLE` if
 * any annotation in `annotations` declares an `applicableTo` set that does
 * not include `kind`. Used by lane terminals (SQL DSL builders' `.build()`,
 * ORM `Collection` terminals) to fail closed when the type-level
 * `ValidAnnotations` gate is bypassed via cast / `any` / dynamic
 * invocation.
 *
 * Passes silently on:
 *  - empty arrays
 *  - annotations whose `applicableTo` includes `kind`
 *
 * Throws on:
 *  - any annotation whose `applicableTo` does not include `kind`. The
 *    error names the offending annotation's `namespace` and the
 *    `terminalName` so users can locate the misuse.
 *
 * @example
 * ```typescript
 * // Inside an ORM read terminal:
 * assertAnnotationsApplicable(annotations, 'read', 'first');
 * ```
 */
export function assertAnnotationsApplicable(
  annotations: readonly AnnotationValue<unknown, OperationKind>[],
  kind: OperationKind,
  terminalName: string,
): void {
  for (const annotation of annotations) {
    if (!annotation.applicableTo.has(kind)) {
      const applicableTo = Array.from(annotation.applicableTo);
      const kinds = applicableTo.join(' and ');
      throw runtimeError(
        'RUNTIME.ANNOTATION_INAPPLICABLE',
        `An annotation that applies only to ${kinds} operations was given to a ${kind} operation. Remove it from the ${kind} and put it on a ${kinds} operation instead.`,
        { namespace: annotation.namespace, terminalName, kind, applicableTo },
      );
    }
  }
}

const noAnnotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> = new Map();

/** The branded annotation values in a plan's `meta.annotations`, keyed by namespace. */
export function brandedAnnotations(
  annotations: Readonly<Record<string, unknown>> | undefined,
): ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> {
  if (annotations === undefined) return noAnnotations;
  let branded: Map<string, AnnotationValue<unknown, OperationKind>> | undefined;
  for (const [namespace, value] of Object.entries(annotations)) {
    if (!isAnnotationValue(value)) continue;
    branded ??= new Map();
    branded.set(namespace, value);
  }
  return branded ?? noAnnotations;
}

/**
 * Type guard for branded annotation values stored in `plan.meta.annotations`.
 *
 * Internal — used by `AnnotationHandle.read` to distinguish user
 * annotations (created by calling a handle returned from
 * `defineAnnotation(...)`) from framework-internal metadata that may
 * happen to live under the same namespace key.
 */
function isAnnotationValue(value: unknown): value is AnnotationValue<unknown, OperationKind> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { readonly __annotation?: unknown };
  return candidate.__annotation === true;
}
