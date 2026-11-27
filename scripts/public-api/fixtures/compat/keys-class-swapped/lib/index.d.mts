import { Keys as A, Numbered as NA, Computed as CA } from "./a.mjs";
import { Keys as B, Numbered as NB, Computed as CB } from "./b.mjs";
declare function keys(): typeof B;
declare function numbered(): typeof NB;
declare function computed(): typeof CB;
export { computed, keys, numbered };
