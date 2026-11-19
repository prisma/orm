import { Debug } from '@prisma/debug'
import { ConnectionInfo, SqlQuery, SqlQueryable, SqlResultSet } from '@prisma/driver-adapter-utils'
import type { SqlCommenterPlugin, SqlCommenterQueryInfo } from '@prisma/sqlcommenter'
import { klona } from 'klona'

import { QueryEvent } from '../events'
import {
  FieldInitializer,
  FieldOperation,
  ImpureQueryPlanNode,
  InMemoryOps,
  JoinExpression,
  PrismaValue,
  PureQueryPlanNode,
  QueryPlanNode,
} from '../query-plan'
import { type SchemaProvider } from '../schema'
import { appendSqlComment, buildSqlComment } from '../sql-commenter'
import { type TracingHelper, withQuerySpanAndEvent } from '../tracing'
import { type TransactionManager } from '../transaction-manager/transaction-manager'
import { rethrowAsUserFacing, rethrowAsUserFacingRawError } from '../user-facing-error'
import { appendToArray, assertNever, DeepReadonly, DeepUnreadonly } from '../utils'
import { applyDataMap } from './data-mapper'
import { GeneratorRegistry, GeneratorRegistrySnapshot } from './generators'
import { getRecordKey, processRecords } from './in-memory-processing'
import { evaluateArg, renderQuery } from './render-query'
import { PrismaObject, ScopeBindings, Value } from './scope'
import { serializeRawSql, serializeSql } from './serialize-sql'
import { doesSatisfyRule, performValidation } from './validation'

const debug = Debug('prisma:client:queryInterpreter')

export type QueryInterpreterTransactionManager = { enabled: true; manager: TransactionManager } | { enabled: false }

export type QueryInterpreterOptions = {
  onQuery?: (event: QueryEvent) => void
  tracingHelper: TracingHelper
  serializer: (results: SqlResultSet) => Value
  rawSerializer?: (results: SqlResultSet) => Value
  provider?: SchemaProvider
  connectionInfo?: ConnectionInfo
}

export type QueryRuntimeOptions = {
  queryable: SqlQueryable
  transactionManager: QueryInterpreterTransactionManager
  scope: Record<string, unknown>
  sqlCommenter?: QueryInterpreterSqlCommenter
}

type QueryRuntimeContext = {
  queryable: SqlQueryable
  transactionManager: QueryInterpreterTransactionManager
  scope: Record<string, unknown>
  generators: GeneratorRegistrySnapshot
  sqlCommenter?: QueryInterpreterSqlCommenter
}

export type QueryInterpreterSqlCommenter = {
  plugins: SqlCommenterPlugin[]
  queryInfo: SqlCommenterQueryInfo
}

export class QueryInterpreter {
  readonly #onQuery?: (event: QueryEvent) => void
  readonly #generators: GeneratorRegistry = new GeneratorRegistry()
  readonly #tracingHelper: TracingHelper
  readonly #serializer: (results: SqlResultSet) => Value
  readonly #rawSerializer: (results: SqlResultSet) => Value
  readonly #provider?: SchemaProvider
  readonly #connectionInfo?: ConnectionInfo

  constructor({
    onQuery,
    tracingHelper,
    serializer,
    rawSerializer,
    provider,
    connectionInfo,
  }: QueryInterpreterOptions) {
    this.#onQuery = onQuery
    this.#tracingHelper = tracingHelper
    this.#serializer = serializer
    this.#rawSerializer = rawSerializer ?? serializer
    this.#provider = provider
    this.#connectionInfo = connectionInfo
  }

  static forSql(options: {
    onQuery?: (event: QueryEvent) => void
    tracingHelper: TracingHelper
    provider?: SchemaProvider
    connectionInfo?: ConnectionInfo
  }): QueryInterpreter {
    return new QueryInterpreter({
      onQuery: options.onQuery,
      tracingHelper: options.tracingHelper,
      serializer: serializeSql,
      rawSerializer: serializeRawSql,
      provider: options.provider,
      connectionInfo: options.connectionInfo,
    })
  }

  async run(queryPlan: DeepReadonly<QueryPlanNode>, options: QueryRuntimeOptions): Promise<unknown> {
    const generators = this.#generators.snapshot()
    const context: QueryRuntimeContext = { ...options, generators }

    const purified = purifyQueryPlan(queryPlan, (node) => this.interpretNode(node, context))?.catch((e) =>
      rethrowAsUserFacing(e),
    )

    if (purified) {
      try {
        return this.#interpretPureNode(await purified, context.scope, generators).value
      } catch (e) {
        rethrowAsUserFacing(e)
      }
    }

    const { value } = await this.interpretNode(queryPlan, context).catch((e) => rethrowAsUserFacing(e))

    return value
  }

  private async interpretNode(
    node: DeepReadonly<QueryPlanNode>,
    context: QueryRuntimeContext,
  ): Promise<IntermediateValue> {
    switch (node.type) {
      case 'value': {
        return {
          value: evaluateArg(node.args, context.scope, context.generators),
          lastInsertId: node.lastInsertId,
        }
      }

      case 'seq': {
        let result: IntermediateValue | undefined
        for (const arg of node.args) {
          result = await this.interpretNode(arg, context)
        }
        return result ?? { value: undefined }
      }

      case 'let': {
        const nestedScope: ScopeBindings = Object.create(context.scope)
        for (const binding of node.args.bindings) {
          const { value } = await this.interpretNode(binding.expr, { ...context, scope: nestedScope })
          nestedScope[binding.name] = value
        }
        return this.interpretNode(node.args.expr, { ...context, scope: nestedScope })
      }

      case 'concat': {
        const parts = await Promise.all(
          node.args.map((arg) => this.interpretNode(arg, context).then((res) => res.value)),
        )
        return {
          value: parts.length > 0 ? parts.reduce<Value[]>((acc, part) => acc.concat(asList(part)), []) : [],
        }
      }

      case 'sum': {
        const parts = await Promise.all(
          node.args.map((arg) => this.interpretNode(arg, context).then((res) => res.value)),
        )
        return {
          value: parts.length > 0 ? parts.reduce((acc, part) => asNumber(acc) + asNumber(part)) : 0,
        }
      }

      case 'execute': {
        const queries = renderQuery(node.args, context.scope, context.generators, this.#maxChunkSize())

        return this.#withChunkTransaction(queries.length, context, async (context) => {
          let sum = 0
          for (const query of queries) {
            const commentedQuery = applyComments(query, context.sqlCommenter)
            sum += await this.#withQuerySpanAndEvent(commentedQuery, context.queryable, () =>
              context.queryable
                .executeRaw(cloneObject(commentedQuery))
                .catch((err) =>
                  node.args.type === 'rawSql' ? rethrowAsUserFacingRawError(err) : rethrowAsUserFacing(err),
                ),
            )
          }

          return { value: sum }
        })
      }

      case 'query': {
        const queries = renderQuery(node.args, context.scope, context.generators, this.#maxChunkSize())

        return this.#withChunkTransaction(queries.length, context, async (context) => {
          let results: SqlResultSet | undefined
          for (const query of queries) {
            const commentedQuery = applyComments(query, context.sqlCommenter)
            const result = await this.#withQuerySpanAndEvent(commentedQuery, context.queryable, () =>
              context.queryable
                .queryRaw(cloneObject(commentedQuery))
                .catch((err) =>
                  node.args.type === 'rawSql' ? rethrowAsUserFacingRawError(err) : rethrowAsUserFacing(err),
                ),
            )
            if (results === undefined) {
              results = result
            } else {
              appendToArray(results.rows, result.rows)
              results.lastInsertId = result.lastInsertId
            }
          }

          return {
            value: node.args.type === 'rawSql' ? this.#rawSerializer(results!) : this.#serializer(results!),
            lastInsertId: results?.lastInsertId,
          }
        })
      }

      case 'reverse': {
        const { value, lastInsertId } = await this.interpretNode(node.args, context)
        return { value: Array.isArray(value) ? value.reverse() : value, lastInsertId }
      }

      case 'unique': {
        const { value, lastInsertId } = await this.interpretNode(node.args, context)
        if (!Array.isArray(value)) {
          return { value, lastInsertId }
        }
        if (value.length > 1) {
          throw new Error(`Expected zero or one element, got ${value.length}`)
        }
        return { value: value[0] ?? null, lastInsertId }
      }

      case 'required': {
        const { value, lastInsertId } = await this.interpretNode(node.args, context)
        if (isEmpty(value)) {
          throw new Error('Required value is empty')
        }
        return { value, lastInsertId }
      }

      case 'mapField': {
        const { value, lastInsertId } = await this.interpretNode(node.args.records, context)
        return { value: mapField(value, node.args.field), lastInsertId }
      }

      case 'join': {
        const { value: parent, lastInsertId } = await this.interpretNode(node.args.parent, context)

        if (parent === null) {
          return { value: null, lastInsertId }
        }

        const children = await Promise.all(
          node.args.children.map(async (joinExpr) => ({
            joinExpr,
            childRecords: (await this.interpretNode(joinExpr.child, context)).value,
          })),
        )

        return { value: attachChildrenToParents(parent, children, node.args.canAssumeStrictEquality), lastInsertId }
      }

      case 'transaction': {
        return this.#withInternalTransaction(context, (context) => this.interpretNode(node.args, context))
      }

      case 'dataMap': {
        const { value, lastInsertId } = await this.interpretNode(node.args.expr, context)
        return { value: applyDataMap(value, node.args.structure, node.args.enums), lastInsertId }
      }

      case 'validate': {
        const { value, lastInsertId } = await this.interpretNode(node.args.expr, context)
        performValidation(value, node.args.rules, node.args)

        return { value, lastInsertId }
      }

      case 'if': {
        const { value } = await this.interpretNode(node.args.value, context)
        if (doesSatisfyRule(value, node.args.rule)) {
          return await this.interpretNode(node.args.then, context)
        } else {
          return await this.interpretNode(node.args.else, context)
        }
      }

      case 'diff': {
        const { value: from } = await this.interpretNode(node.args.from, context)
        const { value: to } = await this.interpretNode(node.args.to, context)

        const keyGetter = (item: Value) => (item !== null ? getRecordKey(asRecord(item), node.args.fields) : null)

        const toSet = new Set(asList(to).map(keyGetter))
        return { value: asList(from).filter((item) => !toSet.has(keyGetter(item))) }
      }

      case 'process': {
        const { value, lastInsertId } = await this.interpretNode(node.args.expr, context)
        const ops = cloneObject(node.args.operations)
        evaluateProcessingParameters(ops, context.scope, context.generators)
        return { value: processRecords(value, ops), lastInsertId }
      }

      case 'initializeRecord': {
        const { lastInsertId } = await this.interpretNode(node.args.expr, context)

        const record = {}
        for (const [key, initializer] of Object.entries(node.args.fields)) {
          record[key] = evalFieldInitializer(initializer, lastInsertId, context.scope, context.generators)
        }
        return { value: record, lastInsertId }
      }

      case 'mapRecord': {
        const { value, lastInsertId } = await this.interpretNode(node.args.expr, context)

        const record = value === null ? {} : asRecord(value)
        for (const [key, entry] of Object.entries(node.args.fields)) {
          record[key] = evalFieldOperation(entry, record[key], context.scope, context.generators)
        }
        return { value: record, lastInsertId }
      }

      default:
        return this.#interpretPureNode(node, context.scope, context.generators)
    }
  }

  #interpretPureNode(
    node: DeepReadonly<PureQueryPlanNode>,
    scope: ScopeBindings,
    generators: GeneratorRegistrySnapshot,
  ): IntermediateValue {
    switch (node.type) {
      case 'value': {
        return { value: evaluateArg(node.args, scope, generators), lastInsertId: node.lastInsertId }
      }

      case 'seq': {
        let result: IntermediateValue | undefined
        for (const arg of node.args) {
          result = this.#interpretPureNode(arg, scope, generators)
        }
        return result ?? { value: undefined }
      }

      case 'get': {
        return { value: scope[node.args.name] }
      }

      case 'let': {
        const nestedScope: ScopeBindings = Object.create(scope)
        for (const binding of node.args.bindings) {
          const { value } = this.#interpretPureNode(binding.expr, nestedScope, generators)
          nestedScope[binding.name] = value
        }
        return this.#interpretPureNode(node.args.expr, nestedScope, generators)
      }

      case 'getFirstNonEmpty': {
        for (const name of node.args.names) {
          const value = scope[name]
          if (!isEmpty(value)) {
            return { value }
          }
        }
        return { value: [] }
      }

      case 'concat': {
        const parts = node.args.map((arg) => this.#interpretPureNode(arg, scope, generators).value)

        return {
          value: parts.length > 0 ? parts.reduce<Value[]>((acc, part) => acc.concat(asList(part)), []) : [],
        }
      }

      case 'sum': {
        const parts = node.args.map((arg) => this.#interpretPureNode(arg, scope, generators).value)

        return {
          value: parts.length > 0 ? parts.reduce((acc, part) => asNumber(acc) + asNumber(part)) : 0,
        }
      }

      case 'reverse': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args, scope, generators)
        return { value: Array.isArray(value) ? value.reverse() : value, lastInsertId }
      }

      case 'unique': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args, scope, generators)
        if (!Array.isArray(value)) {
          return { value, lastInsertId }
        }
        if (value.length > 1) {
          throw new Error(`Expected zero or one element, got ${value.length}`)
        }
        return { value: value[0] ?? null, lastInsertId }
      }

      case 'required': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args, scope, generators)
        if (isEmpty(value)) {
          throw new Error('Required value is empty')
        }
        return { value, lastInsertId }
      }

      case 'mapField': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args.records, scope, generators)
        return { value: mapField(value, node.args.field), lastInsertId }
      }

      case 'join': {
        const { value: parent, lastInsertId } = this.#interpretPureNode(node.args.parent, scope, generators)

        if (parent === null) {
          return { value: null, lastInsertId }
        }

        const children = node.args.children.map((joinExpr) => ({
          joinExpr,
          childRecords: this.#interpretPureNode(joinExpr.child, scope, generators).value,
        }))

        return { value: attachChildrenToParents(parent, children, node.args.canAssumeStrictEquality), lastInsertId }
      }

      case 'dataMap': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args.expr, scope, generators)
        return { value: applyDataMap(value, node.args.structure, node.args.enums), lastInsertId }
      }

      case 'validate': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args.expr, scope, generators)
        performValidation(value, node.args.rules, node.args)

        return { value, lastInsertId }
      }

      case 'if': {
        const { value } = this.#interpretPureNode(node.args.value, scope, generators)
        if (doesSatisfyRule(value, node.args.rule)) {
          return this.#interpretPureNode(node.args.then, scope, generators)
        } else {
          return this.#interpretPureNode(node.args.else, scope, generators)
        }
      }

      case 'unit': {
        return { value: undefined }
      }

      case 'diff': {
        const { value: from } = this.#interpretPureNode(node.args.from, scope, generators)
        const { value: to } = this.#interpretPureNode(node.args.to, scope, generators)

        const keyGetter = (item: Value) => (item !== null ? getRecordKey(asRecord(item), node.args.fields) : null)

        const toSet = new Set(asList(to).map(keyGetter))
        return { value: asList(from).filter((item) => !toSet.has(keyGetter(item))) }
      }

      case 'process': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args.expr, scope, generators)
        const ops = cloneObject(node.args.operations)
        evaluateProcessingParameters(ops, scope, generators)
        return { value: processRecords(value, ops), lastInsertId }
      }

      case 'initializeRecord': {
        const { lastInsertId } = this.#interpretPureNode(node.args.expr, scope, generators)

        const record = {}
        for (const [key, initializer] of Object.entries(node.args.fields)) {
          record[key] = evalFieldInitializer(initializer, lastInsertId, scope, generators)
        }
        return { value: record, lastInsertId }
      }

      case 'mapRecord': {
        const { value, lastInsertId } = this.#interpretPureNode(node.args.expr, scope, generators)

        const record = value === null ? {} : asRecord(value)
        for (const [key, entry] of Object.entries(node.args.fields)) {
          record[key] = evalFieldOperation(entry, record[key], scope, generators)
        }
        return { value: record, lastInsertId }
      }

      default:
        assertNever(node, `Unexpected node type: ${(node as { type: unknown }).type}`)
    }
  }

  /**
   * Runs the statements of a `query` or `execute` node via `fn`, wrapping them in a
   * transaction when a chunkable statement was split into multiple queries at render time,
   * so that a partially applied write cannot be observed or left behind if a later chunk
   * fails. A single statement is atomic on its own, so it runs on the current context.
   */
  #withChunkTransaction<T>(
    statementCount: number,
    context: QueryRuntimeContext,
    fn: (context: QueryRuntimeContext) => Promise<T>,
  ): Promise<T> {
    if (statementCount <= 1) {
      return fn(context)
    }
    return this.#withInternalTransaction(context, fn)
  }

  /**
   * Runs `fn` with a context whose queryable is guaranteed to be a transaction, starting a
   * new internal transaction and committing or rolling it back around the call.
   *
   * A disabled transaction manager means the queryable already is a transaction: executors
   * pass `{ enabled: false }` when the plan runs inside an interactive transaction, and the
   * context handed to `fn` carries it for the duration of an internal transaction. In that
   * case `fn` runs on the current context, since the statements it issues are already
   * covered by the surrounding transaction.
   */
  async #withInternalTransaction<T>(
    context: QueryRuntimeContext,
    fn: (context: QueryRuntimeContext) => Promise<T>,
  ): Promise<T> {
    if (!context.transactionManager.enabled) {
      return fn(context)
    }

    const transactionManager = context.transactionManager.manager
    const transactionInfo = await transactionManager.startInternalTransaction()
    const transaction = await transactionManager.getTransaction(transactionInfo, 'query')

    try {
      const result = await fn({ ...context, queryable: transaction, transactionManager: { enabled: false } })
      await transactionManager.commitTransaction(transactionInfo.id)
      return result
    } catch (e) {
      try {
        await transactionManager.rollbackTransaction(transactionInfo.id)
      } catch (rollbackError) {
        // Rethrow the error that caused the rollback rather than the rollback failure itself.
        debug('failed to roll back an internal transaction', rollbackError)
      }
      throw e
    }
  }

  #maxChunkSize(): number | undefined {
    if (this.#connectionInfo?.maxBindValues !== undefined) {
      return this.#connectionInfo.maxBindValues
    }
    return this.#providerMaxChunkSize()
  }

  #providerMaxChunkSize(): number | undefined {
    if (this.#provider === undefined) {
      return undefined
    }
    switch (this.#provider) {
      case 'cockroachdb':
      case 'postgres':
      case 'postgresql':
      case 'prisma+postgres':
        return 32766
      case 'mysql':
        return 65535
      case 'sqlite':
        return 999
      case 'sqlserver':
        return 2098
      case 'mongodb':
        return undefined
      default:
        assertNever(this.#provider, `Unexpected provider: ${this.#provider}`)
    }
  }

  #withQuerySpanAndEvent<T>(
    query: DeepReadonly<SqlQuery>,
    queryable: SqlQueryable,
    execute: () => Promise<T>,
  ): Promise<T> {
    return withQuerySpanAndEvent({
      query,
      execute,
      provider: this.#provider ?? queryable.provider,
      tracingHelper: this.#tracingHelper,
      onQuery: this.#onQuery,
      connectionInfo: this.#connectionInfo,
    })
  }
}

type IntermediateValue = { value: Value; lastInsertId?: string }

function isEmpty(value: Value): boolean {
  if (Array.isArray(value)) {
    return value.length === 0
  }
  return value == null
}

function asList(value: Value): Value[] {
  return Array.isArray(value) ? value : [value]
}

function asNumber(value: Value): number {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    return Number(value)
  }

  throw new Error(`Expected number, got ${typeof value}`)
}

function asRecord(value: Value): PrismaObject {
  if (typeof value === 'object' && value !== null) {
    return value as PrismaObject
  }
  throw new Error(`Expected object, got ${typeof value}`)
}

function mapField(value: Value, field: string): Value {
  if (Array.isArray(value)) {
    return value.map((element) => mapField(element, field))
  }

  if (typeof value === 'object' && value !== null) {
    return value[field] ?? null
  }

  return value
}

type JoinExpressionWithRecords = {
  joinExpr: JoinExpression
  childRecords: Value
}

type KeyCast = (value: Value) => Value

function attachChildrenToParents(
  parentRecords: unknown,
  children: DeepReadonly<JoinExpressionWithRecords[]>,
  canAssumeStrictEquality: boolean,
) {
  for (const { joinExpr, childRecords } of children) {
    const parentKeys = joinExpr.on.map(([k]) => k)
    const childKeys = joinExpr.on.map(([, k]) => k)
    const parentMap = {}

    const parentArray = Array.isArray(parentRecords) ? parentRecords : [parentRecords]
    for (const parent of parentArray) {
      const parentRecord = asRecord(parent)
      const key = getRecordKey(parentRecord, parentKeys)
      if (!parentMap[key]) {
        parentMap[key] = []
      }
      parentMap[key].push(parentRecord)

      if (joinExpr.isRelationUnique) {
        parentRecord[joinExpr.parentField] = null
      } else {
        parentRecord[joinExpr.parentField] = []
      }
    }

    const mappers = canAssumeStrictEquality ? undefined : inferKeyCasts(parentArray, parentKeys)
    for (const childRecord of Array.isArray(childRecords) ? childRecords : [childRecords]) {
      if (childRecord === null) {
        continue
      }

      const key = getRecordKey(asRecord(childRecord), childKeys, mappers)
      for (const parentRecord of parentMap[key] ?? []) {
        if (joinExpr.isRelationUnique) {
          parentRecord[joinExpr.parentField] = childRecord
        } else {
          parentRecord[joinExpr.parentField].push(childRecord)
        }
      }
    }
  }

  return parentRecords
}

function inferKeyCasts(rows: unknown[], keys: string[]): KeyCast[] {
  function getKeyCast(type: string): KeyCast | undefined {
    switch (type) {
      case 'number':
        return Number
      case 'string':
        return String
      case 'boolean':
        return Boolean
      case 'bigint':
        return BigInt as KeyCast
      default:
        return
    }
  }

  const keyCasts: KeyCast[] = Array.from({ length: keys.length })
  let keysFound = 0
  for (const parent of rows) {
    const parentRecord = asRecord(parent)
    for (const [i, key] of keys.entries()) {
      if (parentRecord[key] !== null && keyCasts[i] === undefined) {
        const keyCast = getKeyCast(typeof parentRecord[key])
        if (keyCast !== undefined) {
          keyCasts[i] = keyCast
        }
        keysFound++
      }
    }
    if (keysFound === keys.length) {
      break
    }
  }

  return keyCasts
}

function evalFieldInitializer(
  initializer: DeepReadonly<FieldInitializer>,
  lastInsertId: string | undefined,
  scope: ScopeBindings,
  generators: GeneratorRegistrySnapshot,
): Value {
  switch (initializer.type) {
    case 'value':
      return evaluateArg(initializer.value, scope, generators)
    case 'lastInsertId':
      return lastInsertId
    default:
      assertNever(initializer, `Unexpected field initializer type: ${initializer['type']}`)
  }
}

function evalFieldOperation(
  op: DeepReadonly<FieldOperation>,
  value: Value,
  scope: ScopeBindings,
  generators: GeneratorRegistrySnapshot,
): Value {
  switch (op.type) {
    case 'set':
      return evaluateArg(op.value, scope, generators)
    case 'add':
      return asNumber(value) + asNumber(evaluateArg(op.value, scope, generators))
    case 'subtract':
      return asNumber(value) - asNumber(evaluateArg(op.value, scope, generators))
    case 'multiply':
      return asNumber(value) * asNumber(evaluateArg(op.value, scope, generators))
    case 'divide': {
      const lhs = asNumber(value)
      const rhs = asNumber(evaluateArg(op.value, scope, generators))
      // SQLite and older versions of MySQL return NULL for division by zero, so we emulate
      // that behavior here.
      // If the database does not permit division by zero, a database error should be raised,
      // preventing this case from being executed.
      if (rhs === 0) {
        return null
      }
      return lhs / rhs
    }
    default:
      assertNever(op, `Unexpected field operation type: ${op['type']}`)
  }
}

/**
 * Attempts to convert a query plan into a pure one by finding the single impure node
 * that is unconditionally evaluated exactly once, evaluating it eagerly via `evalNode`,
 * and substituting its result into the plan as a constant. The remaining plan can then
 * be interpreted synchronously.
 *
 * Returns `undefined` if the plan cannot be purified this way (it contains no impure
 * nodes, more than one of them, or unsupported constructs).
 *
 * Query plans are cached and shared between requests, so the input plan is never
 * modified; the returned plan shares all unaffected subtrees with the input and only
 * copies the nodes on the path to the substituted one.
 */
export function purifyQueryPlan(
  node: DeepReadonly<QueryPlanNode>,
  evalNode: (node: DeepReadonly<ImpureQueryPlanNode>) => Promise<IntermediateValue>,
): Promise<DeepReadonly<PureQueryPlanNode>> | undefined {
  const impureNode = findUniqueUnconditionalImpureNode(node)
  if (!impureNode) {
    return undefined
  }
  return evalNode(impureNode).then((result) => {
    const evaluated: DeepReadonly<QueryPlanNode> = {
      type: 'value',
      args: result.value as PrismaValue,
      lastInsertId: result.lastInsertId,
    }
    const purified = replaceImpureNode(node, impureNode, evaluated)
    if (!purified) {
      throw new Error('Could not substitute the evaluated impure node into the query plan')
    }
    // The replaced node was the only impure node in the plan, so the result is pure.
    return purified as DeepReadonly<PureQueryPlanNode>
  })
}

/**
 * Returns a copy of the plan with `target` (identified by reference) replaced by
 * `replacement`, sharing all subtrees that do not contain `target` with the input,
 * or `undefined` if `target` does not occur in the plan. Only traverses the node
 * kinds that `findUniqueUnconditionalImpureNode` can find the target through.
 */
function replaceImpureNode(
  node: DeepReadonly<QueryPlanNode>,
  target: DeepReadonly<ImpureQueryPlanNode>,
  replacement: DeepReadonly<QueryPlanNode>,
): DeepReadonly<QueryPlanNode> | undefined {
  if (node === target) {
    return replacement
  }
  switch (node.type) {
    case 'seq':
    case 'sum':
    case 'concat': {
      for (let i = 0; i < node.args.length; i++) {
        const child = replaceImpureNode(node.args[i], target, replacement)
        if (child) {
          return { ...node, args: node.args.map((arg, j) => (j === i ? child : arg)) }
        }
      }
      return undefined
    }
    case 'dataMap':
    case 'validate':
    case 'initializeRecord':
    case 'mapRecord':
    case 'process': {
      const expr = replaceImpureNode(node.args.expr, target, replacement)
      // The cast is needed because TypeScript does not narrow the type of the
      // spread result down to the matching union member.
      return expr && ({ ...node, args: { ...node.args, expr } } as DeepReadonly<QueryPlanNode>)
    }
    case 'mapField': {
      const records = replaceImpureNode(node.args.records, target, replacement)
      return records && { ...node, args: { ...node.args, records } }
    }
    case 'reverse':
    case 'unique':
    case 'required': {
      const args = replaceImpureNode(node.args, target, replacement)
      return args && { ...node, args }
    }
    default:
      return undefined
  }
}

function findUniqueUnconditionalImpureNode(
  node: DeepReadonly<QueryPlanNode>,
): DeepReadonly<ImpureQueryPlanNode> | null | undefined {
  switch (node.type) {
    case 'query':
    case 'execute':
      return node
    case 'seq':
    case 'sum':
    case 'concat': {
      let found: DeepReadonly<ImpureQueryPlanNode> | undefined = undefined
      for (const child of node.args) {
        const childFound = findUniqueUnconditionalImpureNode(child)
        if (childFound === null) {
          // unsupported node found in child
          return null
        }
        if (childFound) {
          if (found) {
            // more than one node found
            return null
          }
          found = childFound
        }
      }
      return found
    }
    case 'dataMap':
    case 'validate':
    case 'initializeRecord':
    case 'mapRecord':
    case 'process':
      return findUniqueUnconditionalImpureNode(node.args.expr)
    case 'mapField':
      return findUniqueUnconditionalImpureNode(node.args.records)
    case 'reverse':
    case 'unique':
    case 'required':
      return findUniqueUnconditionalImpureNode(node.args)
    case 'let':
    case 'join':
    case 'diff':
    case 'if':
    case 'transaction':
      // unsupported nodes: plans containing these are never purified
      return null
    case 'value':
    case 'get':
    case 'getFirstNonEmpty':
    case 'unit':
      // leaf nodes that cannot contain impure descendants
      return undefined
    default:
      assertNever(node, `Unexpected node type: ${(node as { type: unknown }).type}`)
  }
}

function applyComments(
  query: DeepReadonly<SqlQuery>,
  sqlCommenter?: QueryInterpreterSqlCommenter,
): DeepReadonly<SqlQuery> {
  if (!sqlCommenter || sqlCommenter.plugins.length === 0) {
    return query
  }

  const comment = buildSqlComment(sqlCommenter.plugins, {
    query: sqlCommenter.queryInfo,
    sql: query.sql,
  })

  if (!comment) {
    return query
  }

  return {
    ...query,
    sql: appendSqlComment(query.sql, comment),
  }
}

function evaluateProcessingParameters(
  ops: InMemoryOps,
  scope: ScopeBindings,
  generators: GeneratorRegistrySnapshot,
): void {
  const cursor = ops.pagination?.cursor
  if (cursor) {
    for (const [key, value] of Object.entries(cursor)) {
      cursor[key] = evaluateArg(value, scope, generators)
    }
  }
  for (const nested of Object.values(ops.nested)) {
    evaluateProcessingParameters(nested, scope, generators)
  }
}

function cloneObject<T>(value: T): DeepUnreadonly<T> {
  return klona(value) as DeepUnreadonly<T>
}
