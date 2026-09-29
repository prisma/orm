import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { ifDefined } from '@internal/utils/defined';
import { astDocumentToPrintDocument } from './ast-to-print-document';
import { serializePrintDocument } from './serialize-print-document';

export type PslBlockDescriptorsNamespace = AuthoringPslBlockDescriptorNamespace;

export interface PrintPslOptions {
  /**
   * Extension-contributed PSL block descriptors, indexed by user-facing path.
   *
   * When absent, an AST that contains extension-contributed blocks throws —
   * silently dropping blocks would lose user-authored content without a
   * diagnostic. ASTs that contain only framework-parsed blocks print without
   * any `pslBlockDescriptors` argument, which is what existing call sites do today.
   */
  readonly pslBlockDescriptors?: PslBlockDescriptorsNamespace;
  /**
   * One line saying where the file came from. The printed file opens with the
   * `// use prisma-8` marker, then this line as a comment.
   */
  readonly description?: string;
}

export function printPslFromAst(ast: PslDocumentAst, options: PrintPslOptions = {}): string {
  const doc = astDocumentToPrintDocument(ast, options.description);
  return serializePrintDocument(doc, {
    ...ifDefined('pslBlockDescriptors', options.pslBlockDescriptors),
  });
}
