import { Stats } from "node:fs";
interface Stats$1 {
  readonly size: number;
}
declare function fromFs(stats: Stats): void;
declare function local(stats: Stats$1): void;
export { fromFs, local };
