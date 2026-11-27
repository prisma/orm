import { Token as First } from "./a.mjs";
import { Token as Second } from "./b.mjs";
declare function make(): First;
declare function use(token: First): void;
interface Bag {
  readonly Token: string;
}
declare function plain(): string;
declare function bag(): Bag;
type Gone = First & never;
export type { Gone };
export { bag, make, plain, use };
