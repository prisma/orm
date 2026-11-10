export class MongoPreparedParamRef<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
> {
  readonly name: string;
  readonly codecId: CodecId;
  readonly nullable: Nullable;

  constructor(name: string, codecId: CodecId, nullable: Nullable) {
    this.name = name;
    this.codecId = codecId;
    this.nullable = nullable;
    Object.freeze(this);
  }
}

export function isMongoPreparedParamRef(value: unknown): value is MongoPreparedParamRef {
  return value instanceof MongoPreparedParamRef;
}
