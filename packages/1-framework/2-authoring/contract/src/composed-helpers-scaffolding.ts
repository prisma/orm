import type {
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
} from '@internal/framework-components/authoring';
import { instantiateAuthoringEntityType } from '@internal/framework-components/authoring';

/**
 * Family-agnostic merge / instantiation scaffolding for pack-bag-driven
 * authoring contributions. The per-namespace shape (`type`,
 * `entityTypes`) is parameterized by the discriminator key so each
 * namespace can reuse the same extractor + cross-pack merger without
 * re-deriving the template per family. Call sites flatten merged
 * `entityTypes` onto the user-facing top-level helpers surface
 * alongside the built-in `model` / `rel` (e.g. `helpers.enum(...)`).
 * The contribution data structure stays as
 * `authoring.entityTypes.<name>` — pack authors keep contributing
 * through the namespace; the composed-helpers template performs the
 * rename in the type system.
 *
 * SQL-specific composition (the `field` / `model` / `rel` / `type` core
 * helpers, the SQL index-types merge) lives in the SQL contract-ts
 * package and imports from here.
 */

export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

export type AuthoringNamespaceKey = 'type' | 'entityTypes';

export type ExtractAuthoringNamespaceFromPack<
  Pack,
  Key extends AuthoringNamespaceKey,
  EmptyNamespace,
> = Pack extends {
  readonly authoring?: { readonly [P in Key]?: infer Namespace };
}
  ? Namespace extends Record<string, unknown>
    ? Namespace
    : EmptyNamespace
  : EmptyNamespace;

export type MergeExtensionAuthoringNamespaces<
  Extensions,
  Key extends AuthoringNamespaceKey,
  EmptyNamespace = Record<never, never>,
> =
  Extensions extends Record<string, unknown>
    ? keyof Extensions extends never
      ? EmptyNamespace
      : UnionToIntersection<
          {
            [K in keyof Extensions]: ExtractAuthoringNamespaceFromPack<
              Extensions[K],
              Key,
              EmptyNamespace
            >;
          }[keyof Extensions]
        >
    : EmptyNamespace;

/**
 * Entity-helper shape derivation. Mirrors `TypeHelpersFromNamespace` in the SQL package: leaf descriptors become callable helpers; nested namespaces recurse.
 */
type ExtractFactoryInputAndOutput<Descriptor extends AuthoringEntityTypeDescriptor> =
  Descriptor['output'] extends {
    readonly factory: (input: infer Input, ctx: AuthoringEntityContext) => infer Output;
  }
    ? { input: Input; output: Output }
    : { input: unknown; output: unknown };

export type EntityHelperFunction<Descriptor extends AuthoringEntityTypeDescriptor> =
  ExtractFactoryInputAndOutput<Descriptor> extends { input: infer Input; output: infer Output }
    ? (input: Input) => Output
    : never;

export type EntityHelpersFromNamespace<Namespace> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringEntityTypeDescriptor
    ? EntityHelperFunction<Namespace[K]>
    : Namespace[K] extends Record<string, unknown>
      ? EntityHelpersFromNamespace<Namespace[K]>
      : never;
};

export interface EntityHelperFactoryOptions {
  readonly ctx: AuthoringEntityContext;
}

/**
 * Walks an entity-type namespace (after cross-pack merge) and produces the
 * runtime callable surface mirroring its tree shape. Each leaf
 * descriptor becomes a function `(input) => factory(input, ctx)`;
 * nested namespace objects recurse.
 */
export function createEntityHelpersFromNamespace(
  namespace: AuthoringEntityTypeNamespace,
  options: EntityHelperFactoryOptions,
  path: readonly string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isLeafEntityDescriptor(value)) {
      result[key] = createEntityHelper(currentPath.join('.'), value, options);
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = createEntityHelpersFromNamespace(
        value as AuthoringEntityTypeNamespace,
        options,
        currentPath,
      );
    }
  }
  return result;
}

function isLeafEntityDescriptor(value: unknown): value is AuthoringEntityTypeDescriptor {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { kind?: unknown }).kind !== 'entity'
  ) {
    return false;
  }
  const discriminator = (value as { discriminator?: unknown }).discriminator;
  return typeof discriminator === 'string' && discriminator.length > 0;
}

function createEntityHelper(
  helperPath: string,
  descriptor: AuthoringEntityTypeDescriptor,
  options: EntityHelperFactoryOptions,
): (...args: readonly unknown[]) => unknown {
  return (...args: readonly unknown[]) =>
    instantiateAuthoringEntityType(helperPath, descriptor, args, options.ctx);
}
