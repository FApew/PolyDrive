import express from "express"
import { dirname, join } from "path"
import { createServer } from "http"
import { fileURLToPath } from "url"
import { Server } from "socket.io"

import * as THREE from "three"

import type { Lobby, LobbyPlayer, CarModelName, CarVisuals } from "./shared/types"

//SECTION - General Server Init
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import YAML from "yaml"
import fs from "node:fs"
const configTxt = fs.readFileSync(join(__dirname, "shared/config/config.yaml"), "utf-8")
const config = YAML.parse(configTxt)

const PORT = process.env.PORT || 3000

const app = express()
const server = createServer(app)
const io = new Server(server)

app.set("trust proxy", true)

//Frontend
app.use(express.static(join(__dirname, "dist")))

//!SECTION

//SECTION - Lobby Engine
const lobbyRecord: Record<string, Lobby> = {}
const playerRecord: Record<string, string> = {}

//fun - createLobby()
function createLobby(id: string, code: string): void {
    const newLobby: Lobby = {
        code: code,
        leader: id,
        playerList: [],
        state: "lobby"
    }
    lobbyRecord[code] = newLobby
}

//fun - joinLobby()
function joinLobby(id: string, carVisuals: CarVisuals, code: string): void {
    const newPlayer: LobbyPlayer = {
        id: id,
        carVisuals: carVisuals,
        throttle: 0,
        steer: 0
    }

    lobbyRecord[code]!.playerList.push(newPlayer)
    playerRecord[id] = code
}

//fun - leaveLobby()
function leaveLobby(id: string): void {
    const code = playerRecord[id]
    if (code && lobbyRecord[code]) {

        const playerList = lobbyRecord[code].playerList

        const idx = playerList.findIndex((player) => {return player.id == id})
        playerList.splice(idx, 1)
        delete playerRecord[id]

        const playerIDsList = playerList.map((obj) => {return obj.id})
        if (playerIDsList.length > 0) {
            if (lobbyRecord[code].leader == id) { lobbyRecord[code].leader = playerIDsList[0]! }

            io.to(playerIDsList).emit("lobbyRefresh", playerList)
        }

        console.log("User", id, "left", code)
        if (playerList.length == 0) {
            destroyLobby(code)
        }
    }
}

//fun - destroyLobby()
function destroyLobby(code: string): void {
    delete lobbyRecord[code]
    console.log("Lobby", code, "destroyed")
}

//!SECTION

//SECTION IO handler
io.on("connection", (socket) => {
    console.log("User Connected:", socket.id)

    //socket_In - ping
    socket.on("ping", (time: number) => {
        console.log("Latency:", Date.now() - time, "ms")
        
        //socket_Out - pong
        socket.emit("pong", time)

        //socket_Out - Init
        socket.emit("Init")
        playerRecord[socket.id] = ""
    })

    //socket_IO - createLobby
    socket.on("createLobby", (ack) => {
        const code = generateCode()
        createLobby(socket.id, code)

        console.log("Lobby", code, "created")
        ack({code: code})
    })

    //socket_IO - joinLobby
    socket.on("joinLobby", ({code, carVisuals}: {code: string, carVisuals: CarVisuals}, ack) => {
        joinLobby(socket.id, carVisuals, code)
        
        console.log("User", socket.id, "joined", code)

        const playerList = lobbyRecord[code]!.playerList

        const playerIDsList = playerList.map((obj) => {return obj.id})
        io.to(playerIDsList).emit("lobbyRefresh", playerList)

        ack({playerList: playerList})
    })

    //socket_IO - checkCode
    socket.on("checkCode", (code: string, ack) => {
        const res = lobbyRecord[code] ? true : false
        console.log("Code", code, "checked:", res)
        ack(res)
    })

    //socket_In - REQvisibleChange
    socket.on("REQvisibleChange", ({carVisuals, change}) => {
        const code = playerRecord[socket.id]
        if (code && lobbyRecord[code]) {

            const playerList = lobbyRecord[code].playerList
            const idx = playerList.findIndex((player) => {return player.id == socket.id})

            playerList[idx]!.carVisuals = carVisuals

            const playerIDsList = playerList.map((obj) => {return obj.id})
            io.to(playerIDsList).emit("RESvisibleChange", ({playerList: playerList, change: change}))
        }
    })

    //socket_In - REQwheelsUpdate
    socket.on("REQwheelsUpdate", ({throttle, steer}) => {
        const code = playerRecord[socket.id]
        if (code && lobbyRecord[code]) {

            const playerList = lobbyRecord[code].playerList
            const idx = playerList.findIndex((player) => {return player.id == socket.id})

            playerList[idx]!.throttle = throttle
            playerList[idx]!.steer = steer

            const playerIDsList = playerList.map((obj) => {return obj.id})
            io.to(playerIDsList).emit("RESvisibleChange", ({playerList: playerList, change: "wheels"}))
        }
    })
    
    //socket_In - disconnect
    socket.on("disconnect", () => {
        console.log("User Disconnected:", socket.id)

        leaveLobby(socket.id)
    })
})
//!SECTION

//fun - generateCode()
function generateCode(length: number = config.game.codes_length): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

    let ret
    do {
        const random = new Uint32Array(length)
        crypto.getRandomValues(random)
        ret = Array.from(random, (n) => {return chars[n % chars.length]}).join("")
    } while (Object.hasOwn(lobbyRecord, ret))

    return ret
}

server.listen(PORT, () => {
    console.log(`PORT ${PORT} OPEN`)
})