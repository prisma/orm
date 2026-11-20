import { maskQuery } from './maskQuery'

test('big query', () => {
  const query = `query {
  users(
    mirst: 100
    skip: "200"
    where: {
      age_gt: -10
      age_in: [1, 2, 3.123]
      name_in: ["hans", "peter", "schmidt"]
      OR: [
        {
          age_gt: 10123123123
          email_endsWith: "veryLongNameGoIntoaNewLineNow@gmail.com"
        },
        {
          age_gt: 10123123123
          email_endsWith: "veryLongNameGoIntoaNewLineNow@gmail.com"
          OR: [
            {
              age_gt: 10123123123
              email_endsWith: "veryLongNameGoIntoaNewLineNow@gmail.com"
            }
          ]
        }
      ]
    }
  ) {
    id
    name2 # INVALID_FIELD
    friends {
      id
      name
    }
    posts(first: 200) {
      id
      name
    }
  }
}`

  expect(maskQuery(query)).toMatchInlineSnapshot(`
    "query {
      users(
        mirst: 5
        skip: "X"
        where: {
          age_gt: 5
          age_in: [5, 5, 5]
          name_in: ["X", "X", "X"]
          OR: [
            {
              age_gt: 5
              email_endsWith: "X"
            },
            {
              age_gt: 5
              email_endsWith: "X"
              OR: [
                {
                  age_gt: 5
                  email_endsWith: "X"
                }
              ]
            }
          ]
        }
      ) {
        id
        name2 # INVALID_FIELD
        friends {
          id
          name
        }
        posts(first: 5) {
          id
          name
        }
      }
    }"
  `)
})

test('aggregate', () => {
  const query = `query {
    aggregateUser(take: 10) {
      count {
        _all
      }
    }
  }`

  expect(maskQuery(query)).toMatchInlineSnapshot(`
    "query {
        aggregateUser(take: 5) {
          count {
            _all
          }
        }
      }"
  `)
})

test('string with an escaped quote', () => {
  const query = `email_endsWith: "safe\\"secret", next: "other"`

  expect(maskQuery(query)).toMatchInlineSnapshot(`"email_endsWith: "X", next: "X""`)
})
