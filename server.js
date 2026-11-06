import express from "express"
import path from "path"
import http from "http"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 3000

const app = express()
const server = http.createServer(app)
app.use(express.static(path.join(__dirname, "dist")))

app.set("trust proxy", true)

server.listen(PORT, () => {
    console.log(`PORT ${PORT} OPEN`)
})