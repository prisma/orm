/**
 * Internal printer intermediates used by `astDocumentToPrintDocument` →
 * `serializePrintDocument`. These types are package-private and never
 * exported through `src/exports/`.
 */

export type PrinterField = {
  readonly name: string;
  readonly typeName: string;
  readonly optional: boolean;
  readonly list: boolean;
  readonly elementOptional?: boolean;
  readonly attributes: readonly string[];
  readonly mapName?: string | undefined;
  readonly isId: boolean;
  readonly isRelation: boolean;
  readonly isUnsupported: boolean;
  readonly comment?: string | undefined;
};

export type PrinterModel = {
  readonly name: string;
  readonly mapName?: string | undefined;
  readonly fields: readonly PrinterField[];
  readonly modelAttributes: readonly string[];
  readonly comment?: string | undefined;
};

export type PrinterNamedType = {
  readonly name: string;
  readonly baseType: string;
  readonly attributes: readonly string[];
};
