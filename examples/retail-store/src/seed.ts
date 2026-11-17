import { createAddToCartEvent, createSearchEvent, createViewProductEvent } from './data/events';
import type { Db } from './db';
import { enums } from './enums';

const productData = [
  {
    name: 'Classic Oxford Shirt',
    brand: 'Heritage',
    code: 'HER-OXF-001',
    description: 'Timeless button-down oxford shirt in crisp white cotton',
    primaryCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    price: { amount: 79.99, currency: 'USD' },
  },
  {
    name: 'Linen Camp Collar Shirt',
    brand: 'Heritage',
    code: 'HER-LIN-002',
    description: 'Relaxed linen camp collar shirt for warm weather',
    primaryCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    price: { amount: 89.99, currency: 'USD' },
  },
  {
    name: 'Merino Crew Sweater',
    brand: 'Heritage',
    code: 'HER-MER-003',
    description: 'Lightweight merino wool crew neck sweater',
    primaryCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Sweaters',
    price: { amount: 119.99, currency: 'USD' },
  },
  {
    name: 'Graphic Tee - Mountain',
    brand: 'UrbanEdge',
    code: 'UE-TEE-010',
    description: 'Soft cotton graphic tee with mountain print',
    primaryCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'T-Shirts',
    price: { amount: 34.99, currency: 'USD' },
  },
  {
    name: 'Performance Polo',
    brand: 'UrbanEdge',
    code: 'UE-POL-011',
    description: 'Moisture-wicking performance polo for active days',
    primaryCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Shirts',
    price: { amount: 54.99, currency: 'USD' },
  },
  {
    name: 'Denim Jacket',
    brand: 'UrbanEdge',
    code: 'UE-DEN-012',
    description: 'Classic medium-wash denim jacket',
    primaryCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Jackets',
    price: { amount: 99.99, currency: 'USD' },
  },
  {
    name: 'Slim Fit Chinos',
    brand: 'UrbanEdge',
    code: 'UE-CHI-042',
    description: 'Modern slim-fit chinos in navy with stretch comfort',
    primaryCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Trousers',
    price: { amount: 59.99, currency: 'USD' },
  },
  {
    name: 'Relaxed Fit Jeans',
    brand: 'Heritage',
    code: 'HER-JEA-020',
    description: 'Relaxed fit jeans in dark indigo wash',
    primaryCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Jeans',
    price: { amount: 89.99, currency: 'USD' },
  },
  {
    name: 'Cargo Shorts',
    brand: 'TrailMark',
    code: 'TM-SHO-030',
    description: 'Durable cargo shorts with multiple pockets',
    primaryCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Shorts',
    price: { amount: 44.99, currency: 'USD' },
  },
  {
    name: 'Jogger Pants',
    brand: 'UrbanEdge',
    code: 'UE-JOG-013',
    description: 'Tapered jogger pants with elastic cuff',
    primaryCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Trousers',
    price: { amount: 49.99, currency: 'USD' },
  },
  {
    name: 'Wool Dress Trousers',
    brand: 'Heritage',
    code: 'HER-DRS-021',
    description: 'Tailored wool dress trousers with flat front',
    primaryCategory: 'Apparel',
    subCategory: 'Bottomwear',
    articleType: 'Trousers',
    price: { amount: 129.99, currency: 'USD' },
  },
  {
    name: 'Leather Crossbody Bag',
    brand: 'Craftsman',
    code: 'CRA-BAG-017',
    description: 'Hand-stitched leather crossbody bag with adjustable strap',
    primaryCategory: 'Accessories',
    subCategory: 'Bags',
    articleType: 'Handbags',
    price: { amount: 149.99, currency: 'USD' },
  },
  {
    name: 'Canvas Tote Bag',
    brand: 'Craftsman',
    code: 'CRA-TOT-018',
    description: 'Waxed canvas tote with leather handles',
    primaryCategory: 'Accessories',
    subCategory: 'Bags',
    articleType: 'Handbags',
    price: { amount: 69.99, currency: 'USD' },
  },
  {
    name: 'Weekender Duffle',
    brand: 'TrailMark',
    code: 'TM-DUF-031',
    description: 'Water-resistant weekender duffle bag',
    primaryCategory: 'Accessories',
    subCategory: 'Bags',
    articleType: 'Handbags',
    price: { amount: 119.99, currency: 'USD' },
  },
  {
    name: 'Leather Belt',
    brand: 'Craftsman',
    code: 'CRA-BLT-019',
    description: 'Full-grain leather belt with brass buckle',
    primaryCategory: 'Accessories',
    subCategory: 'Belts',
    articleType: 'Belts',
    price: { amount: 59.99, currency: 'USD' },
  },
  {
    name: 'Aviator Sunglasses',
    brand: 'UrbanEdge',
    code: 'UE-SUN-014',
    description: 'Classic aviator sunglasses with polarized lenses',
    primaryCategory: 'Accessories',
    subCategory: 'Eyewear',
    articleType: 'Sunglasses',
    price: { amount: 79.99, currency: 'USD' },
  },
  {
    name: 'Wool Beanie',
    brand: 'TrailMark',
    code: 'TM-BEA-032',
    description: 'Ribbed merino wool beanie',
    primaryCategory: 'Accessories',
    subCategory: 'Headwear',
    articleType: 'Caps',
    price: { amount: 29.99, currency: 'USD' },
  },
  {
    name: 'Leather Sneakers',
    brand: 'UrbanEdge',
    code: 'UE-SNK-015',
    description: 'Minimalist white leather sneakers',
    primaryCategory: 'Footwear',
    subCategory: 'Shoes',
    articleType: 'Casual Shoes',
    price: { amount: 129.99, currency: 'USD' },
  },
  {
    name: 'Suede Chelsea Boots',
    brand: 'Heritage',
    code: 'HER-CHE-022',
    description: 'Suede Chelsea boots with elastic side panel',
    primaryCategory: 'Footwear',
    subCategory: 'Shoes',
    articleType: 'Casual Shoes',
    price: { amount: 189.99, currency: 'USD' },
  },
  {
    name: 'Trail Running Shoes',
    brand: 'TrailMark',
    code: 'TM-TRL-033',
    description: 'Lightweight trail running shoes with grip sole',
    primaryCategory: 'Footwear',
    subCategory: 'Shoes',
    articleType: 'Sports Shoes',
    price: { amount: 109.99, currency: 'USD' },
  },
  {
    name: 'Canvas Slip-Ons',
    brand: 'UrbanEdge',
    code: 'UE-SLP-016',
    description: 'Casual canvas slip-on shoes',
    primaryCategory: 'Footwear',
    subCategory: 'Shoes',
    articleType: 'Casual Shoes',
    price: { amount: 44.99, currency: 'USD' },
  },
  {
    name: 'Hiking Boots',
    brand: 'TrailMark',
    code: 'TM-HIK-034',
    description: 'Waterproof hiking boots with ankle support',
    primaryCategory: 'Footwear',
    subCategory: 'Shoes',
    articleType: 'Sports Shoes',
    price: { amount: 159.99, currency: 'USD' },
  },
  {
    name: 'Rain Jacket',
    brand: 'TrailMark',
    code: 'TM-RAI-035',
    description: 'Packable waterproof rain jacket',
    primaryCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Jackets',
    price: { amount: 89.99, currency: 'USD' },
  },
  {
    name: 'Silk Pocket Square',
    brand: 'Heritage',
    code: 'HER-PSQ-023',
    description: 'Hand-rolled silk pocket square',
    primaryCategory: 'Accessories',
    subCategory: 'Scarves',
    articleType: 'Scarves',
    price: { amount: 39.99, currency: 'USD' },
  },
] as const;

export async function seed(db: Db) {
  const products = await db.orm.products.createAll(
    productData.map((p) => ({
      ...p,
      image: { url: `/images/products/${p.code.toLowerCase()}.jpg` },
      embedding: null,
      status: 'active',
    })),
  );

  const p0 = products[0];
  const p1 = products[1];
  const p2 = products[11];
  if (!p0 || !p1 || !p2) throw new Error('Failed to seed products');

  function lineItemFrom(product: (typeof products)[number]) {
    return {
      productId: product.id,
      name: product.name,
      brand: product.brand,
      image: { url: `/images/products/${product.code.toLowerCase()}.jpg` },
    };
  }

  const users = await db.orm.users.createAll([
    {
      name: 'Alice Chen',
      email: 'alice@example.com',
      address: {
        streetAndNumber: '123 Main St',
        city: 'San Francisco',
        postalCode: '94102',
        country: 'US',
      },
    },
    {
      name: 'Bob Kumar',
      email: 'bob@example.com',
      address: null,
    },
  ]);

  const alice = users[0];
  const bob = users[1];
  if (!alice || !bob) throw new Error('Failed to seed users');

  await db.orm.carts.create({
    userId: alice.id,
    items: [
      {
        ...lineItemFrom(p0),
        amount: 1,
        price: { amount: 79.99, currency: 'USD' },
      },
      {
        ...lineItemFrom(p1),
        amount: 2,
        price: { amount: 89.99, currency: 'USD' },
      },
    ],
  });

  const order = await db.orm.orders.create({
    userId: bob.id,
    items: [
      {
        ...lineItemFrom(p2),
        amount: 1,
        price: { amount: 149.99, currency: 'USD' },
      },
    ],
    shippingAddress: '456 Oak Ave, Portland, OR 97201',
    type: enums.OrderType.members.Delivery,
    statusHistory: [{ status: 'placed', timestamp: new Date('2026-03-01T10:00:00Z') }],
  });

  await db.orm.locations.createAll([
    {
      name: 'Downtown Flagship',
      streetAndNumber: '100 Market St',
      city: 'San Francisco',
      postalCode: '94105',
      country: 'US',
    },
    {
      name: 'Portland Store',
      streetAndNumber: '200 NW 23rd Ave',
      city: 'Portland',
      postalCode: '97210',
      country: 'US',
    },
    {
      name: 'Seattle Pike Place',
      streetAndNumber: '85 Pike St',
      city: 'Seattle',
      postalCode: '98101',
      country: 'US',
    },
    {
      name: 'Austin South Congress',
      streetAndNumber: '1400 S Congress Ave',
      city: 'Austin',
      postalCode: '78704',
      country: 'US',
    },
  ]);

  await db.orm.invoices.create({
    orderId: order.id,
    items: [{ name: 'Leather Crossbody Bag', amount: 1, unitPrice: 149.99, lineTotal: 149.99 }],
    subtotal: 149.99,
    tax: 12.75,
    total: 162.74,
    issuedAt: new Date('2026-03-01T10:05:00Z'),
  });

  await createViewProductEvent(db, {
    userId: 'alice-session-1',
    sessionId: 'sess-001',
    timestamp: new Date('2026-03-01T09:00:00Z'),
    productId: p0.id,
    subCategory: 'Topwear',
    brand: 'Heritage',
    exitMethod: null,
  });

  await createAddToCartEvent(db, {
    userId: 'alice-session-1',
    sessionId: 'sess-001',
    timestamp: new Date('2026-03-01T09:05:00Z'),
    productId: p0.id,
    brand: 'Heritage',
  });

  await createSearchEvent(db, {
    userId: 'bob-session-1',
    sessionId: 'sess-002',
    timestamp: new Date('2026-03-01T09:30:00Z'),
    query: 'leather bag',
  });
}
