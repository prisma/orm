/** @internal */
declare function hidden(): void;
interface Thing {
  /** @internal */
  readonly secret: string;
  readonly shown: string;
}
export { hidden, Thing };
