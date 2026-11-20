import fs from 'fs/promises'

const MODELS_COUNT = 100
const fieldsCount = 5

// can be used to generate schema for this benchmark
// generated schema needs `format` pass to be valid
async function main() {
  const models = Array.from({ length: MODELS_COUNT }).map((v, i) => `Model${i}`)
  const modelsStr = models
    .map((modelName, currentModelIdx) => {
      const fields = ['id Int @id']
      for (let i = 0; i < fieldsCount; i++) {
        const modelIdx = (currentModelIdx + i + 1) % MODELS_COUNT
        fields.push(`model${modelIdx}Id Int`)
        fields.push(`model${modelIdx} Model${modelIdx} @relation(fields: [model${modelIdx}Id], references: [id])`)
      }

      return `
    model ${modelName} {
       ${fields.join('\n')} 
    }
    `
    })
    .join('\n')

  const str = `
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
      provider = "postgresql"
  }

  ${modelsStr}
  `

  await fs.writeFile('schema.prisma', str)
}

void main()
