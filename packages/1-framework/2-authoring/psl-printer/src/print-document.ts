import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import type { PrinterModel, PrinterNamedType } from './types';

/**
 * A namespace's print-time contents. The framework parser collects top-level
 * declarations (no `namespace { … }` wrapper in source) into the
 * `__unspecified__` synthesised bucket; the printer recognises that name
 * specially and emits its contents at the document top level with no
 * `namespace { … }` wrapper. Named namespaces emit a `namespace <name> { … }`
 * block around their contents.
 *
 * `extensionBlocks` carries extension-contributed top-level blocks verbatim from the
 * input AST. Phase 1 (`astDocumentToPrintDocument`) does no transformation
 * here — phase 2 (`serializePrintDocument`) checks each block against the
 * registered `pslBlockDescriptors` contribution for its keyword and renders
 * the block's ordered source entries verbatim. The slot is always present;
 * an empty array means no extension-contributed blocks landed in this
 * namespace.
 */
export type PrintNamespaceSection = {
  readonly name: string;
  readonly models: readonly PrinterModel[];
  readonly extensionBlocks: readonly PslExtensionBlock[];
};

export type PrintDocument = {
  readonly headerComment: string;
  readonly namedTypes: readonly PrinterNamedType[];
  readonly namespaces: readonly PrintNamespaceSection[];
};
