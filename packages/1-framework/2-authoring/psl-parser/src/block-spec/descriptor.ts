import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import { blindCast } from '@internal/utils/casts';
import type { BlockAttributeSpecFactory } from '../attribute-spec/spec-context';
import type { BlockSpecFactory } from './types';

export interface PslBlockSpecDescriptor extends AuthoringPslBlockDescriptor {
  readonly spec: BlockSpecFactory;
  readonly attributes?: Readonly<Record<string, BlockAttributeSpecFactory>>;
}

export function blockSpecFactoryOf(descriptor: AuthoringPslBlockDescriptor): BlockSpecFactory {
  return blindCast<
    BlockSpecFactory,
    'framework core cannot name BlockSpec, so spec factories transit the descriptor erased as unknown; this is the single point that restores the factory type the descriptor surface documents'
  >(descriptor.spec);
}
