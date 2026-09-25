import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import { blindCast } from '@internal/utils/casts';
import type { BlockAttributeSpecFactory } from '../attribute-spec/spec-context';
import type { BlockSpecFactory } from './types';

/**
 * The parser-facing view of a PSL block descriptor: the same core
 * registration shape, with `spec` and `attributes` narrowed to their real
 * factory types. Authoring code declares descriptors with
 * `satisfies PslBlockSpecDescriptor` so the erased core fields stay typed at
 * the source.
 */
export interface PslBlockSpecDescriptor extends AuthoringPslBlockDescriptor {
  readonly spec: BlockSpecFactory;
  readonly attributes?: Readonly<Record<string, BlockAttributeSpecFactory>>;
}

/**
 * Restores the callable spec factory a descriptor carries erased as
 * `unknown`. This is the single point that reverses the core-side erasure;
 * registration already validated the value is a function.
 */
export function blockSpecFactoryOf(descriptor: AuthoringPslBlockDescriptor): BlockSpecFactory {
  return blindCast<
    BlockSpecFactory,
    'framework core cannot name BlockSpec, so spec factories transit the descriptor erased as unknown; this is the single point that restores the factory type the descriptor surface documents'
  >(descriptor.spec);
}
