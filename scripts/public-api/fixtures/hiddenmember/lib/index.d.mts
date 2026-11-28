declare class Base {
  /** @internal */
  readonly secret: string;
  readonly shown: string;
}
declare namespace Units {
  /** @internal */
  const hiddenUnit: number;
  const meter: number;
}
declare function make(): Base;
export { Units, make };
