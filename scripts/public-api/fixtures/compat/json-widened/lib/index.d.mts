type JsonValue = string | number | boolean | bigint | null | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}
interface Row {
  data: JsonValue;
  name: string;
}
declare function g(): JsonObject;
export type { JsonObject, JsonValue, Row };
export { g };
