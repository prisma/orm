import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import type {
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockSourceEntry,
} from '@internal/framework-components/psl-ast';
import { nodePslSpan } from './resolve';
import type { PslSources } from './source-file';
import type { GenericBlockDeclarationAst } from './syntax/ast/declarations';
import { printSyntax } from './syntax/ast-helpers';

/**
 * Reconstructs a block's source/print representation: ordered entries with
 * their expression text and spans, plus printable `@@` attribute lines.
 * Purely provenance — no descriptor-driven classification, no value
 * interpretation, and no diagnostics; the block-spec interpreter owns
 * duplicate-entry reporting. Duplicate member names are first-wins.
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  descriptor: AuthoringPslBlockDescriptor | undefined,
  sources: PslSources,
): PslExtensionBlock {
  const keyword = node.keyword()?.text ?? '';
  const blockName = node.name()?.name() ?? '';

  const blockAttributes: PslExtensionBlockAttribute[] = [];

  for (const attribute of node.attributes()) {
    const name = attribute.name()?.path().join('.') ?? '';
    const args = Array.from(attribute.argList()?.args() ?? [], (arg) => {
      const value = arg.value();
      return {
        kind: 'positional' as const,
        value: value === undefined ? '' : printSyntax(value.syntax).trim(),
        span: nodePslSpan(arg.syntax, sources),
      };
    });
    const span = nodePslSpan(attribute.syntax, sources);
    blockAttributes.push({ name, args, span });
  }

  const parameters: Record<string, PslExtensionBlockSourceEntry> = Object.create(null);
  for (const entry of node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    const span = nodePslSpan(entry.syntax, sources);
    if (Object.hasOwn(parameters, key)) continue;
    const value = entry.value();
    parameters[key] =
      value === undefined ? { span } : { expression: printSyntax(value.syntax).trim(), span };
  }

  return {
    kind: descriptor?.discriminator ?? keyword,
    keyword,
    name: blockName,
    parameters,
    blockAttributes,
    span: nodePslSpan(node.syntax, sources),
  };
}
