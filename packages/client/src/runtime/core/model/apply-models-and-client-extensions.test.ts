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

function createClientConstructor(dataModel: RuntimeDataModel) {
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
  const PrismaClient = createClientConstructor({ ...dataModel, models: new Proxy(dataModel.models, { ownKeys }) })
  const client = new PrismaClient(options)

  client.$extends({})
  client.$extends({}).$extends({})
  new PrismaClient(options).$extends({})

  expect(ownKeys).toHaveBeenCalledTimes(1)
})

test('keeps model proxies and extension methods local to each client', () => {
  const PrismaClient = createClientConstructor(runtimeDataModel({ models: [model('User', [])] }))
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
  const UserClient = createClientConstructor(runtimeDataModel({ models: [model('User', [])] }))
  const PostClient = createClientConstructor(runtimeDataModel({ models: [model('Post', [])] }))
  const userClient = new UserClient(options).$extends({})
  const postClient = new PostClient(options).$extends({})

  expect(userClient).toHaveProperty('user.$name', 'User')
  expect(userClient).not.toHaveProperty('post')
  expect(postClient).toHaveProperty('post.$name', 'Post')
  expect(postClient).not.toHaveProperty('user')
  expect(Object.keys(userClient)).toContain('user')
  expect(Object.keys(userClient)).not.toContain('post')
  expect(Object.keys(postClient)).toContain('post')
  expect(Object.keys(postClient)).not.toContain('user')
})

test('preserves model aliases and enumerability when reusing model keys', () => {
  const PrismaClient = createClientConstructor(
    runtimeDataModel({ models: [model('User', []), model('post', []), model('URL', [])] }),
  )
  const client = new PrismaClient(options)

  for (const instance of [client, client.$extends({}), client.$extends({}).$extends({})]) {
    expect(instance).toHaveProperty('User.$name', 'User')
    expect(instance).toHaveProperty('user.$name', 'User')
    expect(instance).toHaveProperty('post.$name', 'post')
    expect(instance).toHaveProperty('URL.$name', 'URL')
    expect(instance).toHaveProperty('uRL.$name', 'URL')
    expect(Object.keys(instance)).toEqual(expect.arrayContaining(['user', 'post', 'uRL']))
    expect(Object.keys(instance)).not.toContain('User')
    expect(Object.keys(instance)).not.toContain('URL')
    expect(Reflect.ownKeys(instance).filter((key) => key === 'post')).toHaveLength(1)
    expect(Object.getOwnPropertyDescriptor(instance, 'User')?.enumerable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(instance, 'user')?.enumerable).toBe(true)
  }
})
