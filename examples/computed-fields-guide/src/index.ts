import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
})

async function demonstrateComputedFields() {
    console.log('🚀 Demonstrating Computed Fields with Prisma\n')
    console.log('='.repeat(60))

    // Cleanup existing data
    await prisma.post.deleteMany()
    await prisma.user.deleteMany()
    await prisma.product.deleteMany()

    // Example 1: Creating records with computed fields
    console.log('\n📝 Example 1: Creating a User')
    console.log('-'.repeat(60))

    const user = await prisma.user.create({
        data: {
            firstName: 'Alice',
            lastName: 'Johnson',
            email: 'alice.johnson@prisma.io',
            countryCode: '+1',
            phone: '5559876543',
        },
    })

    console.log('Input data:')
    console.log(`  First Name: ${user.firstName}`)
    console.log(`  Last Name: ${user.lastName}`)
    console.log(`  Email: ${user.email}`)
    console.log(`  Country Code: ${user.countryCode}`)
    console.log(`  Phone: ${user.phone}`)
    console.log('\nComputed fields (automatically generated):')
    console.log(`  ✨ Full Name: ${user.fullName}`)
    console.log(`  ✨ Formatted Phone: ${user.formattedPhone}`)
    console.log(`  ✨ Email Domain: ${user.emailDomain}`)

    // Example 2: Querying by computed fields
    console.log('\n\n🔍 Example 2: Querying by Computed Fields')
    console.log('-'.repeat(60))

    const usersFromPrisma = await prisma.user.findMany({
        where: {
            emailDomain: 'prisma.io',
        },
        select: {
            fullName: true,
            email: true,
            emailDomain: true,
        },
    })

    console.log(`Found ${usersFromPrisma.length} user(s) with @prisma.io email:`)
    usersFromPrisma.forEach((u: any) => {
        console.log(`  - ${u.fullName} (${u.email})`)
    })

    // Example 3: Searching by full name
    console.log('\n\n🔎 Example 3: Searching by Full Name')
    console.log('-'.repeat(60))

    const searchResults = await prisma.user.findMany({
        where: {
            fullName: {
                contains: 'Alice',
            },
        },
        select: {
            fullName: true,
            email: true,
        },
    })

    console.log(`Search results for "Alice":`)
    searchResults.forEach((u: any) => {
        console.log(`  - ${u.fullName} (${u.email})`)
    })

    // Example 4: Product with computed total price
    console.log('\n\n💰 Example 4: Product with Computed Total Price')
    console.log('-'.repeat(60))

    const product = await prisma.product.create({
        data: {
            name: 'Wireless Keyboard',
            basePrice: 79.99,
            taxRate: 0.0825, // 8.25% tax
        },
    })

    console.log('Product created:')
    console.log(`  Name: ${product.name}`)
    console.log(`  Base Price: $${product.basePrice}`)
    console.log(`  Tax Rate: ${(Number(product.taxRate) * 100).toFixed(2)}%`)
    console.log(`  ✨ Total Price: $${product.totalPrice} (computed!)`)

    // Example 5: Updating records (computed fields auto-update)
    console.log('\n\n🔄 Example 5: Updating Records')
    console.log('-'.repeat(60))

    const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
            lastName: 'Williams', // Change last name
        },
    })

    console.log('Updated last name from "Johnson" to "Williams"')
    console.log(`  ✨ Full Name automatically updated to: ${updatedUser.fullName}`)

    // Example 6: Demonstrating read-only nature
    console.log('\n\n🚫 Example 6: Computed Fields are Read-Only')
    console.log('-'.repeat(60))

    try {
        await prisma.user.create({
            data: {
                firstName: 'Bob',
                lastName: 'Smith',
                email: 'bob@example.com',
                countryCode: '+1',
                phone: '5551111111',
                fullName: 'This will fail!', // Trying to set computed field
            } as any,
        })
    } catch (error: any) {
        console.log('❌ Attempting to set computed field failed (as expected):')
        console.log(`   Error: ${error.message.split('\n')[0]}`)
    }

    // Example 7: Aggregations with computed fields
    console.log('\n\n📊 Example 7: Aggregations with Computed Fields')
    console.log('-'.repeat(60))

    const domainCounts = await prisma.user.groupBy({
        by: ['emailDomain'],
        _count: {
            emailDomain: true,
        },
        orderBy: {
            _count: {
                emailDomain: 'desc',
            },
        },
    })

    console.log('Users grouped by email domain:')
    domainCounts.forEach((group: any) => {
        console.log(`  ${group.emailDomain}: ${group._count.emailDomain} user(s)`)
    })

    console.log('\n' + '='.repeat(60))
    console.log('✅ All examples completed successfully!')
}

// Run the demonstration
demonstrateComputedFields()
    .catch((e) => {
        console.error('❌ Error:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
