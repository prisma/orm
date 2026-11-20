import { isSkip, skip } from '../core/types'
import { deepCloneArgs } from './deepCloneArgs'

describe('deepCloneArgs', () => {
  test('preserves Skip instances through cloning', () => {
    const args = {
      data: {
        name: skip,
        email: 'test@example.com',
      },
    }

    const cloned = deepCloneArgs(args) as Record<string, any>

    expect(isSkip(cloned.data.name)).toBe(true)
    expect(cloned.data.name).toBe(skip)
    expect(cloned.data.email).toBe('test@example.com')
  })

  test('preserves Skip as a top-level value', () => {
    const args = {
      where: skip,
      orderBy: { name: 'asc' },
    }

    const cloned = deepCloneArgs(args) as Record<string, any>

    expect(isSkip(cloned.where)).toBe(true)
    expect(cloned.where).toBe(skip)
  })

  test('preserves Skip in arrays', () => {
    const args = {
      data: [skip, 'value'],
    }

    const cloned = deepCloneArgs(args) as Record<string, any>

    expect(isSkip(cloned.data[0])).toBe(true)
  })

  test('preserves cross-bundle ObjectEnumValue through cloning', () => {
    const crossBundleDbNull = Object.create(null)
    crossBundleDbNull[Symbol.for('prisma.objectEnumValue')] = true
    crossBundleDbNull._getName = () => 'DbNull'
    crossBundleDbNull._getNamespace = () => 'NullTypes'

    const args = { data: { field: crossBundleDbNull } }
    const cloned = deepCloneArgs(args) as Record<string, any>

    expect(cloned.data.field).toBe(crossBundleDbNull)
  })

  test('preserves class instances with a toJSON method', () => {
    class Id {
      constructor(readonly equals: string) {}
      toJSON() {
        return 'from-toJSON'
      }
    }
    const id = new Id('from-field')
    const args = { where: { id } }

    const cloned = deepCloneArgs(args) as Record<string, any>

    expect(cloned.where.id).toBe(id)
  })

  test('still deep clones regular objects', () => {
    const inner = { foo: 'bar' }
    const args = { data: inner }

    const cloned = deepCloneArgs(args) as Record<string, any>

    expect(cloned.data).toEqual(inner)
    expect(cloned.data).not.toBe(inner)
  })
})
