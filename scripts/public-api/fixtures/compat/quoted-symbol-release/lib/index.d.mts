import { K as K1 } from "./a.mjs";
import { K as K2 } from "./b.mjs";
declare function keyed(): { [K1.id]: string };
declare function numbered(): { [K1[0]]: string };
declare function quoted(): { [K1["id"]]: string };
declare function indexed(): (typeof K1)["id"];
export { indexed, keyed, numbered, quoted };
