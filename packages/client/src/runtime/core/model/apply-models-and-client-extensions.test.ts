import type { RuntimeDataModel } from '@prisma/client-common'
import { serializeParamGraph } from '@prisma/param-graph'

import { model, runtimeDataModel } from '../../../testUtils/dataModelBuilder'
import { getPrismaClient } from '../../getPrismaClient'

beforeAll(() => {
  Object.defineProperty(globalThis, 'TARGET_BUILD_TYPE', { value: 'client', configurable: true })
})

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'TARGET_BUILD_TYPE')
})

function clientConstructor(dataModel: RuntimeDataModel) {
  return getPrismaClient({
    runtimeDataModel: dataModel,
    previewFeatures: [],
    clientVersion: '0.0.0',
    engineVersion: 'test',
    activeProvider: 'postgresql',
    inlineSchema: '',
    parameterizationSchema: serializeParamGraph({ strings: [], inputNodes: [], outputNodes: [], roots: {} }),
  })
}

const options = { accelerateUrl: 'prisma://localhost/?api_key=test' }

test('enumerates model names once across client instances and extensions sharing a data model', () => {
  const dataModel = runtimeDataModel({ models: [model('User', []), model('Post', [])] })
  const ownKeys = jest.fn((models: RuntimeDataModel['models']) => Reflect.ownKeys(models))
  const PrismaClient = clientConstructor({ ...dataModel, models: new Proxy(dataModel.models, { ownKeys }) })
  const client = new PrismaClient(options)

  client.$extends({})
  client.$extends({}).$extends({})
  new PrismaClient(options).$extends({})

  expect(ownKeys).toHaveBeenCalledTimes(1)
})

test('keeps model proxies and extension methods local to each client', () => {
  const PrismaClient = clientConstructor(runtimeDataModel({ models: [model('User', [])] }))
  const client = new PrismaClient(options)
  const first = client.$extends({ model: { user: { label: () => 'first' } } })
  const second = client.$extends({ model: { user: { label: () => 'second' } } })
  const chained = first.$extends({ model: { user: { label: () => 'chained' } } })
  const other = new PrismaClient(options)

  const firstModel = Reflect.get(first, 'user')
  const secondModel = Reflect.get(second, 'user')
  const chainedModel = Reflect.get(chained, 'user')
  const baseModel = Reflect.get(client, 'user')
  const otherModel = Reflect.get(other, 'user')

  expect(firstModel.label()).toBe('first')
  expect(secondModel.label()).toBe('second')
  expect(chainedModel.label()).toBe('chained')
  expect(baseModel.label).toBeUndefined()
  expect(otherModel.label).toBeUndefined()
  expect(firstModel).toBe(Reflect.get(first, 'user'))
  expect(firstModel).not.toBe(baseModel)
  expect(firstModel).not.toBe(secondModel)
  expect(firstModel).not.toBe(chainedModel)
  expect(baseModel).not.toBe(otherModel)
  expect(firstModel.$parent).toBe(client)
  expect(chainedModel.$parent).toBe(first)
})

test('keeps model names separate for different runtime data models', () => {
  const UserClient = clientConstructor(runtimeDataModel({ models: [model('User', [])] }))
  const PostClient = clientConstructor(runtimeDataModel({ models: [model('Post', [])] }))
  const userClient = new UserClient(options).$extends({})
  const postClient = new PostClient(options).$extends({})

  expect(Reflect.get(userClient, 'user').$name).toBe('User')
  expect(Reflect.get(userClient, 'post')).toBeUndefined()
  expect(Reflect.get(postClient, 'post').$name).toBe('Post')
  expect(Reflect.get(postClient, 'user')).toBeUndefined()
  expect(Object.keys(userClient)).toContain('user')
  expect(Object.keys(userClient)).not.toContain('post')
  expect(Object.keys(postClient)).toContain('post')
  expect(Object.keys(postClient)).not.toContain('user')
})

test('preserves model aliases and enumerability when reusing model keys', () => {
  const PrismaClient = clientConstructor(
    runtimeDataModel({ models: [model('User', []), model('post', []), model('URL', [])] }),
  )
  const client = new PrismaClient(options)

  for (const instance of [client, client.$extends({}), client.$extends({}).$extends({})]) {
    expect(Reflect.get(instance, 'User').$name).toBe('User')
    expect(Reflect.get(instance, 'user').$name).toBe('User')
    expect(Reflect.get(instance, 'post').$name).toBe('post')
    expect(Reflect.get(instance, 'URL').$name).toBe('URL')
    expect(Reflect.get(instance, 'uRL').$name).toBe('URL')
    expect(Object.keys(instance)).toEqual(expect.arrayContaining(['user', 'post', 'uRL']))
    expect(Object.keys(instance)).not.toContain('User')
    expect(Object.keys(instance)).not.toContain('URL')
    expect(Reflect.ownKeys(instance).filter((key) => key === 'post')).toHaveLength(1)
    expect(Object.getOwnPropertyDescriptor(instance, 'User')?.enumerable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(instance, 'user')?.enumerable).toBe(true)
  }
})
