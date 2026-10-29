import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { SYNTHETIC_SPAN } from './psl-literals';

/** One `extension <name> {}` block. */
export function buildExtensionBlock(name: string): PslExtensionBlock {
  return {
    kind: 'extension',
    keyword: 'extension',
    name,
    parameters: {},
    blockAttributes: [],
    span: SYNTHETIC_SPAN,
  };
}
