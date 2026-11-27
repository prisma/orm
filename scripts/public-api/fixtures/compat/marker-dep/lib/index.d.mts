import type { Token } from "./a.mjs";
export interface Holder {
  readonly t: Token;
}
export type { Token as Other } from "./b.mjs";
