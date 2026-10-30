import type { MongoAggExpr } from '@internal/mongo-query-ast/execution';
import {
  MongoAggCond,
  MongoAggLiteral,
  MongoAggOperator,
} from '@internal/mongo-query-ast/execution';
import type {
  ArrayField,
  BooleanField,
  BsonDateField,
  DateField,
  DocField,
  LiteralValue,
  NullableDocField,
  NumericField,
  StringField,
  TypedAggExpr,
} from './types';

// ---------------------------------------------------------------------------
// Internal factory helpers
// ---------------------------------------------------------------------------

function numericExpr(op: string, args: TypedAggExpr<DocField>[]): TypedAggExpr<NumericField> {
  return {
    _field: { codecId: 'mongo/double@1', nullable: false } as NumericField,
    node: MongoAggOperator.of(
      op,
      args.map((a) => a.node),
    ),
  };
}

function numericUnaryExpr(op: string, arg: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
  return {
    _field: { codecId: 'mongo/double@1', nullable: false } as NumericField,
    node: MongoAggOperator.of(op, arg.node),
  };
}

function stringExpr(op: string, args: TypedAggExpr<DocField>[]): TypedAggExpr<StringField> {
  return {
    _field: { codecId: 'mongo/string@1', nullable: false } as StringField,
    node: MongoAggOperator.of(
      op,
      args.map((a) => a.node),
    ),
  };
}

function stringUnaryExpr(op: string, arg: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
  return {
    _field: { codecId: 'mongo/string@1', nullable: false } as StringField,
    node: MongoAggOperator.of(op, arg.node),
  };
}

function booleanExpr(op: string, args: TypedAggExpr<DocField>[]): TypedAggExpr<BooleanField> {
  return {
    _field: { codecId: 'mongo/bool@1', nullable: false } as BooleanField,
    node: MongoAggOperator.of(
      op,
      args.map((a) => a.node),
    ),
  };
}

function booleanUnaryExpr(op: string, arg: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
  return {
    _field: { codecId: 'mongo/bool@1', nullable: false } as BooleanField,
    node: MongoAggOperator.of(op, arg.node),
  };
}

function dateUnaryExpr(op: string, arg: TypedAggExpr<DocField>): TypedAggExpr<DateField> {
  return {
    _field: { codecId: 'mongo/date@1', nullable: false } as DateField,
    node: MongoAggOperator.of(op, arg.node),
  };
}

function arrayExpr(op: string, args: TypedAggExpr<DocField>[]): TypedAggExpr<ArrayField> {
  return {
    _field: { codecId: 'mongo/array@1', nullable: false } as ArrayField,
    node: MongoAggOperator.of(
      op,
      args.map((a) => a.node),
    ),
  };
}

function arrayUnaryExpr(op: string, arg: TypedAggExpr<DocField>): TypedAggExpr<ArrayField> {
  return {
    _field: { codecId: 'mongo/array@1', nullable: false } as ArrayField,
    node: MongoAggOperator.of(op, arg.node),
  };
}

function docUnaryExpr(op: string, arg: TypedAggExpr<DocField>): TypedAggExpr<DocField> {
  return {
    _field: { codecId: arg._field.codecId, nullable: false },
    node: MongoAggOperator.of(op, arg.node),
  };
}

function namedArgsExpr<F extends DocField>(
  op: string,
  args: Readonly<Record<string, TypedAggExpr<DocField> | undefined>>,
  _field: F,
): TypedAggExpr<F> {
  const nodeArgs: Record<string, MongoAggExpr> = {};
  for (const [key, val] of Object.entries(args)) {
    if (val !== undefined) {
      nodeArgs[key] = val.node;
    }
  }
  return { _field, node: MongoAggOperator.of(op, nodeArgs) };
}

const NUMERIC: NumericField = { codecId: 'mongo/double@1', nullable: false } as NumericField;
const STRING: StringField = { codecId: 'mongo/string@1', nullable: false } as StringField;
const BOOLEAN: BooleanField = { codecId: 'mongo/bool@1', nullable: false } as BooleanField;
const DATE: DateField = { codecId: 'mongo/date@1', nullable: false } as DateField;
const ARRAY: ArrayField = { codecId: 'mongo/array@1', nullable: false } as ArrayField;
const DOC: DocField = { codecId: 'mongo/document@1', nullable: false };

function literal(value: string): TypedAggExpr<StringField>;
function literal(value: number): TypedAggExpr<NumericField>;
function literal(value: boolean): TypedAggExpr<BooleanField>;
function literal(value: Date): TypedAggExpr<DateField>;
function literal<F extends DocField>(value: LiteralValue<F>): TypedAggExpr<F>;
function literal(value: unknown): TypedAggExpr<DocField> {
  return { _field: undefined as never, node: MongoAggLiteral.of(value) };
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export const fn = {
  // -- Arithmetic (existing) ------------------------------------------------

  add(...args: TypedAggExpr<DocField>[]): TypedAggExpr<NumericField> {
    return numericExpr('$add', args);
  },

  subtract(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericExpr('$subtract', [a, b]);
  },

  multiply(...args: TypedAggExpr<DocField>[]): TypedAggExpr<NumericField> {
    return numericExpr('$multiply', args);
  },

  divide(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericExpr('$divide', [a, b]);
  },

  // -- String (existing) ----------------------------------------------------

  concat(...args: TypedAggExpr<DocField>[]): TypedAggExpr<StringField> {
    return stringExpr('$concat', args);
  },

  toLower(a: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
    return stringUnaryExpr('$toLower', a);
  },

  toUpper(a: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
    return stringUnaryExpr('$toUpper', a);
  },

  // -- Size (existing) ------------------------------------------------------

  size(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$size', a);
  },

  // -- Control flow (existing) ----------------------------------------------

  cond<F extends DocField>(
    condition: MongoAggExpr,
    thenExpr: TypedAggExpr<F>,
    elseExpr: TypedAggExpr<DocField>,
  ): TypedAggExpr<F> {
    return {
      _field: thenExpr._field,
      node: new MongoAggCond(condition, thenExpr.node, elseExpr.node),
    };
  },

  literal,

  // -- Date helpers ---------------------------------------------------------

  year(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$year', a);
  },
  month(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$month', a);
  },
  dayOfMonth(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$dayOfMonth', a);
  },
  hour(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$hour', a);
  },
  minute(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$minute', a);
  },
  second(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$second', a);
  },
  millisecond(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$millisecond', a);
  },
  dateToString(args: {
    date: TypedAggExpr<BsonDateField>;
    format?: TypedAggExpr<StringField>;
    timezone?: TypedAggExpr<StringField>;
    onNull?: TypedAggExpr<DocField>;
  }): TypedAggExpr<StringField> {
    return namedArgsExpr('$dateToString', args, STRING);
  },
  dateFromString(args: {
    dateString: TypedAggExpr<StringField>;
    format?: TypedAggExpr<StringField>;
    timezone?: TypedAggExpr<StringField>;
    onError?: TypedAggExpr<DocField>;
    onNull?: TypedAggExpr<DocField>;
  }): TypedAggExpr<DateField> {
    return namedArgsExpr('$dateFromString', args, DATE);
  },
  dateDiff(args: {
    startDate: TypedAggExpr<BsonDateField>;
    endDate: TypedAggExpr<BsonDateField>;
    unit: TypedAggExpr<StringField>;
    timezone?: TypedAggExpr<StringField>;
    startOfWeek?: TypedAggExpr<StringField>;
  }): TypedAggExpr<NumericField> {
    return namedArgsExpr('$dateDiff', args, NUMERIC);
  },
  dateAdd(args: {
    startDate: TypedAggExpr<BsonDateField>;
    unit: TypedAggExpr<StringField>;
    amount: TypedAggExpr<NumericField>;
    timezone?: TypedAggExpr<StringField>;
  }): TypedAggExpr<DateField> {
    return namedArgsExpr('$dateAdd', args, DATE);
  },
  dateSubtract(args: {
    startDate: TypedAggExpr<BsonDateField>;
    unit: TypedAggExpr<StringField>;
    amount: TypedAggExpr<NumericField>;
    timezone?: TypedAggExpr<StringField>;
  }): TypedAggExpr<DateField> {
    return namedArgsExpr('$dateSubtract', args, DATE);
  },
  dateTrunc(args: {
    date: TypedAggExpr<BsonDateField>;
    unit: TypedAggExpr<StringField>;
    binSize?: TypedAggExpr<NumericField>;
    timezone?: TypedAggExpr<StringField>;
    startOfWeek?: TypedAggExpr<StringField>;
  }): TypedAggExpr<DateField> {
    return namedArgsExpr('$dateTrunc', args, DATE);
  },

  // -- String helpers -------------------------------------------------------

  substr(
    str: TypedAggExpr<DocField>,
    start: TypedAggExpr<DocField>,
    length: TypedAggExpr<DocField>,
  ): TypedAggExpr<StringField> {
    return stringExpr('$substr', [str, start, length]);
  },
  substrBytes(
    str: TypedAggExpr<DocField>,
    start: TypedAggExpr<DocField>,
    count: TypedAggExpr<DocField>,
  ): TypedAggExpr<StringField> {
    return stringExpr('$substrBytes', [str, start, count]);
  },
  trim(args: {
    input: TypedAggExpr<StringField>;
    chars?: TypedAggExpr<StringField>;
  }): TypedAggExpr<StringField> {
    return namedArgsExpr('$trim', args, STRING);
  },
  ltrim(args: {
    input: TypedAggExpr<StringField>;
    chars?: TypedAggExpr<StringField>;
  }): TypedAggExpr<StringField> {
    return namedArgsExpr('$ltrim', args, STRING);
  },
  rtrim(args: {
    input: TypedAggExpr<StringField>;
    chars?: TypedAggExpr<StringField>;
  }): TypedAggExpr<StringField> {
    return namedArgsExpr('$rtrim', args, STRING);
  },
  split(str: TypedAggExpr<DocField>, delimiter: TypedAggExpr<DocField>): TypedAggExpr<ArrayField> {
    return arrayExpr('$split', [str, delimiter]);
  },
  strLenCP(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$strLenCP', a);
  },
  strLenBytes(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$strLenBytes', a);
  },
  regexMatch(args: {
    input: TypedAggExpr<StringField>;
    regex: TypedAggExpr<StringField>;
    options?: TypedAggExpr<StringField>;
  }): TypedAggExpr<BooleanField> {
    return namedArgsExpr('$regexMatch', args, BOOLEAN);
  },
  regexFind(args: {
    input: TypedAggExpr<StringField>;
    regex: TypedAggExpr<StringField>;
    options?: TypedAggExpr<StringField>;
  }): TypedAggExpr<DocField> {
    return namedArgsExpr('$regexFind', args, DOC);
  },
  regexFindAll(args: {
    input: TypedAggExpr<StringField>;
    regex: TypedAggExpr<StringField>;
    options?: TypedAggExpr<StringField>;
  }): TypedAggExpr<ArrayField> {
    return namedArgsExpr('$regexFindAll', args, ARRAY);
  },
  replaceOne(args: {
    input: TypedAggExpr<StringField>;
    find: TypedAggExpr<StringField>;
    replacement: TypedAggExpr<StringField>;
  }): TypedAggExpr<StringField> {
    return namedArgsExpr('$replaceOne', args, STRING);
  },
  replaceAll(args: {
    input: TypedAggExpr<StringField>;
    find: TypedAggExpr<StringField>;
    replacement: TypedAggExpr<StringField>;
  }): TypedAggExpr<StringField> {
    return namedArgsExpr('$replaceAll', args, STRING);
  },

  // -- Comparison helpers ---------------------------------------------------

  cmp(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericExpr('$cmp', [a, b]);
  },
  eq(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$eq', [a, b]);
  },
  ne(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$ne', [a, b]);
  },
  gt(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$gt', [a, b]);
  },
  gte(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$gte', [a, b]);
  },
  lt(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$lt', [a, b]);
  },
  lte(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$lte', [a, b]);
  },

  // -- Array helpers --------------------------------------------------------

  arrayElemAt(
    arr: TypedAggExpr<DocField>,
    idx: TypedAggExpr<DocField>,
  ): TypedAggExpr<NullableDocField> {
    return {
      _field: { codecId: DOC.codecId, nullable: true },
      node: MongoAggOperator.of('$arrayElemAt', [arr.node, idx.node]),
    };
  },
  concatArrays(...args: TypedAggExpr<DocField>[]): TypedAggExpr<ArrayField> {
    return arrayExpr('$concatArrays', args);
  },
  firstElem(a: TypedAggExpr<DocField>): TypedAggExpr<NullableDocField> {
    return {
      _field: { codecId: DOC.codecId, nullable: true },
      node: MongoAggOperator.of('$first', a.node),
    };
  },
  lastElem(a: TypedAggExpr<DocField>): TypedAggExpr<NullableDocField> {
    return {
      _field: { codecId: DOC.codecId, nullable: true },
      node: MongoAggOperator.of('$last', a.node),
    };
  },
  isIn(elem: TypedAggExpr<DocField>, arr: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$in', [elem, arr]);
  },
  indexOfArray(
    arr: TypedAggExpr<DocField>,
    value: TypedAggExpr<DocField>,
    ...rest: TypedAggExpr<DocField>[]
  ): TypedAggExpr<NumericField> {
    return numericExpr('$indexOfArray', [arr, value, ...rest]);
  },
  isArray(a: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanUnaryExpr('$isArray', a);
  },
  reverseArray(a: TypedAggExpr<DocField>): TypedAggExpr<ArrayField> {
    return arrayUnaryExpr('$reverseArray', a);
  },
  slice(arr: TypedAggExpr<DocField>, ...rest: TypedAggExpr<DocField>[]): TypedAggExpr<ArrayField> {
    return arrayExpr('$slice', [arr, ...rest]);
  },
  zip(args: {
    inputs: TypedAggExpr<ArrayField>[];
    useLongestLength?: TypedAggExpr<BooleanField>;
    defaults?: TypedAggExpr<ArrayField>;
  }): TypedAggExpr<ArrayField> {
    const nodeArgs: Record<string, MongoAggExpr | ReadonlyArray<MongoAggExpr>> = {
      inputs: args.inputs.map((a) => a.node),
    };
    if (args.useLongestLength) nodeArgs['useLongestLength'] = args.useLongestLength.node;
    if (args.defaults) nodeArgs['defaults'] = args.defaults.node;
    return { _field: ARRAY, node: MongoAggOperator.of('$zip', nodeArgs) };
  },
  range(
    start: TypedAggExpr<DocField>,
    end: TypedAggExpr<DocField>,
    step: TypedAggExpr<DocField>,
  ): TypedAggExpr<ArrayField> {
    return arrayExpr('$range', [start, end, step]);
  },

  // -- Set helpers ----------------------------------------------------------

  setUnion(...args: TypedAggExpr<DocField>[]): TypedAggExpr<ArrayField> {
    return arrayExpr('$setUnion', args);
  },
  setIntersection(...args: TypedAggExpr<DocField>[]): TypedAggExpr<ArrayField> {
    return arrayExpr('$setIntersection', args);
  },
  setDifference(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<ArrayField> {
    return arrayExpr('$setDifference', [a, b]);
  },
  setEquals(...args: TypedAggExpr<DocField>[]): TypedAggExpr<BooleanField> {
    return booleanExpr('$setEquals', args);
  },
  setIsSubset(a: TypedAggExpr<DocField>, b: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanExpr('$setIsSubset', [a, b]);
  },
  anyElementTrue(a: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanUnaryExpr('$anyElementTrue', a);
  },
  allElementsTrue(a: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanUnaryExpr('$allElementsTrue', a);
  },

  // -- Type helpers ---------------------------------------------------------

  typeOf(a: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
    return stringUnaryExpr('$type', a);
  },
  convert(args: {
    input: TypedAggExpr<DocField>;
    to: TypedAggExpr<StringField | NumericField>;
    onError?: TypedAggExpr<DocField>;
    onNull?: TypedAggExpr<DocField>;
  }): TypedAggExpr<DocField> {
    return namedArgsExpr('$convert', args, DOC);
  },
  toInt(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$toInt', a);
  },
  toLong(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$toLong', a);
  },
  toDouble(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$toDouble', a);
  },
  toDecimal(a: TypedAggExpr<DocField>): TypedAggExpr<NumericField> {
    return numericUnaryExpr('$toDecimal', a);
  },
  toString_(a: TypedAggExpr<DocField>): TypedAggExpr<StringField> {
    return stringUnaryExpr('$toString', a);
  },
  toObjectId(a: TypedAggExpr<DocField>): TypedAggExpr<DocField> {
    return docUnaryExpr('$toObjectId', a);
  },
  toBool(a: TypedAggExpr<DocField>): TypedAggExpr<BooleanField> {
    return booleanUnaryExpr('$toBool', a);
  },
  toDate(a: TypedAggExpr<DocField>): TypedAggExpr<DateField> {
    return dateUnaryExpr('$toDate', a);
  },

  // -- Object helpers -------------------------------------------------------

  objectToArray(a: TypedAggExpr<DocField>): TypedAggExpr<ArrayField> {
    return arrayUnaryExpr('$objectToArray', a);
  },
  arrayToObject(a: TypedAggExpr<DocField>): TypedAggExpr<DocField> {
    return { _field: DOC, node: MongoAggOperator.of('$arrayToObject', a.node) };
  },
  getField(args: {
    field: TypedAggExpr<StringField>;
    input?: TypedAggExpr<DocField>;
  }): TypedAggExpr<DocField> {
    return namedArgsExpr('$getField', args, DOC);
  },
  setField(args: {
    field: TypedAggExpr<StringField>;
    input: TypedAggExpr<DocField>;
    value: TypedAggExpr<DocField>;
  }): TypedAggExpr<DocField> {
    return namedArgsExpr('$setField', args, DOC);
  },
};
