import { K as K1 } from "./a.mjs";
import { K as K2 } from "./b.mjs";
declare function keyed(): { [K2.id]: string };
declare function numbered(): { [K2[0]]: string };
declare function quoted(): { [K2["id"]]: string };
declare function indexed(): (typeof K2)["id"];
export { indexed, keyed, numbered, quoted };
