import { t as OptionsA } from "./options-a.mjs";
import { t as OptionsB } from "./options-b.mjs";
type CodecTypes$1 = {
  readonly text: string;
};
type CodecTypes = CodecTypes$1;
interface Row$1 {
  readonly id: number;
}
interface Column$1 {
  readonly name: string;
}
declare function read(): Row$1;
declare function column(): Column$1;
declare function first(options: OptionsA): void;
declare function second(options: OptionsB): void;
export { CodecTypes, Column$1 as Column, column, first, read, second };
