// This file is used to build large schemas for benchmarking purposes

import fs from 'fs'
import path from 'path'

function write(location: string, data: string) {
  if (fs.existsSync(location)) {
    fs.unlinkSync(location)
  }
  fs.writeFileSync(location, data, {})
}

class Model {
  name: string
  body: string
  constructor({ name, body }: { name: string; body?: string }) {
    this.name = name
    this.body = body ?? ``
  }
  public build() {
    return `
model ${this.name} {
  ${this.body}
}
`
  }
}

function main() {
  let schema = `
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["groupBy"]
}

datasource db {
  provider = "postgresql"
  }
  
  `
  const ts = `
import { PrismaClient } from  '@prisma/client'
const client = new PrismaClient();

async function main(){
  const a = await client.model1.findMany()
}
main().catch(err => console.log(err))
`
  const modelMap = new Map<string, Model>()
  for (let i = 1; i < 50; i++) {
    const modelName = `Model${i}`
    const model = new Model({
      name: modelName,
      body: `   id        Int      @id @default(autoincrement())
    int             Int
    optionalInt     Int?
    float           Float
    optionalFloat   Float?
    string          String
    optionalString  String?
    json            Json
    optionalJson    Json?
    boolean         Boolean
    optionalBoolean Boolean?`,
    })
    modelMap.set(modelName, model)
  }
  modelMap.forEach((model) => {
    schema += model.build()
  })
  const schemaPath = path.join(__dirname, 'schema.prisma')
  const tsPath = path.join(__dirname, 'compile.ts')

  write(schemaPath, schema)
  write(tsPath, ts)
}

main()
