import { Keys as A, Numbered as NA, Computed as CA } from "./a.mjs";
import { Keys as B, Numbered as NB, Computed as CB } from "./b.mjs";
declare function keys(): typeof A;
declare function numbered(): typeof NA;
declare function computed(): typeof CA;
export { computed, keys, numbered };
