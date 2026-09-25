import { diagnosticSource, type PslDiagnostic } from './diagnostic';
import { nodePslSpan } from './resolve';
import type { PslSources } from './source-file';
import type { BlockSymbol } from './symbol-table';

export function enumMemberAttributeDiagnostics(
  enumBlock: BlockSymbol,
  sources: PslSources,
): PslDiagnostic[] {
  const source = diagnosticSource(sources, enumBlock.node.syntax);
  return Array.from(enumBlock.node.entries()).flatMap((member) =>
    Array.from(member.attributes(), (attribute) => ({
      code: 'PSL_UNSUPPORTED_ENUM_MEMBER_ATTRIBUTE',
      message: `enum "${enumBlock.block.name}": member "${member.key()?.name() ?? '?'}" carries @${attribute.name()?.path().join('.') ?? '?'}, but an enum member takes no attributes`,
      ...source.at(nodePslSpan(attribute.syntax, sources)),
    })),
  );
}
