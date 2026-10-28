#!/usr/bin/env -S node
import {
  createCollection,
  createIndex,
  Migration,
  MigrationCLI,
} from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/917a8cff4030fa9140b93367a663f33d66cd14e92547b51e23a9ff82ffabf27f/contract';
import endContract from '../../snapshots/917a8cff4030fa9140b93367a663f33d66cd14e92547b51e23a9ff82ffabf27f/contract.json' with {
  type: 'json',
};

class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      createCollection('carts', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              items: {
                bsonType: 'array',
                items: {
                  additionalProperties: false,
                  bsonType: 'object',
                  properties: {
                    amount: { bsonType: 'int' },
                    brand: { bsonType: 'string' },
                    image: {
                      additionalProperties: false,
                      bsonType: 'object',
                      properties: { url: { bsonType: 'string' } },
                      required: ['url'],
                    },
                    name: { bsonType: 'string' },
                    price: {
                      additionalProperties: false,
                      bsonType: 'object',
                      properties: {
                        amount: { bsonType: 'double' },
                        currency: { bsonType: 'string' },
                      },
                      required: ['amount', 'currency'],
                    },
                    productId: { bsonType: 'string' },
                  },
                  required: ['amount', 'brand', 'image', 'name', 'price', 'productId'],
                },
              },
              userId: { bsonType: 'objectId' },
            },
            required: ['_id', 'items', 'userId'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('events', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            oneOf: [
              {
                additionalProperties: false,
                properties: {
                  _id: { bsonType: 'objectId' },
                  brand: { bsonType: 'string' },
                  exitMethod: { bsonType: ['null', 'string'] },
                  productId: { bsonType: 'string' },
                  sessionId: { bsonType: 'string' },
                  subCategory: { bsonType: 'string' },
                  timestamp: { bsonType: 'date' },
                  type: { enum: ['view-product'] },
                  userId: { bsonType: 'string' },
                },
                required: ['brand', 'productId', 'subCategory', 'type'],
              },
              {
                additionalProperties: false,
                properties: {
                  _id: { bsonType: 'objectId' },
                  query: { bsonType: 'string' },
                  sessionId: { bsonType: 'string' },
                  timestamp: { bsonType: 'date' },
                  type: { enum: ['search'] },
                  userId: { bsonType: 'string' },
                },
                required: ['query', 'type'],
              },
              {
                additionalProperties: false,
                properties: {
                  _id: { bsonType: 'objectId' },
                  brand: { bsonType: 'string' },
                  productId: { bsonType: 'string' },
                  sessionId: { bsonType: 'string' },
                  timestamp: { bsonType: 'date' },
                  type: { enum: ['add-to-cart'] },
                  userId: { bsonType: 'string' },
                },
                required: ['brand', 'productId', 'type'],
              },
            ],
            properties: {
              _id: { bsonType: 'objectId' },
              sessionId: { bsonType: 'string' },
              timestamp: { bsonType: 'date' },
              type: { bsonType: 'string' },
              userId: { bsonType: 'string' },
            },
            required: ['_id', 'sessionId', 'timestamp', 'type', 'userId'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('invoices', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              issuedAt: { bsonType: 'date' },
              items: {
                bsonType: 'array',
                items: {
                  additionalProperties: false,
                  bsonType: 'object',
                  properties: {
                    amount: { bsonType: 'int' },
                    lineTotal: { bsonType: 'double' },
                    name: { bsonType: 'string' },
                    unitPrice: { bsonType: 'double' },
                  },
                  required: ['amount', 'lineTotal', 'name', 'unitPrice'],
                },
              },
              orderId: { bsonType: 'objectId' },
              subtotal: { bsonType: 'double' },
              tax: { bsonType: 'double' },
              total: { bsonType: 'double' },
            },
            required: ['_id', 'issuedAt', 'items', 'orderId', 'subtotal', 'tax', 'total'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('locations', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              city: { bsonType: 'string' },
              country: { bsonType: 'string' },
              name: { bsonType: 'string' },
              postalCode: { bsonType: 'string' },
              streetAndNumber: { bsonType: 'string' },
            },
            required: ['_id', 'city', 'country', 'name', 'postalCode', 'streetAndNumber'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('orders', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              items: {
                bsonType: 'array',
                items: {
                  additionalProperties: false,
                  bsonType: 'object',
                  properties: {
                    amount: { bsonType: 'int' },
                    brand: { bsonType: 'string' },
                    image: {
                      additionalProperties: false,
                      bsonType: 'object',
                      properties: { url: { bsonType: 'string' } },
                      required: ['url'],
                    },
                    name: { bsonType: 'string' },
                    price: {
                      additionalProperties: false,
                      bsonType: 'object',
                      properties: {
                        amount: { bsonType: 'double' },
                        currency: { bsonType: 'string' },
                      },
                      required: ['amount', 'currency'],
                    },
                    productId: { bsonType: 'string' },
                  },
                  required: ['amount', 'brand', 'image', 'name', 'price', 'productId'],
                },
              },
              shippingAddress: { bsonType: 'string' },
              statusHistory: {
                bsonType: 'array',
                items: {
                  additionalProperties: false,
                  bsonType: 'object',
                  properties: { status: { bsonType: 'string' }, timestamp: { bsonType: 'date' } },
                  required: ['status', 'timestamp'],
                },
              },
              type: { bsonType: 'string' },
              userId: { bsonType: 'objectId' },
            },
            required: ['_id', 'items', 'shippingAddress', 'statusHistory', 'type', 'userId'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('products', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              articleType: { bsonType: 'string' },
              brand: { bsonType: 'string' },
              code: { bsonType: 'string' },
              description: { bsonType: 'string' },
              image: {
                additionalProperties: false,
                bsonType: 'object',
                properties: { url: { bsonType: 'string' } },
                required: ['url'],
              },
              name: { bsonType: 'string' },
              price: {
                additionalProperties: false,
                bsonType: 'object',
                properties: { amount: { bsonType: 'double' }, currency: { bsonType: 'string' } },
                required: ['amount', 'currency'],
              },
              primaryCategory: { bsonType: 'string' },
              subCategory: { bsonType: 'string' },
            },
            required: [
              '_id',
              'articleType',
              'brand',
              'code',
              'description',
              'image',
              'name',
              'price',
              'primaryCategory',
              'subCategory',
            ],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createCollection('users', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              address: {
                oneOf: [
                  { bsonType: 'null' },
                  {
                    additionalProperties: false,
                    bsonType: 'object',
                    properties: {
                      city: { bsonType: 'string' },
                      country: { bsonType: 'string' },
                      postalCode: { bsonType: 'string' },
                      streetAndNumber: { bsonType: 'string' },
                    },
                    required: ['city', 'country', 'postalCode', 'streetAndNumber'],
                  },
                ],
              },
              email: { bsonType: 'string' },
              name: { bsonType: 'string' },
            },
            required: ['_id', 'email', 'name'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createIndex('carts', [{ direction: 1, field: 'userId' }], { unique: true }),
      createIndex(
        'events',
        [
          { direction: 1, field: 'userId' },
          { direction: -1, field: 'timestamp' },
        ],
        {},
      ),
      createIndex('events', [{ direction: 1, field: 'timestamp' }], {
        expireAfterSeconds: 7776000,
      }),
      createIndex('invoices', [{ direction: 1, field: 'orderId' }], {}),
      createIndex('invoices', [{ direction: -1, field: 'issuedAt' }], { sparse: true }),
      createIndex(
        'locations',
        [
          { direction: 1, field: 'city' },
          { direction: 1, field: 'country' },
        ],
        { collation: { locale: 'en', strength: 2 } },
      ),
      createIndex('orders', [{ direction: 1, field: 'userId' }], {}),
      createIndex(
        'products',
        [
          { direction: 'text', field: 'name' },
          { direction: 'text', field: 'description' },
        ],
        { weights: { description: 1, name: 10 } },
      ),
      createIndex(
        'products',
        [
          { direction: 1, field: 'brand' },
          { direction: 1, field: 'subCategory' },
        ],
        {},
      ),
      createIndex('products', [{ direction: 'hashed', field: 'code' }], {}),
      createIndex('users', [{ direction: 1, field: 'email' }], { unique: true }),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
