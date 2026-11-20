import { PrismaClient } from '@prisma/client'

export class MyPrisma {
  prisma: PrismaClient

  constructor() {
    this.prisma = new PrismaClient()
  }
}
