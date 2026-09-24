/** A PSL type name and the arguments of its call, if it takes any. */
export type PslTypeReference = {
  readonly name: string;
  readonly args?: readonly string[];
};

export type PslTypeResolution =
  | {
      readonly pslType: PslTypeReference;
      readonly nativeType: string;
      readonly typeParams?: Record<string, unknown>;
    }
  | {
      readonly unsupported: true;
      readonly nativeType: string;
    };

/** Which PSL type a column of a native type is written as, or that none is. */
export interface PslTypeMap {
  resolve(nativeType: string, annotations?: Record<string, unknown>): PslTypeResolution;
}
