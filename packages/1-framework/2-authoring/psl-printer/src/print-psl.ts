import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { ifDefined } from '@internal/utils/defined';
import { astDocumentToPrintDocument } from './ast-to-print-document';
import { serializePrintDocument } from './serialize-print-document';

export type PslBlockDescriptorsNamespace = AuthoringPslBlockDescriptorNamespace;

export interface PrintPslOptions {
  /**
   * Extension-contributed PSL block descriptors, indexed by user-facing path.
   * Typically an `AssembledAuthoringContributions.pslBlockDescriptors` namespace
   * produced by `assembleAuthoringContributions`. Phase 2 of the printer indexes
   * into this namespace by each extension-contributed AST node's `kind`
   * discriminator and renders the block generically from the descriptor's
   * `parameters` map.
   *
   * When absent, an AST that contains extension-contributed blocks throws —
   * silently dropping blocks would lose user-authored content without a
   * diagnostic. ASTs that contain only framework-parsed blocks print without
   * any `pslBlockDescriptors` argument, which is what existing call sites do today.
   */
  readonly pslBlockDescriptors?: PslBlockDescriptorsNamespace;
  /**
   * Codec lookup used to print `value`-kind block parameters. The codec's JSON
   * medium (`encodeJson`/`decodeJson`) validates and normalizes each value param.
   * Required alongside `pslBlockDescriptors` when the AST contains `value`-kind
   * parameters. When absent, the raw PSL literal stored in the AST node is
   * emitted as-is.
   */
  readonly codecLookup?: CodecLookup;
  /**
   * The comment lines printed after the `// use prisma-8` directive. Defaults
   * to the `contract infer` wording; `contract convert` passes its own.
   */
  readonly header?: string;
}

export function printPslFromAst(ast: PslDocumentAst, options: PrintPslOptions = {}): string {
  const doc = astDocumentToPrintDocument(ast, options.header);
  return serializePrintDocument(doc, {
    ...ifDefined('pslBlockDescriptors', options.pslBlockDescriptors),
    ...ifDefined('codecLookup', options.codecLookup),
  });
}
