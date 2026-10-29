import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { invariant } from '@internal/utils/assertions';
import { PostgresExtension } from '../postgres-extension';
import { buildExtensionBlock } from '../psl-build/extension-block';
import {
  refuseEntryFiledUnderAnotherName,
  refuseExtensionControl,
  refuseUnwritableName,
} from './refusals';

/** One `extension` block per extension a namespace declares. */
export function buildExtensionBlocks(
  namespaceId: string,
  entries: Readonly<Record<string, unknown>> | undefined,
): readonly PslExtensionBlock[] {
  return Object.entries(entries ?? {}).map(([name, entity]) => {
    invariant(
      PostgresExtension.is(entity),
      `"extension" entry "${name}" in namespace "${namespaceId}" is not an extension`,
    );
    refuseExtensionControl(namespaceId, entity);
    refuseEntryFiledUnderAnotherName({
      namespaceId,
      kind: 'extension',
      name,
      readsBackAs: entity.name,
    });
    refuseUnwritableName('extension', entity.name);
    return buildExtensionBlock(entity.name);
  });
}
