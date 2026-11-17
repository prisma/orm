export interface MongoParamRefOptions {
  readonly name?: string;
  readonly codecId?: string;
  readonly collection?: string;
  readonly nullable?: boolean;
}

export class MongoParamRef {
  readonly value: unknown;
  readonly name: string | undefined;
  readonly codecId: string | undefined;
  readonly collection: string | undefined;
  readonly nullable: boolean | undefined;

  constructor(value: unknown, options?: MongoParamRefOptions) {
    this.value = value;
    this.name = options?.name;
    this.codecId = options?.codecId;
    this.collection = options?.collection;
    this.nullable = options?.nullable;
    Object.freeze(this);
  }

  static of(value: unknown, options?: MongoParamRefOptions): MongoParamRef {
    return new MongoParamRef(value, options);
  }
}
