import type * as DMMF from '@prisma/dmmf'

import type { Client } from '../../getPrismaClient'
import { getCallSite } from '../../utils/CallSite'
import { deepSet } from '../../utils/deep-set'
import type { UserArgs } from '../request/UserArgs'
import type { ModelAction } from './applyModel'
import { defaultProxyHandlers } from './utils/defaultProxyHandlers'

/**
 * The fluent API makes that nested relations can be retrieved at once. It's a
 * helper for writing `select` statements on relations with a chaining api.
 * Because of this, we automatically add `select` statements to the query, that
 * also means that we need to provide a `dataPath` for unpacking nested values.
 * @see {getNextUserArgs}
 * @param dmmfModelName
 * @param prevDataPath
 * @returns
 */
function getNextDataPath(fluentPropName?: string, prevDataPath?: string[]) {
  if (fluentPropName === undefined || prevDataPath === undefined) return []

  return [...prevDataPath, 'select', fluentPropName]
}

/**
 * @see {getNextDataPath} for introduction. The goal of the fluent API is to
 * make it easy to retrieve nested relations. For this, we construct the query
 * args that are necessary to retrieve the nested relations. It consists of
 * nesting `select` statements each time that we access a relation.
 * @param callArgs usually passed on the last call of the chaining api
 * @param prevArgs when multiple chaining occurs, they are the previous
 * @param nextDataPath path where to set `callArgs` in `prevArgs`
 * @example
 * ```ts
 * prisma.user.findUnique().link().user()
 *
 * // will end up with an args like this:
 * // args {
 * //   "where": {
 * //     "email": "1639498523518@gmail.com"
 * //   },
 * //   "select": {
 * //     "link": {
 * //       "select": {
 * //         "user": true
 * //       }
 * //     }
 * //   }
 * // }
 * ```
 */
function getNextUserArgs(callArgs: UserArgs, prevArgs: UserArgs, nextDataPath: string[]): UserArgs {
  if (prevArgs === undefined) return callArgs ?? {}

  return deepSet(prevArgs, nextDataPath, callArgs || true)
}

/**
 * Dynamically creates a fluent API from a `modelAction` and a `dmmfModelName`.
 * We use the current `dmmfModelName` to determine what can be chained on next.
 * The fluent API allows to chain on model relations to provide an alternative
 * way to fetch and access nested data all at once. When triggered, it calls
 * `modelActions` after having accumulated `prevDataPath` and `prevUserArgs`
 * with the chaining. You can find an example of usage at {@link applyModel}.
 * @param client to provide dmmf information
 * @param dmmfModelName the dmmf name of the model to apply the api to
 * @param modelAction a callback action that triggers request execution
 * @param fluentPropName the name of the api link that was just called
 * @param prevDataPath the dataPath from the previous api link
 * @param prevUserArgs the userArgs from the previous api link
 * @remarks optional parameters are empty on the first call via
 * {@link applyModel}
 * @returns
 */
export function applyFluent(
  client: Client,
  dmmfModelName: string,
  modelAction: ModelAction,
  fluentPropName?: string,
  prevDataPath?: string[],
  prevUserArgs?: UserArgs,
) {
  // we retrieve the model that is described from the DMMF
  const dmmfModel = client._runtimeDataModel.models[dmmfModelName]

  // map[field.name] === field, basically for quick access; built lazily and
  // only when the fluent API is actually chained on, so plain queries pay nothing
  let dmmfModelFieldMap: { [dmmfModelFieldName: string]: DMMF.Field } | undefined

  // we return a regular model action but proxy its return
  return (userArgs?: UserArgs) => {
    const callsite = getCallSite(client._errorFormat)
    // ! first call: nextDataPath => [], nextUserArgs => userArgs
    const nextDataPath = getNextDataPath(fluentPropName, prevDataPath)
    const nextUserArgs = getNextUserArgs(userArgs, prevUserArgs, nextDataPath)
    const prismaPromise = modelAction({ dataPath: nextDataPath, callsite })(nextUserArgs)
    // TODO: use an unpacker here instead of ClientFetcher logic
    // TODO: once it's done we can deprecate the use of dataPath
    const ownKeys = getOwnKeys(client, dmmfModelName)

    // we take control of the return promise to allow chaining
    return new Proxy(prismaPromise, {
      get(target, prop: string) {
        // fluent api only works on fields that are relational
        if (!ownKeys.includes(prop)) return target[prop]

        // here we are sure that prop is a field of type object
        dmmfModelFieldMap ??= Object.fromEntries(dmmfModel.fields.map((field) => [field.name, field] as const))
        const dmmfModelName = dmmfModelFieldMap[prop].type
        const modelArgs = [dmmfModelName, modelAction, prop] as const
        const dataArgs = [nextDataPath, nextUserArgs] as const

        // we allow for chaining more with this recursive call
        return applyFluent(client, ...modelArgs, ...dataArgs)
      },
      ...defaultProxyHandlers([...ownKeys, ...Object.getOwnPropertyNames(prismaPromise)]),
    })
  }
}

// the only accessible fields are relations to be chained on
function getOwnKeys(client: Client, dmmfModelName: string) {
  return client._runtimeDataModel.models[dmmfModelName].fields
    .filter((field) => field.kind === 'object') // relations
    .map((field) => field.name)
}
