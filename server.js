import express from "express"
import { dirname, join } from "path"
import { createServer } from "http"
import { fileURLToPath } from "url"
import { Server } from "socket.io"

import * as THREE from "three"
import RAPIER from "@dimforge/rapier3d-compat"

//SECTION - General Server Init
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 3000

const app = express()
const server = createServer(app)
const io = new Server(server)

app.set("trust proxy", true)

//Frontend
app.use(express.static(join(__dirname, "dist")))

//!SECTION

//SECTION IO handler
io.on("connection", (socket) => {
    console.log("User Connected:", socket.id)

    socket.on("ping", (data) => {
        console.log("Latency", Date.now() - data, "ms")
        socket.emit("pong", data)

        socket.emit("genLobby")
    })
    
    socket.on("disconnect", () => {
        console.log("User Disconnected:", socket.id)
    })
})
//!SECTION

server.listen(PORT, () => {
    console.log(`PORT ${PORT} OPEN`)
})