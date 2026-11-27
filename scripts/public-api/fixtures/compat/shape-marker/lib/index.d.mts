import { Token as First } from "./a.mjs";
import { Token as Second } from "./b.mjs";
interface Optional {
  readonly optional: true;
}
interface Arg<T> {
  readonly type: T;
}
type OutOf<T> = T extends Arg<infer V> ? V : never;
declare class Holder<P extends Record<string, Arg<unknown>>> {
  constructor(shape: P);
  readonly out: { [K in keyof P as P[K] extends Optional ? never : K]: OutOf<P[K]> };
  static readonly token: First;
}
export { Holder };
