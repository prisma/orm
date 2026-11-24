#!/usr/bin/env -S node
import { collMod, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/1c73a5a88943362a9b01f6476e85fddc574031accb9ada12be61e9da24fe0fd8/contract';
import endContract from '../../snapshots/1c73a5a88943362a9b01f6476e85fddc574031accb9ada12be61e9da24fe0fd8/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/5b423686089e2ada5ece2b224849ac73ce6b998fb062e88217d2f30a1a567748/contract';
import startContract from '../../snapshots/5b423686089e2ada5ece2b224849ac73ce6b998fb062e88217d2f30a1a567748/contract.json' with {
  type: 'json',
};

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      collMod(
        'orders',
        {
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
                type: { bsonType: 'string', enum: ['delivery', 'pickup'] },
                userId: { bsonType: 'objectId' },
              },
              required: ['_id', 'items', 'shippingAddress', 'statusHistory', 'type', 'userId'],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.orders.update',
          label: 'Update validator on orders',
          operationClass: 'destructive',
        },
      ),
      collMod(
        'products',
        {
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
                embedding: { bsonType: 'array', items: { bsonType: 'double' } },
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
                status: { bsonType: 'string', enum: ['active', 'discontinued', 'out-of-stock'] },
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
                'status',
                'subCategory',
              ],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.products.update',
          label: 'Update validator on products',
          operationClass: 'destructive',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
