import { t as HolderA } from "./holder-a.mjs";
import { t as HolderB } from "./holder-b.mjs";
declare function first(holder: HolderA): void;
declare function second(holder: HolderB): void;
export { first, second };
