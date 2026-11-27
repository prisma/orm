import First from "./a.mjs";
import Second from "./b.mjs";
declare function keyed(): { [Second.id]: string };
export { keyed };
