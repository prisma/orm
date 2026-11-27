import { Token } from "./chunk.mjs";
declare const brand: unique symbol;
declare function make(): Token;
declare function use(token: Token): void;
interface Branded {
  readonly [brand]: true;
}
declare function branded(): Branded;
export { branded, make, use };
