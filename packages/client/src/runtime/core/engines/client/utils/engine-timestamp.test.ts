import { convertEngineTimestamp, dateFromEngineTimestamp } from './engine-timestamp'

test('convertEngineTimestamp', () => {
  expect(convertEngineTimestamp([1701962387, 551813333])).toEqual(1701962387551.8132)
})

test('dateFromEngineTimestamp', () => {
  expect(dateFromEngineTimestamp([1701962387, 551813333])).toEqual(new Date('2023-12-07T15:19:47.551Z'))
})
