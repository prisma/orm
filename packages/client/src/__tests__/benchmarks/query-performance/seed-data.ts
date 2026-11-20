/*
 * Data seeding utilities for query performance benchmarks.
 * Creates realistic test data for various benchmark scenarios.
 */

import { PrismaClient } from './node_modules/.prisma/client/index.js'

export interface SeedConfig {
  users: number
  postsPerUser: number
  commentsPerPost: number
  tagsCount: number
  categoriesCount: number
  productsCount: number
  ordersPerUser: number
  itemsPerOrder: number
  followsPerUser: number
  messagesPerUser: number
}

export const SEED_CONFIGS = {
  // Small dataset for quick iteration and debugging
  small: {
    users: 10,
    postsPerUser: 5,
    commentsPerPost: 3,
    tagsCount: 10,
    categoriesCount: 5,
    productsCount: 20,
    ordersPerUser: 2,
    itemsPerOrder: 3,
    followsPerUser: 3,
    messagesPerUser: 5,
  } satisfies SeedConfig,

  // Medium dataset for typical benchmark runs
  medium: {
    users: 100,
    postsPerUser: 10,
    commentsPerPost: 5,
    tagsCount: 50,
    categoriesCount: 20,
    productsCount: 200,
    ordersPerUser: 5,
    itemsPerOrder: 4,
    followsPerUser: 10,
    messagesPerUser: 20,
  } satisfies SeedConfig,

  // Large dataset for stress testing
  large: {
    users: 500,
    postsPerUser: 20,
    commentsPerPost: 10,
    tagsCount: 100,
    categoriesCount: 50,
    productsCount: 1000,
    ordersPerUser: 10,
    itemsPerOrder: 5,
    followsPerUser: 20,
    messagesPerUser: 50,
  } satisfies SeedConfig,
} as const

class SeededRandom {
  private seed: number

  constructor(seed: number = 42) {
    this.seed = seed
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  pick<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)]
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array]
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i)
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  pickMultiple<T>(array: T[], count: number): T[] {
    return this.shuffle(array).slice(0, Math.min(count, array.length))
  }
}

const FIRST_NAMES = [
  'Alice',
  'Bob',
  'Charlie',
  'Diana',
  'Edward',
  'Fiona',
  'George',
  'Hannah',
  'Ivan',
  'Julia',
  'Kevin',
  'Laura',
  'Michael',
  'Nina',
  'Oscar',
  'Patricia',
  'Quentin',
  'Rachel',
  'Samuel',
  'Tina',
  'Ulrich',
  'Victoria',
  'William',
  'Xena',
  'Yusuf',
  'Zoe',
  'Aaron',
  'Beth',
  'Carlos',
  'Danielle',
  'Eric',
  'Fatima',
]

const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Anderson',
  'Taylor',
  'Thomas',
  'Jackson',
  'White',
  'Harris',
  'Martin',
  'Thompson',
  'Moore',
  'Young',
  'Allen',
  'King',
  'Wright',
  'Scott',
  'Torres',
  'Nguyen',
  'Hill',
  'Flores',
  'Green',
  'Adams',
  'Nelson',
  'Baker',
]

const DOMAINS = ['example.com', 'test.org', 'sample.net', 'demo.io', 'bench.dev']

const WORDS = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'do',
  'eiusmod',
  'tempor',
  'incididunt',
  'ut',
  'labore',
  'et',
  'dolore',
  'magna',
  'aliqua',
  'enim',
  'ad',
  'minim',
  'veniam',
  'quis',
  'nostrud',
  'exercitation',
  'ullamco',
  'laboris',
  'nisi',
  'aliquip',
  'ex',
  'ea',
  'commodo',
  'consequat',
  'duis',
  'aute',
  'irure',
  'in',
  'reprehenderit',
  'voluptate',
]

const CATEGORY_NAMES = [
  'Technology',
  'Science',
  'Health',
  'Business',
  'Sports',
  'Entertainment',
  'Politics',
  'Education',
  'Travel',
  'Food',
  'Fashion',
  'Art',
  'Music',
  'Gaming',
  'Finance',
  'Lifestyle',
  'News',
  'Opinion',
  'Culture',
  'Environment',
]

const TAG_NAMES = [
  'javascript',
  'typescript',
  'nodejs',
  'react',
  'vue',
  'angular',
  'python',
  'rust',
  'golang',
  'database',
  'sql',
  'nosql',
  'api',
  'rest',
  'graphql',
  'microservices',
  'cloud',
  'aws',
  'azure',
  'docker',
  'kubernetes',
  'devops',
  'testing',
  'performance',
  'security',
  'frontend',
  'backend',
  'fullstack',
  'mobile',
  'web',
  'design',
  'ux',
  'agile',
  'startup',
  'opensource',
]

const PRODUCT_ADJECTIVES = [
  'Premium',
  'Classic',
  'Modern',
  'Elegant',
  'Professional',
  'Compact',
  'Deluxe',
  'Essential',
  'Advanced',
  'Basic',
  'Ultra',
  'Pro',
  'Lite',
]

const PRODUCT_NOUNS = [
  'Widget',
  'Gadget',
  'Device',
  'Tool',
  'Kit',
  'Set',
  'Pack',
  'Bundle',
  'System',
  'Solution',
  'Platform',
  'Module',
  'Component',
  'Adapter',
]

const CITIES = [
  'New York',
  'Los Angeles',
  'Chicago',
  'Houston',
  'Phoenix',
  'Philadelphia',
  'San Antonio',
  'San Diego',
  'Dallas',
  'San Jose',
  'Austin',
  'Jacksonville',
  'Fort Worth',
  'Columbus',
  'Charlotte',
  'Seattle',
  'Denver',
  'Boston',
]

const COUNTRIES = ['USA', 'Canada', 'UK', 'Germany', 'France', 'Australia', 'Japan']

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']

const ROLES = ['user', 'admin', 'moderator', 'editor']

export class DataGenerator {
  readonly random: SeededRandom

  constructor(seed: number = 42) {
    this.random = new SeededRandom(seed)
  }

  generateSentence(wordCount: number): string {
    const words: string[] = []
    for (let i = 0; i < wordCount; i++) {
      words.push(this.random.pick(WORDS))
    }
    const sentence = words.join(' ')
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'
  }

  generateParagraph(sentenceCount: number = 5): string {
    const sentences: string[] = []
    for (let i = 0; i < sentenceCount; i++) {
      sentences.push(this.generateSentence(this.random.nextInt(5, 15)))
    }
    return sentences.join(' ')
  }

  generateContent(paragraphCount: number = 3): string {
    const paragraphs: string[] = []
    for (let i = 0; i < paragraphCount; i++) {
      paragraphs.push(this.generateParagraph(this.random.nextInt(3, 7)))
    }
    return paragraphs.join('\n\n')
  }

  slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  generateEmail(firstName: string, lastName: string, index: number): string {
    const domain = this.random.pick(DOMAINS)
    return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${domain}`
  }

  generateUsername(firstName: string, lastName: string, index: number): string {
    return `${firstName.toLowerCase()}${lastName.charAt(0).toLowerCase()}${index}`
  }

  generatePhone(): string {
    const areaCode = this.random.nextInt(200, 999)
    const exchange = this.random.nextInt(200, 999)
    const subscriber = this.random.nextInt(1000, 9999)
    return `+1-${areaCode}-${exchange}-${subscriber}`
  }

  generateZipCode(): string {
    return String(this.random.nextInt(10000, 99999))
  }

  generateDate(startYear: number = 2020, endYear: number = 2024): Date {
    const start = new Date(startYear, 0, 1).getTime()
    const end = new Date(endYear, 11, 31).getTime()
    return new Date(start + this.random.next() * (end - start))
  }

  generatePrice(min: number = 9.99, max: number = 999.99): number {
    return Math.round((min + this.random.next() * (max - min)) * 100) / 100
  }

  generateUser(index: number): UserData {
    const firstName = this.random.pick(FIRST_NAMES)
    const lastName = this.random.pick(LAST_NAMES)
    const createdAt = this.generateDate(2020, 2023)

    return {
      email: this.generateEmail(firstName, lastName, index),
      name: `${firstName} ${lastName}`,
      username: this.generateUsername(firstName, lastName, index),
      bio: this.random.next() > 0.3 ? this.generateSentence(this.random.nextInt(10, 25)) : null,
      avatar: this.random.next() > 0.2 ? `https://example.com/avatars/${index}.jpg` : null,
      isActive: this.random.next() > 0.1,
      role: this.random.pick(ROLES),
      createdAt,
      profile: {
        firstName,
        lastName,
        dateOfBirth: this.random.next() > 0.3 ? this.generateDate(1970, 2000) : null,
        phone: this.random.next() > 0.4 ? this.generatePhone() : null,
        address: this.random.next() > 0.5 ? `${this.random.nextInt(1, 9999)} Main St` : null,
        city: this.random.next() > 0.4 ? this.random.pick(CITIES) : null,
        country: this.random.next() > 0.3 ? this.random.pick(COUNTRIES) : null,
        zipCode: this.random.next() > 0.5 ? this.generateZipCode() : null,
        website: this.random.next() > 0.6 ? `https://${firstName.toLowerCase()}${lastName.toLowerCase()}.com` : null,
        company: this.random.next() > 0.5 ? `${lastName} Inc.` : null,
      },
    }
  }

  generateCategory(index: number, parentId: number | null = null): CategoryData {
    const name = index < CATEGORY_NAMES.length ? CATEGORY_NAMES[index] : `Category ${index}`

    return {
      name: parentId ? `${name} Sub${index}` : name,
      slug: this.slugify(parentId ? `${name}-sub-${index}` : name),
      description: this.random.next() > 0.3 ? this.generateSentence(this.random.nextInt(10, 20)) : null,
      parentId,
      sortOrder: index,
    }
  }

  generateTag(index: number): TagData {
    const name = index < TAG_NAMES.length ? TAG_NAMES[index] : `tag${index}`
    return {
      name,
      slug: this.slugify(name),
    }
  }

  generatePost(index: number, authorId: number, categoryId: number | null): PostData {
    const title = this.generateSentence(this.random.nextInt(4, 10)).slice(0, -1)
    const published = this.random.next() > 0.2
    const createdAt = this.generateDate(2021, 2024)

    return {
      title,
      slug: this.slugify(`${title}-${index}`),
      content: this.generateContent(this.random.nextInt(2, 6)),
      excerpt: this.random.next() > 0.3 ? this.generateSentence(this.random.nextInt(15, 30)) : null,
      published,
      featured: published && this.random.next() > 0.9,
      viewCount: this.random.nextInt(0, 10000),
      authorId,
      categoryId,
      createdAt,
      publishedAt: published ? createdAt : null,
    }
  }

  generateComment(postId: number, authorId: number, parentId: number | null = null): CommentData {
    return {
      content: this.generateParagraph(this.random.nextInt(1, 3)),
      authorId,
      postId,
      parentId,
      isEdited: this.random.next() > 0.9,
      createdAt: this.generateDate(2022, 2024),
    }
  }

  generateMessage(senderId: number, receiverId: number): MessageData {
    return {
      content: this.generateSentence(this.random.nextInt(5, 30)),
      senderId,
      receiverId,
      isRead: this.random.next() > 0.3,
      createdAt: this.generateDate(2023, 2024),
    }
  }

  generateProduct(index: number): ProductData {
    const adjective = this.random.pick(PRODUCT_ADJECTIVES)
    const noun = this.random.pick(PRODUCT_NOUNS)
    const name = `${adjective} ${noun} ${index}`
    const price = this.generatePrice(9.99, 499.99)

    return {
      name,
      slug: this.slugify(name),
      description: this.random.next() > 0.2 ? this.generateParagraph(this.random.nextInt(2, 4)) : null,
      price,
      comparePrice: this.random.next() > 0.5 ? price * (1 + this.random.next() * 0.5) : null,
      sku: `SKU-${String(index).padStart(6, '0')}`,
      stock: this.random.nextInt(0, 500),
      isActive: this.random.next() > 0.1,
      weight: this.random.next() > 0.5 ? this.random.nextInt(1, 100) / 10 : null,
      createdAt: this.generateDate(2021, 2024),
    }
  }

  generateOrder(userId: number): OrderData {
    const subtotal = this.generatePrice(50, 500)
    const tax = Math.round(subtotal * 0.08 * 100) / 100
    const shipping = this.random.next() > 0.3 ? this.generatePrice(5, 25) : 0

    return {
      userId,
      status: this.random.pick(ORDER_STATUSES),
      subtotal,
      tax,
      shipping,
      total: Math.round((subtotal + tax + shipping) * 100) / 100,
      notes: this.random.next() > 0.7 ? this.generateSentence(this.random.nextInt(5, 15)) : null,
      createdAt: this.generateDate(2023, 2024),
    }
  }

  generateOrderItem(orderId: number, productId: number): OrderItemData {
    const quantity = this.random.nextInt(1, 5)
    const price = this.generatePrice(9.99, 199.99)

    return {
      orderId,
      productId,
      quantity,
      price,
    }
  }
}

export interface UserData {
  email: string
  name: string
  username: string
  bio: string | null
  avatar: string | null
  isActive: boolean
  role: string
  createdAt: Date
  profile: ProfileData
}

export interface ProfileData {
  firstName: string
  lastName: string
  dateOfBirth: Date | null
  phone: string | null
  address: string | null
  city: string | null
  country: string | null
  zipCode: string | null
  website: string | null
  company: string | null
}

export interface CategoryData {
  name: string
  slug: string
  description: string | null
  parentId: number | null
  sortOrder: number
}

export interface TagData {
  name: string
  slug: string
}

export interface PostData {
  title: string
  slug: string
  content: string
  excerpt: string | null
  published: boolean
  featured: boolean
  viewCount: number
  authorId: number
  categoryId: number | null
  createdAt: Date
  publishedAt: Date | null
}

export interface CommentData {
  content: string
  authorId: number
  postId: number
  parentId: number | null
  isEdited: boolean
  createdAt: Date
}

export interface MessageData {
  content: string
  senderId: number
  receiverId: number
  isRead: boolean
  createdAt: Date
}

export interface ProductData {
  name: string
  slug: string
  description: string | null
  price: number
  comparePrice: number | null
  sku: string
  stock: number
  isActive: boolean
  weight: number | null
  createdAt: Date
}

export interface OrderData {
  userId: number
  status: string
  subtotal: number
  tax: number
  shipping: number
  total: number
  notes: string | null
  createdAt: Date
}

export interface OrderItemData {
  orderId: number
  productId: number
  quantity: number
  price: number
}

/**
 * Seeds the database with test data using the provided PrismaClient.
 * Returns IDs for quick access in benchmarks.
 */
export async function seedDatabase(
  prisma: PrismaClient,
  config: SeedConfig = SEED_CONFIGS.medium,
): Promise<SeedResult> {
  const generator = new DataGenerator(42)

  console.log('Seeding database with config:', config)
  const startTime = Date.now()

  const categoryIds: number[] = []
  for (let i = 0; i < config.categoriesCount; i++) {
    const parentId = i > 5 && generator.random.next() > 0.5 ? categoryIds[Math.floor(i / 2)] : null
    const category = await prisma.category.create({
      data: generator.generateCategory(i, parentId),
    })
    categoryIds.push(category.id)
  }

  const tagIds: number[] = []
  for (let i = 0; i < config.tagsCount; i++) {
    const tag = await prisma.tag.create({
      data: generator.generateTag(i),
    })
    tagIds.push(tag.id)
  }

  const productIds: number[] = []
  for (let i = 0; i < config.productsCount; i++) {
    const product = await prisma.product.create({
      data: generator.generateProduct(i),
    })
    productIds.push(product.id)
  }

  const userIds: number[] = []
  for (let i = 0; i < config.users; i++) {
    const userData = generator.generateUser(i)
    const user = await prisma.user.create({
      data: {
        email: userData.email,
        name: userData.name,
        username: userData.username,
        bio: userData.bio,
        avatar: userData.avatar,
        isActive: userData.isActive,
        role: userData.role,
        createdAt: userData.createdAt,
        profile: {
          create: userData.profile,
        },
      },
    })
    userIds.push(user.id)
  }

  const postIds: number[] = []
  for (const userId of userIds) {
    for (let i = 0; i < config.postsPerUser; i++) {
      const categoryId =
        generator.random.next() > 0.2 ? categoryIds[Math.floor(generator.random.next() * categoryIds.length)] : null
      const postData = generator.generatePost(postIds.length, userId, categoryId)

      const postTagIds = generator.random.pickMultiple(tagIds, generator.random.nextInt(1, 5))

      const post = await prisma.post.create({
        data: {
          ...postData,
          tags: {
            create: postTagIds.map((tagId) => ({ tagId })),
          },
        },
      })
      postIds.push(post.id)
    }
  }

  const commentIds: number[] = []
  for (const postId of postIds) {
    for (let i = 0; i < config.commentsPerPost; i++) {
      const authorId = userIds[Math.floor(generator.random.next() * userIds.length)]
      const parentId = i > 0 && generator.random.next() > 0.7 ? commentIds[commentIds.length - 1] : null
      const comment = await prisma.comment.create({
        data: generator.generateComment(postId, authorId, parentId),
      })
      commentIds.push(comment.id)
    }
  }

  const followPairs = new Set<string>()
  for (const userId of userIds) {
    const followCount = Math.min(config.followsPerUser, userIds.length - 1)
    const potentialFollows = userIds.filter((id) => id !== userId)
    const toFollow = generator.random.pickMultiple(potentialFollows, followCount)

    for (const followingId of toFollow) {
      const pairKey = `${userId}-${followingId}`
      if (!followPairs.has(pairKey)) {
        followPairs.add(pairKey)
        await prisma.follow.create({
          data: {
            followerId: userId,
            followingId,
            createdAt: generator.generateDate(2022, 2024),
          },
        })
      }
    }
  }

  const likePairs = new Set<string>()
  for (const userId of userIds) {
    const likeCount = Math.min(Math.floor(postIds.length * 0.3), 20)
    const toLike = generator.random.pickMultiple(postIds, likeCount)

    for (const postId of toLike) {
      const pairKey = `${userId}-${postId}`
      if (!likePairs.has(pairKey)) {
        likePairs.add(pairKey)
        await prisma.like.create({
          data: {
            userId,
            postId,
            createdAt: generator.generateDate(2023, 2024),
          },
        })
      }
    }
  }

  for (const senderId of userIds) {
    const messageCount = Math.min(config.messagesPerUser, userIds.length - 1)
    const receivers = generator.random.pickMultiple(
      userIds.filter((id) => id !== senderId),
      messageCount,
    )

    for (const receiverId of receivers) {
      await prisma.message.create({
        data: generator.generateMessage(senderId, receiverId),
      })
    }
  }

  const orderIds: number[] = []
  for (const userId of userIds) {
    for (let i = 0; i < config.ordersPerUser; i++) {
      const orderData = generator.generateOrder(userId)
      const itemCount = config.itemsPerOrder
      const orderProductIds = generator.random.pickMultiple(productIds, itemCount)

      const order = await prisma.order.create({
        data: {
          ...orderData,
          items: {
            create: orderProductIds
              .map((productId) => generator.generateOrderItem(0, productId))
              .map(({ orderId: _, ...item }) => item),
          },
        },
      })
      orderIds.push(order.id)
    }
  }

  const duration = Date.now() - startTime
  console.log(`Seeding completed in ${duration}ms`)

  return {
    userIds,
    postIds,
    commentIds,
    categoryIds,
    tagIds,
    productIds,
    orderIds,
    stats: {
      users: userIds.length,
      posts: postIds.length,
      comments: commentIds.length,
      categories: categoryIds.length,
      tags: tagIds.length,
      products: productIds.length,
      orders: orderIds.length,
      seedTimeMs: duration,
    },
  }
}

export interface SeedResult {
  userIds: number[]
  postIds: number[]
  commentIds: number[]
  categoryIds: number[]
  tagIds: number[]
  productIds: number[]
  orderIds: number[]
  stats: {
    users: number
    posts: number
    comments: number
    categories: number
    tags: number
    products: number
    orders: number
    seedTimeMs: number
  }
}
