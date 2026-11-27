import { brand as first } from "./a.mjs";
import { brand as second } from "./b.mjs";
export interface Both {
  readonly [first]: string;
  readonly [second]: string;
}
