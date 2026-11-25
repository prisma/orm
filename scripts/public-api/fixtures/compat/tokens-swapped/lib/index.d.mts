import { Token as First } from "./a.mjs";
import { Token as Second } from "./b.mjs";
declare function make(): Second;
declare function use(token: First): void;
declare function plain(): string;
export { make, plain, use };
