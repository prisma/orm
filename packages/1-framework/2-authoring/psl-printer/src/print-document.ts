import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import type { PrinterModel, PrinterNamedType } from './types';

/**
 * A namespace's print-time contents. The framework parser collects top-level
 * declarations (no `namespace { … }` wrapper in source) into the
 * `__unspecified__` synthesised bucket; the printer recognises that name
 * specially and emits its contents at the document top level with no
 * `namespace { … }` wrapper. Named namespaces emit a `namespace <name> { … }`
 * block around their contents.
 */
export type PrintNamespaceSection = {
  readonly name: string;
  /** Value-object `type` blocks, printed before the models in the same namespace. */
  readonly compositeTypes: readonly PrinterModel[];
  readonly models: readonly PrinterModel[];
  readonly extensionBlocks: readonly PslExtensionBlock[];
};

export type PrintDocument = {
  readonly headerComment: string;
  readonly namedTypes: readonly PrinterNamedType[];
  readonly namespaces: readonly PrintNamespaceSection[];
};
