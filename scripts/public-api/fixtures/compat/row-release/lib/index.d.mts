type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}
interface Row {
  data: JsonValue;
  name: string;
}
export type { Row };
