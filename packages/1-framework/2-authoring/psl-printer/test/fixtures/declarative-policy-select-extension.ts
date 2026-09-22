/**
 * Test-only fixture extension: a DECLARATIVE `policy_select` block descriptor.
 *
 * This extension contributes NO parser or printer code. The framework owns
 * the generic parser, block interpreter, and printer. The extension supplies
 * only:
 *
 *  - A declarative descriptor with keyword, discriminator, name.required,
 *    and a typed block spec over the shared expression grammar.
 *  - A matching `entityTypes` factory that reads the typed envelope
 *    (`ParsedPslExtensionBlock`) and returns a `PolicySelectIr` instance.
 *
 * Block shape exercised:
 *
 * ```
 * policy_select <name> {
 *   target = <ModelRef>
 *   as     = permissive | restrictive        (optional)
 *   roles  = [<RoleRef | identifier>, …]     (optional)
 *   using  = "<predicate>"
 * }
 * ```
 */

import type {
  AuthoringContributions,
  AuthoringEntityContext,
  ParsedPslExtensionBlock,
} from '@internal/framework-components/authoring';
import { freezeNode, IRNodeBase } from '@internal/framework-components/ir';
import type { InferBlock, PslBlockSpecDescriptor } from '@internal/psl-parser';
import {
  entityRef,
  fixedBlock,
  identifier,
  list,
  oneOf,
  optional,
  str,
} from '@internal/psl-parser';

export const POLICY_SELECT_KEYWORD = 'policy_select';
export const POLICY_SELECT_DISCRIMINATOR = 'fixture-policy-select';

export function policySelectSpec() {
  return fixedBlock({
    parameters: {
      target: {
        type: entityRef({ kind: 'model' }),
        documentation: 'The model protected by this policy.',
      },
      as: {
        type: optional(
          oneOf(
            identifier('permissive', { documentation: 'Rows combine with OR.' }),
            identifier('restrictive', { documentation: 'Rows combine with AND.' }),
          ),
        ),
        documentation: 'Whether the policy is permissive or restrictive.',
      },
      roles: {
        type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
        documentation: 'The database roles the policy applies to.',
      },
      using: { type: str(), documentation: 'The row predicate.' },
    },
  });
}

export type PolicySelectBlockValues = InferBlock<ReturnType<typeof policySelectSpec>>;

export interface PolicySelectIrInput {
  readonly name: string;
  /** The selected target model's declared name. */
  readonly target: string;
  /** Chosen token, or undefined when the `as` parameter was omitted. */
  readonly as?: 'permissive' | 'restrictive' | undefined;
  /** The decoded predicate string. */
  readonly using: string;
}

/**
 * IR class for the fixture's `policy_select` block. Plain readonly fields
 * only — JSON-clean by construction. Frozen on construction via `freezeNode`.
 * Hydrate from JSON via {@link hydratePolicySelectIrFromJson}.
 */
export class PolicySelectIr extends IRNodeBase {
  override readonly kind: typeof POLICY_SELECT_DISCRIMINATOR = POLICY_SELECT_DISCRIMINATOR;
  readonly name: string;
  readonly target: string;
  readonly as?: 'permissive' | 'restrictive';
  readonly using: string;

  constructor(input: PolicySelectIrInput) {
    super();
    this.name = input.name;
    this.target = input.target;
    if (input.as !== undefined) {
      this.as = input.as;
    }
    this.using = input.using;
    freezeNode(this);
  }
}

export function hydratePolicySelectIrFromJson(value: unknown): PolicySelectIr {
  if (typeof value !== 'object' || value === null) {
    throw new Error('hydratePolicySelectIrFromJson: expected an object');
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] !== POLICY_SELECT_DISCRIMINATOR) {
    throw new Error(
      `hydratePolicySelectIrFromJson: expected kind "${POLICY_SELECT_DISCRIMINATOR}", got "${String(record['kind'])}"`,
    );
  }
  const name = record['name'];
  const target = record['target'];
  const as = record['as'];
  const using = record['using'];
  if (typeof name !== 'string' || typeof target !== 'string' || typeof using !== 'string') {
    throw new Error('hydratePolicySelectIrFromJson: missing or mistyped name/target/using field');
  }
  if (as !== undefined && as !== 'permissive' && as !== 'restrictive') {
    throw new Error(`hydratePolicySelectIrFromJson: unexpected as value "${String(as)}"`);
  }
  return new PolicySelectIr({
    name,
    target,
    as: as as 'permissive' | 'restrictive' | undefined,
    using,
  });
}

export const declarativePolicySelectContributions = {
  entityTypes: {
    policy_select: {
      kind: 'entity',
      discriminator: POLICY_SELECT_DISCRIMINATOR,
      output: {
        factory: (
          block: ParsedPslExtensionBlock<PolicySelectBlockValues>,
          _ctx: AuthoringEntityContext,
        ): PolicySelectIr =>
          new PolicySelectIr({
            name: block.name,
            target: block.values.target.declaration.name,
            as: block.values.as,
            using: block.values.using,
          }),
      },
    },
  },
  pslBlockDescriptors: {
    policy_select: {
      kind: 'pslBlock',
      keyword: POLICY_SELECT_KEYWORD,
      discriminator: POLICY_SELECT_DISCRIMINATOR,
      name: { required: true },
      spec: policySelectSpec,
    } satisfies PslBlockSpecDescriptor,
  },
} as const satisfies AuthoringContributions;
