import { describe, expect, it } from 'vitest';
import { findProductsPaginated, searchProducts } from '../src/data/products';
import { setupTestDb } from './setup';

describe('product search and pagination', () => {
  const ctx = setupTestDb('search-test');

  async function seedProducts() {
    await ctx.db.orm.products.createAll([
      {
        name: 'Classic Oxford Shirt',
        brand: 'Heritage',
        code: 'HER-001',
        description: 'A shirt',
        primaryCategory: 'Apparel',
        subCategory: 'Topwear',
        articleType: 'Shirts',
        price: { amount: 79.99, currency: 'USD' },
        image: { url: '/img/1.jpg' },
        embedding: null,
        status: 'active',
      },
      {
        name: 'Slim Fit Chinos',
        brand: 'UrbanEdge',
        code: 'UE-042',
        description: 'Pants',
        primaryCategory: 'Apparel',
        subCategory: 'Bottomwear',
        articleType: 'Trousers',
        price: { amount: 59.99, currency: 'USD' },
        image: { url: '/img/2.jpg' },
        embedding: null,
        status: 'active',
      },
      {
        name: 'Leather Crossbody Bag',
        brand: 'Craftsman',
        code: 'CRA-017',
        description: 'A bag',
        primaryCategory: 'Accessories',
        subCategory: 'Bags',
        articleType: 'Handbags',
        price: { amount: 149.99, currency: 'USD' },
        image: { url: '/img/3.jpg' },
        embedding: null,
        status: 'active',
      },
      {
        name: 'Trail Running Shoes',
        brand: 'TrailMark',
        code: 'TM-033',
        description: 'Shoes',
        primaryCategory: 'Footwear',
        subCategory: 'Shoes',
        articleType: 'Sports Shoes',
        price: { amount: 109.99, currency: 'USD' },
        image: { url: '/img/4.jpg' },
        embedding: null,
        status: 'active',
      },
    ]);
  }

  describe('searchProducts', () => {
    it('finds products by name substring', async () => {
      await seedProducts();
      const results = await searchProducts(ctx.db, 'oxford');
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Classic Oxford Shirt');
    });

    it('finds products by brand', async () => {
      await seedProducts();
      const results = await searchProducts(ctx.db, 'heritage');
      expect(results).toHaveLength(1);
      expect(results[0]?.brand).toBe('Heritage');
    });

    it('finds products by articleType', async () => {
      await seedProducts();
      const results = await searchProducts(ctx.db, 'trousers');
      expect(results).toHaveLength(1);
      expect(results[0]?.articleType).toBe('Trousers');
    });

    it('returns empty for non-matching query', async () => {
      await seedProducts();
      const results = await searchProducts(ctx.db, 'nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('findProductsPaginated', () => {
    it('returns paginated results', async () => {
      await seedProducts();
      const page1 = await findProductsPaginated(ctx.db, 0, 2);
      const page2 = await findProductsPaginated(ctx.db, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });

    it('returns empty when skip exceeds count', async () => {
      await seedProducts();
      const results = await findProductsPaginated(ctx.db, 100, 10);
      expect(results).toHaveLength(0);
    });
  });
});
