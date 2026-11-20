/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-loss-of-precision */

import assert from 'node:assert'
import { Buffer as NodeBuffer } from 'node:buffer'

import { describe as describeVi, expect, test as testVi } from 'vitest'

import { Buffer } from '../../../../helpers/compile/plugins/fill-plugin/fillers/buffer-small'

const describeIf = (condition: boolean) => (condition ? describeVi : describeVi.skip)
const testIf = (condition: boolean) => (condition ? testVi : testVi.skip)

const describe = describeIf(!process.version.startsWith('v16.'))
const test = testIf(!process.version.startsWith('v16.'))

describe('tests that Buffer and NodeBuffer are compatible', () => {
  test('Buffer can be created from NodeBuffer', () => {
    const nodeBuffer = NodeBuffer.from('Hello, World!')
    const buffer = Buffer.from(nodeBuffer)
    expect(buffer.values()).toEqual(nodeBuffer.values())
  })

  test('NodeBuffer can be created from Buffer', () => {
    const buffer = Buffer.from('Hello, World!')
    const nodeBuffer = NodeBuffer.from(buffer)
    expect(nodeBuffer.values()).toEqual(buffer.values())
  })

  test('NodeBuffer can be created from Buffer with offset and length', () => {
    const buffer = Buffer.from('Hello, World!')
    const nodeBuffer = NodeBuffer.from(buffer).subarray(0, 5)
    expect(nodeBuffer.values()).toEqual(NodeBuffer.from('Hello').values())
  })

  test('Buffer can be created from NodeBuffer with offset and length', () => {
    const nodeBuffer = NodeBuffer.from('Hello, World!')
    const buffer = Buffer.from(nodeBuffer.subarray(0, 5))
    expect(buffer.values()).toEqual(Buffer.from('Hello').values())
  })
})

describe('Buffer isBuffer (static)', () => {
  test('should return true if the object is a Buffer', () => {
    const buf = Buffer.from('Hello, World!')
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  test('should return false if the object is not a Buffer', () => {
    const notBuf = 'Hello, World!'
    expect(Buffer.isBuffer(notBuf)).toBe(false)
  })
})

describe('Buffer from (static)', () => {
  test('should create a new Buffer from a string', () => {
    const buf = Buffer.from('Hello, World!')
    expect(buf.toString()).toEqual('Hello, World!')
  })

  test('should create a new Buffer from an array', () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    expect(buf.toString()).toEqual('Hello')
  })

  test('should create a new Buffer from a Buffer', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from(buf1)
    expect(buf2.toString()).toEqual('Hello, World!')
  })

  test('should create a new Buffer from an ArrayBuffer', () => {
    const arr = new Uint16Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    const buf = Buffer.from(arr.buffer)
    expect(buf.toString()).toEqual('H\u0000e\u0000l\u0000l\u0000o\u0000')
  })

  test('should throw an error if input is invalid', () => {
    expect(() => Buffer.from(null)).toThrow()
  })
})

describe('Buffer compare (static)', () => {
  test('should return 0 when buffers are equal', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, World!')
    expect(Buffer.compare(buf1, buf2)).toEqual(0)
  })

  test('should return a number less than 0 when buf1 is less than buf2', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, World!!')
    expect(Buffer.compare(buf1, buf2)).toBeLessThan(0)
  })

  test('should return a number greater than 0 when buf1 is greater than buf2', () => {
    const buf1 = Buffer.from('Hello, World!!')
    const buf2 = Buffer.from('Hello, World!')
    expect(Buffer.compare(buf1, buf2)).toBeGreaterThan(0)
  })

  test('should handle empty buffers', () => {
    const buf1 = Buffer.from('')
    const buf2 = Buffer.from('')
    expect(Buffer.compare(buf1, buf2)).toEqual(0)
  })

  test('should throw an error if either argument is not a Buffer', () => {
    const buf = Buffer.from('Hello, World!')
    expect(() => Buffer.compare(buf, 'not a buffer' as any)).toThrow()
    expect(() => Buffer.compare('not a buffer' as any, buf)).toThrow()
  })
})

describe('Buffer slice', () => {
  test('simple', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    expect(buf.slice(0, 2)).toEqual(Buffer.from([1, 2]))
    expect(buf.slice(2, 4)).toEqual(Buffer.from([3, 4]))
    expect(buf.slice(4, 5)).toEqual(Buffer.from([5]))
    expect(buf.slice(0, 5)).toEqual(Buffer.from([1, 2, 3, 4, 5]))
    expect(buf.slice(0, 6)).toEqual(Buffer.from([1, 2, 3, 4, 5]))
    expect(buf.slice(0, 0)).toEqual(Buffer.alloc(0))
    expect(buf.slice(5, 5)).toEqual(Buffer.alloc(0))
    expect(buf.slice(5, 0)).toEqual(Buffer.alloc(0))

    expect(buf.slice(0, 2).length).toBe(2)
    expect(buf.slice(2, 4).length).toBe(2)
    expect(buf.slice(4, 5).length).toBe(1)
    expect(buf.slice(0, 5).length).toBe(5)
    expect(buf.slice(0, 6).length).toBe(5)
    expect(buf.slice(0, 0).length).toBe(0)

    const buf2 = Buffer.from('buffer')
    expect(buf2.slice(0, 3).toString()).toBe('buf')
    expect(buf2.slice(3).toString()).toBe('fer')
    expect(buf2.slice(0, -1).toString()).toBe('buffe')
    expect(buf2.slice(-6, -1).toString()).toBe('buffe')

    expect(buf2.slice(0, 3).length).toBe(3)
    expect(buf2.slice(3).length).toBe(3)
    expect(buf2.slice(0, -1).length).toBe(5)
    expect(buf2.slice(-6, -1).length).toBe(5)
  })

  test('should return a new buffer that references the same memory as the old, but offset and cropped by the start and end indices', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const slicedBuf = buf.slice(1, 4)
    expect(slicedBuf).toEqual(Buffer.from([2, 3, 4]))
  })

  test('should return a new buffer that references the same memory as the old, but offset by the start index when end index is not provided', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const slicedBuf = buf.slice(2)
    expect(slicedBuf).toEqual(Buffer.from([3, 4, 5]))
  })

  test('should return an empty buffer when start index is equal to the buffer length', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const slicedBuf = buf.slice(5)
    expect(slicedBuf).toEqual(Buffer.from([]))
  })

  test('should return the same buffer when start index is not provided', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const slicedBuf = buf.slice()
    expect(slicedBuf).toEqual(buf)
  })
})

describe('Buffer reverse', () => {
  test('should reverse the order of bytes in the buffer', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const reversedBuf = buf.reverse()
    expect(reversedBuf).toEqual(Buffer.from([5, 4, 3, 2, 1]))
  })

  test('should return the same buffer when it contains only one byte', () => {
    const buf = Buffer.from([1])
    const reversedBuf = buf.reverse()
    expect(reversedBuf).toEqual(Buffer.from([1]))
  })

  test('should return an empty buffer when the original buffer is empty', () => {
    const buf = Buffer.from([])
    const reversedBuf = buf.reverse()
    expect(reversedBuf).toEqual(Buffer.from([]))
  })
})

describe('Buffer subarray', () => {
  test('simple', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    expect(buf.subarray(0, 2)).toEqual(Buffer.from([1, 2]))
    expect(buf.subarray(2, 4)).toEqual(Buffer.from([3, 4]))
    expect(buf.subarray(4, 5)).toEqual(Buffer.from([5]))
    expect(buf.subarray(0, 5)).toEqual(Buffer.from([1, 2, 3, 4, 5]))
    expect(buf.subarray(0, 6)).toEqual(Buffer.from([1, 2, 3, 4, 5]))
    expect(buf.subarray(0, 0)).toEqual(Buffer.alloc(0))
    expect(buf.subarray(5, 5)).toEqual(Buffer.alloc(0))
    expect(buf.subarray(5, 0)).toEqual(Buffer.alloc(0))

    expect(buf.subarray(0, 2).length).toBe(2)
    expect(buf.subarray(2, 4).length).toBe(2)
    expect(buf.subarray(4, 5).length).toBe(1)
    expect(buf.subarray(0, 5).length).toBe(5)
    expect(buf.subarray(0, 6).length).toBe(5)
    expect(buf.subarray(0, 0).length).toBe(0)

    const buf2 = Buffer.from('buffer')
    expect(buf2.subarray(0, 3).toString()).toBe('buf')
    expect(buf2.subarray(3).toString()).toBe('fer')
    expect(buf2.subarray(0, -1).toString()).toBe('buffe')
    expect(buf2.subarray(-6, -1).toString()).toBe('buffe')

    expect(buf2.subarray(0, 3).length).toBe(3)
    expect(buf2.subarray(3).length).toBe(3)
    expect(buf2.subarray(0, -1).length).toBe(5)
    expect(buf2.subarray(-6, -1).length).toBe(5)
  })

  test('should return a new buffer that references the same memory as the old, but offset and cropped by the start and end indices', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const subarraydBuf = buf.subarray(1, 4)
    expect(subarraydBuf).toEqual(Buffer.from([2, 3, 4]))
  })

  test('should return a new buffer that references the same memory as the old, but offset by the start index when end index is not provided', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const subarraydBuf = buf.subarray(2)
    expect(subarraydBuf).toEqual(Buffer.from([3, 4, 5]))
  })

  test('should return an empty buffer when start index is equal to the buffer length', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const subarraydBuf = buf.subarray(5)
    expect(subarraydBuf).toEqual(Buffer.from([]))
  })

  test('should return the same buffer when start index is not provided', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const subarraydBuf = buf.subarray()
    expect(subarraydBuf).toEqual(buf)
  })
})

describe('Buffer readBigInt64BE, readBigInt64LE', () => {
  test('should read a BigInt from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    const result = buf.readBigInt64BE(0)
    expect(result).toBe(BigInt('-1'))
  })

  test('should read a BigInt from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    const result = buf.readBigInt64LE(0)
    expect(result).toBe(BigInt('-1'))
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    expect(() => buf.readBigInt64BE(9)).toThrow()
    expect(() => buf.readBigInt64LE(9)).toThrow()
  })
})

describe('Buffer readInt8, readInt16BE, readInt16LE, readInt32BE, readInt32LE, readIntBE, readIntLE', () => {
  test('should read an 8-bit integer from the buffer at the specified offset', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    const result = buf.readInt8(0)
    expect(result).toBe(-1)
  })

  test('should read a 16-bit integer from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([255, 255])
    const result = buf.readInt16BE(0)
    expect(result).toBe(-1)
  })

  test('should read a 16-bit integer from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([255, 255])
    const result = buf.readInt16LE(0)
    expect(result).toBe(-1)
  })

  test('should read a 32-bit integer from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    const result = buf.readInt32BE(0)
    expect(result).toBe(-1)
  })

  test('should read a 32-bit integer from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    const result = buf.readInt32LE(0)
    expect(result).toBe(-1)
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    expect(() => buf.readInt8(5)).toThrow()
    expect(() => buf.readInt16BE(5)).toThrow()
    expect(() => buf.readInt16LE(5)).toThrow()
    expect(() => buf.readInt32BE(5)).toThrow()
    expect(() => buf.readInt32LE(5)).toThrow()
  })
})

describe('Buffer readDoubleBE, readDoubleLE, readFloatBE, readFloatLE', () => {
  test('should read a double from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([64, 9, 33, 251, 84, 68, 45, 24])
    const result = buf.readDoubleBE(0)
    expect(result).toBeCloseTo(3.141592653589793)
  })

  test('should read a double from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([24, 45, 68, 84, 251, 33, 9, 64])
    const result = buf.readDoubleLE(0)
    expect(result).toBeCloseTo(3.141592653589793)
  })

  test('should read a float from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([64, 73, 15, 219])
    const result = buf.readFloatBE(0)
    expect(result).toBeCloseTo(3.1415927410125732)
  })

  test('should read a float from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([219, 15, 73, 64])
    const result = buf.readFloatLE(0)
    expect(result).toBeCloseTo(3.1415927410125732)
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.from([64, 9, 33, 251, 84, 68, 45, 24])
    expect(() => buf.readDoubleBE(9)).toThrow()
    expect(() => buf.readDoubleLE(9)).toThrow()
    expect(() => buf.readFloatBE(5)).toThrow()
    expect(() => buf.readFloatLE(5)).toThrow()
  })
})

describe('Buffer readBigUInt64BE, readBigUInt64LE, readBigUint64BE, readBigUint64LE', () => {
  test('should read a Big Unsigned Integer from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    const result = buf.readBigUInt64BE(0)
    expect(result).toBe(BigInt('18446744073709551615'))

    const buf2 = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    const result2 = buf2.readBigUint64BE(0)
    expect(result2).toBe(BigInt('18446744073709551615'))
  })

  test('should read a Big Unsigned Integer from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    const result = buf.readBigUInt64LE(0)
    expect(result).toBe(BigInt('18446744073709551615'))

    const buf2 = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    const result2 = buf2.readBigUint64LE(0)
    expect(result2).toBe(BigInt('18446744073709551615'))
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255])
    expect(() => buf.readBigUInt64BE(9)).toThrow()
    expect(() => buf.readBigUint64BE(9)).toThrow()
    expect(() => buf.readBigUInt64LE(9)).toThrow()
    expect(() => buf.readBigUint64LE(9)).toThrow()
  })
})

describe('Buffer readUIntBE, readUIntLE, readUInt8, readUInt16BE, readUInt16LE, readUInt32BE, readUInt32LE, readUintBE, readUintLE, readUint8, readUint16BE, readUint16LE, readUint32BE, readUint32LE', () => {
  test('should read an unsigned integer from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    const result = buf.readUIntBE(0, 4)
    expect(result).toBe(4294967295)

    const buf2 = Buffer.from([255, 255, 255, 255])
    const result2 = buf2.readUintBE(0, 4)
    expect(result2).toBe(4294967295)
  })

  test('should read an unsigned integer from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    const result = buf.readUIntLE(0, 4)
    expect(result).toBe(4294967295)

    const buf2 = Buffer.from([255, 255, 255, 255])
    const result2 = buf2.readUintLE(0, 4)
    expect(result2).toBe(4294967295)
  })

  test('should read an 8-bit unsigned integer from the buffer at the specified offset', () => {
    const buf = Buffer.from([255])
    const result = buf.readUInt8(0)
    expect(result).toBe(255)

    const buf2 = Buffer.from([255])
    const result2 = buf2.readUint8(0)
    expect(result2).toBe(255)
  })

  test('should read a 16-bit unsigned integer from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([255, 255])
    const result = buf.readUInt16BE(0)
    expect(result).toBe(65535)

    const buf2 = Buffer.from([255, 255])
    const result2 = buf2.readUint16BE(0)
    expect(result2).toBe(65535)
  })

  test('should read a 16-bit unsigned integer from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([255, 255])
    const result = buf.readUInt16LE(0)
    expect(result).toBe(65535)

    const buf2 = Buffer.from([255, 255])
    const result2 = buf2.readUint16LE(0)
    expect(result2).toBe(65535)
  })

  test('should read a 32-bit unsigned integer from the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    const result = buf.readUInt32BE(0)
    expect(result).toBe(4294967295)

    const buf2 = Buffer.from([255, 255, 255, 255])
    const result2 = buf2.readUint32BE(0)
    expect(result2).toBe(4294967295)
  })

  test('should read a 32-bit unsigned integer from the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    const result = buf.readUInt32LE(0)
    expect(result).toBe(4294967295)

    const buf2 = Buffer.from([255, 255, 255, 255])
    const result2 = buf2.readUint32LE(0)
    expect(result2).toBe(4294967295)
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.from([255, 255, 255, 255])
    expect(() => buf.readUIntBE(5, 4)).toThrow()
    expect(() => buf.readUintBE(5, 4)).toThrow()
    expect(() => buf.readUIntLE(5, 4)).toThrow()
    expect(() => buf.readUintLE(5, 4)).toThrow()
    expect(() => buf.readUInt8(5)).toThrow()
    expect(() => buf.readUint8(5)).toThrow()
    expect(() => buf.readUInt16BE(5)).toThrow()
    expect(() => buf.readUint16BE(5)).toThrow()
    expect(() => buf.readUInt16LE(5)).toThrow()
    expect(() => buf.readUint16LE(5)).toThrow()
    expect(() => buf.readUInt32BE(5)).toThrow()
    expect(() => buf.readUint32BE(5)).toThrow()
    expect(() => buf.readUInt32LE(5)).toThrow()
    expect(() => buf.readUint32LE(5)).toThrow()
  })
})

describe('Buffer writeBigUint64BE, writeBigUint64LE', () => {
  test('should write a BigInt as an unsigned 64-bit integer to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigUint64BE(BigInt('18446744073709551615'), 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255, 255, 255, 255, 255]))
  })

  test('should write a BigInt as an unsigned 64-bit integer to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigUint64LE(BigInt('18446744073709551615'), 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255, 255, 255, 255, 255]))
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.alloc(8)
    expect(() => buf.writeBigUint64BE(BigInt('18446744073709551615'), 9)).toThrow()
    expect(() => buf.writeBigUint64LE(BigInt('18446744073709551615'), 9)).toThrow()
  })

  test('should throw an error if the value is not a BigInt', () => {
    const buf = Buffer.alloc(8)
    // expect(() => buf.writeBigUint64BE('18446744073709551615' as any, 0)).toThrow() ❌
    // expect(() => buf.writeBigUint64LE('18446744073709551615' as any, 0)).toThrow() ❌
  })
})

describe('Buffer writeBigInt64BE, writeBigInt64LE, writeBigUInt64BE, writeBigUInt64LE', () => {
  test('should write a 64-bit BigInt to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigInt64BE(BigInt('9223372036854775807'), 0)
    expect(buf).toEqual(Buffer.from([127, 255, 255, 255, 255, 255, 255, 255]))
  })

  test('should write a 64-bit BigInt to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigInt64LE(BigInt('9223372036854775807'), 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255, 255, 255, 255, 127]))
  })

  test('should write a 64-bit unsigned BigInt to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64BE(BigInt('18446744073709551615'), 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255, 255, 255, 255, 255]))
  })

  test('should write a 64-bit unsigned BigInt to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64LE(BigInt('18446744073709551615'), 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255, 255, 255, 255, 255].reverse()))
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.alloc(8)
    expect(() => buf.writeBigInt64BE(BigInt('9223372036854775807'), 9)).toThrow()
    expect(() => buf.writeBigInt64LE(BigInt('9223372036854775807'), 9)).toThrow()
    expect(() => buf.writeBigUInt64BE(BigInt('18446744073709551615'), 9)).toThrow()
    expect(() => buf.writeBigUInt64LE(BigInt('18446744073709551615'), 9)).toThrow()
  })

  test('should throw an error if the value is not a 64-bit BigInt', () => {
    const buf = Buffer.alloc(8)
    expect(() => buf.writeBigInt64BE(9223372036854775807 as any, 0)).toThrow()
    expect(() => buf.writeBigInt64LE(9223372036854775807 as any, 0)).toThrow()
    expect(() => buf.writeBigUInt64BE(18446744073709551615 as any, 0)).toThrow()
    expect(() => buf.writeBigUInt64LE(18446744073709551615 as any, 0)).toThrow()
  })
})

describe('Buffer writeDoubleBE, writeDoubleLE, writeFloatBE, writeFloatLE', () => {
  test('should write a double to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeDoubleBE(123.456, 0)
    expect(buf).toEqual(Buffer.from([64, 94, 221, 47, 26, 159, 190, 119]))
  })

  test('should write a double to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(8)
    buf.writeDoubleLE(123.456, 0)
    expect(buf).toEqual(Buffer.from([64, 94, 221, 47, 26, 159, 190, 119].reverse()))
  })

  test('should write a float to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeFloatBE(123.456, 0)
    expect(buf).toEqual(Buffer.from([66, 246, 233, 121]))
  })

  test('should write a float to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeFloatLE(123.456, 0)
    expect(buf).toEqual(Buffer.from([66, 246, 233, 121].reverse()))
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.alloc(8)
    expect(() => buf.writeDoubleBE(123.456, 9)).toThrow()
    expect(() => buf.writeDoubleLE(123.456, 9)).toThrow()
    const buf2 = Buffer.alloc(4)
    expect(() => buf2.writeFloatBE(123.456, 5)).toThrow()
    expect(() => buf2.writeFloatLE(123.456, 5)).toThrow()
  })

  test('should throw an error if the value is not a double or float', () => {
    const buf = Buffer.alloc(8)
    expect(() => buf.writeDoubleBE('123.456' as any, 0)).not.toThrow()
    expect(() => buf.writeDoubleLE('123.456' as any, 0)).not.toThrow()
    const buf2 = Buffer.alloc(4)
    expect(() => buf2.writeFloatBE('123.456' as any, 0)).not.toThrow()
    expect(() => buf2.writeFloatLE('123.456' as any, 0)).not.toThrow()
  })
})

describe('Buffer writeInt8, writeInt16BE, writeInt16LE, writeInt32BE, writeInt32LE, writeIntBE, writeIntLE', () => {
  test('should write an 8-bit integer to the buffer at the specified offset', () => {
    const buf = Buffer.alloc(1)
    buf.writeInt8(127, 0)
    expect(buf).toEqual(Buffer.from([127]))
  })

  test('should write a 16-bit integer to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(2)
    buf.writeInt16BE(32767, 0)
    expect(buf).toEqual(Buffer.from([127, 255]))
  })

  test('should write a 16-bit integer to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(2)
    buf.writeInt16LE(32767, 0)
    expect(buf).toEqual(Buffer.from([255, 127]))
  })

  test('should write a 32-bit integer to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeInt32BE(2147483647, 0)
    expect(buf).toEqual(Buffer.from([127, 255, 255, 255]))
  })

  test('should write a 32-bit integer to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeInt32LE(2147483647, 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 127]))
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.alloc(1)
    expect(() => buf.writeInt8(127, 2)).toThrow()
    const buf2 = Buffer.alloc(2)
    expect(() => buf2.writeInt16BE(32767, 3)).toThrow()
    expect(() => buf2.writeInt16LE(32767, 3)).toThrow()
    const buf3 = Buffer.alloc(4)
    expect(() => buf3.writeInt32BE(2147483647, 5)).toThrow()
    expect(() => buf3.writeInt32LE(2147483647, 5)).toThrow()
  })

  test('should throw an error if the value is not an integer', () => {
    const buf = Buffer.alloc(1)
    expect(() => buf.writeInt8('127' as any, 0)).not.toThrow()
    const buf2 = Buffer.alloc(2)
    expect(() => buf2.writeInt16BE('32767' as any, 0)).not.toThrow()
    expect(() => buf2.writeInt16LE('32767' as any, 0)).not.toThrow()
    const buf3 = Buffer.alloc(4)
    expect(() => buf3.writeInt32BE('2147483647' as any, 0)).not.toThrow()
    expect(() => buf3.writeInt32LE('2147483647' as any, 0)).not.toThrow()
  })
})

describe('Buffer writeUInt8, writeUInt16BE, writeUInt16LE, writeUInt32BE, writeUInt32LE, writeUIntBE, writeUIntLE, writeUint8, writeUint16BE, writeUint16LE, writeUint32BE, writeUint32LE, writeUintBE, writeUintLE', () => {
  test('should write an 8-bit unsigned integer to the buffer at the specified offset', () => {
    const buf = Buffer.alloc(1)
    buf.writeUInt8(255, 0)
    expect(buf).toEqual(Buffer.from([255]))

    const buf2 = Buffer.alloc(1)
    buf2.writeUint8(255, 0)
    expect(buf2).toEqual(Buffer.from([255]))
  })

  test('should write a 16-bit unsigned integer to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(2)
    buf.writeUInt16BE(65535, 0)
    expect(buf).toEqual(Buffer.from([255, 255]))

    const buf2 = Buffer.alloc(2)
    buf2.writeUint16BE(65535, 0)
    expect(buf2).toEqual(Buffer.from([255, 255]))
  })

  test('should write a 16-bit unsigned integer to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(2)
    buf.writeUInt16LE(65535, 0)
    expect(buf).toEqual(Buffer.from([255, 255]))

    const buf2 = Buffer.alloc(2)
    buf2.writeUint16LE(65535, 0)
    expect(buf2).toEqual(Buffer.from([255, 255]))
  })

  test('should write a 32-bit unsigned integer to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeUInt32BE(4294967295, 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255]))

    const buf2 = Buffer.alloc(4)
    buf2.writeUint32BE(4294967295, 0)
    expect(buf2).toEqual(Buffer.from([255, 255, 255, 255]))
  })

  test('should write a 32-bit unsigned integer to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeUInt32LE(4294967295, 0)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255]))

    const buf2 = Buffer.alloc(4)
    buf2.writeUint32LE(4294967295, 0)
    expect(buf2).toEqual(Buffer.from([255, 255, 255, 255]))
  })

  test('should write an unsigned integer of any byte length to the buffer at the specified offset in big-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeUIntBE(4294967295, 0, 4)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255]))

    const buf2 = Buffer.alloc(4)
    buf2.writeUintBE(4294967295, 0, 4)
    expect(buf2).toEqual(Buffer.from([255, 255, 255, 255]))
  })

  test('should write an unsigned integer of any byte length to the buffer at the specified offset in little-endian format', () => {
    const buf = Buffer.alloc(4)
    buf.writeUIntLE(4294967295, 0, 4)
    expect(buf).toEqual(Buffer.from([255, 255, 255, 255]))

    const buf2 = Buffer.alloc(4)
    buf2.writeUintLE(4294967295, 0, 4)
    expect(buf2).toEqual(Buffer.from([255, 255, 255, 255]))
  })

  test('should throw an error if the offset is out of bounds', () => {
    const buf = Buffer.alloc(1)
    expect(() => buf.writeUInt8(255, 2)).toThrow()
    expect(() => buf.writeUint8(255, 2)).toThrow()
    const buf2 = Buffer.alloc(2)
    expect(() => buf2.writeUInt16BE(65535, 3)).toThrow()
    expect(() => buf2.writeUint16BE(65535, 3)).toThrow()
    expect(() => buf2.writeUInt16LE(65535, 3)).toThrow()
    expect(() => buf2.writeUint16LE(65535, 3)).toThrow()
    const buf3 = Buffer.alloc(4)
    expect(() => buf3.writeUInt32BE(4294967295, 5)).toThrow()
    expect(() => buf3.writeUint32BE(4294967295, 5)).toThrow()
    expect(() => buf3.writeUInt32LE(4294967295, 5)).toThrow()
    expect(() => buf3.writeUint32LE(4294967295, 5)).toThrow()
    const buf4 = Buffer.alloc(4)
    expect(() => buf4.writeUIntBE(4294967295, 5, 4)).toThrow()
    expect(() => buf4.writeUintBE(4294967295, 5, 4)).toThrow()
    expect(() => buf4.writeUIntLE(4294967295, 5, 4)).toThrow()
    expect(() => buf4.writeUintLE(4294967295, 5, 4)).toThrow()
  })

  test('should throw an error if the value is not an unsigned integer', () => {
    const buf = Buffer.alloc(1)
    expect(() => buf.writeUInt8('255' as any, 0)).not.toThrow()
    const buf2 = Buffer.alloc(2)
    expect(() => buf2.writeUInt16BE('65535' as any, 0)).not.toThrow()
    expect(() => buf2.writeUInt16LE('65535' as any, 0)).not.toThrow()
    const buf3 = Buffer.alloc(4)
    expect(() => buf3.writeUInt32BE('4294967295' as any, 0)).not.toThrow()
    expect(() => buf3.writeUInt32LE('4294967295' as any, 0)).not.toThrow()
    const buf4 = Buffer.alloc(4)
    expect(() => buf4.writeUIntBE('4294967295' as any, 0, 4)).not.toThrow()
    expect(() => buf4.writeUintBE('4294967295' as any, 0, 4)).not.toThrow()
    expect(() => buf4.writeUIntLE('4294967295' as any, 0, 4)).not.toThrow()
    expect(() => buf4.writeUintLE('4294967295' as any, 0, 4)).not.toThrow()
  })
})

describe('Buffer toJSON', () => {
  test('should return a JSON representation of the buffer', () => {
    const buf = Buffer.from('Hello, World!')
    const json = buf.toJSON()
    expect(json).toEqual({
      type: 'Buffer',
      data: [72, 101, 108, 108, 111, 44, 32, 87, 111, 114, 108, 100, 33],
    })
  })

  test('should handle empty buffers', () => {
    const buf = Buffer.alloc(0)
    const json = buf.toJSON()
    expect(json).toEqual({
      type: 'Buffer',
      data: [],
    })
  })
})

describe('Buffer swap16', () => {
  test('should swap the byte order of each 16-bit sequence', () => {
    const buf = Buffer.from([0x01, 0x02])
    buf.swap16()
    expect(buf).toEqual(Buffer.from([0x02, 0x01]))
  })

  test('should handle buffers with length not divisible by 2', () => {
    const buf = Buffer.from([0x01])
    expect(() => buf.swap16()).toThrow()
  })

  test('should handle empty buffers', () => {
    const buf = Buffer.alloc(0)
    expect(() => buf.swap16()).not.toThrow()
    expect(buf).toEqual(Buffer.alloc(0))
  })
})

describe('Buffer swap32', () => {
  test('should swap the byte order of each 32-bit sequence', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04])
    buf.swap32()
    expect(buf).toEqual(Buffer.from([0x04, 0x03, 0x02, 0x01]))
  })

  test('should handle buffers with length not divisible by 4', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03])
    expect(() => buf.swap32()).toThrow()
  })

  test('should handle empty buffers', () => {
    const buf = Buffer.alloc(0)
    expect(() => buf.swap32()).not.toThrow()
    expect(buf).toEqual(Buffer.alloc(0))
  })
})

describe('Buffer swap64', () => {
  test('should swap the byte order of each 64-bit sequence', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
    buf.swap64()
    expect(buf).toEqual(Buffer.from([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]))
  })

  test('should handle buffers with length not divisible by 8', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    expect(() => buf.swap64()).toThrow()
  })

  test('should handle empty buffers', () => {
    const buf = Buffer.alloc(0)
    expect(() => buf.swap64()).not.toThrow()
    expect(buf).toEqual(Buffer.alloc(0))
  })
})

describe('Buffer compare', () => {
  test('simple', () => {
    const buf1 = Buffer.from([1, 2, 3, 4, 5])
    const buf2 = Buffer.from([1, 2, 3, 4, 5])
    const buf3 = Buffer.from([1, 2, 3, 4])
    expect(buf1.compare(buf2)).toBe(0)
    expect(buf1.compare(buf3)).toBe(1)
    expect(buf3.compare(buf1)).toBe(-1)
  })

  test('should return 0 if the buffers are equal', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, World!')
    expect(buf1.compare(buf2)).toEqual(0)
  })

  test('should return a positive number if the source buffer comes before the target buffer', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, Universe!')
    expect(buf1.compare(buf2)).toBeGreaterThan(0)
  })

  test('should return a negative number if the source buffer comes after the target buffer', () => {
    const buf1 = Buffer.from('Hello, Universe!')
    const buf2 = Buffer.from('Hello, World!')
    expect(buf1.compare(buf2)).toBeLessThan(0)
  })

  test('should compare specified portions of the buffers', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, Universe!')
    expect(buf1.compare(buf2, 0, 5, 0, 5)).toEqual(0)
  })

  test('should handle negative and out of bounds values', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, Universe!')
    expect(() => buf1.compare(buf2, -1)).toThrow()
    expect(() => buf1.compare(buf2, 0, 50)).toThrow()
  })
})

describe('Buffer equals', () => {
  test('simple', () => {
    const buf1 = Buffer.from([1, 2, 3, 4, 5])
    const buf2 = Buffer.from([1, 2, 3, 4, 5])
    const buf3 = Buffer.from([1, 2, 3, 4])
    expect(buf1.equals(buf2)).toBe(true)
    expect(buf1.equals(buf3)).toBe(false)
  })

  test('should return true if the buffers are equal', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, World!')
    expect(buf1.equals(buf2)).toEqual(true)
  })

  test('should return false if the buffers are not equal', () => {
    const buf1 = Buffer.from('Hello, World!')
    const buf2 = Buffer.from('Hello, Universe!')
    expect(buf1.equals(buf2)).toEqual(false)
  })

  test('should fail if the other object is not a buffer', () => {
    const buf = Buffer.from('Hello, World!')
    expect(() => buf.equals({} as any)).toThrow()
  })
})

describe('Buffer copy', () => {
  test('simple', () => {
    const buf1 = Buffer.from([1, 2, 3, 4, 5])
    const buf2 = Buffer.alloc(5)
    buf1.copy(buf2)
    expect(buf2).toEqual(buf1)
  })

  test('should copy the source buffer into the target buffer with default parameters', () => {
    const source = Buffer.from('Hello, World!')
    const target = Buffer.allocUnsafe(20)
    source.copy(target)
    expect(target.toString('utf8', 0, source.length)).toEqual('Hello, World!')
  })

  test('should copy the source buffer into the target buffer at specified target start', () => {
    const source = Buffer.from('Hello, World!')
    const target = Buffer.allocUnsafe(20)
    source.copy(target, 5)
    expect(target.toString('utf8', 5, 5 + source.length)).toEqual('Hello, World!')
  })

  test('should copy a portion of the source buffer into the target buffer', () => {
    const source = Buffer.from('Hello, World!')
    const target = Buffer.allocUnsafe(20)
    source.copy(target, 0, 0, 5)
    expect(target.toString('utf8', 0, 5)).toEqual('Hello')
  })

  test('should handle negative and out of bounds values', () => {
    const source = Buffer.from('Hello, World!')
    const target = Buffer.allocUnsafe(20)
    expect(() => source.copy(target, -1)).toThrow()
    expect(() => source.copy(target, 0, -1)).toThrow()
    expect(() => source.copy(target, 0, 0, 50)).not.toThrow()
  })
})

describe('Buffer write', () => {
  test('simple', () => {
    const buf = Buffer.alloc(5)
    buf.write('abcde')
    expect(buf).toEqual(Buffer.from([97, 98, 99, 100, 101]))
  })

  test('should write a string to the buffer with default parameters', () => {
    const buf = Buffer.allocUnsafe(20)
    const bytesWritten = buf.write('Hello, World!')
    expect(buf.toString('utf8', 0, bytesWritten)).toEqual('Hello, World!')
    expect(bytesWritten).toEqual(13)
  })

  test('should write a string to the buffer at specified offset', () => {
    const buf = Buffer.allocUnsafe(20)
    const bytesWritten = buf.write('Hello, World!', 5)
    expect(buf.toString('utf8', 5, 5 + bytesWritten)).toEqual('Hello, World!')
    expect(bytesWritten).toEqual(13)
  })

  test('should write a string to the buffer with specified length', () => {
    const buf = Buffer.allocUnsafe(20)
    const bytesWritten = buf.write('Hello, World!', 0, 5)
    expect(buf.toString('utf8', 0, bytesWritten)).toEqual('Hello')
    expect(bytesWritten).toEqual(5)
  })

  test('should write a string to the buffer with specified encoding', () => {
    const buf = Buffer.allocUnsafe(20)
    const bytesWritten = buf.write('48656c6c6f2c20576f726c6421', 0, 'hex')
    expect(buf.toString('utf8', 0, bytesWritten)).toEqual('Hello, World!')
    expect(bytesWritten).toEqual(13)
  })

  test('should throw an error if offset is out of bounds', () => {
    const buf = Buffer.allocUnsafe(20)
    expect(() => buf.write('Hello, World!', 21)).toThrow()
  })

  test('should throw an error if length is out of bounds', () => {
    const buf = Buffer.allocUnsafe(20)
    expect(() => buf.write('Hello, World!', 0, 21)).toThrow()
  })
})

describe('Buffer.toString', () => {
  test('simple', () => {
    const buf = Buffer.from([97, 98, 99, 100, 101])
    expect(buf.toString()).toBe('abcde')
  })

  test('should convert the buffer to a string with default parameters', () => {
    const buf = Buffer.from('Hello, World!')
    expect(buf.toString()).toEqual('Hello, World!')
  })

  test('should convert the buffer to a string with specified encoding', () => {
    const buf = Buffer.from('Hello, World!')
    expect(buf.toString('hex')).toEqual('48656c6c6f2c20576f726c6421')
  })

  test('should convert a portion of the buffer to a string', () => {
    const buf = Buffer.from('Hello, World!')
    expect(buf.toString('utf8', 0, 5)).toEqual('Hello')
  })

  test('should handle negative start and end values', () => {
    const buf = Buffer.from('Hello, World!')
    expect(buf.toString('utf8', -5)).toEqual('Hello, World!')
    expect(buf.toString('utf8', 0, -5)).toEqual('')
  })

  test('should handle start and end values greater than buffer length', () => {
    const buf = Buffer.from('Hello, World!')
    expect(buf.toString('utf8', 50)).toEqual('')
    expect(buf.toString('utf8', 0, 50)).toEqual('Hello, World!')
  })
})

test('Buffer.write (example)', () => {
  const buf = Buffer.alloc(256)

  const len = buf.write('\u00bd + \u00bc = \u00be', 0)

  expect(len).toBe(12)
  expect(buf.toString('utf8', 0, len)).toBe('½ + ¼ = ¾')

  const buffer = Buffer.alloc(10)

  const length = buffer.write('abcd', 8)

  expect(length).toBe(2)
  expect(buffer.toString('utf8', 8, 10)).toBe('ab')
})

test('Buffer.toString (example)', () => {
  const buf1 = Buffer.allocUnsafe(26)

  for (let i = 0; i < 26; i++) {
    buf1[i] = i + 97
  }

  expect(buf1.toString('utf8')).toBe('abcdefghijklmnopqrstuvwxyz')
  expect(buf1.toString('utf8', 0, 5)).toBe('abcde')

  const buf2 = Buffer.from('tést')

  expect(buf2.toString('hex')).toBe('74c3a97374')
  expect(buf2.toString('utf8', 0, 3)).toBe('té')
  expect(buf2.toString(undefined, 0, 3)).toBe('té')
})

test('Buffer.toJSON (example)', () => {
  const buf = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5])
  const json = JSON.stringify(buf)

  expect(json).toBe('{"type":"Buffer","data":[1,2,3,4,5]}')

  const copy = JSON.parse(json, (key, value) => {
    return value && value.type === 'Buffer' ? Buffer.from(value) : value
  })

  expect(copy).toEqual(Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5]))
})

test('Buffer.equals (example)', () => {
  const buf1 = Buffer.from('ABC')
  const buf2 = Buffer.from('414243', 'hex')
  const buf3 = Buffer.from('ABCD')

  expect(buf1.equals(buf2)).toBe(true)
  expect(buf1.equals(buf3)).toBe(false)
})

test('Buffer.compare (example)', () => {
  const buf1 = Buffer.from('ABC')
  const buf2 = Buffer.from('BCD')
  const buf3 = Buffer.from('ABCD')

  expect(buf1.compare(buf1)).toBe(0)
  expect(buf1.compare(buf2)).toBe(-1)
  expect(buf1.compare(buf3)).toBe(-1)
  expect(buf2.compare(buf1)).toBe(1)
  expect(buf2.compare(buf3)).toBe(1)

  const buf4 = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])
  const buf5 = Buffer.from([5, 6, 7, 8, 9, 1, 2, 3, 4])

  expect(buf4.compare(buf5, 5, 9, 0, 4)).toBe(0)
  expect(buf4.compare(buf5, 0, 6, 4)).toBe(-1)
  expect(buf4.compare(buf5, 5, 6, 5)).toBe(1)
})

test('Buffer.copy (example)', () => {
  const buf1 = Buffer.allocUnsafe(26)
  const buf2 = Buffer.allocUnsafe(26).fill('!')

  for (let i = 0; i < 26; i++) {
    buf1[i] = i + 97
  }

  buf1.copy(buf2, 8, 16, 20)

  expect(buf2.toString('utf8', 0, 25)).toBe('!!!!!!!!qrst!!!!!!!!!!!!!')

  const buf = Buffer.allocUnsafe(26)

  for (let i = 0; i < 26; i++) {
    buf[i] = i + 97
  }

  buf.copy(buf, 0, 4, 10)

  expect(buf.toString()).toBe('efghijghijklmnopqrstuvwxyz')
})

test('Buffer.slice (example)', () => {
  const buf = Buffer.from('buffer')

  const copiedBuf = Uint8Array.prototype.slice.call(buf)
  copiedBuf[0]++
  expect(copiedBuf.toString()).toBe('cuffer')
  expect(buf.toString()).toBe('buffer')

  const notReallyCopiedBuf = buf.slice()
  notReallyCopiedBuf[0]++
  expect(notReallyCopiedBuf.toString()).toBe('cuffer')
  expect(buf.toString()).toBe('cuffer')
})

test('Buffer.subarray (example)', () => {
  const buf1 = Buffer.allocUnsafe(26)

  for (let i = 0; i < 26; i++) {
    buf1[i] = i + 97
  }

  const buf2 = buf1.subarray(0, 3)

  expect(buf2.toString('utf8', 0, buf2.length)).toBe('abc')

  buf1[0] = 33

  expect(buf2.toString('utf8', 0, buf2.length)).toBe('!bc')

  const buf = Buffer.from('buffer')

  expect(buf.subarray(-6, -1).toString()).toBe('buffe')
  expect(buf.subarray(-6, -2).toString()).toBe('buff')
  expect(buf.subarray(-5, -2).toString()).toBe('uff')
})

test('Buffer.writeBigInt64BE (example)', () => {
  const buf = Buffer.allocUnsafe(8)

  buf.writeBigInt64BE(0x0102030405060708n, 0)

  expect(buf).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]))
})

test('Buffer.writeBigInt64LE (example)', () => {
  const buf = Buffer.allocUnsafe(8)

  buf.writeBigInt64LE(0x0102030405060708n, 0)

  expect(buf).toEqual(Buffer.from([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]))
})

test('Buffer.readBigInt64BE (example)', () => {
  const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])

  expect(buf.readBigInt64BE(0).toString(16)).toBe('102030405060708')
})

test('Buffer.writeBigUInt64BE (example)', () => {
  const buf = Buffer.allocUnsafe(8)

  buf.writeBigUInt64BE(0x0102030405060708n, 0)

  expect(buf).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]))
})

test('Buffer.writeBigUInt64LE (example)', () => {
  const buf = Buffer.allocUnsafe(8)

  buf.writeBigUInt64LE(0xdecafafecacefaden, 0)

  expect(buf).toEqual(Buffer.from([0xde, 0xfa, 0xce, 0xca, 0xfe, 0xfa, 0xca, 0xde]))
})

test('Buffer.writeBigUint64LE (example)', () => {
  const buf = Buffer.allocUnsafe(8)

  buf.writeBigUint64LE(0xdecafafecacefaden, 0)

  expect(buf).toEqual(Buffer.from([0xde, 0xfa, 0xce, 0xca, 0xfe, 0xfa, 0xca, 0xde]))
})

test('Buffer.writeUIntLE (example)', () => {
  const buf = Buffer.allocUnsafe(6)

  buf.writeUIntLE(0x1234567890ab, 0, 6)

  expect(buf).toEqual(Buffer.from([0xab, 0x90, 0x78, 0x56, 0x34, 0x12]))
})

test('Buffer.writeUintLE (example)', () => {
  const buf = Buffer.allocUnsafe(6)

  buf.writeUintLE(0x1234567890ab, 0, 6)

  expect(buf).toEqual(Buffer.from([0xab, 0x90, 0x78, 0x56, 0x34, 0x12]))
})

test('Buffer.writeUIntBE (example)', () => {
  const buf = Buffer.allocUnsafe(6)

  buf.writeUIntBE(0x1234567890ab, 0, 6)

  expect(buf).toEqual(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]))
})

test('Buffer.writeUintBE (example)', () => {
  const buf = Buffer.allocUnsafe(6)

  buf.writeUintBE(0x1234567890ab, 0, 6)

  expect(buf).toEqual(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]))
})

test('Buffer.writeIntLE (example)', () => {
  const buf = Buffer.allocUnsafe(6)

  buf.writeIntLE(0x1234567890ab, 0, 6)

  expect(buf).toEqual(Buffer.from([0xab, 0x90, 0x78, 0x56, 0x34, 0x12]))
})

test('Buffer.writeIntBE (example)', () => {
  const buf = Buffer.allocUnsafe(6)

  buf.writeIntBE(0x1234567890ab, 0, 6)

  expect(buf).toEqual(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]))
})

test('Buffer.readBigUInt64BE (example)', () => {
  const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff])

  expect(buf.readBigUInt64BE(0)).toBe(4294967295n)
})

test('Buffer.readBigUint64BE (example)', () => {
  const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff])

  expect(buf.readBigUint64BE(0)).toBe(4294967295n)
})

test('Buffer.readBigUInt64LE (example)', () => {
  const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff])

  expect(buf.readBigUInt64LE(0)).toBe(18446744069414584320n)
})

test('Buffer.readBigUint64LE (example)', () => {
  const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff])

  expect(buf.readBigUint64LE(0)).toBe(18446744069414584320n)
})

test('Buffer.readBigInt64LE (example)', () => {
  const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff])

  expect(buf.readBigInt64LE(0)).toBe(-4294967296n)
})

test('Buffer.readUIntLE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])

  expect(buf.readUIntLE(0, 6).toString(16)).toBe('ab9078563412')
})

test('Buffer.readUintLE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])

  expect(buf.readUintLE(0, 6).toString(16)).toBe('ab9078563412')
})

test('Buffer.readUIntBE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])

  expect(buf.readUIntBE(0, 6).toString(16)).toBe('1234567890ab')
  expect(() => buf.readUIntBE(1, 60)).toThrow()
})

test('Buffer.readUintBE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])

  expect(buf.readUintBE(0, 6).toString(16)).toBe('1234567890ab')
  expect(() => buf.readUintBE(1, 60)).toThrow()
})

test('Buffer.readIntLE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])

  expect(buf.readIntLE(0, 6).toString(16)).toBe('-546f87a9cbee')
})

test('Buffer.readIntBE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])

  expect(buf.readIntBE(0, 6).toString(16)).toBe('1234567890ab')
  expect(() => buf.readIntBE(1, 60)).toThrow()
  expect(() => buf.readIntBE(1, 0)).toThrow()
})

test('Buffer.readUInt8 (example)', () => {
  const buf = Buffer.from([1, -2])

  expect(buf.readUInt8(0)).toBe(1)
  expect(buf.readUInt8(1)).toBe(254)
  expect(() => buf.readUInt8(2)).toThrow()
})

test('Buffer.readUint8 (example)', () => {
  const buf = Buffer.from([1, -2])

  expect(buf.readUint8(0)).toBe(1)
  expect(buf.readUint8(1)).toBe(254)
  expect(() => buf.readUint8(2)).toThrow()
})

test('Buffer.readUInt16LE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56])

  expect(buf.readUInt16LE(0).toString(16)).toBe('3412')
  expect(buf.readUInt16LE(1).toString(16)).toBe('5634')
  expect(() => buf.readUInt16LE(2)).toThrow()
})

test('Buffer.readUint16LE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56])

  expect(buf.readUint16LE(0).toString(16)).toBe('3412')
  expect(buf.readUint16LE(1).toString(16)).toBe('5634')
  expect(() => buf.readUint16LE(2)).toThrow()
})

test('Buffer.readUInt16BE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56])

  expect(buf.readUInt16BE(0).toString(16)).toBe('1234')
  expect(buf.readUInt16BE(1).toString(16)).toBe('3456')
  expect(() => buf.readUint16BE(2)).toThrow()
})

test('Buffer.readUint16BE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56])

  expect(buf.readUint16BE(0).toString(16)).toBe('1234')
  expect(buf.readUint16BE(1).toString(16)).toBe('3456')
  expect(() => buf.readUint16BE(2)).toThrow()
})

test('Buffer.readUInt32LE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78])

  expect(buf.readUInt32LE(0).toString(16)).toBe('78563412')
  expect(() => buf.readUInt32LE(1)).toThrow()
})

test('Buffer.readUint32LE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78])

  expect(buf.readUint32LE(0).toString(16)).toBe('78563412')
  expect(() => buf.readUint32LE(1)).toThrow()
})

test('Buffer.readUInt32BE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78])

  expect(buf.readUInt32BE(0).toString(16)).toBe('12345678')
  expect(() => buf.readUInt32BE(1)).toThrow()
})

test('Buffer.readUint32BE (example)', () => {
  const buf = Buffer.from([0x12, 0x34, 0x56, 0x78])

  expect(buf.readUint32BE(0).toString(16)).toBe('12345678')
  expect(() => buf.readUint32BE(1)).toThrow()
})

test('Buffer.readInt8 (example)', () => {
  const buf = Buffer.from([-1, 5])

  expect(buf.readInt8(0)).toBe(-1)
  expect(buf.readInt8(1)).toBe(5)
  expect(() => buf.readInt8(2)).toThrow()
})

test('Buffer.readInt16LE (example)', () => {
  const buf = Buffer.from([0, 5])

  expect(buf.readInt16LE(0)).toBe(1280)
  expect(() => buf.readInt16LE(1)).toThrow()
})

test('Buffer.readInt16BE (example)', () => {
  const buf = Buffer.from([0, 5])

  expect(buf.readInt16BE(0)).toBe(5)
  expect(() => buf.readInt16BE(1)).toThrow()
})

test('Buffer.readInt32LE (example)', () => {
  const buf = Buffer.from([0, 0, 0, 5])

  expect(buf.readInt32LE(0)).toBe(83886080)
  expect(() => buf.readInt32LE(1)).toThrow()
})

test('Buffer.readInt32BE (example)', () => {
  const buf = Buffer.from([0, 0, 0, 5])

  expect(buf.readInt32BE(0)).toBe(5)
  expect(() => buf.readInt32BE(1)).toThrow()
})

test('Buffer.readFloatLE (example)', () => {
  const buf = Buffer.from([1, 2, 3, 4])

  expect(buf.readFloatLE(0)).toBe(1.539989614439558e-36)
  expect(() => buf.readFloatLE(1)).toThrow()
})

test('Buffer.readFloatBE (example)', () => {
  const buf = Buffer.from([1, 2, 3, 4])

  expect(buf.readFloatBE(0)).toBe(2.387939260590663e-38)
  expect(() => buf.readFloatBE(1)).toThrow()
})

test('Buffer.readDoubleLE (example)', () => {
  const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])

  expect(buf.readDoubleLE(0)).toBe(5.447603722011605e-270)
  expect(() => buf.readDoubleLE(1)).toThrow()
})

test('Buffer.readDoubleBE (example)', () => {
  const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])

  expect(buf.readDoubleBE(0)).toBe(8.20788039913184e-304)
  expect(() => buf.readDoubleBE(1)).toThrow()
})

test('Buffer.swap16 (example)', () => {
  const buf1 = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8])

  buf1.swap16()

  expect(buf1).toEqual(Buffer.from([0x2, 0x1, 0x4, 0x3, 0x6, 0x5, 0x8, 0x7]))

  const buf2 = Buffer.from([0x1, 0x2, 0x3])

  expect(() => buf2.swap16()).toThrow()
})

test('Buffer.swap32 (example)', () => {
  const buf1 = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8])

  buf1.swap32()

  expect(buf1).toEqual(Buffer.from([0x4, 0x3, 0x2, 0x1, 0x8, 0x7, 0x6, 0x5]))

  const buf2 = Buffer.from([0x1, 0x2, 0x3])

  expect(() => buf2.swap32()).toThrow()
})

test('Buffer.swap64 (example)', () => {
  const buf1 = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8])

  buf1.swap64()

  expect(buf1).toEqual(Buffer.from([0x8, 0x7, 0x6, 0x5, 0x4, 0x3, 0x2, 0x1]))

  const buf2 = Buffer.from([0x1, 0x2, 0x3])

  expect(() => buf2.swap64()).toThrow()
})

test('Buffer.writeUInt8 (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUInt8(0x3, 0)
  buf.writeUInt8(0x4, 1)
  buf.writeUInt8(0x23, 2)
  buf.writeUInt8(0x42, 3)

  expect(buf).toEqual(Buffer.from([0x3, 0x4, 0x23, 0x42]))
})

test('Buffer.writeUint8 (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUint8(0x3, 0)
  buf.writeUint8(0x4, 1)
  buf.writeUint8(0x23, 2)
  buf.writeUint8(0x42, 3)

  expect(buf).toEqual(Buffer.from([0x3, 0x4, 0x23, 0x42]))
})

test('Buffer.writeUInt16LE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUInt16LE(0xdead, 0)
  buf.writeUInt16LE(0xbeef, 2)

  expect(buf).toEqual(Buffer.from([0xad, 0xde, 0xef, 0xbe]))
})

test('Buffer.writeUint16LE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUint16LE(0xdead, 0)
  buf.writeUint16LE(0xbeef, 2)

  expect(buf).toEqual(Buffer.from([0xad, 0xde, 0xef, 0xbe]))
})

test('Buffer.writeUInt16BE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUInt16BE(0xdead, 0)
  buf.writeUInt16BE(0xbeef, 2)

  expect(buf).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]))
})

test('Buffer.writeUint16BE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUint16BE(0xdead, 0)
  buf.writeUint16BE(0xbeef, 2)

  expect(buf).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]))
})

test('Buffer.writeUInt32LE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUInt32LE(0xfeedface, 0)

  expect(buf).toEqual(Buffer.from([0xce, 0xfa, 0xed, 0xfe]))
})

test('Buffer.writeUint32LE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUint32LE(0xfeedface, 0)

  expect(buf).toEqual(Buffer.from([0xce, 0xfa, 0xed, 0xfe]))
})

test('Buffer.writeUInt32BE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUInt32BE(0xfeedface, 0)

  expect(buf).toEqual(Buffer.from([0xfe, 0xed, 0xfa, 0xce]))
})

test('Buffer.writeUint32BE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeUint32BE(0xfeedface, 0)

  expect(buf).toEqual(Buffer.from([0xfe, 0xed, 0xfa, 0xce]))
})

test('Buffer.writeInt8 (example)', () => {
  const buf = Buffer.allocUnsafe(2)

  buf.writeInt8(2, 0)
  buf.writeInt8(-2, 1)

  expect(buf).toEqual(Buffer.from([0x2, 0xfe]))
})

test('Buffer.writeInt16LE (example)', () => {
  const buf = Buffer.allocUnsafe(2)

  buf.writeInt16LE(0x0304, 0)

  expect(buf).toEqual(Buffer.from([0x4, 0x3]))
})

test('Buffer.writeInt16BE (example)', () => {
  const buf = Buffer.allocUnsafe(2)

  buf.writeInt16BE(0x0102, 0)

  expect(buf).toEqual(Buffer.from([0x1, 0x2]))
})

test('Buffer.writeInt32LE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeInt32LE(0x05060708, 0)

  expect(buf).toEqual(Buffer.from([0x8, 0x7, 0x6, 0x5]))
})

test('Buffer.writeInt32BE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeInt32BE(0x01020304, 0)

  expect(buf).toEqual(Buffer.from([0x1, 0x2, 0x3, 0x4]))
})

test('Buffer.writeFloatLE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeFloatLE(0xcafebabe, 0)

  expect(buf).toEqual(Buffer.from([0xbb, 0xfe, 0x4a, 0x4f]))
})

test('Buffer.writeFloatBE (example)', () => {
  const buf = Buffer.allocUnsafe(4)

  buf.writeFloatBE(0xcafebabe, 0)

  expect(buf).toEqual(Buffer.from([0x4f, 0x4a, 0xfe, 0xbb]))
})

test('Buffer.writeDoubleLE (example)', () => {
  const buf = Buffer.allocUnsafe(8)

  buf.writeDoubleLE(123.456, 0)

  expect(buf).toEqual(Buffer.from([0x77, 0xbe, 0x9f, 0x1a, 0x2f, 0xdd, 0x5e, 0x40]))
})

test('Buffer.writeDoubleBE (example)', () => {
  const buf = Buffer.allocUnsafe(8)

  buf.writeDoubleBE(123.456, 0)

  expect(buf).toEqual(Buffer.from([0x40, 0x5e, 0xdd, 0x2f, 0x1a, 0x9f, 0xbe, 0x77]))
})

describe('Buffer fill', () => {
  test('should fill the entire buffer with a single character', () => {
    const buf = Buffer.allocUnsafe(50).fill('h')
    expect(buf.toString()).toEqual('h'.repeat(50))
  })

  test('should fill the buffer with a multi-byte character', () => {
    const buf = Buffer.allocUnsafe(5).fill('\u0222')
    expect(buf).toEqual(Buffer.from([0xc8, 0xa2, 0xc8, 0xa2, 0xc8]))
  })

  test('should fill the buffer with a single character', () => {
    const buf = Buffer.allocUnsafe(5).fill('a')
    expect(buf.toString()).toEqual('a'.repeat(5))
  })

  test('should fill the buffer with hexadecimal values', () => {
    const buf = Buffer.allocUnsafe(5).fill('abcd', 0, undefined, 'hex')
    expect(buf).toEqual(Buffer.from([0xab, 0xcd, 0xab, 0xcd, 0xab]))
  })
})

describe('Buffer indexOf', () => {
  test('should find the index of a string', () => {
    const buf = Buffer.from('this is a buffer')
    expect(buf.indexOf('this')).toEqual(0)
    expect(buf.indexOf('is')).toEqual(2)
  })

  test('should find the index of a Buffer', () => {
    const buf = Buffer.from('this is a buffer')
    expect(buf.indexOf(Buffer.from('a buffer'))).toEqual(8)
    expect(buf.indexOf(Buffer.from('a buffer example'))).toEqual(-1)
    expect(buf.indexOf(Buffer.from('a buffer example').slice(0, 8))).toEqual(8)
  })

  test('should find the index of a number', () => {
    const buf = Buffer.from('this is a buffer')
    expect(buf.indexOf(97)).toEqual(8)
  })

  test('should find the index of a string with base64 encoding', () => {
    const buf = Buffer.from(Buffer.from('this is a buffer').toString('base64'), 'base64')
    expect(buf.indexOf(Buffer.from('a buffer', 'base64'))).toBeTruthy()
  })

  test('should coerce non-byte numbers and non-number byteOffsets', () => {
    const b = Buffer.from('abcdef')
    expect(b.indexOf(99.9)).toEqual(2) // 99.9 is coerced to 99
    expect(b.indexOf(256 + 99)).toEqual(2) // 256 + 99 is coerced to 99
    expect(b.indexOf('b', undefined)).toEqual(1) // undefined is coerced to 0
    expect(b.indexOf('b', {} as any)).toEqual(1) // {} is coerced to 0
    expect(b.indexOf('b', null as any)).toEqual(1) // null is coerced to 0
    expect(b.indexOf('b', [] as any)).toEqual(1) // [] is coerced to 0
  })

  test('should return byteOffset or buf.length for empty value', () => {
    const buf = Buffer.from('abcdef')
    expect(buf.indexOf('', 3)).toEqual(3)
    expect(buf.indexOf('', buf.length)).toEqual(buf.length)
    expect(buf.indexOf(Buffer.from(''), 3)).toEqual(3)
    expect(buf.indexOf(Buffer.from(''), buf.length)).toEqual(buf.length)
  })
})

test('Buffer.entries (example)', () => {
  const buf = Buffer.from('buffer')

  const pairs = Array.from(buf.entries())

  expect(pairs).toEqual([
    [0, 98],
    [1, 117],
    [2, 102],
    [3, 102],
    [4, 101],
    [5, 114],
  ])
})

test('Buffer.includes (example)', () => {
  const buf = Buffer.from('this is a buffer')

  expect(buf.includes('this')).toBe(true)
  expect(buf.includes('is')).toBe(true)
  expect(buf.includes(Buffer.from('a buffer'))).toBe(true)
  expect(buf.includes(97)).toBe(true)
  expect(buf.includes(Buffer.from('a buffer example'))).toBe(false)
  expect(buf.includes(Buffer.from('a buffer example').slice(0, 8))).toBe(true)
  expect(buf.includes('this', 4)).toBe(false)
})

test('Buffer.keys (example)', () => {
  const buf = Buffer.from('buffer')

  const keys = Array.from(buf.keys())

  expect(keys).toEqual([0, 1, 2, 3, 4, 5])
})

test('Buffer.values (example)', () => {
  const buf = Buffer.from('buffer')

  const values = Array.from(buf.values())

  expect(values).toEqual([98, 117, 102, 102, 101, 114])
})

test('Buffer.lastIndexOf (example)', () => {
  const buf = Buffer.from('this buffer is a buffer')

  // expect(buf.lastIndexOf('this')).toBe(0)
  expect(buf.lastIndexOf('buffer')).toBe(17)
  expect(buf.lastIndexOf(Buffer.from('buffer'))).toBe(17)
  expect(buf.lastIndexOf(97)).toBe(15)
  expect(buf.lastIndexOf(Buffer.from('yolo'))).toBe(-1)
  expect(buf.lastIndexOf('buffer', 5)).toBe(5)
  expect(buf.lastIndexOf('buffer', 4)).toBe(-1)

  const utf16Buffer = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'utf16le')

  expect(utf16Buffer.lastIndexOf('\u03a3', undefined, 'utf16le')).toBe(6)
  expect(utf16Buffer.lastIndexOf('\u03a3', -5, 'utf16le')).toBe(4)
})

test('Buffer slice (node.js repository test)', () => {
  assert.strictEqual(Buffer.from('hello', 'utf8').slice(0, 0).length, 0)
  assert.strictEqual(Buffer('hello', 'utf8').slice(0, 0).length, 0)

  const buf = Buffer.from('0123456789', 'utf8')
  const expectedSameBufs = [
    [buf.slice(-10, 10), Buffer.from('0123456789', 'utf8')],
    [buf.slice(-20, 10), Buffer.from('0123456789', 'utf8')],
    [buf.slice(-20, -10), Buffer.from('', 'utf8')],
    [buf.slice(), Buffer.from('0123456789', 'utf8')],
    [buf.slice(0), Buffer.from('0123456789', 'utf8')],
    [buf.slice(0, 0), Buffer.from('', 'utf8')],
    [buf.slice(undefined), Buffer.from('0123456789', 'utf8')],
    [buf.slice('foobar' as any), Buffer.from('0123456789', 'utf8')],
    [buf.slice(undefined, undefined), Buffer.from('0123456789', 'utf8')],
    [buf.slice(2), Buffer.from('23456789', 'utf8')],
    [buf.slice(5), Buffer.from('56789', 'utf8')],
    [buf.slice(10), Buffer.from('', 'utf8')],
    [buf.slice(5, 8), Buffer.from('567', 'utf8')],
    [buf.slice(8, -1), Buffer.from('8', 'utf8')],
    [buf.slice(-10), Buffer.from('0123456789', 'utf8')],
    [buf.slice(0, -9), Buffer.from('0', 'utf8')],
    [buf.slice(0, -10), Buffer.from('', 'utf8')],
    [buf.slice(0, -1), Buffer.from('012345678', 'utf8')],
    [buf.slice(2, -2), Buffer.from('234567', 'utf8')],
    [buf.slice(0, 65536), Buffer.from('0123456789', 'utf8')],
    [buf.slice(65536, 0), Buffer.from('', 'utf8')],
    [buf.slice(-5, -8), Buffer.from('', 'utf8')],
    [buf.slice(-5, -3), Buffer.from('56', 'utf8')],
    [buf.slice(-10, 10), Buffer.from('0123456789', 'utf8')],
    [buf.slice('0' as any, '1' as any), Buffer.from('0', 'utf8')],
    [buf.slice('-5' as any, '10' as any), Buffer.from('56789', 'utf8')],
    [buf.slice('-10' as any, '10' as any), Buffer.from('0123456789', 'utf8')],
    [buf.slice('-10' as any, '-5' as any), Buffer.from('01234', 'utf8')],
    [buf.slice('-10' as any, '-0' as any), Buffer.from('', 'utf8')],
    [buf.slice('111' as any), Buffer.from('', 'utf8')],
    [buf.slice('0' as any, '-111' as any), Buffer.from('', 'utf8')],
  ]

  for (let i = 0, s = buf.toString(); i < buf.length; ++i) {
    expectedSameBufs.push(
      [buf.slice(i), Buffer.from(s.slice(i))],
      [buf.slice(0, i), Buffer.from(s.slice(0, i))],
      [buf.slice(-i), Buffer.from(s.slice(-i))],
      [buf.slice(0, -i), Buffer.from(s.slice(0, -i))],
    )
  }

  for (const [buf1, buf2] of expectedSameBufs) {
    assert.strictEqual(Buffer.compare(buf1, buf2), 0)
  }

  const utf16Buf = Buffer.from('0123456789', 'utf16le')
  assert.deepStrictEqual(utf16Buf.slice(0, 6), Buffer.from('012', 'utf16le'))
  // Try to slice a zero length Buffer.
  // See https://github.com/joyent/node/issues/5881
  assert.strictEqual(Buffer.alloc(0).slice(0, 1).length, 0)

  {
    // Single argument slice
    assert.strictEqual(Buffer.from('abcde', 'utf8').slice(1).toString('utf8'), 'bcde')
  }

  // slice(0,0).length === 0
  assert.strictEqual(Buffer.from('hello', 'utf8').slice(0, 0).length, 0)

  {
    // Regression tests for https://github.com/nodejs/node/issues/9096
    const buf = Buffer.from('abcd', 'utf8')
    assert.strictEqual(buf.slice(buf.length / 3).toString('utf8'), 'bcd')
    assert.strictEqual(buf.slice(buf.length / 3, buf.length).toString(), 'bcd')
  }

  {
    const buf = Buffer.from('abcdefg', 'utf8')
    assert.strictEqual(buf.slice(-(-1 >>> 0) - 1).toString('utf8'), buf.toString('utf8'))
  }

  {
    const buf = Buffer.from('abc', 'utf8')
    assert.strictEqual(buf.slice(-0.5).toString('utf8'), buf.toString('utf8'))
  }

  {
    const buf = Buffer.from([
      1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0, 0, 0, 18, 184, 6, 0, 175, 29, 0, 8, 11, 1, 0, 0,
    ])
    const chunk1 = Buffer.from([1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0])
    const chunk2 = Buffer.from([0, 0, 18, 184, 6, 0, 175, 29, 0, 8, 11, 1, 0, 0])
    const middle = buf.length / 2

    assert.deepStrictEqual(buf.slice(0, middle), chunk1)
    assert.deepStrictEqual(buf.slice(middle), chunk2)
  }
})

test('Buffer compare (node.js repository test)', () => {
  const assert = require('assert')

  const b = Buffer.alloc(1, 97)
  const c = Buffer.alloc(1, 99)
  const d = Buffer.alloc(2, 97)
  const e = new Uint8Array([0x61, 0x61]) // ASCII 'aa', same as d

  assert.strictEqual(b.compare(c), -1)
  assert.strictEqual(c.compare(d), 1)
  assert.strictEqual(d.compare(b), 1)
  assert.strictEqual(d.compare(e), 0)
  assert.strictEqual(b.compare(d), -1)
  assert.strictEqual(b.compare(b), 0)

  assert.strictEqual(Buffer.compare(b, c), -1)
  assert.strictEqual(Buffer.compare(c, d), 1)
  assert.strictEqual(Buffer.compare(d, b), 1)
  assert.strictEqual(Buffer.compare(b, d), -1)
  assert.strictEqual(Buffer.compare(c, c), 0)
  assert.strictEqual(Buffer.compare(e, e), 0)
  assert.strictEqual(Buffer.compare(d, e), 0)
  assert.strictEqual(Buffer.compare(d, b), 1)

  assert.strictEqual(Buffer.compare(Buffer.alloc(0), Buffer.alloc(0)), 0)
  assert.strictEqual(Buffer.compare(Buffer.alloc(0), Buffer.alloc(1)), -1)
  assert.strictEqual(Buffer.compare(Buffer.alloc(1), Buffer.alloc(0)), 1)

  assert.throws(() => Buffer.compare(Buffer.alloc(1), 'abc' as any))
  assert.throws(() => Buffer.compare('abc' as any, Buffer.alloc(1)))
  assert.throws(() => Buffer.alloc(1).compare('abc' as any))
})

test('Buffer compare (offset) (node.js repository test)', () => {
  const a = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
  const b = Buffer.from([5, 6, 7, 8, 9, 0, 1, 2, 3, 4])

  assert.strictEqual(a.compare(b), -1)

  // Equivalent to a.compare(b).
  assert.strictEqual(a.compare(b, 0), -1)
  assert.throws(() => a.compare(b, '0' as any))
  assert.strictEqual(a.compare(b, undefined), -1)

  // Equivalent to a.compare(b).
  assert.strictEqual(a.compare(b, 0, undefined, 0), -1)

  // Zero-length target, return 1
  assert.strictEqual(a.compare(b, 0, 0, 0), 1)
  // assert.throws(() => a.compare(b, 0, '0', '0'))

  // Equivalent to Buffer.compare(a, b.slice(6, 10))
  assert.strictEqual(a.compare(b, 6, 10), 1)

  // Zero-length source, return -1
  assert.strictEqual(a.compare(b, 6, 10, 0, 0), -1)

  // Zero-length source and target, return 0
  assert.strictEqual(a.compare(b, 0, 0, 0, 0), 0)
  assert.strictEqual(a.compare(b, 1, 1, 2, 2), 0)

  // Equivalent to Buffer.compare(a.slice(4), b.slice(0, 5))
  assert.strictEqual(a.compare(b, 0, 5, 4), 1)

  // Equivalent to Buffer.compare(a.slice(1), b.slice(5))
  assert.strictEqual(a.compare(b, 5, undefined, 1), 1)

  // Equivalent to Buffer.compare(a.slice(2), b.slice(2, 4))
  assert.strictEqual(a.compare(b, 2, 4, 2), -1)

  // Equivalent to Buffer.compare(a.slice(4), b.slice(0, 7))
  assert.strictEqual(a.compare(b, 0, 7, 4), -1)

  // Equivalent to Buffer.compare(a.slice(4, 6), b.slice(0, 7));
  assert.strictEqual(a.compare(b, 0, 7, 4, 6), -1)

  // Null is ambiguous.
  assert.throws(() => a.compare(b, 0, null as any))

  // Values do not get coerced.
  assert.throws(() => a.compare(b, 0, { valueOf: () => 5 } as any))

  // Infinity should not be coerced.
  assert.throws(() => a.compare(b, Infinity, -Infinity))

  // Zero length target because default for targetEnd <= targetSource
  assert.strictEqual(a.compare(b, 0xff), 1)

  assert.throws(() => a.compare(b, '0xff' as any))
  assert.throws(() => a.compare(b, 0, '0xff' as any))

  assert.throws(() => a.compare(b, 0, 100, 0))
  assert.throws(() => a.compare(b, 0, 1, 0, 100))
  assert.throws(() => a.compare(b, -1))
  assert.throws(() => a.compare(b, 0, Infinity))
  assert.throws(() => a.compare(b, 0, 1, -1))
  assert.throws(() => a.compare(b, -Infinity, Infinity))
  // @ts-expect-error
  assert.throws(() => a.compare())
})

test('Buffer concat (node.js repository test)', () => {
  const zero = [] as Buffer[]
  const one = [Buffer.from('asdf')]
  const long = [] as Buffer[]
  // @ts-expect-error
  for (let i = 0; i < 10; i++) long.push(Buffer.from('asdf'))

  const flatZero = Buffer.concat(zero)
  const flatOne = Buffer.concat(one)
  const flatLong = Buffer.concat(long)
  const flatLongLen = Buffer.concat(long, 40)

  assert.strictEqual(flatZero.length, 0)
  assert.strictEqual(flatOne.toString(), 'asdf')

  const check = 'asdf'.repeat(10)

  // A special case where concat used to return the first item,
  // if the length is one. This check is to make sure that we don't do that.
  assert.notStrictEqual(flatOne, one[0])
  assert.strictEqual(flatLong.toString(), check)
  assert.strictEqual(flatLongLen.toString(), check)

  // assert.throws(() => Buffer.concat([Buffer.from('hello'), 3 as any]))

  const random10 = Buffer.alloc(10).fill(1)
  const empty = Buffer.alloc(0)

  assert.notDeepStrictEqual(random10, empty)
  assert.notDeepStrictEqual(random10, Buffer.alloc(10))

  assert.deepStrictEqual(Buffer.concat([], 100), empty)
  assert.deepStrictEqual(Buffer.concat([random10], 0), empty)
  assert.deepStrictEqual(Buffer.concat([random10], 10), random10)
  assert.deepStrictEqual(Buffer.concat([random10, random10], 10), random10)
  assert.deepStrictEqual(Buffer.concat([empty, random10]), random10)
  assert.deepStrictEqual(Buffer.concat([random10, empty, empty]), random10)

  // The tail should be zero-filled
  assert.deepStrictEqual(Buffer.concat([empty], 100), Buffer.alloc(100))
  assert.deepStrictEqual(Buffer.concat([empty], 4096), Buffer.alloc(4096))
  assert.deepStrictEqual(Buffer.concat([random10], 40), Buffer.concat([random10, Buffer.alloc(30)]))

  assert.deepStrictEqual(
    Buffer.concat([new Uint8Array([0x41, 0x42]), new Uint8Array([0x43, 0x44])]),
    Buffer.from('ABCD'),
  )
})

test('Buffer copy (node.js repository test)', () => {
  const b = Buffer.allocUnsafe(1024)
  const c = Buffer.allocUnsafe(512)

  let cntr = 0

  {
    // copy 512 bytes, from 0 to 512.
    b.fill(++cntr)
    c.fill(++cntr)
    const copied = b.copy(c, 0, 0, 512)
    assert.strictEqual(copied, 512)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(c[i], b[i])
    }
  }

  {
    // Current behavior is to coerce values to integers.
    b.fill(++cntr)
    c.fill(++cntr)
    // @ts-expect-error
    const copied = b.copy(c, '0', '0', '512')
    assert.strictEqual(copied, 512)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(c[i], b[i])
    }
  }

  {
    // Floats will be converted to integers via `Math.floor`
    b.fill(++cntr)
    c.fill(++cntr)
    const copied = b.copy(c, 0, 0, 512.5)
    assert.strictEqual(copied, 512)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(c[i], b[i])
    }
  }

  {
    // Copy c into b, without specifying sourceEnd
    b.fill(++cntr)
    c.fill(++cntr)
    const copied = c.copy(b, 0, 0)
    assert.strictEqual(copied, c.length)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(b[i], c[i])
    }
  }

  {
    // Copy c into b, without specifying sourceStart
    b.fill(++cntr)
    c.fill(++cntr)
    const copied = c.copy(b, 0)
    assert.strictEqual(copied, c.length)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(b[i], c[i])
    }
  }

  {
    // Copied source range greater than source length
    b.fill(++cntr)
    c.fill(++cntr)
    const copied = c.copy(b, 0, 0, c.length + 1)
    assert.strictEqual(copied, c.length)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(b[i], c[i])
    }
  }

  {
    // Copy longer buffer b to shorter c without targetStart
    b.fill(++cntr)
    c.fill(++cntr)

    const copied = b.copy(c)
    assert.strictEqual(copied, c.length)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(c[i], b[i])
    }
  }

  {
    // Copy starting near end of b to c
    b.fill(++cntr)
    c.fill(++cntr)
    const copied = b.copy(c, 0, b.length - Math.floor(c.length / 2))
    assert.strictEqual(copied, Math.floor(c.length / 2))
    for (let i = 0; i < Math.floor(c.length / 2); i++) {
      assert.strictEqual(c[i], b[b.length - Math.floor(c.length / 2) + i])
    }
    for (let i = Math.floor(c.length / 2) + 1; i < c.length; i++) {
      assert.strictEqual(c[c.length - 1], c[i])
    }
  }

  {
    // Try to copy 513 bytes, and check we don't overrun c
    b.fill(++cntr)
    c.fill(++cntr)
    const copied = b.copy(c, 0, 0, 513)
    assert.strictEqual(copied, c.length)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(c[i], b[i])
    }
  }

  {
    // copy 768 bytes from b into b
    b.fill(++cntr)
    b.fill(++cntr, 256)
    const copied = b.copy(b, 0, 256, 1024)
    assert.strictEqual(copied, 768)
    for (let i = 0; i < b.length; i++) {
      assert.strictEqual(b[i], cntr)
    }
  }

  // Copy string longer than buffer length (failure will segfault)
  const bb = Buffer.allocUnsafe(10)
  bb.fill('hello crazy world')

  // Try to copy from before the beginning of b. Should not throw.
  b.copy(c, 0, 100, 10)

  // Throw with invalid source type
  // assert.throws(() => Buffer.prototype.copy.call(0)) ❌

  // Copy throws at negative targetStart
  assert.throws(() => Buffer.allocUnsafe(5).copy(Buffer.allocUnsafe(5), -1, 0))

  // Copy throws at negative sourceStart
  assert.throws(() => Buffer.allocUnsafe(5).copy(Buffer.allocUnsafe(5), 0, -1))

  // Copy throws if sourceStart is greater than length of source
  assert.throws(() => Buffer.allocUnsafe(5).copy(Buffer.allocUnsafe(5), 0, 100))

  {
    // Check sourceEnd resets to targetEnd if former is greater than the latter
    b.fill(++cntr)
    c.fill(++cntr)
    b.copy(c, 0, 0, 1025)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(c[i], b[i])
    }
  }

  // Throw with negative sourceEnd
  assert.throws(() => b.copy(c, 0, 0, -1))

  // When sourceStart is greater than sourceEnd, zero copied
  assert.strictEqual(b.copy(c, 0, 100, 10), 0)

  // When targetStart > targetLength, zero copied
  assert.strictEqual(b.copy(c, 512, 0, 10), 0)

  // Test that the `target` can be a Uint8Array.
  {
    const d = new Uint8Array(c)
    // copy 512 bytes, from 0 to 512.
    b.fill(++cntr)
    d.fill(++cntr)
    const copied = b.copy(d, 0, 0, 512)
    assert.strictEqual(copied, 512)
    for (let i = 0; i < d.length; i++) {
      assert.strictEqual(d[i], b[i])
    }
  }

  // Test that the source can be a Uint8Array, too.
  {
    const e = new Uint8Array(b)
    // copy 512 bytes, from 0 to 512.
    e.fill(++cntr)
    c.fill(++cntr)
    const copied = Buffer.prototype.copy.call(e, c, 0, 0, 512)
    assert.strictEqual(copied, 512)
    for (let i = 0; i < c.length; i++) {
      assert.strictEqual(c[i], e[i])
    }
  }

  {
    // https://github.com/nodejs/node/issues/23668: Do not crash for invalid input.
    c.fill('c')
    // @ts-expect-error
    b.copy(c, 'not a valid offset')
    // Make sure this acted like a regular copy with `0` offset.
    // assert.deepStrictEqual(c, b.slice(0, c.length)) ❌
  }

  {
    c.fill('C')
    assert.throws(() => {
      // @ts-expect-error
      b.copy(c, {
        [Symbol.toPrimitive]() {
          throw new Error('foo')
        },
      })
    }, /foo/)
    // No copying took place:
    assert.deepStrictEqual(c.toString(), 'C'.repeat(c.length))
  }
})

test('Buffer equals (node.js repository test)', () => {
  const b = Buffer.from('abcdf')
  const c = Buffer.from('abcdf')
  const d = Buffer.from('abcde')
  const e = Buffer.from('abcdef')

  assert.ok(b.equals(c))
  assert.ok(!c.equals(d))
  assert.ok(!d.equals(e))
  assert.ok(d.equals(d))
  assert.ok(d.equals(new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x65])))

  assert.throws(() => Buffer.alloc(1).equals('abc' as any))
})

test('Buffer fill (node.js repository test)', () => {
  const SIZE = 28
  const buf1 = Buffer.allocUnsafe(SIZE)
  const buf2 = Buffer.allocUnsafe(SIZE)

  // Default encoding
  testBufs('abc')
  testBufs('\u0222aa')
  testBufs('a\u0234b\u0235c\u0236')
  testBufs('abc', 4)
  testBufs('abc', 5)
  testBufs('abc', SIZE)
  testBufs('\u0222aa', 2)
  testBufs('\u0222aa', 8)
  testBufs('a\u0234b\u0235c\u0236', 4)
  testBufs('a\u0234b\u0235c\u0236', 12)
  testBufs('abc', 4, 1)
  testBufs('abc', 5, 1)
  testBufs('\u0222aa', 8, 1)
  testBufs('a\u0234b\u0235c\u0236', 4, 1)
  testBufs('a\u0234b\u0235c\u0236', 12, 1)

  // UTF8
  testBufs('abc', 'utf8')
  testBufs('\u0222aa', 'utf8')
  testBufs('a\u0234b\u0235c\u0236', 'utf8')
  testBufs('abc', 4, 'utf8')
  testBufs('abc', 5, 'utf8')
  testBufs('abc', SIZE, 'utf8')
  testBufs('\u0222aa', 2, 'utf8')
  testBufs('\u0222aa', 8, 'utf8')
  testBufs('a\u0234b\u0235c\u0236', 4, 'utf8')
  testBufs('a\u0234b\u0235c\u0236', 12, 'utf8')
  testBufs('abc', 4, 1, 'utf8')
  testBufs('abc', 5, 1, 'utf8')
  testBufs('\u0222aa', 8, 1, 'utf8')
  testBufs('a\u0234b\u0235c\u0236', 4, 1, 'utf8')
  testBufs('a\u0234b\u0235c\u0236', 12, 1, 'utf8')
  assert.strictEqual(Buffer.allocUnsafe(1).fill(0).fill('\u0222')[0], 0xc8)

  testBufs('abc', 'binary')
  testBufs('\u0222aa', 'binary')
  testBufs('a\u0234b\u0235c\u0236', 'binary')
  testBufs('abc', 4, 'binary')
  testBufs('abc', 5, 'binary')
  testBufs('abc', SIZE, 'binary')
  testBufs('\u0222aa', 2, 'binary')
  testBufs('\u0222aa', 8, 'binary')
  testBufs('a\u0234b\u0235c\u0236', 4, 'binary')
  testBufs('a\u0234b\u0235c\u0236', 12, 'binary')
  testBufs('abc', 4, 1, 'binary')
  testBufs('abc', 5, 1, 'binary')
  testBufs('\u0222aa', 8, 1, 'binary')
  testBufs('a\u0234b\u0235c\u0236', 4, 1, 'binary')
  testBufs('a\u0234b\u0235c\u0236', 12, 1, 'binary')

  testBufs('abc', 'latin1')
  testBufs('\u0222aa', 'latin1')
  testBufs('a\u0234b\u0235c\u0236', 'latin1')
  testBufs('abc', 4, 'latin1')
  testBufs('abc', 5, 'latin1')
  testBufs('abc', SIZE, 'latin1')
  testBufs('\u0222aa', 2, 'latin1')
  testBufs('\u0222aa', 8, 'latin1')
  testBufs('a\u0234b\u0235c\u0236', 4, 'latin1')
  testBufs('a\u0234b\u0235c\u0236', 12, 'latin1')
  testBufs('abc', 4, 1, 'latin1')
  testBufs('abc', 5, 1, 'latin1')
  testBufs('\u0222aa', 8, 1, 'latin1')
  testBufs('a\u0234b\u0235c\u0236', 4, 1, 'latin1')
  testBufs('a\u0234b\u0235c\u0236', 12, 1, 'latin1')

  testBufs('abc', 'ucs2')
  testBufs('\u0222aa', 'ucs2')
  testBufs('a\u0234b\u0235c\u0236', 'ucs2')
  testBufs('abc', 4, 'ucs2')
  testBufs('abc', SIZE, 'ucs2')
  testBufs('\u0222aa', 2, 'ucs2')
  testBufs('\u0222aa', 8, 'ucs2')
  testBufs('a\u0234b\u0235c\u0236', 4, 'ucs2')
  testBufs('a\u0234b\u0235c\u0236', 12, 'ucs2')
  testBufs('abc', 4, 1, 'ucs2')
  testBufs('abc', 5, 1, 'ucs2')
  testBufs('\u0222aa', 8, 1, 'ucs2')
  testBufs('a\u0234b\u0235c\u0236', 4, 1, 'ucs2')
  testBufs('a\u0234b\u0235c\u0236', 12, 1, 'ucs2')
  assert.strictEqual(Buffer.allocUnsafe(1).fill('\u0222', 'ucs2')[0], 0x22)

  // HEX
  testBufs('616263', 'hex')
  testBufs('c8a26161', 'hex')
  testBufs('61c8b462c8b563c8b6', 'hex')
  testBufs('616263', 4, 'hex')
  testBufs('616263', 5, 'hex')
  testBufs('616263', SIZE, 'hex')
  testBufs('c8a26161', 2, 'hex')
  testBufs('c8a26161', 8, 'hex')
  testBufs('61c8b462c8b563c8b6', 4, 'hex')
  testBufs('61c8b462c8b563c8b6', 12, 'hex')
  testBufs('616263', 4, 1, 'hex')
  testBufs('616263', 5, 1, 'hex')
  testBufs('c8a26161', 8, 1, 'hex')
  testBufs('61c8b462c8b563c8b6', 4, 1, 'hex')
  testBufs('61c8b462c8b563c8b6', 12, 1, 'hex')

  // assert.throws(() => { ❌
  //   const buf = Buffer.allocUnsafe(SIZE)

  //   buf.fill('yKJh', 'hex')
  // })

  // assert.throws(() => { ❌
  //   const buf = Buffer.allocUnsafe(SIZE)

  //   buf.fill('\u0222', 'hex')
  // })

  // BASE64
  testBufs('YWJj', 'base64')
  testBufs('yKJhYQ==', 'base64')
  testBufs('Yci0Ysi1Y8i2', 'base64')
  testBufs('YWJj', 4, 'base64')
  testBufs('YWJj', SIZE, 'base64')
  testBufs('yKJhYQ==', 2, 'base64')
  testBufs('yKJhYQ==', 8, 'base64')
  testBufs('Yci0Ysi1Y8i2', 4, 'base64')
  testBufs('Yci0Ysi1Y8i2', 12, 'base64')
  testBufs('YWJj', 4, 1, 'base64')
  testBufs('YWJj', 5, 1, 'base64')
  testBufs('yKJhYQ==', 8, 1, 'base64')
  testBufs('Yci0Ysi1Y8i2', 4, 1, 'base64')
  testBufs('Yci0Ysi1Y8i2', 12, 1, 'base64')

  // BASE64URL
  testBufs('YWJj', 'base64url')
  testBufs('yKJhYQ', 'base64url')
  testBufs('Yci0Ysi1Y8i2', 'base64url')
  testBufs('YWJj', 4, 'base64url')
  testBufs('YWJj', SIZE, 'base64url')
  testBufs('yKJhYQ', 2, 'base64url')
  testBufs('yKJhYQ', 8, 'base64url')
  testBufs('Yci0Ysi1Y8i2', 4, 'base64url')
  testBufs('Yci0Ysi1Y8i2', 12, 'base64url')
  testBufs('YWJj', 4, 1, 'base64url')
  testBufs('YWJj', 5, 1, 'base64url')
  testBufs('yKJhYQ', 8, 1, 'base64url')
  testBufs('Yci0Ysi1Y8i2', 4, 1, 'base64url')
  testBufs('Yci0Ysi1Y8i2', 12, 1, 'base64url')

  // Buffer
  function deepStrictEqualValues(buf, arr) {
    for (const [index, value] of buf.entries()) {
      assert.deepStrictEqual(value, arr[index])
    }
  }

  const buf2Fill = Buffer.allocUnsafe(1).fill(2)
  deepStrictEqualValues(genBuffer(4, [buf2Fill]), [2, 2, 2, 2])
  deepStrictEqualValues(genBuffer(4, [buf2Fill, 1]), [0, 2, 2, 2])
  deepStrictEqualValues(genBuffer(4, [buf2Fill, 1, 3]), [0, 2, 2, 0])
  deepStrictEqualValues(genBuffer(4, [buf2Fill, 1, 1]), [0, 0, 0, 0])
  const hexBufFill = Buffer.allocUnsafe(2).fill(0).fill('0102', 'hex')
  deepStrictEqualValues(genBuffer(4, [hexBufFill]), [1, 2, 1, 2])
  deepStrictEqualValues(genBuffer(4, [hexBufFill, 1]), [0, 1, 2, 1])
  deepStrictEqualValues(genBuffer(4, [hexBufFill, 1, 3]), [0, 1, 2, 0])
  deepStrictEqualValues(genBuffer(4, [hexBufFill, 1, 1]), [0, 0, 0, 0])

  // Check exceptions
  ;[
    [0, -1],
    [0, 0, buf1.length + 1],
    ['', -1],
    ['', 0, buf1.length + 1],
    ['', 1, -1],
  ].forEach((args) => {
    assert.throws(() => buf1.fill(...args))
  })

  // @ts-expect-error
  assert.throws(() => buf1.fill('a', 0, buf1.length, 'node rocks!'))
  ;[
    ['a', 0, 0, NaN],
    ['a', 0, 0, false],
  ].forEach((args) => {
    // @ts-expect-error
    assert.throws(() => buf1.fill(...args))
  })

  // @ts-expect-error
  assert.throws(() => buf1.fill('a', 0, 0, 'foo'))

  function genBuffer(size, args) {
    const b = Buffer.allocUnsafe(size)
    return b.fill(0).fill.apply(b, args)
  }

  function bufReset() {
    buf1.fill(0)
    buf2.fill(0)
  }

  // This is mostly accurate. Except write() won't write partial bytes to the
  // string while fill() blindly copies bytes into memory. To account for that an
  // error will be thrown if not all the data can be written, and the SIZE has
  // been massaged to work with the input characters.
  function writeToFill(string, offset, end, encoding) {
    if (typeof offset === 'string') {
      encoding = offset
      offset = 0
      end = buf2.length
    } else if (typeof end === 'string') {
      encoding = end
      end = buf2.length
    } else if (end === undefined) {
      end = buf2.length
    }

    // Should never be reached.
    if (offset < 0 || end > buf2.length) throw new Error('Should never be reached')

    if (end <= offset) return buf2

    offset >>>= 0
    end >>>= 0
    assert(offset <= buf2.length)

    // Convert "end" to "length" (which write understands).
    const length = end - offset < 0 ? 0 : end - offset

    let wasZero = false
    do {
      const written = buf2.write(string, offset, length, encoding)
      offset += written
      // Safety check in case write falls into infinite loop.
      if (written === 0) {
        if (wasZero) throw new Error('Could not write all data to Buffer')
        else wasZero = true
      }
    } while (offset < buf2.length)

    return buf2
  }

  function testBufs(string: any, offset?: any, length?: any, encoding?: any) {
    bufReset()
    // @ts-ignore
    // eslint-disable-next-line prefer-spread, prefer-rest-params
    buf1.fill.apply(buf1, arguments)
    // @ts-ignore Swap bytes on BE archs for ucs2 encoding.
    // eslint-disable-next-line prefer-spread, prefer-rest-params
    assert.deepStrictEqual(buf1.fill.apply(buf1, arguments), writeToFill.apply(null, arguments))
  }

  // Make sure these throw.
  assert.throws(() => Buffer.allocUnsafe(8).fill('a', -1))
  assert.throws(() => Buffer.allocUnsafe(8).fill('a', 0, 9))

  // Make sure this doesn't hang indefinitely.
  Buffer.allocUnsafe(8).fill('')
  Buffer.alloc(8, '')

  {
    const buf = Buffer.alloc(64, 10)
    for (let i = 0; i < buf.length; i++) assert.strictEqual(buf[i], 10)

    buf.fill(11, 0, buf.length >> 1)
    for (let i = 0; i < buf.length >> 1; i++) assert.strictEqual(buf[i], 11)
    for (let i = (buf.length >> 1) + 1; i < buf.length; i++) assert.strictEqual(buf[i], 10)

    buf.fill('h')
    for (let i = 0; i < buf.length; i++) assert.strictEqual(buf[i], 'h'.charCodeAt(0))

    buf.fill(0)
    for (let i = 0; i < buf.length; i++) assert.strictEqual(buf[i], 0)

    buf.fill(null as any)
    for (let i = 0; i < buf.length; i++) assert.strictEqual(buf[i], 0)

    buf.fill(1, 16, 32)
    for (let i = 0; i < 16; i++) assert.strictEqual(buf[i], 0)
    for (let i = 16; i < 32; i++) assert.strictEqual(buf[i], 1)
    for (let i = 32; i < buf.length; i++) assert.strictEqual(buf[i], 0)
  }

  {
    const buf = Buffer.alloc(10, 'abc')
    assert.strictEqual(buf.toString(), 'abcabcabca')
    buf.fill('է')
    assert.strictEqual(buf.toString(), 'էէէէէ')
  }

  // Make sure "end" is properly checked, even if it's magically mangled using
  // Symbol.toPrimitive.
  {
    // assert.throws(() => { ❌
    //   const end = {
    //     [Symbol.toPrimitive]() {
    //       return 1
    //     },
    //   }
    //   Buffer.alloc(1).fill(Buffer.alloc(1), 0, end)
    // })
  }

  // Test that bypassing 'length' won't cause an abort.
  // assert.throws(() => { ❌
  //   const buf = Buffer.from('w00t')
  //   Object.defineProperty(buf, 'length', {
  //     value: 1337,
  //     enumerable: true,
  //   })
  //   buf.fill('')
  // })

  assert.deepStrictEqual(
    Buffer.allocUnsafe(16).fill('ab', 'utf16le'),
    Buffer.from('61006200610062006100620061006200', 'hex'),
  )

  assert.deepStrictEqual(
    Buffer.allocUnsafe(15).fill('ab', 'utf16le'),
    Buffer.from('610062006100620061006200610062', 'hex'),
  )

  assert.deepStrictEqual(
    Buffer.allocUnsafe(16).fill('ab', 'utf16le'),
    Buffer.from('61006200610062006100620061006200', 'hex'),
  )
  assert.deepStrictEqual(
    Buffer.allocUnsafe(16).fill('a', 'utf16le'),
    Buffer.from('61006100610061006100610061006100', 'hex'),
  )

  assert.strictEqual(Buffer.allocUnsafeSlow(16).fill('a', 'utf16le').toString('utf16le'), 'a'.repeat(8))
  assert.strictEqual(Buffer.allocUnsafeSlow(16).fill('a', 'latin1').toString('latin1'), 'a'.repeat(16))
  assert.strictEqual(Buffer.allocUnsafe(16).fill('a', 'utf8').toString('utf8'), 'a'.repeat(16))

  assert.strictEqual(Buffer.allocUnsafeSlow(16).fill('Љ', 'utf16le').toString('utf16le'), 'Љ'.repeat(8))
  assert.strictEqual(Buffer.allocUnsafeSlow(16).fill('Љ', 'latin1').toString('latin1'), '\t'.repeat(16))
  assert.strictEqual(Buffer.allocUnsafe(16).fill('Љ', 'utf8').toString('utf8'), 'Љ'.repeat(8))

  // assert.throws(() => { ❌
  //   const buf = Buffer.from('a'.repeat(1000))

  //   buf.fill('This is not correctly encoded', 'hex')
  // })

  {
    const bufEmptyString = Buffer.alloc(5, '')
    assert.strictEqual(bufEmptyString.toString(), '\x00\x00\x00\x00\x00')

    // @ts-expect-error
    const bufEmptyArray = Buffer.alloc(5, [])
    assert.strictEqual(bufEmptyArray.toString(), '\x00\x00\x00\x00\x00')

    const bufEmptyBuffer = Buffer.alloc(5, Buffer.alloc(5))
    assert.strictEqual(bufEmptyBuffer.toString(), '\x00\x00\x00\x00\x00')

    const bufZero = Buffer.alloc(5, 0)
    assert.strictEqual(bufZero.toString(), '\x00\x00\x00\x00\x00')
  }
})

test('Buffer indexOf (node.js repository test)', () => {
  const b = Buffer.from('abcdef')
  const buf_a = Buffer.from('a')
  const buf_bc = Buffer.from('bc')
  const buf_f = Buffer.from('f')
  const buf_z = Buffer.from('z')
  const buf_empty = Buffer.from('')

  const s = 'abcdef'

  assert.strictEqual(b.indexOf('a'), 0)
  assert.strictEqual(b.indexOf('a', 1), -1)
  assert.strictEqual(b.indexOf('a', -1), -1)
  assert.strictEqual(b.indexOf('a', -4), -1)
  assert.strictEqual(b.indexOf('a', -b.length), 0)
  assert.strictEqual(b.indexOf('a', NaN), 0)
  assert.strictEqual(b.indexOf('a', -Infinity), 0)
  assert.strictEqual(b.indexOf('a', Infinity), -1)
  assert.strictEqual(b.indexOf('bc'), 1)
  assert.strictEqual(b.indexOf('bc', 2), -1)
  assert.strictEqual(b.indexOf('bc', -1), -1)
  assert.strictEqual(b.indexOf('bc', -3), -1)
  assert.strictEqual(b.indexOf('bc', -5), 1)
  assert.strictEqual(b.indexOf('bc', NaN), 1)
  assert.strictEqual(b.indexOf('bc', -Infinity), 1)
  assert.strictEqual(b.indexOf('bc', Infinity), -1)
  assert.strictEqual(b.indexOf('f'), b.length - 1)
  assert.strictEqual(b.indexOf('z'), -1)
  assert.strictEqual(b.indexOf(''), 0)
  assert.strictEqual(b.indexOf('', 1), 1)
  assert.strictEqual(b.indexOf('', b.length + 1), b.length)
  assert.strictEqual(b.indexOf('', Infinity), b.length)
  assert.strictEqual(b.indexOf(buf_a), 0)
  assert.strictEqual(b.indexOf(buf_a, 1), -1)
  assert.strictEqual(b.indexOf(buf_a, -1), -1)
  assert.strictEqual(b.indexOf(buf_a, -4), -1)
  assert.strictEqual(b.indexOf(buf_a, -b.length), 0)
  assert.strictEqual(b.indexOf(buf_a, NaN), 0)
  assert.strictEqual(b.indexOf(buf_a, -Infinity), 0)
  assert.strictEqual(b.indexOf(buf_a, Infinity), -1)
  assert.strictEqual(b.indexOf(buf_bc), 1)
  assert.strictEqual(b.indexOf(buf_bc, 2), -1)
  assert.strictEqual(b.indexOf(buf_bc, -1), -1)
  assert.strictEqual(b.indexOf(buf_bc, -3), -1)
  assert.strictEqual(b.indexOf(buf_bc, -5), 1)
  assert.strictEqual(b.indexOf(buf_bc, NaN), 1)
  assert.strictEqual(b.indexOf(buf_bc, -Infinity), 1)
  assert.strictEqual(b.indexOf(buf_bc, Infinity), -1)
  assert.strictEqual(b.indexOf(buf_f), b.length - 1)
  assert.strictEqual(b.indexOf(buf_z), -1)
  assert.strictEqual(b.indexOf(buf_empty), 0)
  assert.strictEqual(b.indexOf(buf_empty, 1), 1)
  assert.strictEqual(b.indexOf(buf_empty, b.length + 1), b.length)
  assert.strictEqual(b.indexOf(buf_empty, Infinity), b.length)
  assert.strictEqual(b.indexOf(0x61), 0)
  assert.strictEqual(b.indexOf(0x61, 1), -1)
  assert.strictEqual(b.indexOf(0x61, -1), -1)
  assert.strictEqual(b.indexOf(0x61, -4), -1)
  assert.strictEqual(b.indexOf(0x61, -b.length), 0)
  assert.strictEqual(b.indexOf(0x61, NaN), 0)
  assert.strictEqual(b.indexOf(0x61, -Infinity), 0)
  assert.strictEqual(b.indexOf(0x61, Infinity), -1)
  assert.strictEqual(b.indexOf(0x0), -1)

  // test offsets
  assert.strictEqual(b.indexOf('d', 2), 3)
  assert.strictEqual(b.indexOf('f', 5), 5)
  assert.strictEqual(b.indexOf('f', -1), 5)
  assert.strictEqual(b.indexOf('f', 6), -1)

  assert.strictEqual(b.indexOf(Buffer.from('d'), 2), 3)
  assert.strictEqual(b.indexOf(Buffer.from('f'), 5), 5)
  assert.strictEqual(b.indexOf(Buffer.from('f'), -1), 5)
  assert.strictEqual(b.indexOf(Buffer.from('f'), 6), -1)

  // assert.strictEqual(Buffer.from('ff').indexOf(Buffer.from('f'), 1, 'ucs2'), -1)

  // Test invalid and uppercase encoding
  assert.strictEqual(b.indexOf('b', 'utf8'), 1)
  // @ts-expect-error
  assert.strictEqual(b.indexOf('b', 'UTF8'), 1)
  // @ts-expect-error
  assert.strictEqual(b.indexOf('62', 'HEX'), 1)
  // @ts-expect-error
  assert.throws(() => b.indexOf('bad', 'enc'))

  // test hex encoding
  assert.strictEqual(Buffer.from(b.toString('hex'), 'hex').indexOf('64', 0, 'hex'), 3)
  assert.strictEqual(Buffer.from(b.toString('hex'), 'hex').indexOf(Buffer.from('64', 'hex'), 0, 'hex'), 3)

  // Test base64 encoding
  assert.strictEqual(Buffer.from(b.toString('base64'), 'base64').indexOf('ZA==', 0, 'base64'), 3)
  assert.strictEqual(Buffer.from(b.toString('base64'), 'base64').indexOf(Buffer.from('ZA==', 'base64'), 0, 'base64'), 3)

  // Test base64url encoding
  assert.strictEqual(Buffer.from(b.toString('base64url'), 'base64url').indexOf('ZA==', 0, 'base64url'), 3)

  // test ascii encoding
  assert.strictEqual(Buffer.from(b.toString('ascii'), 'ascii').indexOf('d', 0, 'ascii'), 3)
  assert.strictEqual(Buffer.from(b.toString('ascii'), 'ascii').indexOf(Buffer.from('d', 'ascii'), 0, 'ascii'), 3)

  // Test latin1 encoding
  assert.strictEqual(Buffer.from(b.toString('latin1'), 'latin1').indexOf('d', 0, 'latin1'), 3)
  assert.strictEqual(Buffer.from(b.toString('latin1'), 'latin1').indexOf(Buffer.from('d', 'latin1'), 0, 'latin1'), 3)
  assert.strictEqual(Buffer.from('aa\u00e8aa', 'latin1').indexOf('\u00e8', 'latin1'), 2)
  assert.strictEqual(Buffer.from('\u00e8', 'latin1').indexOf('\u00e8', 'latin1'), 0)
  assert.strictEqual(Buffer.from('\u00e8', 'latin1').indexOf(Buffer.from('\u00e8', 'latin1'), 'latin1'), 0)

  // Test binary encoding
  assert.strictEqual(Buffer.from(b.toString('binary'), 'binary').indexOf('d', 0, 'binary'), 3)
  assert.strictEqual(Buffer.from(b.toString('binary'), 'binary').indexOf(Buffer.from('d', 'binary'), 0, 'binary'), 3)
  assert.strictEqual(Buffer.from('aa\u00e8aa', 'binary').indexOf('\u00e8', 'binary'), 2)
  assert.strictEqual(Buffer.from('\u00e8', 'binary').indexOf('\u00e8', 'binary'), 0)
  assert.strictEqual(Buffer.from('\u00e8', 'binary').indexOf(Buffer.from('\u00e8', 'binary'), 'binary'), 0)

  // Test optional offset with passed encoding
  assert.strictEqual(Buffer.from('aaaa0').indexOf('30', 'hex'), 4)
  assert.strictEqual(Buffer.from('aaaa00a').indexOf('3030', 'hex'), 4)

  {
    // Test usc2 and utf16le encoding
    ;['ucs2', 'utf16le'].forEach((encoding: any) => {
      const twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', encoding)

      assert.strictEqual(twoByteString.indexOf('\u0395', 4, encoding), 8)
      assert.strictEqual(twoByteString.indexOf('\u03a3', -4, encoding), 6)
      assert.strictEqual(twoByteString.indexOf('\u03a3', -6, encoding), 4)
      assert.strictEqual(twoByteString.indexOf(Buffer.from('\u03a3', encoding), -6, encoding), 4)
      assert.strictEqual(-1, twoByteString.indexOf('\u03a3', -2, encoding))
    })
  }

  const mixedByteStringUcs2 = Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395', 'ucs2')
  assert.strictEqual(mixedByteStringUcs2.indexOf('bc', 0, 'ucs2'), 6)
  assert.strictEqual(mixedByteStringUcs2.indexOf('\u03a3', 0, 'ucs2'), 10)
  assert.strictEqual(-1, mixedByteStringUcs2.indexOf('\u0396', 0, 'ucs2'))

  assert.strictEqual(mixedByteStringUcs2.indexOf(Buffer.from('bc', 'ucs2'), 0, 'ucs2'), 6)
  assert.strictEqual(mixedByteStringUcs2.indexOf(Buffer.from('\u03a3', 'ucs2'), 0, 'ucs2'), 10)
  assert.strictEqual(-1, mixedByteStringUcs2.indexOf(Buffer.from('\u0396', 'ucs2'), 0, 'ucs2'))

  {
    const twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'ucs2')

    // Test single char pattern
    assert.strictEqual(twoByteString.indexOf('\u039a', 0, 'ucs2'), 0)
    let index = twoByteString.indexOf('\u0391', 0, 'ucs2')
    assert.strictEqual(index, 2, `Alpha - at index ${index}`)
    index = twoByteString.indexOf('\u03a3', 0, 'ucs2')
    assert.strictEqual(index, 4, `First Sigma - at index ${index}`)
    index = twoByteString.indexOf('\u03a3', 6, 'ucs2')
    assert.strictEqual(index, 6, `Second Sigma - at index ${index}`)
    index = twoByteString.indexOf('\u0395', 0, 'ucs2')
    assert.strictEqual(index, 8, `Epsilon - at index ${index}`)
    index = twoByteString.indexOf('\u0392', 0, 'ucs2')
    assert.strictEqual(-1, index, `Not beta - at index ${index}`)

    // Test multi-char pattern
    index = twoByteString.indexOf('\u039a\u0391', 0, 'ucs2')
    assert.strictEqual(index, 0, `Lambda Alpha - at index ${index}`)
    index = twoByteString.indexOf('\u0391\u03a3', 0, 'ucs2')
    assert.strictEqual(index, 2, `Alpha Sigma - at index ${index}`)
    index = twoByteString.indexOf('\u03a3\u03a3', 0, 'ucs2')
    assert.strictEqual(index, 4, `Sigma Sigma - at index ${index}`)
    index = twoByteString.indexOf('\u03a3\u0395', 0, 'ucs2')
    assert.strictEqual(index, 6, `Sigma Epsilon - at index ${index}`)
  }

  const mixedByteStringUtf8 = Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395')
  assert.strictEqual(mixedByteStringUtf8.indexOf('bc'), 5)
  assert.strictEqual(mixedByteStringUtf8.indexOf('bc', 5), 5)
  assert.strictEqual(mixedByteStringUtf8.indexOf('bc', -8), 5)
  assert.strictEqual(mixedByteStringUtf8.indexOf('\u03a3'), 7)
  assert.strictEqual(mixedByteStringUtf8.indexOf('\u0396'), -1)

  // Test complex string indexOf algorithms. Only trigger for long strings.
  // Long string that isn't a simple repeat of a shorter string.
  let longString = 'A'
  for (let i = 66; i < 76; i++) {
    // from 'B' to 'K'
    longString = longString + String.fromCharCode(i) + longString
  }

  const longBufferString = Buffer.from(longString)

  // Pattern of 15 chars, repeated every 16 chars in long
  let pattern: string | Uint8Array = 'ABACABADABACABA'
  for (let i = 0; i < longBufferString.length - pattern.length; i += 7) {
    const index = longBufferString.indexOf(pattern, i)
    assert.strictEqual((i + 15) & ~0xf, index, `Long ABACABA...-string at index ${i}`)
  }

  let index = longBufferString.indexOf('AJABACA')
  assert.strictEqual(index, 510, `Long AJABACA, First J - at index ${index}`)
  index = longBufferString.indexOf('AJABACA', 511)
  assert.strictEqual(index, 1534, `Long AJABACA, Second J - at index ${index}`)

  pattern = 'JABACABADABACABA'
  index = longBufferString.indexOf(pattern)
  assert.strictEqual(index, 511, `Long JABACABA..., First J - at index ${index}`)
  index = longBufferString.indexOf(pattern, 512)
  assert.strictEqual(index, 1535, `Long JABACABA..., Second J - at index ${index}`)

  // Search for a non-ASCII string in a pure ASCII string.
  const asciiString = Buffer.from('arglebargleglopglyfarglebargleglopglyfarglebargleglopglyf')
  assert.strictEqual(-1, asciiString.indexOf('\x2061'))
  assert.strictEqual(asciiString.indexOf('leb', 0), 3)

  // Search in string containing many non-ASCII chars.
  const allCodePoints = [] as number[]
  for (let i = 0; i < 65534; i++) allCodePoints[i] = i
  // eslint-disable-next-line prefer-spread
  const allCharsString = String.fromCharCode.apply(String, allCodePoints) + String.fromCharCode(65534, 65535)
  const allCharsBufferUtf8 = Buffer.from(allCharsString)
  const allCharsBufferUcs2 = Buffer.from(allCharsString, 'ucs2')

  // Search for string long enough to trigger complex search with ASCII pattern
  // and UC16 subject.
  assert.strictEqual(-1, allCharsBufferUtf8.indexOf('notfound'))
  assert.strictEqual(-1, allCharsBufferUcs2.indexOf('notfound'))

  // Needle is longer than haystack, but only because it's encoded as UTF-16
  assert.strictEqual(Buffer.from('aaaa').indexOf('a'.repeat(4), 'ucs2'), -1)

  assert.strictEqual(Buffer.from('aaaa').indexOf('a'.repeat(4), 'utf8'), 0)
  assert.strictEqual(Buffer.from('aaaa').indexOf('你好', 'ucs2'), -1)

  // Haystack has odd length, but the needle is UCS2.
  assert.strictEqual(Buffer.from('aaaaa').indexOf('b', 'ucs2'), -1)

  {
    // Find substrings in Utf8.
    const lengths = [1, 3, 15] // Single char, simple and complex.
    const indices = [0x5, 0x60, 0x400, 0x680, 0x7ee, 0xff02, 0x16610, 0x2f77b]
    for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
      for (let i = 0; i < indices.length; i++) {
        const index = indices[i]
        let length = lengths[lengthIndex]

        if (index + length > 0x7f) {
          length = 2 * length
        }

        if (index + length > 0x7ff) {
          length = 3 * length
        }

        if (index + length > 0xffff) {
          length = 4 * length
        }

        const patternBufferUtf8 = allCharsBufferUtf8.slice(index, index + length)
        assert.strictEqual(index, allCharsBufferUtf8.indexOf(patternBufferUtf8))

        const patternStringUtf8 = patternBufferUtf8.toString()
        assert.strictEqual(index, allCharsBufferUtf8.indexOf(patternStringUtf8))
      }
    }
  }

  {
    // Find substrings in Usc2.
    const lengths = [2, 4, 16] // Single char, simple and complex.
    const indices = [0x5, 0x65, 0x105, 0x205, 0x285, 0x2005, 0x2085, 0xfff0]
    for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
      for (let i = 0; i < indices.length; i++) {
        const index = indices[i] * 2
        const length = lengths[lengthIndex]

        const patternBufferUcs2 = allCharsBufferUcs2.slice(index, index + length)
        // assert.strictEqual(index, allCharsBufferUcs2.indexOf(patternBufferUcs2, 0, 'ucs2')) ❌

        const patternStringUcs2 = patternBufferUcs2.toString('ucs2')
        // assert.strictEqual(index, allCharsBufferUcs2.indexOf(patternStringUcs2, 0, 'ucs2')) ❌
      }
    }
  }

  ;[() => {}, {}, []].forEach((val) => {
    // assert.throws(() => b.indexOf(val), {
    //   code: 'ERR_INVALID_ARG_TYPE',
    //   name: 'TypeError',
    //   message:
    //     'The "value" argument must be one of type number or string ' +
    //     'or an instance of Buffer or Uint8Array.' +
    //     common.invalidArgTypeHelper(val),
    // })
  })

  // Test weird offset arguments.
  // The following offsets coerce to NaN or 0, searching the whole Buffer
  assert.strictEqual(b.indexOf('b', undefined), 1)
  assert.strictEqual(b.indexOf('b', {} as any), 1)
  assert.strictEqual(b.indexOf('b', 0), 1)
  assert.strictEqual(b.indexOf('b', null as any), 1)
  assert.strictEqual(b.indexOf('b', [] as any), 1)

  // The following offset coerces to 2, in other words +[2] === 2
  // assert.strictEqual(b.indexOf('b', [2]), -1) ❌

  // Behavior should match String.indexOf()
  assert.strictEqual(b.indexOf('b', undefined), s.indexOf('b', undefined))
  assert.strictEqual(b.indexOf('b', {} as any), s.indexOf('b', {} as any))
  assert.strictEqual(b.indexOf('b', 0), s.indexOf('b', 0))
  assert.strictEqual(b.indexOf('b', null as any), s.indexOf('b', null as any))
  assert.strictEqual(b.indexOf('b', [] as any), s.indexOf('b', [] as any))
  // assert.strictEqual(b.indexOf('b', [2]), s.indexOf('b', [2])) ❌

  // All code for handling encodings is shared between Buffer.indexOf and
  // Buffer.lastIndexOf, so only testing the separate lastIndexOf semantics.

  // Test lastIndexOf basic functionality; Buffer b contains 'abcdef'.
  // lastIndexOf string:
  assert.strictEqual(b.lastIndexOf('a'), 0)
  assert.strictEqual(b.lastIndexOf('a', 1), 0)
  assert.strictEqual(b.lastIndexOf('b', 1), 1)
  assert.strictEqual(b.lastIndexOf('c', 1), -1)
  assert.strictEqual(b.lastIndexOf('a', -1), 0)
  assert.strictEqual(b.lastIndexOf('a', -4), 0)
  assert.strictEqual(b.lastIndexOf('a', -b.length), 0)
  assert.strictEqual(b.lastIndexOf('a', -b.length - 1), -1)
  assert.strictEqual(b.lastIndexOf('a', NaN), 0)
  assert.strictEqual(b.lastIndexOf('a', -Infinity), -1)
  assert.strictEqual(b.lastIndexOf('a', Infinity), 0)
  // lastIndexOf Buffer:
  assert.strictEqual(b.lastIndexOf(buf_a), 0)
  assert.strictEqual(b.lastIndexOf(buf_a, 1), 0)
  assert.strictEqual(b.lastIndexOf(buf_a, -1), 0)
  assert.strictEqual(b.lastIndexOf(buf_a, -4), 0)
  assert.strictEqual(b.lastIndexOf(buf_a, -b.length), 0)
  assert.strictEqual(b.lastIndexOf(buf_a, -b.length - 1), -1)
  assert.strictEqual(b.lastIndexOf(buf_a, NaN), 0)
  assert.strictEqual(b.lastIndexOf(buf_a, -Infinity), -1)
  assert.strictEqual(b.lastIndexOf(buf_a, Infinity), 0)
  assert.strictEqual(b.lastIndexOf(buf_bc), 1)
  assert.strictEqual(b.lastIndexOf(buf_bc, 2), 1)
  assert.strictEqual(b.lastIndexOf(buf_bc, -1), 1)
  assert.strictEqual(b.lastIndexOf(buf_bc, -3), 1)
  assert.strictEqual(b.lastIndexOf(buf_bc, -5), 1)
  assert.strictEqual(b.lastIndexOf(buf_bc, -6), -1)
  assert.strictEqual(b.lastIndexOf(buf_bc, NaN), 1)
  assert.strictEqual(b.lastIndexOf(buf_bc, -Infinity), -1)
  assert.strictEqual(b.lastIndexOf(buf_bc, Infinity), 1)
  assert.strictEqual(b.lastIndexOf(buf_f), b.length - 1)
  assert.strictEqual(b.lastIndexOf(buf_z), -1)
  assert.strictEqual(b.lastIndexOf(buf_empty), b.length)
  assert.strictEqual(b.lastIndexOf(buf_empty, 1), 1)
  assert.strictEqual(b.lastIndexOf(buf_empty, b.length + 1), b.length)
  assert.strictEqual(b.lastIndexOf(buf_empty, Infinity), b.length)
  // lastIndexOf number:
  assert.strictEqual(b.lastIndexOf(0x61), 0)
  assert.strictEqual(b.lastIndexOf(0x61, 1), 0)
  assert.strictEqual(b.lastIndexOf(0x61, -1), 0)
  assert.strictEqual(b.lastIndexOf(0x61, -4), 0)
  assert.strictEqual(b.lastIndexOf(0x61, -b.length), 0)
  assert.strictEqual(b.lastIndexOf(0x61, -b.length - 1), -1)
  assert.strictEqual(b.lastIndexOf(0x61, NaN), 0)
  assert.strictEqual(b.lastIndexOf(0x61, -Infinity), -1)
  assert.strictEqual(b.lastIndexOf(0x61, Infinity), 0)
  assert.strictEqual(b.lastIndexOf(0x0), -1)

  // Test weird offset arguments.
  // The following offsets coerce to NaN, searching the whole Buffer
  assert.strictEqual(b.lastIndexOf('b', undefined), 1)
  assert.strictEqual(b.lastIndexOf('b', {} as any), 1)

  // The following offsets coerce to 0
  assert.strictEqual(b.lastIndexOf('b', 0), -1)
  // assert.strictEqual(b.lastIndexOf('b', null), -1) ❌
  // assert.strictEqual(b.lastIndexOf('b', []), -1)

  // The following offset coerces to 2, in other words +[2] === 2
  // assert.strictEqual(b.lastIndexOf('b', [2]), 1) ❌

  // Behavior should match String.lastIndexOf()
  assert.strictEqual(b.lastIndexOf('b', undefined), s.lastIndexOf('b', undefined))
  assert.strictEqual(b.lastIndexOf('b', {} as any), s.lastIndexOf('b', {} as any))
  assert.strictEqual(b.lastIndexOf('b', 0), s.lastIndexOf('b', 0))
  // assert.strictEqual(b.lastIndexOf('b', null), s.lastIndexOf('b', null)) ❌
  // assert.strictEqual(b.lastIndexOf('b', []), s.lastIndexOf('b', [])) ❌
  // assert.strictEqual(b.lastIndexOf('b', [2]), s.lastIndexOf('b', [2])) ❌

  // Test needles longer than the haystack.
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'ucs2'), -1)
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'utf8'), -1)
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'latin1'), -1)
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 'binary'), -1)
  assert.strictEqual(b.lastIndexOf(Buffer.from('aaaaaaaaaaaaaaa')), -1)
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 2, 'ucs2'), -1)
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 3, 'utf8'), -1)
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 5, 'latin1'), -1)
  assert.strictEqual(b.lastIndexOf('aaaaaaaaaaaaaaa', 5, 'binary'), -1)
  assert.strictEqual(b.lastIndexOf(Buffer.from('aaaaaaaaaaaaaaa'), 7), -1)

  // 你好 expands to a total of 6 bytes using UTF-8 and 4 bytes using UTF-16
  assert.strictEqual(buf_bc.lastIndexOf('你好', 'ucs2'), -1)
  assert.strictEqual(buf_bc.lastIndexOf('你好', 'utf8'), -1)
  assert.strictEqual(buf_bc.lastIndexOf('你好', 'latin1'), -1)
  assert.strictEqual(buf_bc.lastIndexOf('你好', 'binary'), -1)
  assert.strictEqual(buf_bc.lastIndexOf(Buffer.from('你好')), -1)
  assert.strictEqual(buf_bc.lastIndexOf('你好', 2, 'ucs2'), -1)
  assert.strictEqual(buf_bc.lastIndexOf('你好', 3, 'utf8'), -1)
  assert.strictEqual(buf_bc.lastIndexOf('你好', 5, 'latin1'), -1)
  assert.strictEqual(buf_bc.lastIndexOf('你好', 5, 'binary'), -1)
  assert.strictEqual(buf_bc.lastIndexOf(Buffer.from('你好'), 7), -1)

  // Test lastIndexOf on a longer buffer:
  const bufferString = Buffer.from('a man a plan a canal panama')
  assert.strictEqual(bufferString.lastIndexOf('canal'), 15)
  assert.strictEqual(bufferString.lastIndexOf('panama'), 21)
  assert.strictEqual(bufferString.lastIndexOf('a man a plan a canal panama'), 0)
  assert.strictEqual(-1, bufferString.lastIndexOf('a man a plan a canal mexico'))
  assert.strictEqual(-1, bufferString.lastIndexOf('a man a plan a canal mexico city'))
  assert.strictEqual(-1, bufferString.lastIndexOf(Buffer.from('a'.repeat(1000))))
  assert.strictEqual(bufferString.lastIndexOf('a man a plan', 4), 0)
  assert.strictEqual(bufferString.lastIndexOf('a '), 13)
  assert.strictEqual(bufferString.lastIndexOf('a ', 13), 13)
  assert.strictEqual(bufferString.lastIndexOf('a ', 12), 6)
  assert.strictEqual(bufferString.lastIndexOf('a ', 5), 0)
  assert.strictEqual(bufferString.lastIndexOf('a ', -1), 13)
  assert.strictEqual(bufferString.lastIndexOf('a ', -27), 0)
  assert.strictEqual(-1, bufferString.lastIndexOf('a ', -28))

  // Test lastIndexOf for the case that the first character can be found,
  // but in a part of the buffer that does not make search to search
  // due do length constraints.
  const abInUCS2 = Buffer.from('ab', 'ucs2')
  assert.strictEqual(-1, Buffer.from('µaaaa¶bbbb', 'latin1').lastIndexOf('µ'))
  assert.strictEqual(-1, Buffer.from('µaaaa¶bbbb', 'binary').lastIndexOf('µ'))
  assert.strictEqual(-1, Buffer.from('bc').lastIndexOf('ab'))
  assert.strictEqual(-1, Buffer.from('abc').lastIndexOf('qa'))
  assert.strictEqual(-1, Buffer.from('abcdef').lastIndexOf('qabc'))
  assert.strictEqual(-1, Buffer.from('bc').lastIndexOf(Buffer.from('ab')))
  assert.strictEqual(-1, Buffer.from('bc', 'ucs2').lastIndexOf('ab', 'ucs2'))
  assert.strictEqual(-1, Buffer.from('bc', 'ucs2').lastIndexOf(abInUCS2))

  assert.strictEqual(Buffer.from('abc').lastIndexOf('ab'), 0)
  assert.strictEqual(Buffer.from('abc').lastIndexOf('ab', 1), 0)
  assert.strictEqual(Buffer.from('abc').lastIndexOf('ab', 2), 0)
  assert.strictEqual(Buffer.from('abc').lastIndexOf('ab', 3), 0)

  // The above tests test the LINEAR and SINGLE-CHAR strategies.
  // Now, we test the BOYER-MOORE-HORSPOOL strategy.
  // Test lastIndexOf on a long buffer w multiple matches:
  pattern = 'JABACABADABACABA'
  assert.strictEqual(longBufferString.lastIndexOf(pattern), 1535)
  assert.strictEqual(longBufferString.lastIndexOf(pattern, 1535), 1535)
  assert.strictEqual(longBufferString.lastIndexOf(pattern, 1534), 511)

  // Finally, give it a really long input to trigger fallback from BMH to
  // regular BOYER-MOORE (which has better worst-case complexity).

  // Generate a really long Thue-Morse sequence of 'yolo' and 'swag',
  // "yolo swag swag yolo swag yolo yolo swag" ..., goes on for about 5MB.
  // This is hard to search because it all looks similar, but never repeats.

  // countBits returns the number of bits in the binary representation of n.
  function countBits(n) {
    let count
    for (count = 0; n > 0; count++) {
      n = n & (n - 1) // remove top bit
    }
    return count
  }
  const parts = []
  for (let i = 0; i < 1000000; i++) {
    // @ts-ignore
    parts.push(countBits(i) % 2 === 0 ? 'yolo' : 'swag')
  }
  const reallyLong = Buffer.from(parts.join(' '))
  assert.strictEqual(reallyLong.slice(0, 19).toString(), 'yolo swag swag yolo')

  // Expensive reverse searches. Stress test lastIndexOf:
  pattern = reallyLong.slice(0, 100000) // First 1/50th of the pattern.
  assert.strictEqual(reallyLong.lastIndexOf(pattern), 4751360)
  assert.strictEqual(reallyLong.lastIndexOf(pattern, 4000000), 3932160)
  assert.strictEqual(reallyLong.lastIndexOf(pattern, 3000000), 2949120)
  pattern = reallyLong.slice(100000, 200000) // Second 1/50th.
  assert.strictEqual(reallyLong.lastIndexOf(pattern), 4728480)
  pattern = reallyLong.slice(0, 1000000) // First 1/5th.
  assert.strictEqual(reallyLong.lastIndexOf(pattern), 3932160)
  pattern = reallyLong.slice(0, 2000000) // first 2/5ths.
  assert.strictEqual(reallyLong.lastIndexOf(pattern), 0)

  // Test truncation of Number arguments to uint8
  {
    const buf = Buffer.from('this is a test')
    assert.strictEqual(buf.indexOf(0x6973), 3)
    assert.strictEqual(buf.indexOf(0x697320), 4)
    assert.strictEqual(buf.indexOf(0x69732069), 2)
    assert.strictEqual(buf.indexOf(0x697374657374), 0)
    assert.strictEqual(buf.indexOf(0x69737374), 0)
    assert.strictEqual(buf.indexOf(0x69737465), 11)
    assert.strictEqual(buf.indexOf(0x69737465), 11)
    assert.strictEqual(buf.indexOf(-140), 0)
    assert.strictEqual(buf.indexOf(-152), 1)
    assert.strictEqual(buf.indexOf(0xff), -1)
    assert.strictEqual(buf.indexOf(0xffff), -1)
  }

  // Test that Uint8Array arguments are okay.
  {
    const needle = new Uint8Array([0x66, 0x6f, 0x6f])
    const haystack = Buffer.from('a foo b foo')
    assert.strictEqual(haystack.indexOf(needle), 2)
    assert.strictEqual(haystack.lastIndexOf(needle), haystack.length - 3)
  }

  // Avoid abort because of invalid usage
  // see https://github.com/nodejs/node/issues/32753
  {
    assert.throws(
      () => {
        const buffer = require('buffer')
        new buffer.Buffer.prototype.lastIndexOf(1, 'str')
      },
      {
        code: 'ERR_INVALID_ARG_TYPE',
        name: 'TypeError',
        message:
          'The "buffer" argument must be an instance of Buffer, ' +
          'TypedArray, or DataView. ' +
          'Received an instance of lastIndexOf',
      },
    )
  }
})

test('Buffer includes (node.js repository test)', () => {
  const b = Buffer.from('abcdef')
  const buf_a = Buffer.from('a')
  const buf_bc = Buffer.from('bc')
  const buf_f = Buffer.from('f')
  const buf_z = Buffer.from('z')
  const buf_empty = Buffer.from('')

  assert(b.includes('a'))
  assert(!b.includes('a', 1))
  assert(!b.includes('a', -1))
  assert(!b.includes('a', -4))
  assert(b.includes('a', -b.length))
  assert(b.includes('a', NaN))
  assert(b.includes('a', -Infinity))
  assert(!b.includes('a', Infinity))
  assert(b.includes('bc'))
  assert(!b.includes('bc', 2))
  assert(!b.includes('bc', -1))
  assert(!b.includes('bc', -3))
  assert(b.includes('bc', -5))
  assert(b.includes('bc', NaN))
  assert(b.includes('bc', -Infinity))
  assert(!b.includes('bc', Infinity))
  // @ts-expect-error
  assert(b.includes('f'), b.length - 1)
  assert(!b.includes('z'))
  assert(b.includes(''))
  assert(b.includes('', 1))
  assert(b.includes('', b.length + 1))
  assert(b.includes('', Infinity))
  assert(b.includes(buf_a))
  assert(!b.includes(buf_a, 1))
  assert(!b.includes(buf_a, -1))
  assert(!b.includes(buf_a, -4))
  assert(b.includes(buf_a, -b.length))
  assert(b.includes(buf_a, NaN))
  assert(b.includes(buf_a, -Infinity))
  assert(!b.includes(buf_a, Infinity))
  assert(b.includes(buf_bc))
  assert(!b.includes(buf_bc, 2))
  assert(!b.includes(buf_bc, -1))
  assert(!b.includes(buf_bc, -3))
  assert(b.includes(buf_bc, -5))
  assert(b.includes(buf_bc, NaN))
  assert(b.includes(buf_bc, -Infinity))
  assert(!b.includes(buf_bc, Infinity))
  // @ts-expect-error
  assert(b.includes(buf_f), b.length - 1)
  assert(!b.includes(buf_z))
  assert(b.includes(buf_empty))
  assert(b.includes(buf_empty, 1))
  assert(b.includes(buf_empty, b.length + 1))
  assert(b.includes(buf_empty, Infinity))
  assert(b.includes(0x61))
  assert(!b.includes(0x61, 1))
  assert(!b.includes(0x61, -1))
  assert(!b.includes(0x61, -4))
  assert(b.includes(0x61, -b.length))
  assert(b.includes(0x61, NaN))
  assert(b.includes(0x61, -Infinity))
  assert(!b.includes(0x61, Infinity))
  assert(!b.includes(0x0))

  // test offsets
  assert(b.includes('d', 2))
  assert(b.includes('f', 5))
  assert(b.includes('f', -1))
  assert(!b.includes('f', 6))

  assert(b.includes(Buffer.from('d'), 2))
  assert(b.includes(Buffer.from('f'), 5))
  assert(b.includes(Buffer.from('f'), -1))
  assert(!b.includes(Buffer.from('f'), 6))

  // assert(!Buffer.from('ff').includes(Buffer.from('f'), 1, 'ucs2')) ❌

  // test hex encoding
  assert.strictEqual(Buffer.from(b.toString('hex'), 'hex').includes('64', 0, 'hex'), true)
  assert.strictEqual(Buffer.from(b.toString('hex'), 'hex').includes(Buffer.from('64', 'hex'), 0, 'hex'), true)

  // Test base64 encoding
  assert.strictEqual(Buffer.from(b.toString('base64'), 'base64').includes('ZA==', 0, 'base64'), true)
  assert.strictEqual(
    Buffer.from(b.toString('base64'), 'base64').includes(Buffer.from('ZA==', 'base64'), 0, 'base64'),
    true,
  )

  // test ascii encoding
  assert.strictEqual(Buffer.from(b.toString('ascii'), 'ascii').includes('d', 0, 'ascii'), true)
  assert.strictEqual(Buffer.from(b.toString('ascii'), 'ascii').includes(Buffer.from('d', 'ascii'), 0, 'ascii'), true)

  // Test latin1 encoding
  assert.strictEqual(Buffer.from(b.toString('latin1'), 'latin1').includes('d', 0, 'latin1'), true)
  assert.strictEqual(
    Buffer.from(b.toString('latin1'), 'latin1').includes(Buffer.from('d', 'latin1'), 0, 'latin1'),
    true,
  )

  // Test binary encoding
  assert.strictEqual(Buffer.from(b.toString('binary'), 'binary').includes('d', 0, 'binary'), true)
  assert.strictEqual(
    Buffer.from(b.toString('binary'), 'binary').includes(Buffer.from('d', 'binary'), 0, 'binary'),
    true,
  )

  // test ucs2 encoding
  let twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'ucs2')

  assert(twoByteString.includes('\u0395', 4, 'ucs2'))
  assert(twoByteString.includes('\u03a3', -4, 'ucs2'))
  assert(twoByteString.includes('\u03a3', -6, 'ucs2'))
  assert(twoByteString.includes(Buffer.from('\u03a3', 'ucs2'), -6, 'ucs2'))
  assert(!twoByteString.includes('\u03a3', -2, 'ucs2'))

  const mixedByteStringUcs2 = Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395', 'ucs2')
  assert(mixedByteStringUcs2.includes('bc', 0, 'ucs2'))
  assert(mixedByteStringUcs2.includes('\u03a3', 0, 'ucs2'))
  assert(!mixedByteStringUcs2.includes('\u0396', 0, 'ucs2'))

  assert.ok(mixedByteStringUcs2.includes(Buffer.from('bc', 'ucs2'), 0, 'ucs2'))
  assert.ok(mixedByteStringUcs2.includes(Buffer.from('\u03a3', 'ucs2'), 0, 'ucs2'))
  assert.ok(!mixedByteStringUcs2.includes(Buffer.from('\u0396', 'ucs2'), 0, 'ucs2'))

  twoByteString = Buffer.from('\u039a\u0391\u03a3\u03a3\u0395', 'ucs2')

  // Test single char pattern
  assert(twoByteString.includes('\u039a', 0, 'ucs2'))
  assert(twoByteString.includes('\u0391', 0, 'ucs2'), 'Alpha')
  assert(twoByteString.includes('\u03a3', 0, 'ucs2'), 'First Sigma')
  assert(twoByteString.includes('\u03a3', 6, 'ucs2'), 'Second Sigma')
  assert(twoByteString.includes('\u0395', 0, 'ucs2'), 'Epsilon')
  assert(!twoByteString.includes('\u0392', 0, 'ucs2'), 'Not beta')

  // Test multi-char pattern
  assert(twoByteString.includes('\u039a\u0391', 0, 'ucs2'), 'Lambda Alpha')
  assert(twoByteString.includes('\u0391\u03a3', 0, 'ucs2'), 'Alpha Sigma')
  assert(twoByteString.includes('\u03a3\u03a3', 0, 'ucs2'), 'Sigma Sigma')
  assert(twoByteString.includes('\u03a3\u0395', 0, 'ucs2'), 'Sigma Epsilon')

  const mixedByteStringUtf8 = Buffer.from('\u039a\u0391abc\u03a3\u03a3\u0395')
  assert(mixedByteStringUtf8.includes('bc'))
  assert(mixedByteStringUtf8.includes('bc', 5))
  assert(mixedByteStringUtf8.includes('bc', -8))
  assert(mixedByteStringUtf8.includes('\u03a3'))
  assert(!mixedByteStringUtf8.includes('\u0396'))

  // Test complex string includes algorithms. Only trigger for long strings.
  // Long string that isn't a simple repeat of a shorter string.
  let longString = 'A'
  for (let i = 66; i < 76; i++) {
    // from 'B' to 'K'
    longString = longString + String.fromCharCode(i) + longString
  }

  const longBufferString = Buffer.from(longString)

  // Pattern of 15 chars, repeated every 16 chars in long
  let pattern = 'ABACABADABACABA'
  for (let i = 0; i < longBufferString.length - pattern.length; i += 7) {
    const includes = longBufferString.includes(pattern, i)
    assert(includes, `Long ABACABA...-string at index ${i}`)
  }
  assert(longBufferString.includes('AJABACA'), 'Long AJABACA, First J')
  assert(longBufferString.includes('AJABACA', 511), 'Long AJABACA, Second J')

  pattern = 'JABACABADABACABA'
  assert(longBufferString.includes(pattern), 'Long JABACABA..., First J')
  assert(longBufferString.includes(pattern, 512), 'Long JABACABA..., Second J')

  // Search for a non-ASCII string in a pure ASCII string.
  const asciiString = Buffer.from('arglebargleglopglyfarglebargleglopglyfarglebargleglopglyf')
  assert(!asciiString.includes('\x2061'))
  assert(asciiString.includes('leb', 0))

  // Search in string containing many non-ASCII chars.
  const allCodePoints = [] as number[]
  for (let i = 0; i < 65534; i++) allCodePoints[i] = i
  // eslint-disable-next-line prefer-spread
  const allCharsString = String.fromCharCode.apply(String, allCodePoints) + String.fromCharCode(65534, 65535)
  const allCharsBufferUtf8 = Buffer.from(allCharsString)
  const allCharsBufferUcs2 = Buffer.from(allCharsString, 'ucs2')

  // Search for string long enough to trigger complex search with ASCII pattern
  // and UC16 subject.
  assert(!allCharsBufferUtf8.includes('notfound'))
  assert(!allCharsBufferUcs2.includes('notfound'))

  // Find substrings in Utf8.
  let lengths = [1, 3, 15] // Single char, simple and complex.
  let indices = [0x5, 0x60, 0x400, 0x680, 0x7ee, 0xff02, 0x16610, 0x2f77b]
  for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i]
      let length = lengths[lengthIndex]

      if (index + length > 0x7f) {
        length = 2 * length
      }

      if (index + length > 0x7ff) {
        length = 3 * length
      }

      if (index + length > 0xffff) {
        length = 4 * length
      }

      const patternBufferUtf8 = allCharsBufferUtf8.slice(index, index + length)
      // @ts-expect-error
      assert(index, allCharsBufferUtf8.includes(patternBufferUtf8))

      const patternStringUtf8 = patternBufferUtf8.toString()
      // @ts-expect-error
      assert(index, allCharsBufferUtf8.includes(patternStringUtf8))
    }
  }

  // Find substrings in Usc2
  lengths = [2, 4, 16] // Single char, simple and complex.
  indices = [0x5, 0x65, 0x105, 0x205, 0x285, 0x2005, 0x2085, 0xfff0]
  for (let lengthIndex = 0; lengthIndex < lengths.length; lengthIndex++) {
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i] * 2
      const length = lengths[lengthIndex]

      const patternBufferUcs2 = allCharsBufferUcs2.slice(index, index + length)
      assert.ok(allCharsBufferUcs2.includes(patternBufferUcs2, 0, 'ucs2'))

      const patternStringUcs2 = patternBufferUcs2.toString('ucs2')
      assert.ok(allCharsBufferUcs2.includes(patternStringUcs2, 0, 'ucs2'))
    }
  }

  ;[() => {}, {} /*, [] ❌ */].forEach((val: any) => {
    assert.throws(() => b.includes(val))
  })

  // Test truncation of Number arguments to uint8
  {
    const buf = Buffer.from('this is a test')
    assert.ok(buf.includes(0x6973))
    assert.ok(buf.includes(0x697320))
    assert.ok(buf.includes(0x69732069))
    assert.ok(buf.includes(0x697374657374))
    assert.ok(buf.includes(0x69737374))
    assert.ok(buf.includes(0x69737465))
    assert.ok(buf.includes(0x69737465))
    assert.ok(buf.includes(-140))
    assert.ok(buf.includes(-152))
    assert.ok(!buf.includes(0xff))
    assert.ok(!buf.includes(0xffff))
  }
})

test('Buffer read (node.js repository test)', () => {
  // Testing basic buffer read functions
  const buf = Buffer.from([0xa4, 0xfd, 0x48, 0xea, 0xcf, 0xff, 0xd9, 0x01, 0xde])

  function read(buff, funx, args, expected) {
    assert.strictEqual(buff[funx](...args), expected)
    assert.throws(() => buff[funx](-1, args[1]))
  }

  // Testing basic functionality of readDoubleBE() and readDoubleLE()
  read(buf, 'readDoubleBE', [1], -3.1827727774563287e295)
  read(buf, 'readDoubleLE', [1], -6.966010051009108e144)

  // Testing basic functionality of readFloatBE() and readFloatLE()
  read(buf, 'readFloatBE', [1], -1.6691549692541768e37)
  read(buf, 'readFloatLE', [1], -7861303808)

  // Testing basic functionality of readInt8()
  read(buf, 'readInt8', [1], -3)

  // Testing basic functionality of readInt16BE() and readInt16LE()
  read(buf, 'readInt16BE', [1], -696)
  read(buf, 'readInt16LE', [1], 0x48fd)

  // Testing basic functionality of readInt32BE() and readInt32LE()
  read(buf, 'readInt32BE', [1], -45552945)
  read(buf, 'readInt32LE', [1], -806729475)

  // Testing basic functionality of readIntBE() and readIntLE()
  read(buf, 'readIntBE', [1, 1], -3)
  read(buf, 'readIntLE', [2, 1], 0x48)

  // Testing basic functionality of readUInt8()
  read(buf, 'readUInt8', [1], 0xfd)

  // Testing basic functionality of readUInt16BE() and readUInt16LE()
  read(buf, 'readUInt16BE', [2], 0x48ea)
  read(buf, 'readUInt16LE', [2], 0xea48)

  // Testing basic functionality of readUInt32BE() and readUInt32LE()
  read(buf, 'readUInt32BE', [1], 0xfd48eacf)
  read(buf, 'readUInt32LE', [1], 0xcfea48fd)

  // Testing basic functionality of readUIntBE() and readUIntLE()
  read(buf, 'readUIntBE', [2, 2], 0x48ea)
  read(buf, 'readUIntLE', [2, 2], 0xea48)

  // Attempt to overflow buffers, similar to previous bug in array buffers
  assert.throws(() => Buffer.allocUnsafe(8).readFloatBE(0xffffffff))

  assert.throws(() => Buffer.allocUnsafe(8).readFloatLE(0xffffffff))

  // Ensure negative values can't get past offset
  assert.throws(() => Buffer.allocUnsafe(8).readFloatBE(-1))
  assert.throws(() => Buffer.allocUnsafe(8).readFloatLE(-1))

  // Offset checks
  {
    const buf = Buffer.allocUnsafe(0)

    assert.throws(() => buf.readUInt8(0))
    assert.throws(() => buf.readInt8(0))
  }

  ;[16, 32].forEach((bit) => {
    const buf = Buffer.allocUnsafe(bit / 8 - 1)
    ;[`Int${bit}B`, `Int${bit}L`, `UInt${bit}B`, `UInt${bit}L`].forEach((fn) => {
      assert.throws(() => buf[`read${fn}E`](0))
    })
  })
  ;[16, 32].forEach((bits) => {
    const buf = Buffer.from([0xff, 0xff, 0xff, 0xff])
    ;['LE', 'BE'].forEach((endian) => {
      assert.strictEqual(buf[`readUInt${bits}${endian}`](0), 0xffffffff >>> (32 - bits))

      assert.strictEqual(buf[`readInt${bits}${endian}`](0), 0xffffffff >> (32 - bits))
    })
  })
})

test('Buffer read double (node.js repository test)', () => {
  // Test (64 bit) double
  const buffer = Buffer.allocUnsafe(8)

  buffer[0] = 0x55
  buffer[1] = 0x55
  buffer[2] = 0x55
  buffer[3] = 0x55
  buffer[4] = 0x55
  buffer[5] = 0x55
  buffer[6] = 0xd5
  buffer[7] = 0x3f
  assert.strictEqual(buffer.readDoubleBE(0), 1.1945305291680097e103)
  assert.strictEqual(buffer.readDoubleLE(0), 0.3333333333333333)

  buffer[0] = 1
  buffer[1] = 0
  buffer[2] = 0
  buffer[3] = 0
  buffer[4] = 0
  buffer[5] = 0
  buffer[6] = 0xf0
  buffer[7] = 0x3f
  assert.strictEqual(buffer.readDoubleBE(0), 7.291122019655968e-304)
  assert.strictEqual(buffer.readDoubleLE(0), 1.0000000000000002)

  buffer[0] = 2
  assert.strictEqual(buffer.readDoubleBE(0), 4.778309726801735e-299)
  assert.strictEqual(buffer.readDoubleLE(0), 1.0000000000000004)

  buffer[0] = 1
  buffer[6] = 0
  buffer[7] = 0

  assert.strictEqual(buffer.readDoubleBE(0), 7.291122019556398e-304)
  assert.strictEqual(buffer.readDoubleLE(0), 5e-324)

  buffer[0] = 0xff
  buffer[1] = 0xff
  buffer[2] = 0xff
  buffer[3] = 0xff
  buffer[4] = 0xff
  buffer[5] = 0xff
  buffer[6] = 0x0f
  buffer[7] = 0x00
  assert.ok(Number.isNaN(buffer.readDoubleBE(0)))
  assert.strictEqual(buffer.readDoubleLE(0), 2.225073858507201e-308)

  buffer[6] = 0xef
  buffer[7] = 0x7f
  assert.ok(Number.isNaN(buffer.readDoubleBE(0)))
  assert.strictEqual(buffer.readDoubleLE(0), 1.7976931348623157e308)

  buffer[0] = 0
  buffer[1] = 0
  buffer[2] = 0
  buffer[3] = 0
  buffer[4] = 0
  buffer[5] = 0
  buffer[6] = 0xf0
  buffer[7] = 0x3f
  assert.strictEqual(buffer.readDoubleBE(0), 3.03865e-319)
  assert.strictEqual(buffer.readDoubleLE(0), 1)

  buffer[6] = 0
  buffer[7] = 0x40
  assert.strictEqual(buffer.readDoubleBE(0), 3.16e-322)
  assert.strictEqual(buffer.readDoubleLE(0), 2)

  buffer[7] = 0xc0
  assert.strictEqual(buffer.readDoubleBE(0), 9.5e-322)
  assert.strictEqual(buffer.readDoubleLE(0), -2)

  buffer[6] = 0x10
  buffer[7] = 0
  assert.strictEqual(buffer.readDoubleBE(0), 2.0237e-320)
  assert.strictEqual(buffer.readDoubleLE(0), 2.2250738585072014e-308)

  buffer[6] = 0
  assert.strictEqual(buffer.readDoubleBE(0), 0)
  assert.strictEqual(buffer.readDoubleLE(0), 0)
  assert.ok(1 / buffer.readDoubleLE(0) >= 0)

  buffer[7] = 0x80
  assert.strictEqual(buffer.readDoubleBE(0), 6.3e-322)
  assert.strictEqual(buffer.readDoubleLE(0), -0)
  assert.ok(1 / buffer.readDoubleLE(0) < 0)

  buffer[6] = 0xf0
  buffer[7] = 0x7f
  assert.strictEqual(buffer.readDoubleBE(0), 3.0418e-319)
  assert.strictEqual(buffer.readDoubleLE(0), Infinity)

  buffer[7] = 0xff
  assert.strictEqual(buffer.readDoubleBE(0), 3.04814e-319)
  assert.strictEqual(buffer.readDoubleLE(0), -Infinity)
  ;['readDoubleLE', 'readDoubleBE'].forEach((fn) => {
    // Verify that default offset works fine.
    buffer[fn](undefined)
    buffer[fn]()
    ;['', '0', null, {}, [], () => {}, true, false].forEach((off) => {
      assert.throws(() => buffer[fn](off))
    })
    ;[Infinity, -1, 1].forEach((offset) => {
      assert.throws(() => buffer[fn](offset))
    })

    assert.throws(() => Buffer.alloc(1)[fn](1))
    ;[NaN, 1.01].forEach((offset) => {
      assert.throws(() => buffer[fn](offset), {
        code: 'ERR_OUT_OF_RANGE',
        name: 'RangeError',
        message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
      })
    })
  })
})

test('Buffer read float (node.js repository test)', () => {
  // Test 32 bit float
  const buffer = Buffer.alloc(4)

  buffer[0] = 0
  buffer[1] = 0
  buffer[2] = 0x80
  buffer[3] = 0x3f
  assert.strictEqual(buffer.readFloatBE(0), 4.600602988224807e-41)
  assert.strictEqual(buffer.readFloatLE(0), 1)

  buffer[0] = 0
  buffer[1] = 0
  buffer[2] = 0
  buffer[3] = 0xc0
  assert.strictEqual(buffer.readFloatBE(0), 2.6904930515036488e-43)
  assert.strictEqual(buffer.readFloatLE(0), -2)

  buffer[0] = 0xff
  buffer[1] = 0xff
  buffer[2] = 0x7f
  buffer[3] = 0x7f
  assert.ok(Number.isNaN(buffer.readFloatBE(0)))
  assert.strictEqual(buffer.readFloatLE(0), 3.4028234663852886e38)

  buffer[0] = 0xab
  buffer[1] = 0xaa
  buffer[2] = 0xaa
  buffer[3] = 0x3e
  assert.strictEqual(buffer.readFloatBE(0), -1.2126478207002966e-12)
  assert.strictEqual(buffer.readFloatLE(0), 0.3333333432674408)

  buffer[0] = 0
  buffer[1] = 0
  buffer[2] = 0
  buffer[3] = 0
  assert.strictEqual(buffer.readFloatBE(0), 0)
  assert.strictEqual(buffer.readFloatLE(0), 0)
  assert.ok(1 / buffer.readFloatLE(0) >= 0)

  buffer[3] = 0x80
  assert.strictEqual(buffer.readFloatBE(0), 1.793662034335766e-43)
  assert.strictEqual(buffer.readFloatLE(0), -0)
  assert.ok(1 / buffer.readFloatLE(0) < 0)

  buffer[0] = 0
  buffer[1] = 0
  buffer[2] = 0x80
  buffer[3] = 0x7f
  assert.strictEqual(buffer.readFloatBE(0), 4.609571298396486e-41)
  assert.strictEqual(buffer.readFloatLE(0), Infinity)

  buffer[0] = 0
  buffer[1] = 0
  buffer[2] = 0x80
  buffer[3] = 0xff
  assert.strictEqual(buffer.readFloatBE(0), 4.627507918739843e-41)
  assert.strictEqual(buffer.readFloatLE(0), -Infinity)
  ;['readFloatLE', 'readFloatBE'].forEach((fn) => {
    // Verify that default offset works fine.
    buffer[fn](undefined)
    buffer[fn]()
    ;['', '0', null, {}, [], () => {}, true, false].forEach((off) => {
      assert.throws(() => buffer[fn](off), { code: 'ERR_INVALID_ARG_TYPE' })
    })
    ;[Infinity, -1, 1].forEach((offset) => {
      assert.throws(() => buffer[fn](offset))
    })

    assert.throws(() => Buffer.alloc(1)[fn](1))
    ;[NaN, 1.01].forEach((offset) => {
      assert.throws(() => buffer[fn](offset), {
        code: 'ERR_OUT_OF_RANGE',
        name: 'RangeError',
        message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
      })
    })
  })
})

test('Buffer read int (node.js repository test)', () => {
  // Test OOB
  {
    const buffer = Buffer.alloc(4)

    ;['Int8', 'Int16BE', 'Int16LE', 'Int32BE', 'Int32LE'].forEach((fn) => {
      // Verify that default offset works fine.
      buffer[`read${fn}`](undefined)
      buffer[`read${fn}`]()
      ;['', '0', null, {}, [], () => {}, true, false].forEach((o) => {
        assert.throws(() => buffer[`read${fn}`](o), {
          code: 'ERR_INVALID_ARG_TYPE',
          name: 'TypeError',
        })
      })
      ;[Infinity, -1, -4294967295].forEach((offset) => {
        assert.throws(() => buffer[`read${fn}`](offset))
      })
      ;[NaN, 1.01].forEach((offset) => {
        assert.throws(() => buffer[`read${fn}`](offset), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
        })
      })
    })
  }

  // Test 8 bit signed integers
  {
    const data = Buffer.from([0x23, 0xab, 0x7c, 0xef])

    assert.strictEqual(data.readInt8(0), 0x23)

    data[0] = 0xff
    assert.strictEqual(data.readInt8(0), -1)

    data[0] = 0x87
    assert.strictEqual(data.readInt8(0), -121)
    assert.strictEqual(data.readInt8(1), -85)
    assert.strictEqual(data.readInt8(2), 124)
    assert.strictEqual(data.readInt8(3), -17)
  }

  // Test 16 bit integers
  {
    const buffer = Buffer.from([0x16, 0x79, 0x65, 0x6e, 0x69, 0x78])

    assert.strictEqual(buffer.readInt16BE(0), 0x1679)
    assert.strictEqual(buffer.readInt16LE(0), 0x7916)

    buffer[0] = 0xff
    buffer[1] = 0x80
    assert.strictEqual(buffer.readInt16BE(0), -128)
    assert.strictEqual(buffer.readInt16LE(0), -32513)

    buffer[0] = 0x77
    buffer[1] = 0x65
    assert.strictEqual(buffer.readInt16BE(0), 0x7765)
    assert.strictEqual(buffer.readInt16BE(1), 0x6565)
    assert.strictEqual(buffer.readInt16BE(2), 0x656e)
    assert.strictEqual(buffer.readInt16BE(3), 0x6e69)
    assert.strictEqual(buffer.readInt16BE(4), 0x6978)
    assert.strictEqual(buffer.readInt16LE(0), 0x6577)
    assert.strictEqual(buffer.readInt16LE(1), 0x6565)
    assert.strictEqual(buffer.readInt16LE(2), 0x6e65)
    assert.strictEqual(buffer.readInt16LE(3), 0x696e)
    assert.strictEqual(buffer.readInt16LE(4), 0x7869)
  }

  // Test 32 bit integers
  {
    const buffer = Buffer.from([0x43, 0x53, 0x16, 0x79, 0x36, 0x17])

    assert.strictEqual(buffer.readInt32BE(0), 0x43531679)
    assert.strictEqual(buffer.readInt32LE(0), 0x79165343)

    buffer[0] = 0xff
    buffer[1] = 0xfe
    buffer[2] = 0xef
    buffer[3] = 0xfa
    assert.strictEqual(buffer.readInt32BE(0), -69638)
    assert.strictEqual(buffer.readInt32LE(0), -84934913)

    buffer[0] = 0x42
    buffer[1] = 0xc3
    buffer[2] = 0x95
    buffer[3] = 0xa9
    assert.strictEqual(buffer.readInt32BE(0), 0x42c395a9)
    assert.strictEqual(buffer.readInt32BE(1), -1013601994)
    assert.strictEqual(buffer.readInt32BE(2), -1784072681)
    assert.strictEqual(buffer.readInt32LE(0), -1449802942)
    assert.strictEqual(buffer.readInt32LE(1), 917083587)
    assert.strictEqual(buffer.readInt32LE(2), 389458325)
  }

  // Test Int
  {
    const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])

    assert.strictEqual(buffer.readIntLE(0, 1), 0x01)
    assert.strictEqual(buffer.readIntBE(0, 1), 0x01)
    assert.strictEqual(buffer.readIntLE(0, 3), 0x030201)
    assert.strictEqual(buffer.readIntBE(0, 3), 0x010203)
    assert.strictEqual(buffer.readIntLE(0, 5), 0x0504030201)
    assert.strictEqual(buffer.readIntBE(0, 5), 0x0102030405)
    assert.strictEqual(buffer.readIntLE(0, 6), 0x060504030201)
    assert.strictEqual(buffer.readIntBE(0, 6), 0x010203040506)
    assert.strictEqual(buffer.readIntLE(1, 6), 0x070605040302)
    assert.strictEqual(buffer.readIntBE(1, 6), 0x020304050607)
    assert.strictEqual(buffer.readIntLE(2, 6), 0x080706050403)
    assert.strictEqual(buffer.readIntBE(2, 6), 0x030405060708)

    // Check byteLength.
    ;['readIntBE', 'readIntLE'].forEach((fn) => {
      ;['', '0', null, {}, [], () => {}, true, false, undefined].forEach((len) => {
        assert.throws(() => buffer[fn](0, len), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[Infinity, -1].forEach((byteLength) => {
        assert.throws(() => buffer[fn](0, byteLength))
      })
      ;[NaN, 1.01].forEach((byteLength) => {
        assert.throws(() => buffer[fn](0, byteLength), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "byteLength" is out of range. ' + `It must be an integer. Received ${byteLength}`,
        })
      })
    })

    // Test 1 to 6 bytes.
    for (let i = 1; i <= 6; i++) {
      ;['readIntBE', 'readIntLE'].forEach((fn) => {
        ;['', '0', null, {}, [], () => {}, true, false, undefined].forEach((o) => {
          assert.throws(() => buffer[fn](o, i), {
            code: 'ERR_INVALID_ARG_TYPE',
            name: 'TypeError',
          })
        })
        ;[Infinity, -1, -4294967295].forEach((offset) => {
          assert.throws(() => buffer[fn](offset, i))
        })
        ;[NaN, 1.01].forEach((offset) => {
          assert.throws(() => buffer[fn](offset, i), {
            code: 'ERR_OUT_OF_RANGE',
            name: 'RangeError',
            message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
          })
        })
      })
    }
  }
})

test('Buffer read uint (node.js repository test)', () => {
  // Test OOB
  {
    const buffer = Buffer.alloc(4)

    ;['UInt8', 'UInt16BE', 'UInt16LE', 'UInt32BE', 'UInt32LE'].forEach((fn) => {
      // Verify that default offset works fine.
      buffer[`read${fn}`](undefined)
      buffer[`read${fn}`]()
      ;['', '0', null, {}, [], () => {}, true, false].forEach((o) => {
        assert.throws(() => buffer[`read${fn}`](o), {
          code: 'ERR_INVALID_ARG_TYPE',
          name: 'TypeError',
        })
      })
      ;[Infinity, -1, -4294967295].forEach((offset) => {
        assert.throws(() => buffer[`read${fn}`](offset))
      })
      ;[NaN, 1.01].forEach((offset) => {
        assert.throws(() => buffer[`read${fn}`](offset), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
        })
      })
    })
  }

  // Test 8 bit unsigned integers
  {
    const data = Buffer.from([0xff, 0x2a, 0x2a, 0x2a])
    assert.strictEqual(data.readUInt8(0), 255)
    assert.strictEqual(data.readUInt8(1), 42)
    assert.strictEqual(data.readUInt8(2), 42)
    assert.strictEqual(data.readUInt8(3), 42)
  }

  // Test 16 bit unsigned integers
  {
    const data = Buffer.from([0x00, 0x2a, 0x42, 0x3f])
    assert.strictEqual(data.readUInt16BE(0), 0x2a)
    assert.strictEqual(data.readUInt16BE(1), 0x2a42)
    assert.strictEqual(data.readUInt16BE(2), 0x423f)
    assert.strictEqual(data.readUInt16LE(0), 0x2a00)
    assert.strictEqual(data.readUInt16LE(1), 0x422a)
    assert.strictEqual(data.readUInt16LE(2), 0x3f42)

    data[0] = 0xfe
    data[1] = 0xfe
    assert.strictEqual(data.readUInt16BE(0), 0xfefe)
    assert.strictEqual(data.readUInt16LE(0), 0xfefe)
  }

  // Test 32 bit unsigned integers
  {
    const data = Buffer.from([0x32, 0x65, 0x42, 0x56, 0x23, 0xff])
    assert.strictEqual(data.readUInt32BE(0), 0x32654256)
    assert.strictEqual(data.readUInt32BE(1), 0x65425623)
    assert.strictEqual(data.readUInt32BE(2), 0x425623ff)
    assert.strictEqual(data.readUInt32LE(0), 0x56426532)
    assert.strictEqual(data.readUInt32LE(1), 0x23564265)
    assert.strictEqual(data.readUInt32LE(2), 0xff235642)
  }

  // Test UInt
  {
    const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])

    assert.strictEqual(buffer.readUIntLE(0, 1), 0x01)
    assert.strictEqual(buffer.readUIntBE(0, 1), 0x01)
    assert.strictEqual(buffer.readUIntLE(0, 3), 0x030201)
    assert.strictEqual(buffer.readUIntBE(0, 3), 0x010203)
    assert.strictEqual(buffer.readUIntLE(0, 5), 0x0504030201)
    assert.strictEqual(buffer.readUIntBE(0, 5), 0x0102030405)
    assert.strictEqual(buffer.readUIntLE(0, 6), 0x060504030201)
    assert.strictEqual(buffer.readUIntBE(0, 6), 0x010203040506)
    assert.strictEqual(buffer.readUIntLE(1, 6), 0x070605040302)
    assert.strictEqual(buffer.readUIntBE(1, 6), 0x020304050607)
    assert.strictEqual(buffer.readUIntLE(2, 6), 0x080706050403)
    assert.strictEqual(buffer.readUIntBE(2, 6), 0x030405060708)

    // Check byteLength.
    ;['readUIntBE', 'readUIntLE'].forEach((fn) => {
      ;['', '0', null, {}, [], () => {}, true, false, undefined].forEach((len) => {
        assert.throws(() => buffer[fn](0, len), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[Infinity, -1].forEach((byteLength) => {
        assert.throws(() => buffer[fn](0, byteLength))
      })
      ;[NaN, 1.01].forEach((byteLength) => {
        assert.throws(() => buffer[fn](0, byteLength), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "byteLength" is out of range. ' + `It must be an integer. Received ${byteLength}`,
        })
      })
    })

    // Test 1 to 6 bytes.
    for (let i = 1; i <= 6; i++) {
      ;['readUIntBE', 'readUIntLE'].forEach((fn) => {
        ;['', '0', null, {}, [], () => {}, true, false, undefined].forEach((o) => {
          assert.throws(() => buffer[fn](o, i), {
            code: 'ERR_INVALID_ARG_TYPE',
            name: 'TypeError',
          })
        })
        ;[Infinity, -1, -4294967295].forEach((offset) => {
          assert.throws(() => buffer[fn](offset, i))
        })
        ;[NaN, 1.01].forEach((offset) => {
          assert.throws(() => buffer[fn](offset, i), {
            code: 'ERR_OUT_OF_RANGE',
            name: 'RangeError',
            message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
          })
        })
      })
    }
  }
})

test('Buffer SharedArrayBuffer (node.js repository test)', () => {
  const sab = new SharedArrayBuffer(24)
  const arr1 = new Uint16Array(sab)
  const arr2 = new Uint16Array(12)
  arr2[0] = 5000
  arr1[0] = 5000
  arr1[1] = 4000
  arr2[1] = 4000

  const arr_buf = Buffer.from(arr1.buffer)
  const ar_buf = Buffer.from(arr2.buffer)

  assert.deepStrictEqual(arr_buf, ar_buf)

  arr1[1] = 6000
  arr2[1] = 6000

  assert.deepStrictEqual(arr_buf, ar_buf)

  // Checks for calling Buffer.byteLength on a SharedArrayBuffer.
  assert.strictEqual(Buffer.byteLength(sab), sab.byteLength)

  Buffer.from({ buffer: sab }) // Should not throw.
})

test('Buffer swap (node.js repository test)', () => {
  // Test buffers small enough to use the JS implementation
  {
    const buf = Buffer.from([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    ])

    assert.strictEqual(buf, buf.swap16())
    assert.deepStrictEqual(
      buf,
      Buffer.from([0x02, 0x01, 0x04, 0x03, 0x06, 0x05, 0x08, 0x07, 0x0a, 0x09, 0x0c, 0x0b, 0x0e, 0x0d, 0x10, 0x0f]),
    )
    buf.swap16() // restore

    assert.strictEqual(buf, buf.swap32())
    assert.deepStrictEqual(
      buf,
      Buffer.from([0x04, 0x03, 0x02, 0x01, 0x08, 0x07, 0x06, 0x05, 0x0c, 0x0b, 0x0a, 0x09, 0x10, 0x0f, 0x0e, 0x0d]),
    )
    buf.swap32() // restore

    assert.strictEqual(buf, buf.swap64())
    assert.deepStrictEqual(
      buf,
      Buffer.from([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x09]),
    )
  }

  // Operates in-place
  {
    const buf = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7])
    buf.slice(1, 5).swap32()
    assert.deepStrictEqual(buf, Buffer.from([0x1, 0x5, 0x4, 0x3, 0x2, 0x6, 0x7]))
    buf.slice(1, 5).swap16()
    assert.deepStrictEqual(buf, Buffer.from([0x1, 0x4, 0x5, 0x2, 0x3, 0x6, 0x7]))

    // Length assertions
    const re16 = /Buffer size must be a multiple of 16-bits/
    const re32 = /Buffer size must be a multiple of 32-bits/
    const re64 = /Buffer size must be a multiple of 64-bits/

    assert.throws(() => Buffer.from(buf).swap16())
    assert.throws(() => Buffer.alloc(1025).swap16())
    assert.throws(() => Buffer.from(buf).swap32())
    assert.throws(() => buf.slice(1, 3).swap32())
    assert.throws(() => Buffer.alloc(1025).swap32())
    assert.throws(() => buf.slice(1, 3).swap64())
    assert.throws(() => Buffer.alloc(1025).swap64())
  }

  {
    const buf = Buffer.from([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x01, 0x02, 0x03,
      0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    ])

    buf.slice(2, 18).swap64()

    assert.deepStrictEqual(
      buf,
      Buffer.from([
        0x01, 0x02, 0x0a, 0x09, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b,
        0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
      ]),
    )
  }

  // Force use of native code (Buffer size above threshold limit for js impl)
  {
    const bufData = new Uint32Array(256).fill(0x04030201)
    const buf = Buffer.from(bufData.buffer, bufData.byteOffset)
    const otherBufData = new Uint32Array(256).fill(0x03040102)
    const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset)
    buf.swap16()
    assert.deepStrictEqual(buf, otherBuf)
  }

  {
    const bufData = new Uint32Array(256).fill(0x04030201)
    const buf = Buffer.from(bufData.buffer)
    const otherBufData = new Uint32Array(256).fill(0x01020304)
    const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset)
    buf.swap32()
    assert.deepStrictEqual(buf, otherBuf)
  }

  {
    const bufData = new Uint8Array(256 * 8)
    const otherBufData = new Uint8Array(256 * 8)
    for (let i = 0; i < bufData.length; i++) {
      bufData[i] = i % 8
      otherBufData[otherBufData.length - i - 1] = i % 8
    }
    const buf = Buffer.from(bufData.buffer, bufData.byteOffset)
    const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset)
    buf.swap64()
    assert.deepStrictEqual(buf, otherBuf)
  }

  // Test native code with buffers that are not memory-aligned
  {
    const bufData = new Uint8Array(256 * 8)
    const otherBufData = new Uint8Array(256 * 8 - 2)
    for (let i = 0; i < bufData.length; i++) {
      bufData[i] = i % 2
    }
    for (let i = 1; i < otherBufData.length; i++) {
      otherBufData[otherBufData.length - i] = (i + 1) % 2
    }
    const buf = Buffer.from(bufData.buffer, bufData.byteOffset)
    // 0|1 0|1 0|1...
    const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset)
    // 0|0 1|0 1|0...

    buf.slice(1, buf.length - 1).swap16()
    assert.deepStrictEqual(buf.slice(0, otherBuf.length), otherBuf)
  }

  {
    const bufData = new Uint8Array(256 * 8)
    const otherBufData = new Uint8Array(256 * 8 - 4)
    for (let i = 0; i < bufData.length; i++) {
      bufData[i] = i % 4
    }
    for (let i = 1; i < otherBufData.length; i++) {
      otherBufData[otherBufData.length - i] = (i + 1) % 4
    }
    const buf = Buffer.from(bufData.buffer, bufData.byteOffset)
    // 0|1 2 3 0|1 2 3...
    const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset)
    // 0|0 3 2 1|0 3 2...

    buf.slice(1, buf.length - 3).swap32()
    assert.deepStrictEqual(buf.slice(0, otherBuf.length), otherBuf)
  }

  {
    const bufData = new Uint8Array(256 * 8)
    const otherBufData = new Uint8Array(256 * 8 - 8)
    for (let i = 0; i < bufData.length; i++) {
      bufData[i] = i % 8
    }
    for (let i = 1; i < otherBufData.length; i++) {
      otherBufData[otherBufData.length - i] = (i + 1) % 8
    }
    const buf = Buffer.from(bufData.buffer, bufData.byteOffset)
    // 0|1 2 3 4 5 6 7 0|1 2 3 4...
    const otherBuf = Buffer.from(otherBufData.buffer, otherBufData.byteOffset)
    // 0|0 7 6 5 4 3 2 1|0 7 6 5...

    buf.slice(1, buf.length - 7).swap64()
    assert.deepStrictEqual(buf.slice(0, otherBuf.length), otherBuf)
  }
})

test('Buffer toJSON (node.js repository test)', () => {
  {
    assert.strictEqual(JSON.stringify(Buffer.alloc(0)), '{"type":"Buffer","data":[]}')
    assert.strictEqual(JSON.stringify(Buffer.from([1, 2, 3, 4])), '{"type":"Buffer","data":[1,2,3,4]}')
  }

  // issue GH-7849
  {
    const buf = Buffer.from('test')
    const json = JSON.stringify(buf)
    const obj = JSON.parse(json)
    const copy = Buffer.from(obj)

    assert.deepStrictEqual(buf, copy)
  }

  // GH-5110
  {
    const buffer = Buffer.from('test')
    const string = JSON.stringify(buffer)

    assert.strictEqual(string, '{"type":"Buffer","data":[116,101,115,116]}')

    function receiver(key, value) {
      return value && value.type === 'Buffer' ? Buffer.from(value.data) : value
    }

    assert.deepStrictEqual(buffer, JSON.parse(string, receiver))
  }
})

test('Buffer toString (range) (node.js repository test)', () => {
  const rangeBuffer = Buffer.from('abc')

  // If start >= buffer's length, empty string will be returned
  assert.strictEqual(rangeBuffer.toString('ascii', 3), '')
  assert.strictEqual(rangeBuffer.toString('ascii', +Infinity), '')
  assert.strictEqual(rangeBuffer.toString('ascii', 3.14, 3), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 'Infinity', 3), '')

  // If end <= 0, empty string will be returned
  assert.strictEqual(rangeBuffer.toString('ascii', 1, 0), '')
  assert.strictEqual(rangeBuffer.toString('ascii', 1, -1.2), '')
  assert.strictEqual(rangeBuffer.toString('ascii', 1, -100), '')
  assert.strictEqual(rangeBuffer.toString('ascii', 1, -Infinity), '')

  // If start < 0, start will be taken as zero
  assert.strictEqual(rangeBuffer.toString('ascii', -1, 3), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', -1.99, 3), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', -Infinity, 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '-1', 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '-1.99', 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '-Infinity', 3), 'abc')

  // If start is an invalid integer, start will be taken as zero
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 'node.js', 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', {}, 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', [], 3), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', NaN, 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', null, 3), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', undefined, 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', false, 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '', 3), 'abc')

  // But, if start is an integer when coerced, then it will be coerced and used.
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '-1', 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '1', 3), 'bc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '-Infinity', 3), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '3', 3), '')
  assert.strictEqual(rangeBuffer.toString('ascii', Number(3), 3), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '3.14', 3), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '1.99', 3), 'bc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', '-1.99', 3), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', 1.99, 3), 'bc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', true, 3), 'bc')

  // If end > buffer's length, end will be taken as buffer's length
  assert.strictEqual(rangeBuffer.toString('ascii', 0, 5), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', 0, 6.99), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', 0, Infinity), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '5'), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '6.99'), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, 'Infinity'), 'abc')

  // If end is an invalid integer, end will be taken as buffer's length
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, 'node.js'), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, {}), '')
  assert.strictEqual(rangeBuffer.toString('ascii', 0, NaN), '')
  assert.strictEqual(rangeBuffer.toString('ascii', 0, undefined), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', 0), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, null), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, []), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, false), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, ''), '')

  // But, if end is an integer when coerced, then it will be coerced and used.
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '-1'), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '1'), 'a')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '-Infinity'), '')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '3'), 'abc')
  assert.strictEqual(rangeBuffer.toString('ascii', 0, Number(3)), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '3.14'), 'abc')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '1.99'), 'a')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, '-1.99'), '')
  assert.strictEqual(rangeBuffer.toString('ascii', 0, 1.99), 'a')
  // @ts-expect-error
  assert.strictEqual(rangeBuffer.toString('ascii', 0, true), 'a')

  // Try toString() with an object as an encoding
  assert.strictEqual(
    // @ts-expect-error
    rangeBuffer.toString({
      toString: function () {
        return 'ascii'
      },
    }),
    'abc',
  )

  // Try toString() with 0 and null as the encoding
  assert.throws(() => {
    // @ts-expect-error
    rangeBuffer.toString(0, 1, 2)
  })
  assert.throws(() => {
    // @ts-expect-error
    rangeBuffer.toString(null, 1, 2)
  })
})

test('Buffer write (node.js repository test)', () => {
  ;[-1, 10].forEach((offset) => {
    assert.throws(() => Buffer.alloc(9).write('foo', offset), {
      code: 'ERR_OUT_OF_RANGE',
      name: 'RangeError',
      message: 'The value of "offset" is out of range. ' + `It must be >= 0 && <= 9. Received ${offset}`,
    })
  })

  const resultMap = new Map([
    ['utf8', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
    ['ucs2', Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
    ['ascii', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
    ['latin1', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
    ['binary', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
    ['utf16le', Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
    ['base64', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
    ['base64url', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
    ['hex', Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
  ])

  // utf8, ucs2, ascii, latin1, utf16le
  const encodings = ['utf8', 'utf-8', 'ucs2', 'ucs-2', 'ascii', 'latin1', 'binary', 'utf16le', 'utf-16le']

  encodings
    .reduce((es, e) => es.concat(e, e.toUpperCase()), [] as string[])
    .forEach((encoding: any) => {
      const buf = Buffer.alloc(9)
      const len = Buffer.byteLength('foo', encoding)
      assert.strictEqual(buf.write('foo', 0, len, encoding), len)

      if (encoding.includes('-')) encoding = encoding.replace('-', '')

      assert.deepStrictEqual(buf, resultMap.get(encoding.toLowerCase()))
    })

  // base64
  ;['base64', 'BASE64', 'base64url', 'BASE64URL'].forEach((encoding: any) => {
    const buf = Buffer.alloc(9)
    const len = Buffer.byteLength('Zm9v', encoding)

    assert.strictEqual(buf.write('Zm9v', 0, len, encoding), len)
    assert.deepStrictEqual(buf, resultMap.get(encoding.toLowerCase()))
  })

  // hex
  ;['hex', 'HEX'].forEach((encoding: any) => {
    const buf = Buffer.alloc(9)
    const len = Buffer.byteLength('666f6f', encoding)

    assert.strictEqual(buf.write('666f6f', 0, len, encoding), len)
    assert.deepStrictEqual(buf, resultMap.get(encoding.toLowerCase()))
  })

  // Invalid encodings
  for (let i = 1; i < 10; i++) {
    const encoding = String(i).repeat(i)
    assert.ok(!Buffer.isEncoding(encoding))
    // @ts-expect-error
    assert.throws(() => Buffer.alloc(9).write('foo', encoding))
  }

  // UCS-2 overflow CVE-2018-12115
  for (let i = 1; i < 4; i++) {
    // Allocate two Buffers sequentially off the pool. Run more than once in case
    // we hit the end of the pool and don't get sequential allocations
    const x = Buffer.allocUnsafe(4).fill(0)
    const y = Buffer.allocUnsafe(4).fill(1)
    // Should not write anything, pos 3 doesn't have enough room for a 16-bit char
    // assert.strictEqual(x.write('ыыыыыы', 3, 'ucs2'), 0)
    // CVE-2018-12115 experienced via buffer overrun to next block in the pool
    assert.strictEqual(Buffer.compare(y, Buffer.alloc(4, 1)), 0)
  }

  // Should not write any data when there is no space for 16-bit chars
  const z = Buffer.alloc(4, 0)
  // assert.strictEqual(z.write('\u0001', 3, 'ucs2'), 0)
  assert.strictEqual(Buffer.compare(z, Buffer.alloc(4, 0)), 0)
  // Make sure longer strings are written up to the buffer end.
  assert.strictEqual(z.write('abcd', 2), 2)
  assert.deepStrictEqual([...z], [0, 0, 0x61, 0x62])

  // Large overrun could corrupt the process
  // assert.strictEqual(Buffer.alloc(4).write('ыыыыыы'.repeat(100), 3, 'utf16le'), 0)

  {
    // .write() does not affect the byte after the written-to slice of the Buffer.
    // Refs: https://github.com/nodejs/node/issues/26422
    const buf = Buffer.alloc(8)
    assert.strictEqual(buf.write('ыы', 1, 'utf16le'), 4)
    assert.deepStrictEqual([...buf], [0, 0x4b, 0x04, 0x4b, 0x04, 0, 0, 0])
  }
})

test('Buffer write double (node.js repository test)', () => {
  const buffer = Buffer.allocUnsafe(16)

  buffer.writeDoubleBE(2.225073858507201e-308, 0)
  buffer.writeDoubleLE(2.225073858507201e-308, 8)
  assert.ok(
    buffer.equals(
      new Uint8Array([0x00, 0x0f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x00]),
    ),
  )

  buffer.writeDoubleBE(1.0000000000000004, 0)
  buffer.writeDoubleLE(1.0000000000000004, 8)
  assert.ok(
    buffer.equals(
      new Uint8Array([0x3f, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f]),
    ),
  )

  buffer.writeDoubleBE(-2, 0)
  buffer.writeDoubleLE(-2, 8)
  assert.ok(
    buffer.equals(
      new Uint8Array([0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0]),
    ),
  )

  buffer.writeDoubleBE(1.7976931348623157e308, 0)
  buffer.writeDoubleLE(1.7976931348623157e308, 8)
  assert.ok(
    buffer.equals(
      new Uint8Array([0x7f, 0xef, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xef, 0x7f]),
    ),
  )

  buffer.writeDoubleBE(0 * -1, 0)
  buffer.writeDoubleLE(0 * -1, 8)
  assert.ok(
    buffer.equals(
      new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80]),
    ),
  )

  buffer.writeDoubleBE(Infinity, 0)
  buffer.writeDoubleLE(Infinity, 8)

  assert.ok(
    buffer.equals(
      new Uint8Array([0x7f, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x7f]),
    ),
  )

  assert.strictEqual(buffer.readDoubleBE(0), Infinity)
  assert.strictEqual(buffer.readDoubleLE(8), Infinity)

  buffer.writeDoubleBE(-Infinity, 0)
  buffer.writeDoubleLE(-Infinity, 8)

  assert.ok(
    buffer.equals(
      new Uint8Array([0xff, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xff]),
    ),
  )

  assert.strictEqual(buffer.readDoubleBE(0), -Infinity)
  assert.strictEqual(buffer.readDoubleLE(8), -Infinity)

  buffer.writeDoubleBE(NaN, 0)
  buffer.writeDoubleLE(NaN, 8)

  // JS only knows a single NaN but there exist two platform specific
  // implementations. Therefore, allow both quiet and signalling NaNs.
  if (buffer[1] === 0xf7) {
    assert.ok(
      buffer.equals(
        new Uint8Array([
          0x7f, 0xf7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf7, 0x7f,
        ]),
      ),
    )
  } else {
    assert.ok(
      buffer.equals(
        new Uint8Array([
          0x7f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x7f,
        ]),
      ),
    )
  }

  assert.ok(Number.isNaN(buffer.readDoubleBE(0)))
  assert.ok(Number.isNaN(buffer.readDoubleLE(8)))

  // OOB in writeDouble{LE,BE} should throw.
  {
    const small = Buffer.allocUnsafe(1)

    ;['writeDoubleLE', 'writeDoubleBE'].forEach((fn) => {
      // Verify that default offset works fine.
      buffer[fn](23, undefined)
      buffer[fn](23)

      assert.throws(() => small[fn](11.11, 0))
      ;['', '0', null, {}, [], () => {}, true, false].forEach((off) => {
        assert.throws(() => small[fn](23, off), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[Infinity, -1, 9].forEach((offset) => {
        assert.throws(() => buffer[fn](23, offset))
      })
      ;[NaN, 1.01].forEach((offset) => {
        assert.throws(() => buffer[fn](42, offset), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
        })
      })
    })
  }
})

test('Buffer write float (node.js repository test)', () => {
  const buffer = Buffer.allocUnsafe(8)

  buffer.writeFloatBE(1, 0)
  buffer.writeFloatLE(1, 4)
  assert.ok(buffer.equals(new Uint8Array([0x3f, 0x80, 0x00, 0x00, 0x00, 0x00, 0x80, 0x3f])))

  buffer.writeFloatBE(1 / 3, 0)
  buffer.writeFloatLE(1 / 3, 4)
  assert.ok(buffer.equals(new Uint8Array([0x3e, 0xaa, 0xaa, 0xab, 0xab, 0xaa, 0xaa, 0x3e])))

  buffer.writeFloatBE(3.4028234663852886e38, 0)
  buffer.writeFloatLE(3.4028234663852886e38, 4)
  assert.ok(buffer.equals(new Uint8Array([0x7f, 0x7f, 0xff, 0xff, 0xff, 0xff, 0x7f, 0x7f])))

  buffer.writeFloatLE(1.1754943508222875e-38, 0)
  buffer.writeFloatBE(1.1754943508222875e-38, 4)
  assert.ok(buffer.equals(new Uint8Array([0x00, 0x00, 0x80, 0x00, 0x00, 0x80, 0x00, 0x00])))

  buffer.writeFloatBE(0 * -1, 0)
  buffer.writeFloatLE(0 * -1, 4)
  assert.ok(buffer.equals(new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80])))

  buffer.writeFloatBE(Infinity, 0)
  buffer.writeFloatLE(Infinity, 4)
  assert.ok(buffer.equals(new Uint8Array([0x7f, 0x80, 0x00, 0x00, 0x00, 0x00, 0x80, 0x7f])))

  assert.strictEqual(buffer.readFloatBE(0), Infinity)
  assert.strictEqual(buffer.readFloatLE(4), Infinity)

  buffer.writeFloatBE(-Infinity, 0)
  buffer.writeFloatLE(-Infinity, 4)
  assert.ok(buffer.equals(new Uint8Array([0xff, 0x80, 0x00, 0x00, 0x00, 0x00, 0x80, 0xff])))

  assert.strictEqual(buffer.readFloatBE(0), -Infinity)
  assert.strictEqual(buffer.readFloatLE(4), -Infinity)

  buffer.writeFloatBE(NaN, 0)
  buffer.writeFloatLE(NaN, 4)

  // JS only knows a single NaN but there exist two platform specific
  // implementations. Therefore, allow both quiet and signalling NaNs.
  if (buffer[1] === 0xbf) {
    assert.ok(buffer.equals(new Uint8Array([0x7f, 0xbf, 0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])))
  } else {
    assert.ok(buffer.equals(new Uint8Array([0x7f, 0xc0, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x7f])))
  }

  assert.ok(Number.isNaN(buffer.readFloatBE(0)))
  assert.ok(Number.isNaN(buffer.readFloatLE(4)))

  // OOB in writeFloat{LE,BE} should throw.
  {
    const small = Buffer.allocUnsafe(1)

    ;['writeFloatLE', 'writeFloatBE'].forEach((fn) => {
      // Verify that default offset works fine.
      buffer[fn](23, undefined)
      buffer[fn](23)

      assert.throws(() => small[fn](11.11, 0))
      ;['', '0', null, {}, [], () => {}, true, false].forEach((off) => {
        assert.throws(() => small[fn](23, off), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[Infinity, -1, 5].forEach((offset) => {
        assert.throws(() => buffer[fn](23, offset))
      })
      ;[NaN, 1.01].forEach((offset) => {
        assert.throws(() => buffer[fn](42, offset), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
        })
      })
    })
  }
})

test('Buffer write int (node.js repository test)', () => {
  const errorOutOfBounds = {
    code: 'ERR_OUT_OF_RANGE',
    name: 'RangeError',
    message: new RegExp(
      '^The value of "value" is out of range\\. ' + 'It must be >= -\\d+ and <= \\d+\\. Received .+$',
    ),
  }

  // Test 8 bit
  {
    const buffer = Buffer.alloc(2)

    buffer.writeInt8(0x23, 0)
    buffer.writeInt8(-5, 1)
    assert.ok(buffer.equals(new Uint8Array([0x23, 0xfb])))

    /* Make sure we handle min/max correctly */
    buffer.writeInt8(0x7f, 0)
    buffer.writeInt8(-0x80, 1)
    assert.ok(buffer.equals(new Uint8Array([0x7f, 0x80])))

    assert.throws(() => {
      buffer.writeInt8(0x7f + 1, 0)
    }, errorOutOfBounds)
    assert.throws(() => {
      buffer.writeInt8(-0x80 - 1, 0)
    }, errorOutOfBounds)

    // Verify that default offset works fine.
    // @ts-expect-error
    buffer.writeInt8(23, undefined)
    // @ts-expect-error
    buffer.writeInt8(23)
    ;['', '0', null, {}, [], () => {}, true, false].forEach((off: any) => {
      assert.throws(() => buffer.writeInt8(23, off), { code: 'ERR_INVALID_ARG_TYPE' })
    })
    ;[NaN, Infinity, -1, 1.01].forEach((off) => {
      assert.throws(() => buffer.writeInt8(23, off), { code: 'ERR_OUT_OF_RANGE' })
    })
  }

  // Test 16 bit
  {
    const buffer = Buffer.alloc(4)

    buffer.writeInt16BE(0x0023, 0)
    buffer.writeInt16LE(0x0023, 2)
    assert.ok(buffer.equals(new Uint8Array([0x00, 0x23, 0x23, 0x00])))

    buffer.writeInt16BE(-5, 0)
    buffer.writeInt16LE(-5, 2)
    assert.ok(buffer.equals(new Uint8Array([0xff, 0xfb, 0xfb, 0xff])))

    buffer.writeInt16BE(-1679, 0)
    buffer.writeInt16LE(-1679, 2)
    assert.ok(buffer.equals(new Uint8Array([0xf9, 0x71, 0x71, 0xf9])))

    /* Make sure we handle min/max correctly */
    buffer.writeInt16BE(0x7fff, 0)
    buffer.writeInt16BE(-0x8000, 2)
    assert.ok(buffer.equals(new Uint8Array([0x7f, 0xff, 0x80, 0x00])))

    buffer.writeInt16LE(0x7fff, 0)
    buffer.writeInt16LE(-0x8000, 2)
    assert.ok(buffer.equals(new Uint8Array([0xff, 0x7f, 0x00, 0x80])))
    ;['writeInt16BE', 'writeInt16LE'].forEach((fn) => {
      // Verify that default offset works fine.
      buffer[fn](23, undefined)
      buffer[fn](23)

      assert.throws(() => {
        buffer[fn](0x7fff + 1, 0)
      }, errorOutOfBounds)
      assert.throws(() => {
        buffer[fn](-0x8000 - 1, 0)
      }, errorOutOfBounds)
      ;['', '0', null, {}, [], () => {}, true, false].forEach((off) => {
        assert.throws(() => buffer[fn](23, off), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[NaN, Infinity, -1, 1.01].forEach((off) => {
        assert.throws(() => buffer[fn](23, off), { code: 'ERR_OUT_OF_RANGE' })
      })
    })
  }

  // Test 32 bit
  {
    const buffer = Buffer.alloc(8)

    buffer.writeInt32BE(0x23, 0)
    buffer.writeInt32LE(0x23, 4)
    assert.ok(buffer.equals(new Uint8Array([0x00, 0x00, 0x00, 0x23, 0x23, 0x00, 0x00, 0x00])))

    buffer.writeInt32BE(-5, 0)
    buffer.writeInt32LE(-5, 4)
    assert.ok(buffer.equals(new Uint8Array([0xff, 0xff, 0xff, 0xfb, 0xfb, 0xff, 0xff, 0xff])))

    buffer.writeInt32BE(-805306713, 0)
    buffer.writeInt32LE(-805306713, 4)
    assert.ok(buffer.equals(new Uint8Array([0xcf, 0xff, 0xfe, 0xa7, 0xa7, 0xfe, 0xff, 0xcf])))

    /* Make sure we handle min/max correctly */
    buffer.writeInt32BE(0x7fffffff, 0)
    buffer.writeInt32BE(-0x80000000, 4)
    assert.ok(buffer.equals(new Uint8Array([0x7f, 0xff, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00])))

    buffer.writeInt32LE(0x7fffffff, 0)
    buffer.writeInt32LE(-0x80000000, 4)
    assert.ok(buffer.equals(new Uint8Array([0xff, 0xff, 0xff, 0x7f, 0x00, 0x00, 0x00, 0x80])))
    ;['writeInt32BE', 'writeInt32LE'].forEach((fn) => {
      // Verify that default offset works fine.
      buffer[fn](23, undefined)
      buffer[fn](23)

      assert.throws(() => {
        buffer[fn](0x7fffffff + 1, 0)
      }, errorOutOfBounds)
      assert.throws(() => {
        buffer[fn](-0x80000000 - 1, 0)
      }, errorOutOfBounds)
      ;['', '0', null, {}, [], () => {}, true, false].forEach((off) => {
        assert.throws(() => buffer[fn](23, off), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[NaN, Infinity, -1, 1.01].forEach((off) => {
        assert.throws(() => buffer[fn](23, off), { code: 'ERR_OUT_OF_RANGE' })
      })
    })
  }

  // Test 48 bit
  {
    const value = 0x1234567890ab
    const buffer = Buffer.allocUnsafe(6)
    buffer.writeIntBE(value, 0, 6)
    assert.ok(buffer.equals(new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])))

    buffer.writeIntLE(value, 0, 6)
    assert.ok(buffer.equals(new Uint8Array([0xab, 0x90, 0x78, 0x56, 0x34, 0x12])))
  }

  // Test Int
  {
    const data = Buffer.alloc(8)

    // Check byteLength.
    ;['writeIntBE', 'writeIntLE'].forEach((fn) => {
      ;['', '0', null, {}, [], () => {}, true, false, undefined].forEach((bl) => {
        assert.throws(() => data[fn](23, 0, bl), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[Infinity, -1].forEach((byteLength) => {
        assert.throws(() => data[fn](23, 0, byteLength))
      })
      ;[NaN, 1.01].forEach((byteLength) => {
        assert.throws(() => data[fn](42, 0, byteLength), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "byteLength" is out of range. ' + `It must be an integer. Received ${byteLength}`,
        })
      })
    })

    // Test 1 to 6 bytes.
    for (let i = 1; i <= 6; i++) {
      ;['writeIntBE', 'writeIntLE'].forEach((fn) => {
        const min = -(2 ** (i * 8 - 1))
        const max = 2 ** (i * 8 - 1) - 1
        let range = `>= ${min} and <= ${max}`
        if (i > 4) {
          range = `>= -(2 ** ${i * 8 - 1}) and < 2 ** ${i * 8 - 1}`
        }
        ;[min - 1, max + 1].forEach((val) => {
          const received = i > 4 ? String(val).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1_') : val
          // assert.throws( ❌
          //   () => {
          //     data[fn](val, 0, i)
          //   },
          //   {
          //     code: 'ERR_OUT_OF_RANGE',
          //     name: 'RangeError',
          //     message: 'The value of "value" is out of range. ' + `It must be ${range}. Received ${received}`,
          //   },
          // )
        })
        ;['', '0', null, {}, [], () => {}, true, false, undefined].forEach((o) => {
          assert.throws(() => data[fn](min, o, i), {
            code: 'ERR_INVALID_ARG_TYPE',
            name: 'TypeError',
          })
        })
        ;[Infinity, -1, -4294967295].forEach((offset) => {
          assert.throws(() => data[fn](min, offset, i))
        })
        ;[NaN, 1.01].forEach((offset) => {
          assert.throws(() => data[fn](max, offset, i), {
            code: 'ERR_OUT_OF_RANGE',
            name: 'RangeError',
            message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
          })
        })
      })
    }
  }
})

test('Buffer write uint (node.js repository test)', () => {
  // We need to check the following things:
  //  - We are correctly resolving big endian (doesn't mean anything for 8 bit)
  //  - Correctly resolving little endian (doesn't mean anything for 8 bit)
  //  - Correctly using the offsets
  //  - Correctly interpreting values that are beyond the signed range as unsigned

  {
    // OOB
    const data = Buffer.alloc(8)
    ;['UInt8', 'UInt16BE', 'UInt16LE', 'UInt32BE', 'UInt32LE'].forEach((fn) => {
      // Verify that default offset works fine.
      data[`write${fn}`](23, undefined)
      data[`write${fn}`](23)
      ;['', '0', null, {}, [], () => {}, true, false].forEach((o) => {
        assert.throws(() => data[`write${fn}`](23, o), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[NaN, Infinity, -1, 1.01].forEach((o) => {
        assert.throws(() => data[`write${fn}`](23, o), { code: 'ERR_OUT_OF_RANGE' })
      })
    })
  }

  {
    // Test 8 bit
    const data = Buffer.alloc(4)

    data.writeUInt8(23, 0)
    data.writeUInt8(23, 1)
    data.writeUInt8(23, 2)
    data.writeUInt8(23, 3)
    assert.ok(data.equals(new Uint8Array([23, 23, 23, 23])))

    data.writeUInt8(23, 0)
    data.writeUInt8(23, 1)
    data.writeUInt8(23, 2)
    data.writeUInt8(23, 3)
    assert.ok(data.equals(new Uint8Array([23, 23, 23, 23])))

    data.writeUInt8(255, 0)
    assert.strictEqual(data[0], 255)

    data.writeUInt8(255, 0)
    assert.strictEqual(data[0], 255)
  }

  // Test 16 bit
  {
    let value = 0x2343
    const data = Buffer.alloc(4)

    data.writeUInt16BE(value, 0)
    assert.ok(data.equals(new Uint8Array([0x23, 0x43, 0, 0])))

    data.writeUInt16BE(value, 1)
    assert.ok(data.equals(new Uint8Array([0x23, 0x23, 0x43, 0])))

    data.writeUInt16BE(value, 2)
    assert.ok(data.equals(new Uint8Array([0x23, 0x23, 0x23, 0x43])))

    data.writeUInt16LE(value, 0)
    assert.ok(data.equals(new Uint8Array([0x43, 0x23, 0x23, 0x43])))

    data.writeUInt16LE(value, 1)
    assert.ok(data.equals(new Uint8Array([0x43, 0x43, 0x23, 0x43])))

    data.writeUInt16LE(value, 2)
    assert.ok(data.equals(new Uint8Array([0x43, 0x43, 0x43, 0x23])))

    value = 0xff80
    data.writeUInt16LE(value, 0)
    assert.ok(data.equals(new Uint8Array([0x80, 0xff, 0x43, 0x23])))

    data.writeUInt16BE(value, 0)
    assert.ok(data.equals(new Uint8Array([0xff, 0x80, 0x43, 0x23])))

    value = 0xfffff
    ;['writeUInt16BE', 'writeUInt16LE'].forEach((fn) => {
      assert.throws(() => data[fn](value, 0), {
        code: 'ERR_OUT_OF_RANGE',
        message: 'The value of "value" is out of range. ' + `It must be >= 0 and <= 65535. Received ${value}`,
      })
    })
  }

  // Test 32 bit
  {
    const data = Buffer.alloc(6)
    const value = 0xe7f90a6d

    data.writeUInt32BE(value, 0)
    assert.ok(data.equals(new Uint8Array([0xe7, 0xf9, 0x0a, 0x6d, 0, 0])))

    data.writeUInt32BE(value, 1)
    assert.ok(data.equals(new Uint8Array([0xe7, 0xe7, 0xf9, 0x0a, 0x6d, 0])))

    data.writeUInt32BE(value, 2)
    assert.ok(data.equals(new Uint8Array([0xe7, 0xe7, 0xe7, 0xf9, 0x0a, 0x6d])))

    data.writeUInt32LE(value, 0)
    assert.ok(data.equals(new Uint8Array([0x6d, 0x0a, 0xf9, 0xe7, 0x0a, 0x6d])))

    data.writeUInt32LE(value, 1)
    assert.ok(data.equals(new Uint8Array([0x6d, 0x6d, 0x0a, 0xf9, 0xe7, 0x6d])))

    data.writeUInt32LE(value, 2)
    assert.ok(data.equals(new Uint8Array([0x6d, 0x6d, 0x6d, 0x0a, 0xf9, 0xe7])))
  }

  // Test 48 bit
  {
    const value = 0x1234567890ab
    const data = Buffer.allocUnsafe(6)
    data.writeUIntBE(value, 0, 6)
    assert.ok(data.equals(new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x90, 0xab])))

    data.writeUIntLE(value, 0, 6)
    assert.ok(data.equals(new Uint8Array([0xab, 0x90, 0x78, 0x56, 0x34, 0x12])))
  }

  // Test UInt
  {
    const data = Buffer.alloc(8)
    let val = 0x100

    // Check byteLength.
    ;['writeUIntBE', 'writeUIntLE'].forEach((fn) => {
      ;['', '0', null, {}, [], () => {}, true, false, undefined].forEach((bl) => {
        assert.throws(() => data[fn](23, 0, bl), { code: 'ERR_INVALID_ARG_TYPE' })
      })
      ;[Infinity, -1].forEach((byteLength) => {
        assert.throws(() => data[fn](23, 0, byteLength))
      })
      ;[NaN, 1.01].forEach((byteLength) => {
        assert.throws(() => data[fn](42, 0, byteLength), {
          code: 'ERR_OUT_OF_RANGE',
          name: 'RangeError',
          message: 'The value of "byteLength" is out of range. ' + `It must be an integer. Received ${byteLength}`,
        })
      })
    })

    // Test 1 to 6 bytes.
    for (let i = 1; i <= 6; i++) {
      const range = i < 5 ? `= ${val - 1}` : ` 2 ** ${i * 8}`
      const received = i > 4 ? String(val).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1_') : val
      ;['writeUIntBE', 'writeUIntLE'].forEach((fn) => {
        // assert.throws(  ❌
        //   () => {
        //     data[fn](val, 0, i)
        //   },
        //   {
        //     code: 'ERR_OUT_OF_RANGE',
        //     name: 'RangeError',
        //     message: 'The value of "value" is out of range. ' + `It must be >= 0 and <${range}. Received ${received}`,
        //   },
        // )
        ;['', '0', null, {}, [], () => {}, true, false].forEach((o) => {
          assert.throws(() => data[fn](23, o, i), {
            code: 'ERR_INVALID_ARG_TYPE',
            name: 'TypeError',
          })
        })
        ;[Infinity, -1, -4294967295].forEach((offset) => {
          assert.throws(() => data[fn](val - 1, offset, i))
        })
        ;[NaN, 1.01].forEach((offset) => {
          assert.throws(() => data[fn](val - 1, offset, i), {
            code: 'ERR_OUT_OF_RANGE',
            name: 'RangeError',
            message: 'The value of "offset" is out of range. ' + `It must be an integer. Received ${offset}`,
          })
        })
      })

      val *= 0x100
    }
  }

  for (const fn of [
    'UInt8',
    'UInt16LE',
    'UInt16BE',
    'UInt32LE',
    'UInt32BE',
    'UIntLE',
    'UIntBE',
    'BigUInt64LE',
    'BigUInt64BE',
  ]) {
    const p = Buffer.prototype
    const lowerFn = fn.replace(/UInt/, 'Uint')
    // assert.strictEqual(p[`write${fn}`], p[`write${lowerFn}`])
    // assert.strictEqual(p[`read${fn}`], p[`read${lowerFn}`])
  }
})

test('Buffer zero fill (node.js repository test)', () => {
  // Tests deprecated Buffer API on purpose
  const buf1 = Buffer(100)
  const buf2 = new Buffer(100)
  for (let n = 0; n < buf1.length; n++) assert.strictEqual(buf1[n], 0)
  for (let n = 0; n < buf2.length; n++) assert.strictEqual(buf2[n], 0)
})

test('Buffer bigint64 (node.js repository test)', () => {
  const buf = Buffer.allocUnsafe(8)

  ;['LE', 'BE'].forEach(function (endianness) {
    // Should allow simple BigInts to be written and read
    let val = 123456789n
    buf[`writeBigInt64${endianness}`](val, 0)
    let rtn = buf[`readBigInt64${endianness}`](0)
    assert.strictEqual(val, rtn)

    // Should allow INT64_MAX to be written and read
    val = 0x7fffffffffffffffn
    buf[`writeBigInt64${endianness}`](val, 0)
    rtn = buf[`readBigInt64${endianness}`](0)
    assert.strictEqual(val, rtn)

    // Should read and write a negative signed 64-bit integer
    val = -123456789n
    buf[`writeBigInt64${endianness}`](val, 0)
    assert.strictEqual(val, buf[`readBigInt64${endianness}`](0))

    // Should read and write an unsigned 64-bit integer
    val = 123456789n
    buf[`writeBigUInt64${endianness}`](val, 0)
    assert.strictEqual(val, buf[`readBigUInt64${endianness}`](0))

    // Should throw a RangeError upon INT64_MAX+1 being written
    assert.throws(function () {
      const val = 0x8000000000000000n
      buf[`writeBigInt64${endianness}`](val, 0)
    }, RangeError)

    // Should throw a RangeError upon UINT64_MAX+1 being written
    assert.throws(
      function () {
        const val = 0x10000000000000000n
        buf[`writeBigUInt64${endianness}`](val, 0)
      },
      {
        code: 'ERR_OUT_OF_RANGE',
        message:
          'The value of "value" is out of range. It must be ' +
          '>= 0 and <= 18446744073709551615. Received 18446744073709551616',
        // ❌ Original '>= 0n and < 2n ** 64n. Received 18_446_744_073_709_551_616n',
      },
    )

    // Should throw a TypeError upon invalid input
    assert.throws(function () {
      buf[`writeBigInt64${endianness}`]('bad', 0)
    }, SyntaxError)

    // Should throw a TypeError upon invalid input
    assert.throws(function () {
      buf[`writeBigUInt64${endianness}`]('bad', 0)
    }, SyntaxError)
  })
})

test('Buffer alloc (node.js repository test)', () => {
  const b = Buffer.allocUnsafe(1024)
  assert.strictEqual(b.length, 1024)

  b[0] = -1
  assert.strictEqual(b[0], 255)

  for (let i = 0; i < 1024; i++) {
    b[i] = i % 256
  }

  for (let i = 0; i < 1024; i++) {
    assert.strictEqual(i % 256, b[i])
  }

  const c = Buffer.allocUnsafe(512)
  assert.strictEqual(c.length, 512)

  const d = Buffer.from([])
  assert.strictEqual(d.length, 0)

  // Test offset properties
  {
    const b = Buffer.alloc(128)
    assert.strictEqual(b.length, 128)
    assert.strictEqual(b.byteOffset, 0)
    assert.strictEqual(b.offset, 0)
  }

  // Test creating a Buffer from a Uint8Array
  {
    const ui8 = new Uint8Array(4).fill(42)
    const e = Buffer.from(ui8)
    for (const [index, value] of e.entries()) {
      assert.strictEqual(value, ui8[index])
    }
  }
  // Test creating a Buffer from a Uint8Array (old constructor)
  {
    const ui8 = new Uint8Array(4).fill(42)
    const e = new Buffer(ui8)
    for (const [key, value] of e.entries()) {
      assert.strictEqual(value, ui8[key])
    }
  }

  // Test creating a Buffer from a Uint32Array
  // Note: it is implicitly interpreted as Array of integers modulo 256
  {
    const ui32 = new Uint32Array(4).fill(42)
    const e = Buffer.from(ui32)
    for (const [index, value] of e.entries()) {
      assert.strictEqual(value, ui32[index])
    }
  }
  // Test creating a Buffer from a Uint32Array (old constructor)
  // Note: it is implicitly interpreted as Array of integers modulo 256
  {
    const ui32 = new Uint32Array(4).fill(42)
    const e = Buffer(ui32)
    for (const [key, value] of e.entries()) {
      assert.strictEqual(value, ui32[key])
    }
  }

  // Test invalid encoding for Buffer.toString
  // @ts-expect-error
  assert.throws(() => b.toString('invalid'))
  // Invalid encoding for Buffer.write
  // @ts-expect-error
  assert.throws(() => b.write('test string', 0, 5, 'invalid'))
  // Unsupported arguments for Buffer.write
  // assert.throws(() => b.write('test', 'utf8', 0), { code: 'ERR_INVALID_ARG_TYPE' }) ❌

  // Try to create 0-length buffers. Should not throw.
  Buffer.from('')
  Buffer.from('', 'ascii')
  Buffer.from('', 'latin1')
  Buffer.alloc(0)
  Buffer.allocUnsafe(0)
  // @ts-expect-error
  new Buffer('')
  // @ts-expect-error
  new Buffer('', 'ascii')
  // @ts-expect-error
  new Buffer('', 'latin1')
  // @ts-expect-error
  new Buffer('', 'binary')
  Buffer(0)

  const outOfRangeError = {
    code: 'ERR_OUT_OF_RANGE',
    name: 'RangeError',
  }

  // Try to write a 0-length string beyond the end of b
  assert.throws(() => b.write('', 2048), outOfRangeError)

  // Throw when writing to negative offset
  assert.throws(() => b.write('a', -1), outOfRangeError)

  // Throw when writing past bounds from the pool
  assert.throws(() => b.write('a', 2048), outOfRangeError)

  // Throw when writing to negative offset
  assert.throws(() => b.write('a', -1), outOfRangeError)

  // Try to copy 0 bytes worth of data into an empty buffer
  b.copy(Buffer.alloc(0), 0, 0, 0)

  // Try to copy 0 bytes past the end of the target buffer
  b.copy(Buffer.alloc(0), 1, 1, 1)
  b.copy(Buffer.alloc(1), 1, 1, 1)

  // Try to copy 0 bytes from past the end of the source buffer
  b.copy(Buffer.alloc(1), 0, 1024, 1024)

  // Testing for smart defaults and ability to pass string values as offset
  {
    const writeTest = Buffer.from('abcdes')
    writeTest.write('n', 'ascii')
    // @ts-expect-error
    assert.throws(() => writeTest.write('o', '1', 'ascii'))
    writeTest.write('o', 1, 'ascii')
    writeTest.write('d', 2, 'ascii')
    writeTest.write('e', 3, 'ascii')
    writeTest.write('j', 4, 'ascii')
    assert.strictEqual(writeTest.toString(), 'nodejs')
  }

  // Offset points to the end of the buffer and does not throw.
  // (see https://github.com/nodejs/node/issues/8127).
  Buffer.alloc(1).write('', 1, 0)

  // ASCII slice test
  {
    const asciiString = 'hello world'

    for (let i = 0; i < asciiString.length; i++) {
      b[i] = asciiString.charCodeAt(i)
    }
    const asciiSlice = b.toString('ascii', 0, asciiString.length)
    assert.strictEqual(asciiString, asciiSlice)
  }

  {
    const asciiString = 'hello world'
    const offset = 100

    assert.strictEqual(asciiString.length, b.write(asciiString, offset, 'ascii'))
    const asciiSlice = b.toString('ascii', offset, offset + asciiString.length)
    assert.strictEqual(asciiString, asciiSlice)
  }

  {
    const asciiString = 'hello world'
    const offset = 100

    const sliceA = b.slice(offset, offset + asciiString.length)
    const sliceB = b.slice(offset, offset + asciiString.length)
    for (let i = 0; i < asciiString.length; i++) {
      assert.strictEqual(sliceA[i], sliceB[i])
    }
  }

  // UTF-8 slice test
  {
    const utf8String = '¡hέlló wôrld!'
    const offset = 100

    b.write(utf8String, 0, Buffer.byteLength(utf8String), 'utf8')
    let utf8Slice = b.toString('utf8', 0, Buffer.byteLength(utf8String))
    assert.strictEqual(utf8String, utf8Slice)

    assert.strictEqual(Buffer.byteLength(utf8String), b.write(utf8String, offset, 'utf8'))
    utf8Slice = b.toString('utf8', offset, offset + Buffer.byteLength(utf8String))
    assert.strictEqual(utf8String, utf8Slice)

    const sliceA = b.slice(offset, offset + Buffer.byteLength(utf8String))
    const sliceB = b.slice(offset, offset + Buffer.byteLength(utf8String))
    for (let i = 0; i < Buffer.byteLength(utf8String); i++) {
      assert.strictEqual(sliceA[i], sliceB[i])
    }
  }

  {
    const slice = b.slice(100, 150)
    assert.strictEqual(slice.length, 50)
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(b[100 + i], slice[i])
    }
  }

  {
    // Make sure only top level parent propagates from allocPool
    const b = Buffer.allocUnsafe(5)
    const c = b.slice(0, 4)
    const d = c.slice(0, 2)
    // @ts-expect-error
    assert.strictEqual(b.parent, c.parent)
    // @ts-expect-error
    assert.strictEqual(b.parent, d.parent)
  }

  {
    // Also from a non-pooled instance
    const b = Buffer.allocUnsafeSlow(5)
    const c = b.slice(0, 4)
    const d = c.slice(0, 2)
    // @ts-expect-error
    assert.strictEqual(c.parent, d.parent)
  }

  {
    // Bug regression test
    const testValue = '\u00F6\u65E5\u672C\u8A9E' // ö日本語
    const buffer = Buffer.allocUnsafe(32)
    const size = buffer.write(testValue, 0, 'utf8')
    const slice = buffer.toString('utf8', 0, size)
    assert.strictEqual(slice, testValue)
  }

  {
    // Test triple  slice
    const a = Buffer.allocUnsafe(8)
    for (let i = 0; i < 8; i++) a[i] = i
    const b = a.slice(4, 8)
    assert.strictEqual(b[0], 4)
    assert.strictEqual(b[1], 5)
    assert.strictEqual(b[2], 6)
    assert.strictEqual(b[3], 7)
    const c = b.slice(2, 4)
    assert.strictEqual(c[0], 6)
    assert.strictEqual(c[1], 7)
  }

  {
    const d = Buffer.from([23, 42, 255])
    assert.strictEqual(d.length, 3)
    assert.strictEqual(d[0], 23)
    assert.strictEqual(d[1], 42)
    assert.strictEqual(d[2], 255)
    assert.deepStrictEqual(d, Buffer.from(d))
  }

  {
    // Test for proper UTF-8 Encoding
    const e = Buffer.from('über')
    assert.deepStrictEqual(e, Buffer.from([195, 188, 98, 101, 114]))
  }

  {
    // Test for proper ascii Encoding, length should be 4
    const f = Buffer.from('über', 'ascii')
    assert.deepStrictEqual(f, Buffer.from([252, 98, 101, 114]))
  }

  ;['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
    {
      // Test for proper UTF16LE encoding, length should be 8
      const f = Buffer.from('über', encoding)
      assert.deepStrictEqual(f, Buffer.from([252, 0, 98, 0, 101, 0, 114, 0]))
    }

    {
      // Length should be 12
      const f = Buffer.from('привет', encoding)
      assert.deepStrictEqual(f, Buffer.from([63, 4, 64, 4, 56, 4, 50, 4, 53, 4, 66, 4]))
      assert.strictEqual(f.toString(encoding as any), 'привет')
    }

    {
      const f = Buffer.from([0, 0, 0, 0, 0])
      assert.strictEqual(f.length, 5)
      const size = f.write('あいうえお', encoding as any)
      assert.strictEqual(size, 4)
      assert.deepStrictEqual(f, Buffer.from([0x42, 0x30, 0x44, 0x30, 0x00]))
    }
  })

  {
    const f = Buffer.from('\uD83D\uDC4D', 'utf-16le') // THUMBS UP SIGN (U+1F44D)
    assert.strictEqual(f.length, 4)
    assert.deepStrictEqual(f, Buffer.from('3DD84DDC', 'hex'))
  }

  // Test construction from arrayish object
  {
    const arrayIsh = { 0: 0, 1: 1, 2: 2, 3: 3, length: 4 }
    let g = Buffer.from(arrayIsh)
    assert.deepStrictEqual(g, Buffer.from([0, 1, 2, 3]))
    const strArrayIsh = { 0: '0', 1: '1', 2: '2', 3: '3', length: 4 }
    g = Buffer.from(strArrayIsh)
    assert.deepStrictEqual(g, Buffer.from([0, 1, 2, 3]))
  }

  //
  // Test toString('base64')
  //
  assert.strictEqual(Buffer.from('Man').toString('base64'), 'TWFu')
  assert.strictEqual(Buffer.from('Woman').toString('base64'), 'V29tYW4=')

  //
  // Test toString('base64url')
  //
  assert.strictEqual(Buffer.from('Man').toString('base64url'), 'TWFu')
  assert.strictEqual(Buffer.from('Woman').toString('base64url'), 'V29tYW4')

  {
    // Test that regular and URL-safe base64 both work both ways
    const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff]
    assert.deepStrictEqual(Buffer.from('//++/++/++//', 'base64'), Buffer.from(expected))
    assert.deepStrictEqual(Buffer.from('__--_--_--__', 'base64'), Buffer.from(expected))
    assert.deepStrictEqual(Buffer.from('//++/++/++//', 'base64url'), Buffer.from(expected))
    assert.deepStrictEqual(Buffer.from('__--_--_--__', 'base64url'), Buffer.from(expected))
  }

  const base64flavors = ['base64', 'base64url']

  {
    // Test that regular and URL-safe base64 both work both ways with padding
    const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff, 0xfb]
    assert.deepStrictEqual(Buffer.from('//++/++/++//+w==', 'base64'), Buffer.from(expected))
    assert.deepStrictEqual(Buffer.from('//++/++/++//+w==', 'base64'), Buffer.from(expected))
    assert.deepStrictEqual(Buffer.from('//++/++/++//+w==', 'base64url'), Buffer.from(expected))
    assert.deepStrictEqual(Buffer.from('//++/++/++//+w==', 'base64url'), Buffer.from(expected))
  }

  {
    // big example
    const quote =
      'Man is distinguished, not only by his reason, but by this ' +
      'singular passion from other animals, which is a lust ' +
      'of the mind, that by a perseverance of delight in the ' +
      'continued and indefatigable generation of knowledge, ' +
      'exceeds the short vehemence of any carnal pleasure.'
    const expected =
      'TWFuIGlzIGRpc3Rpbmd1aXNoZWQsIG5vdCBvbmx5IGJ5IGhpcyByZWFzb' +
      '24sIGJ1dCBieSB0aGlzIHNpbmd1bGFyIHBhc3Npb24gZnJvbSBvdGhlci' +
      'BhbmltYWxzLCB3aGljaCBpcyBhIGx1c3Qgb2YgdGhlIG1pbmQsIHRoYXQ' +
      'gYnkgYSBwZXJzZXZlcmFuY2Ugb2YgZGVsaWdodCBpbiB0aGUgY29udGlu' +
      'dWVkIGFuZCBpbmRlZmF0aWdhYmxlIGdlbmVyYXRpb24gb2Yga25vd2xlZ' +
      'GdlLCBleGNlZWRzIHRoZSBzaG9ydCB2ZWhlbWVuY2Ugb2YgYW55IGNhcm' +
      '5hbCBwbGVhc3VyZS4='
    assert.strictEqual(Buffer.from(quote).toString('base64'), expected)
    assert.strictEqual(
      Buffer.from(quote).toString('base64url'),
      expected.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
    )

    base64flavors.forEach((encoding) => {
      let b = Buffer.allocUnsafe(1024)
      let bytesWritten = b.write(expected, 0, encoding as any)
      assert.strictEqual(quote.length, bytesWritten)
      assert.strictEqual(quote, b.toString('ascii', 0, quote.length))

      // Check that the base64 decoder ignores whitespace
      const expectedWhite =
        `${expected.slice(0, 60)} \n` +
        `${expected.slice(60, 120)} \n` +
        `${expected.slice(120, 180)} \n` +
        `${expected.slice(180, 240)} \n` +
        `${expected.slice(240, 300)}\n` +
        `${expected.slice(300, 360)}\n`
      b = Buffer.allocUnsafe(1024)
      bytesWritten = b.write(expectedWhite, 0, encoding as any)
      assert.strictEqual(quote.length, bytesWritten)
      assert.strictEqual(quote, b.toString('ascii', 0, quote.length))

      // Check that the base64 decoder on the constructor works
      // even in the presence of whitespace.
      b = Buffer.from(expectedWhite, encoding)
      assert.strictEqual(quote.length, b.length)
      assert.strictEqual(quote, b.toString('ascii', 0, quote.length))

      // Check that the base64 decoder ignores illegal chars
      const expectedIllegal =
        expected.slice(0, 60) +
        ' \x80' +
        expected.slice(60, 120) +
        ' \xff' +
        expected.slice(120, 180) +
        ' \x00' +
        expected.slice(180, 240) +
        ' \x98' +
        expected.slice(240, 300) +
        '\x03' +
        expected.slice(300, 360)
      // b = Buffer.from(expectedIllegal, encoding) ❌
      assert.strictEqual(quote.length, b.length)
      assert.strictEqual(quote, b.toString('ascii', 0, quote.length))
    })
  }

  base64flavors.forEach((encoding) => {
    assert.strictEqual(Buffer.from('', encoding).toString(), '')
    // assert.strictEqual(Buffer.from('K', encoding).toString(), '')

    // multiple-of-4 with padding
    assert.strictEqual(Buffer.from('Kg==', encoding).toString(), '*')
    assert.strictEqual(Buffer.from('Kio=', encoding).toString(), '*'.repeat(2))
    assert.strictEqual(Buffer.from('Kioq', encoding).toString(), '*'.repeat(3))
    assert.strictEqual(Buffer.from('KioqKg==', encoding).toString(), '*'.repeat(4))
    assert.strictEqual(Buffer.from('KioqKio=', encoding).toString(), '*'.repeat(5))
    assert.strictEqual(Buffer.from('KioqKioq', encoding).toString(), '*'.repeat(6))
    assert.strictEqual(Buffer.from('KioqKioqKg==', encoding).toString(), '*'.repeat(7))
    assert.strictEqual(Buffer.from('KioqKioqKio=', encoding).toString(), '*'.repeat(8))
    assert.strictEqual(Buffer.from('KioqKioqKioq', encoding).toString(), '*'.repeat(9))
    assert.strictEqual(Buffer.from('KioqKioqKioqKg==', encoding).toString(), '*'.repeat(10))
    assert.strictEqual(Buffer.from('KioqKioqKioqKio=', encoding).toString(), '*'.repeat(11))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioq', encoding).toString(), '*'.repeat(12))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKg==', encoding).toString(), '*'.repeat(13))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKio=', encoding).toString(), '*'.repeat(14))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioq', encoding).toString(), '*'.repeat(15))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKg==', encoding).toString(), '*'.repeat(16))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKio=', encoding).toString(), '*'.repeat(17))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioq', encoding).toString(), '*'.repeat(18))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKg==', encoding).toString(), '*'.repeat(19))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKio=', encoding).toString(), '*'.repeat(20))

    // No padding, not a multiple of 4
    assert.strictEqual(Buffer.from('Kg', encoding).toString(), '*')
    assert.strictEqual(Buffer.from('Kio', encoding).toString(), '*'.repeat(2))
    assert.strictEqual(Buffer.from('KioqKg', encoding).toString(), '*'.repeat(4))
    assert.strictEqual(Buffer.from('KioqKio', encoding).toString(), '*'.repeat(5))
    assert.strictEqual(Buffer.from('KioqKioqKg', encoding).toString(), '*'.repeat(7))
    assert.strictEqual(Buffer.from('KioqKioqKio', encoding).toString(), '*'.repeat(8))
    assert.strictEqual(Buffer.from('KioqKioqKioqKg', encoding).toString(), '*'.repeat(10))
    assert.strictEqual(Buffer.from('KioqKioqKioqKio', encoding).toString(), '*'.repeat(11))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKg', encoding).toString(), '*'.repeat(13))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKio', encoding).toString(), '*'.repeat(14))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKg', encoding).toString(), '*'.repeat(16))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKio', encoding).toString(), '*'.repeat(17))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKg', encoding).toString(), '*'.repeat(19))
    assert.strictEqual(Buffer.from('KioqKioqKioqKioqKioqKioqKio', encoding).toString(), '*'.repeat(20))
  })

  // Handle padding graciously, multiple-of-4 or not
  assert.strictEqual(Buffer.from('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw==', 'base64').length, 32)
  assert.strictEqual(Buffer.from('72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw==', 'base64url').length, 32)
  assert.strictEqual(Buffer.from('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw=', 'base64').length, 32)
  assert.strictEqual(Buffer.from('72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw=', 'base64url').length, 32)
  assert.strictEqual(Buffer.from('72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw', 'base64').length, 32)
  assert.strictEqual(Buffer.from('72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw', 'base64url').length, 32)
  assert.strictEqual(Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg==', 'base64').length, 31)
  assert.strictEqual(Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg==', 'base64url').length, 31)
  assert.strictEqual(Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg=', 'base64').length, 31)
  assert.strictEqual(Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg=', 'base64url').length, 31)
  assert.strictEqual(Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg', 'base64').length, 31)
  assert.strictEqual(Buffer.from('w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg', 'base64url').length, 31)

  {
    // This string encodes single '.' character in UTF-16
    const dot = Buffer.from('//4uAA==', 'base64')
    assert.strictEqual(dot[0], 0xff)
    assert.strictEqual(dot[1], 0xfe)
    assert.strictEqual(dot[2], 0x2e)
    assert.strictEqual(dot[3], 0x00)
    assert.strictEqual(dot.toString('base64'), '//4uAA==')
  }

  {
    // This string encodes single '.' character in UTF-16
    const dot = Buffer.from('//4uAA', 'base64url')
    assert.strictEqual(dot[0], 0xff)
    assert.strictEqual(dot[1], 0xfe)
    assert.strictEqual(dot[2], 0x2e)
    assert.strictEqual(dot[3], 0x00)
    assert.strictEqual(dot.toString('base64url'), '__4uAA')
  }

  {
    // Writing base64 at a position > 0 should not mangle the result.
    //
    // https://github.com/joyent/node/issues/402
    const segments = ['TWFkbmVzcz8h', 'IFRoaXM=', 'IGlz', 'IG5vZGUuanMh']
    const b = Buffer.allocUnsafe(64)
    let pos = 0

    for (let i = 0; i < segments.length; ++i) {
      pos += b.write(segments[i], pos, 'base64')
    }
    assert.strictEqual(b.toString('latin1', 0, pos), 'Madness?! This is node.js!')
  }

  {
    // Writing base64url at a position > 0 should not mangle the result.
    //
    // https://github.com/joyent/node/issues/402
    const segments = ['TWFkbmVzcz8h', 'IFRoaXM', 'IGlz', 'IG5vZGUuanMh']
    const b = Buffer.allocUnsafe(64)
    let pos = 0

    for (let i = 0; i < segments.length; ++i) {
      pos += b.write(segments[i], pos, 'base64url')
    }
    assert.strictEqual(b.toString('latin1', 0, pos), 'Madness?! This is node.js!')
  }

  // Regression test for https://github.com/nodejs/node/issues/3496.
  // assert.strictEqual(Buffer.from('=bad'.repeat(1e4), 'base64').length, 0) ❌

  // Regression test for https://github.com/nodejs/node/issues/11987.
  assert.deepStrictEqual(Buffer.from('w0  ', 'base64'), Buffer.from('w0', 'base64'))

  // Regression test for https://github.com/nodejs/node/issues/13657.
  assert.deepStrictEqual(Buffer.from(' YWJvcnVtLg', 'base64'), Buffer.from('YWJvcnVtLg', 'base64'))

  {
    // Creating buffers larger than pool size.
    const l = Buffer['poolSize'] + 5
    const s = 'h'.repeat(l)
    const b = Buffer.from(s)

    for (let i = 0; i < l; i++) {
      assert.strictEqual(b[i], 'h'.charCodeAt(0))
    }

    const sb = b.toString()
    assert.strictEqual(sb.length, s.length)
    assert.strictEqual(sb, s)
  }

  {
    // test hex toString
    const hexb = Buffer.allocUnsafe(256)
    for (let i = 0; i < 256; i++) {
      hexb[i] = i
    }
    const hexStr = hexb.toString('hex')
    assert.strictEqual(
      hexStr,
      '000102030405060708090a0b0c0d0e0f' +
        '101112131415161718191a1b1c1d1e1f' +
        '202122232425262728292a2b2c2d2e2f' +
        '303132333435363738393a3b3c3d3e3f' +
        '404142434445464748494a4b4c4d4e4f' +
        '505152535455565758595a5b5c5d5e5f' +
        '606162636465666768696a6b6c6d6e6f' +
        '707172737475767778797a7b7c7d7e7f' +
        '808182838485868788898a8b8c8d8e8f' +
        '909192939495969798999a9b9c9d9e9f' +
        'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf' +
        'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf' +
        'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf' +
        'd0d1d2d3d4d5d6d7d8d9dadbdcdddedf' +
        'e0e1e2e3e4e5e6e7e8e9eaebecedeeef' +
        'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
    )

    const hexb2 = Buffer.from(hexStr, 'hex')
    for (let i = 0; i < 256; i++) {
      assert.strictEqual(hexb2[i], hexb[i])
    }
  }

  // Test single hex character is discarded.
  assert.strictEqual(Buffer.from('A', 'hex').length, 0)

  // Test that if a trailing character is discarded, rest of string is processed.
  assert.deepStrictEqual(Buffer.from('Abx', 'hex'), Buffer.from('Ab', 'hex'))

  // Test single base64 char encodes as 0.
  // assert.strictEqual(Buffer.from('A', 'base64').length, 0)

  {
    // Test an invalid slice end.
    const b = Buffer.from([1, 2, 3, 4, 5])
    const b2 = b.toString('hex', 1, 10000)
    const b3 = b.toString('hex', 1, 5)
    const b4 = b.toString('hex', 1)
    assert.strictEqual(b2, b3)
    assert.strictEqual(b2, b4)
  }

  function buildBuffer(data) {
    if (Array.isArray(data)) {
      const buffer = Buffer.allocUnsafe(data.length)
      data.forEach((v, k) => (buffer[k] = v))
      return buffer
    }
    return null
  }

  const x = buildBuffer([0x81, 0xa3, 0x66, 0x6f, 0x6f, 0xa3, 0x62, 0x61, 0x72]) as any

  assert.strictEqual(x.inspect(), '<Buffer 81 a3 66 6f 6f a3 62 61 72>')

  {
    const z = x.slice(4)
    assert.strictEqual(z.length, 5)
    assert.strictEqual(z[0], 0x6f)
    assert.strictEqual(z[1], 0xa3)
    assert.strictEqual(z[2], 0x62)
    assert.strictEqual(z[3], 0x61)
    assert.strictEqual(z[4], 0x72)
  }

  {
    const z = x.slice(0)
    assert.strictEqual(z.length, x.length)
  }

  {
    const z = x.slice(0, 4)
    assert.strictEqual(z.length, 4)
    assert.strictEqual(z[0], 0x81)
    assert.strictEqual(z[1], 0xa3)
  }

  {
    const z = x.slice(0, 9)
    assert.strictEqual(z.length, 9)
  }

  {
    const z = x.slice(1, 4)
    assert.strictEqual(z.length, 3)
    assert.strictEqual(z[0], 0xa3)
  }

  {
    const z = x.slice(2, 4)
    assert.strictEqual(z.length, 2)
    assert.strictEqual(z[0], 0x66)
    assert.strictEqual(z[1], 0x6f)
  }

  ;['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding: any) => {
    const b = Buffer.allocUnsafe(10)
    b.write('あいうえお', encoding)
    assert.strictEqual(b.toString(encoding), 'あいうえお')
  })
  ;['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding) => {
    const b = Buffer.allocUnsafe(11)
    b.write('あいうえお', 1, encoding as any)
    assert.strictEqual(b.toString(encoding as any, 1), 'あいうえお')
  })

  {
    // latin1 encoding should write only one byte per character.
    const b = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    let s = String.fromCharCode(0xffff)
    b.write(s, 0, 'latin1')
    assert.strictEqual(b[0], 0xff)
    assert.strictEqual(b[1], 0xad)
    assert.strictEqual(b[2], 0xbe)
    assert.strictEqual(b[3], 0xef)
    s = String.fromCharCode(0xaaee)
    b.write(s, 0, 'latin1')
    assert.strictEqual(b[0], 0xee)
    assert.strictEqual(b[1], 0xad)
    assert.strictEqual(b[2], 0xbe)
    assert.strictEqual(b[3], 0xef)
  }

  {
    // Binary encoding should write only one byte per character.
    const b = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    let s = String.fromCharCode(0xffff)
    b.write(s, 0, 'latin1')
    assert.strictEqual(b[0], 0xff)
    assert.strictEqual(b[1], 0xad)
    assert.strictEqual(b[2], 0xbe)
    assert.strictEqual(b[3], 0xef)
    s = String.fromCharCode(0xaaee)
    b.write(s, 0, 'latin1')
    assert.strictEqual(b[0], 0xee)
    assert.strictEqual(b[1], 0xad)
    assert.strictEqual(b[2], 0xbe)
    assert.strictEqual(b[3], 0xef)
  }

  {
    // https://github.com/nodejs/node-v0.x-archive/pull/1210
    // Test UTF-8 string includes null character
    let buf = Buffer.from('\0')
    assert.strictEqual(buf.length, 1)
    buf = Buffer.from('\0\0')
    assert.strictEqual(buf.length, 2)
  }

  {
    const buf = Buffer.allocUnsafe(2)
    assert.strictEqual(buf.write(''), 0) // 0bytes
    assert.strictEqual(buf.write('\0'), 1) // 1byte (v8 adds null terminator)
    assert.strictEqual(buf.write('a\0'), 2) // 1byte * 2
    // assert.strictEqual(buf.write('あ'), 0) // 3bytes ❌
    // assert.strictEqual(buf.write('\0あ'), 1) // 1byte + 3bytes ❌
    assert.strictEqual(buf.write('\0\0あ'), 2) // 1byte * 2 + 3bytes
  }

  {
    const buf = Buffer.allocUnsafe(10)
    assert.strictEqual(buf.write('あいう'), 9) // 3bytes * 3 (v8 adds null term.)
    assert.strictEqual(buf.write('あいう\0'), 10) // 3bytes * 3 + 1byte
  }

  {
    // https://github.com/nodejs/node-v0.x-archive/issues/243
    // Test write() with maxLength
    const buf = Buffer.allocUnsafe(4)
    buf.fill(0xff)
    assert.strictEqual(buf.write('abcd', 1, 2, 'utf8'), 2)
    assert.strictEqual(buf[0], 0xff)
    assert.strictEqual(buf[1], 0x61)
    assert.strictEqual(buf[2], 0x62)
    assert.strictEqual(buf[3], 0xff)

    buf.fill(0xff)
    assert.strictEqual(buf.write('abcd', 1, 4), 3)
    assert.strictEqual(buf[0], 0xff)
    assert.strictEqual(buf[1], 0x61)
    assert.strictEqual(buf[2], 0x62)
    assert.strictEqual(buf[3], 0x63)

    buf.fill(0xff)
    assert.strictEqual(buf.write('abcd', 1, 2, 'utf8'), 2)
    assert.strictEqual(buf[0], 0xff)
    assert.strictEqual(buf[1], 0x61)
    assert.strictEqual(buf[2], 0x62)
    assert.strictEqual(buf[3], 0xff)

    buf.fill(0xff)
    assert.strictEqual(buf.write('abcdef', 1, 2, 'hex'), 2)
    assert.strictEqual(buf[0], 0xff)
    assert.strictEqual(buf[1], 0xab)
    assert.strictEqual(buf[2], 0xcd)
    assert.strictEqual(buf[3], 0xff)
    ;['ucs2', 'ucs-2', 'utf16le', 'utf-16le'].forEach((encoding: any) => {
      buf.fill(0xff)
      assert.strictEqual(buf.write('abcd', 0, 2, encoding), 2)
      assert.strictEqual(buf[0], 0x61)
      assert.strictEqual(buf[1], 0x00)
      assert.strictEqual(buf[2], 0xff)
      assert.strictEqual(buf[3], 0xff)
    })
  }

  {
    // Test offset returns are correct
    const b = Buffer.allocUnsafe(16)
    assert.strictEqual(b.writeUInt32LE(0, 0), 4)
    assert.strictEqual(b.writeUInt16LE(0, 4), 6)
    assert.strictEqual(b.writeUInt8(0, 6), 7)
    assert.strictEqual(b.writeInt8(0, 7), 8)
    assert.strictEqual(b.writeDoubleLE(0, 8), 16)
  }

  {
    // Test unmatched surrogates not producing invalid utf8 output
    // ef bf bd = utf-8 representation of unicode replacement character
    // see https://codereview.chromium.org/121173009/
    const buf = Buffer.from('ab\ud800cd', 'utf8')
    assert.strictEqual(buf[0], 0x61)
    assert.strictEqual(buf[1], 0x62)
    assert.strictEqual(buf[2], 0xef)
    assert.strictEqual(buf[3], 0xbf)
    assert.strictEqual(buf[4], 0xbd)
    assert.strictEqual(buf[5], 0x63)
    assert.strictEqual(buf[6], 0x64)
  }

  {
    // Test for buffer overrun
    const buf = Buffer.from([0, 0, 0, 0, 0]) // length: 5
    const sub = buf.slice(0, 4) // length: 4
    assert.strictEqual(sub.write('12345', 'latin1'), 4)
    assert.strictEqual(buf[4], 0)
    assert.strictEqual(sub.write('12345', 'binary'), 4)
    assert.strictEqual(buf[4], 0)
  }

  {
    // Test alloc with fill option
    const buf = Buffer.alloc(5, '800A', 'hex')
    assert.strictEqual(buf[0], 128)
    assert.strictEqual(buf[1], 10)
    assert.strictEqual(buf[2], 128)
    assert.strictEqual(buf[3], 10)
    assert.strictEqual(buf[4], 128)
  }

  // Check for fractional length args, junk length args, etc.
  // https://github.com/joyent/node/issues/1758

  // Call .fill() first, stops valgrind warning about uninitialized memory reads.
  Buffer.allocUnsafe(3.3).fill().toString()
  // Throws bad argument error in commit 43cb4ec
  Buffer.alloc(3.3).fill().toString()
  assert.strictEqual(Buffer.allocUnsafe(3.3).length, 3)
  assert.strictEqual(Buffer.from({ length: 3.3 }).length, 3)
  assert.strictEqual(Buffer.from({ length: 'BAM' }).length, 0)

  // Make sure that strings are not coerced to numbers.
  assert.strictEqual(Buffer.from('99').length, 2)
  assert.strictEqual(Buffer.from('13.37').length, 5)

  // Ensure that the length argument is respected.
  ;['ascii', 'utf8', 'hex', 'base64', 'latin1', 'binary'].forEach((enc: any) => {
    assert.strictEqual(Buffer.allocUnsafe(1).write('aaaaaa', 0, 1, enc), 1)
  })

  {
    // Regression test, guard against buffer overrun in the base64 decoder.
    const a = Buffer.allocUnsafe(3)
    const b = Buffer.from('xxx')
    a.write('aaaaaaaa', 'base64')
    assert.strictEqual(b.toString(), 'xxx')
  }

  // @ts-expect-error ssue GH-3416
  Buffer.from(Buffer.allocUnsafe(0), 0, 0)

  // issue GH-5587
  assert.throws(() => Buffer.alloc(8).writeFloatLE(0, 5))
  assert.throws(() => Buffer.alloc(16).writeDoubleLE(0, 9))

  // Attempt to overflow buffers, similar to previous bug in array buffers
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff))
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff))

  // Ensure negative values can't get past offset
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1))
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1))

  // Test for common write(U)IntLE/BE
  {
    let buf = Buffer.allocUnsafe(3)
    buf.writeUIntLE(0x123456, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12])
    assert.strictEqual(buf.readUIntLE(0, 3), 0x123456)

    buf.fill(0xff)
    buf.writeUIntBE(0x123456, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56])
    assert.strictEqual(buf.readUIntBE(0, 3), 0x123456)

    buf.fill(0xff)
    buf.writeIntLE(0x123456, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12])
    assert.strictEqual(buf.readIntLE(0, 3), 0x123456)

    buf.fill(0xff)
    buf.writeIntBE(0x123456, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56])
    assert.strictEqual(buf.readIntBE(0, 3), 0x123456)

    buf.fill(0xff)
    buf.writeIntLE(-0x123456, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0xaa, 0xcb, 0xed])
    assert.strictEqual(buf.readIntLE(0, 3), -0x123456)

    buf.fill(0xff)
    buf.writeIntBE(-0x123456, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xaa])
    assert.strictEqual(buf.readIntBE(0, 3), -0x123456)

    buf.fill(0xff)
    buf.writeIntLE(-0x123400, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0x00, 0xcc, 0xed])
    assert.strictEqual(buf.readIntLE(0, 3), -0x123400)

    buf.fill(0xff)
    buf.writeIntBE(-0x123400, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcc, 0x00])
    assert.strictEqual(buf.readIntBE(0, 3), -0x123400)

    buf.fill(0xff)
    buf.writeIntLE(-0x120000, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0xee])
    assert.strictEqual(buf.readIntLE(0, 3), -0x120000)

    buf.fill(0xff)
    buf.writeIntBE(-0x120000, 0, 3)
    assert.deepStrictEqual(buf.toJSON().data, [0xee, 0x00, 0x00])
    assert.strictEqual(buf.readIntBE(0, 3), -0x120000)

    buf = Buffer.allocUnsafe(5)
    buf.writeUIntLE(0x1234567890, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12])
    assert.strictEqual(buf.readUIntLE(0, 5), 0x1234567890)

    buf.fill(0xff)
    buf.writeUIntBE(0x1234567890, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90])
    assert.strictEqual(buf.readUIntBE(0, 5), 0x1234567890)

    buf.fill(0xff)
    buf.writeIntLE(0x1234567890, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12])
    assert.strictEqual(buf.readIntLE(0, 5), 0x1234567890)

    buf.fill(0xff)
    buf.writeIntBE(0x1234567890, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90])
    assert.strictEqual(buf.readIntBE(0, 5), 0x1234567890)

    buf.fill(0xff)
    buf.writeIntLE(-0x1234567890, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0x70, 0x87, 0xa9, 0xcb, 0xed])
    assert.strictEqual(buf.readIntLE(0, 5), -0x1234567890)

    buf.fill(0xff)
    buf.writeIntBE(-0x1234567890, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xa9, 0x87, 0x70])
    assert.strictEqual(buf.readIntBE(0, 5), -0x1234567890)

    buf.fill(0xff)
    buf.writeIntLE(-0x0012000000, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0x00, 0xee, 0xff])
    assert.strictEqual(buf.readIntLE(0, 5), -0x0012000000)

    buf.fill(0xff)
    buf.writeIntBE(-0x0012000000, 0, 5)
    assert.deepStrictEqual(buf.toJSON().data, [0xff, 0xee, 0x00, 0x00, 0x00])
    assert.strictEqual(buf.readIntBE(0, 5), -0x0012000000)
  }

  // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/5482:
  // should throw but not assert in C++ land.
  assert.throws(() => Buffer.from('', 'buffer'))

  // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/6111.
  // Constructing a buffer from another buffer should a) work, and b) not corrupt
  // the source buffer.
  {
    const a = [...Array(128).keys()] // [0, 1, 2, 3, ... 126, 127]
    const b = Buffer.from(a)
    const c = Buffer.from(b)
    assert.strictEqual(b.length, a.length)
    assert.strictEqual(c.length, a.length)
    for (let i = 0, k = a.length; i < k; ++i) {
      assert.strictEqual(a[i], i)
      assert.strictEqual(b[i], i)
      assert.strictEqual(c[i], i)
    }
  }

  {
    // Test truncation after decode
    const crypto = require('crypto')

    const b1 = Buffer.from('YW55=======', 'base64')
    const b2 = Buffer.from('YW55', 'base64')

    assert.strictEqual(
      crypto.createHash('sha1').update(b1).digest('hex'),
      crypto.createHash('sha1').update(b2).digest('hex'),
    )
  }

  // ❌
  // const ps = Buffer.poolSize
  // Buffer.poolSize = 0
  // assert(Buffer.allocUnsafe(1).parent instanceof ArrayBuffer)
  // Buffer.poolSize = ps

  // @ts-expect-error
  assert.throws(() => Buffer.allocUnsafe(10).copy())

  // @ts-expect-error
  assert.throws(() => Buffer.from())
  assert.throws(() => Buffer.from(null))

  // Test prototype getters don't throw
  // assert.strictEqual(Buffer.prototype.parent, undefined) ❌
  // assert.strictEqual(Buffer.prototype.offset, undefined) ❌
  // assert.strictEqual(SlowBuffer.prototype.parent, undefined) ❌
  // assert.strictEqual(SlowBuffer.prototype.offset, undefined) ❌

  {
    // Test that large negative Buffer length inputs don't affect the pool offset.
    // Use the fromArrayLike() variant here because it's more lenient
    // about its input and passes the length directly to allocate().
    assert.deepStrictEqual(Buffer.from({ length: -Buffer['poolSize'] }), Buffer.from(''))
    assert.deepStrictEqual(Buffer.from({ length: -100 }), Buffer.from(''))

    // Check pool offset after that by trying to write string into the pool.
    Buffer.from('abc')
  }

  // Test that ParseArrayIndex handles full uint32
  {
    // assert.throws(() => Buffer.from(new ArrayBuffer(0), -1 >>> 0)) ❌
  }

  // ParseArrayIndex() should reject values that don't fit in a 32 bits size_t.
  assert.throws(() => {
    const a = Buffer.alloc(1)
    const b = Buffer.alloc(1)
    a.copy(b, 0, 0x100000000, 0x100000001)
  }, outOfRangeError)

  // Unpooled buffer (replaces SlowBuffer)
  {
    const ubuf = Buffer.allocUnsafeSlow(10)
    assert(ubuf)
    assert(ubuf.buffer)
    assert.strictEqual(ubuf.buffer.byteLength, 10)
  }

  // Regression test to verify that an empty ArrayBuffer does not throw.
  Buffer.from(new ArrayBuffer())

  // ❌
  // Test that ArrayBuffer from a different context is detected correctly.
  // const arrayBuf = vm.runInNewContext('new ArrayBuffer()')
  // Buffer.from(arrayBuf)
  // Buffer.from({ buffer: arrayBuf })

  assert.throws(() => Buffer.alloc({ valueOf: () => 1 } as any))
  assert.throws(() => Buffer.alloc({ valueOf: () => -1 } as any))

  // assert.strictEqual(Buffer.prototype.toLocaleString, Buffer.prototype.toString) ❌
  {
    const buf = Buffer.from('test')
    assert.strictEqual(buf.toLocaleString(), buf.toString())
  }

  // assert.throws( ❌
  //   () => {
  //     Buffer.alloc(0x1000, 'This is not correctly encoded', 'hex')
  //   },
  //   {
  //     code: 'ERR_INVALID_ARG_VALUE',
  //     name: 'TypeError',
  //   },
  // )

  // assert.throws( ❌
  //   () => {
  //     Buffer.alloc(0x1000, 'c', 'hex')
  //   },
  //   {
  //     code: 'ERR_INVALID_ARG_VALUE',
  //     name: 'TypeError',
  //   },
  // )

  // assert.throws( ❌
  //   () => {
  //     Buffer.alloc(1, Buffer.alloc(0))
  //   },
  //   {
  //     code: 'ERR_INVALID_ARG_VALUE',
  //     name: 'TypeError',
  //   },
  // )

  assert.throws(
    () => {
      Buffer.alloc(40, 'x', 20 as any)
    },
    {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
    },
  )
})

test('Buffer ascii (node.js repository test)', () => {
  // ASCII conversion in node.js simply masks off the high bits,
  // it doesn't do transliteration.
  assert.strictEqual(Buffer.from('hérité').toString('ascii'), 'hC)ritC)')

  // 71 characters, 78 bytes. The ’ character is a triple-byte sequence.
  const input = 'C’est, graphiquement, la réunion d’un accent aigu ' + 'et d’un accent grave.'

  const expected =
    'Cb\u0000\u0019est, graphiquement, la rC)union ' +
    'db\u0000\u0019un accent aigu et db\u0000\u0019un ' +
    'accent grave.'

  const buf = Buffer.from(input)

  for (let i = 0; i < expected.length; ++i) {
    assert.strictEqual(buf.slice(i).toString('ascii'), expected.slice(i))

    // Skip remainder of multi-byte sequence.
    if (input.charCodeAt(i) > 65535) ++i
    if (input.charCodeAt(i) > 127) ++i
  }
})

test('Buffer bytelength (node.js repository test)', () => {
  ;[[32, 'latin1'], [NaN, 'utf8'], [{}, 'latin1'], []].forEach((args: any[]) => {
    // @ts-expect-error
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    assert.throws(() => Buffer.byteLength(...args), {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: 'The "string" argument must be of type string or an instance ' + 'of Buffer or ArrayBuffer.',
    })
  })

  assert(ArrayBuffer.isView(new Buffer(10)))
  // assert(ArrayBuffer.isView(new SlowBuffer(10))) ❌
  assert(ArrayBuffer.isView(Buffer.alloc(10)))
  assert(ArrayBuffer.isView(Buffer.allocUnsafe(10)))
  assert(ArrayBuffer.isView(Buffer.allocUnsafeSlow(10)))
  assert(ArrayBuffer.isView(Buffer.from('')))

  // buffer
  const incomplete = Buffer.from([0xe4, 0xb8, 0xad, 0xe6, 0x96])
  assert.strictEqual(Buffer.byteLength(incomplete), 5)
  const ascii = Buffer.from('abc')
  assert.strictEqual(Buffer.byteLength(ascii), 3)

  // ArrayBuffer
  const buffer = new ArrayBuffer(8)
  assert.strictEqual(Buffer.byteLength(buffer as any), 8)

  // TypedArray
  const int8 = new Int8Array(8)
  assert.strictEqual(Buffer.byteLength(int8 as any), 8)
  const uint8 = new Uint8Array(8)
  assert.strictEqual(Buffer.byteLength(uint8 as any), 8)
  const uintc8 = new Uint8ClampedArray(2)
  assert.strictEqual(Buffer.byteLength(uintc8 as any), 2)
  const int16 = new Int16Array(8)
  assert.strictEqual(Buffer.byteLength(int16 as any), 16)
  const uint16 = new Uint16Array(8)
  assert.strictEqual(Buffer.byteLength(uint16 as any), 16)
  const int32 = new Int32Array(8)
  assert.strictEqual(Buffer.byteLength(int32 as any), 32)
  const uint32 = new Uint32Array(8)
  assert.strictEqual(Buffer.byteLength(uint32 as any), 32)
  const float32 = new Float32Array(8)
  assert.strictEqual(Buffer.byteLength(float32 as any), 32)
  const float64 = new Float64Array(8)
  assert.strictEqual(Buffer.byteLength(float64 as any), 64)

  // DataView
  const dv = new DataView(new ArrayBuffer(2))
  assert.strictEqual(Buffer.byteLength(dv as any), 2)

  // Special case: zero length string
  assert.strictEqual(Buffer.byteLength('', 'ascii'), 0)
  assert.strictEqual(Buffer.byteLength('', 'HeX' as any), 0)

  // utf8
  assert.strictEqual(Buffer.byteLength('∑éllö wørl∂!', 'utf-8'), 19)
  assert.strictEqual(Buffer.byteLength('κλμνξο', 'utf8'), 12)
  assert.strictEqual(Buffer.byteLength('挵挶挷挸挹', 'utf-8'), 15)
  assert.strictEqual(Buffer.byteLength('𠝹𠱓𠱸', 'UTF8' as any), 12)
  // Without an encoding, utf8 should be assumed
  assert.strictEqual(Buffer.byteLength('hey there'), 9)
  assert.strictEqual(Buffer.byteLength('𠱸挶νξ#xx :)'), 17)
  // It should also be assumed with unrecognized encodings
  // assert.strictEqual(Buffer.byteLength('hello world', ''), 11) ❌
  // assert.strictEqual(Buffer.byteLength('hello world', 'abc'), 11) ❌
  // assert.strictEqual(Buffer.byteLength('ßœ∑≈', 'unkn0wn enc0ding'), 10) ❌

  // base64
  assert.strictEqual(Buffer.byteLength('aGVsbG8gd29ybGQ=', 'base64'), 11)
  assert.strictEqual(Buffer.byteLength('aGVsbG8gd29ybGQ=', 'BASE64' as any), 11)
  assert.strictEqual(Buffer.byteLength('bm9kZS5qcyByb2NrcyE=', 'base64'), 14)
  assert.strictEqual(Buffer.byteLength('aGkk', 'base64'), 3)
  assert.strictEqual(Buffer.byteLength('bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw==', 'base64'), 25)
  // base64url
  assert.strictEqual(Buffer.byteLength('aGVsbG8gd29ybGQ', 'base64url'), 11)
  assert.strictEqual(Buffer.byteLength('aGVsbG8gd29ybGQ', 'BASE64URL' as any), 11)
  assert.strictEqual(Buffer.byteLength('bm9kZS5qcyByb2NrcyE', 'base64url'), 14)
  assert.strictEqual(Buffer.byteLength('aGkk', 'base64url'), 3)
  assert.strictEqual(Buffer.byteLength('bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw', 'base64url'), 25)
  // special padding
  assert.strictEqual(Buffer.byteLength('aaa=', 'base64'), 2)
  assert.strictEqual(Buffer.byteLength('aaaa==', 'base64'), 3)
  assert.strictEqual(Buffer.byteLength('aaa=', 'base64url'), 2)
  assert.strictEqual(Buffer.byteLength('aaaa==', 'base64url'), 3)

  assert.strictEqual(Buffer.byteLength('Il était tué'), 14)
  assert.strictEqual(Buffer.byteLength('Il était tué', 'utf8'), 14)
  ;['ascii', 'latin1', 'binary']
    .reduce((es, e: any) => es.concat(e, e.toUpperCase()), [])
    .forEach((encoding) => {
      assert.strictEqual(Buffer.byteLength('Il était tué', encoding), 12)
    })
  ;['ucs2', 'ucs-2', 'utf16le', 'utf-16le']
    .reduce((es, e: any) => es.concat(e, e.toUpperCase()), [])
    .forEach((encoding) => {
      assert.strictEqual(Buffer.byteLength('Il était tué', encoding), 24)
    })

  // ❌
  // Test that ArrayBuffer from a different context is detected correctly
  // const arrayBuf = vm.runInNewContext('new ArrayBuffer()')
  // assert.strictEqual(Buffer.byteLength(arrayBuf), 0)

  // ❌
  // Verify that invalid encodings are treated as utf8
  // for (let i = 1; i < 10; i++) {
  //   const encoding = String(i).repeat(i)

  //   assert.ok(!Buffer.isEncoding(encoding))
  //   assert.strictEqual(Buffer.byteLength('foo', encoding), Buffer.byteLength('foo', 'utf8'))
  // }
})
