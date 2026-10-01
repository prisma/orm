import {
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@internal/framework-components/authoring';
import { diagnosticSource, type PslDiagnostic } from './diagnostic';
import { keywordPslSpan } from './resolve';
import type { PslSources } from './source-file';
import type { BlockSymbol } from './symbol-table';

/** A generic block is read only when a composed descriptor claims its keyword. */
export function claimedBlockKeywords(
  descriptors: AuthoringPslBlockDescriptorNamespace | undefined,
): ReadonlySet<string> {
  const keywords = new Set<string>();
  for (const [keyword, value] of Object.entries(descriptors ?? {})) {
    if (isAuthoringPslBlockDescriptor(value)) {
      keywords.add(keyword);
    }
  }
  return keywords;
}

export function unsupportedBlockDiagnostic(block: BlockSymbol, sources: PslSources): PslDiagnostic {
  return {
    code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
    message: `Unsupported top-level block "${block.keyword}"`,
    ...diagnosticSource(sources, block.node.syntax).at(
      keywordPslSpan(block.node.syntax, block.keyword, sources),
    ),
  };
}
