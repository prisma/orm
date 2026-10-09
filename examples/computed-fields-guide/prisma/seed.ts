import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...\n')

  // Create users with computed fields
  const user1 = await prisma.user.create({
    data: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      countryCode: '+1',
      phone: '5551234567',
    },
  })

  console.log('✅ Created user:', {
    name: `${user1.firstName} ${user1.lastName}`,
    fullName: user1.fullName, // Automatically computed!
    formattedPhone: user1.formattedPhone, // Automatically computed!
    emailDomain: user1.emailDomain, // Automatically computed!
  })

  const user2 = await prisma.user.create({
    data: {
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@company.org',
      countryCode: '+44',
      phone: '7700900123',
    },
  })

  console.log('✅ Created user:', {
    name: `${user2.firstName} ${user2.lastName}`,
    fullName: user2.fullName,
    formattedPhone: user2.formattedPhone,
    emailDomain: user2.emailDomain,
  })

  // Create products with computed total price
  const product1 = await prisma.product.create({
    data: {
      name: 'Laptop',
      basePrice: 999.99,
      taxRate: 0.0825, // 8.25%
    },
  })

  console.log('\n✅ Created product:', {
    name: product1.name,
    basePrice: product1.basePrice.toString(),
    taxRate: product1.taxRate.toString(),
    totalPrice: product1.totalPrice?.toString(), // Automatically computed!
  })

  const product2 = await prisma.product.create({
    data: {
      name: 'Mouse',
      basePrice: 29.99,
      // Uses default tax rate of 8.25%
    },
  })

  console.log('✅ Created product:', {
    name: product2.name,
    basePrice: product2.basePrice.toString(),
    taxRate: product2.taxRate.toString(),
    totalPrice: product2.totalPrice?.toString(),
  })

  // Create posts
  await prisma.post.create({
    data: {
      title: 'Getting Started with Prisma',
      content: 'Prisma is a next-generation ORM...',
      published: true,
      authorId: user1.id,
    },
  })

  await prisma.post.create({
    data: {
      title: 'Understanding Computed Fields',
      content: 'Computed fields are database-level...',
      published: true,
      authorId: user2.id,
    },
  })

  console.log('\n✅ Created 2 blog posts')
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
