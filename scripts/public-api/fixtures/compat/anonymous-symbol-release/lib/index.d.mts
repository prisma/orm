import First from "./a.mjs";
import Second from "./b.mjs";
declare function keyed(): { [First.id]: string };
export { keyed };
