import express, { json, urlencoded } from 'express'

import { RegisterRoutes } from '../build/routes'

export const app = express()

// Use body parser to read sent json payloads
app.use(
  urlencoded({
    extended: true,
  }),
)
app.use(json())

RegisterRoutes(app)
const port = process.env.PORT || 3000

app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))
