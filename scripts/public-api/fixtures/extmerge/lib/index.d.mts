import { t as A } from "./a.mjs";
import { t as B } from "./b.mjs";
declare function fromFile(holder: A): void;
declare function fromTerminal(holder: B): void;
export { fromFile, fromTerminal };
