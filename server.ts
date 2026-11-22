import express from "express"
import { dirname, join } from "path"
import { createServer } from "http"
import { fileURLToPath } from "url"
import { Server } from "socket.io"

import * as THREE from "three"

import type { Lobby, LobbyPlayer, CarModelName, CarVisuals, DefaultChange } from "./shared/types"

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
function joinLobby(id: string, username: string, carVisuals: CarVisuals, lights: boolean, code: string): void {
    const newPlayer: LobbyPlayer = {
        id: id,
        username: username,
        carVisuals: carVisuals,
        throttle: 0,
        steer: 0,
        lights: lights
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

        const playerIDsList = playerList.map((obj) => {return obj.id!})
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
    socket.on("joinLobby", ({code, user, carVisuals, lights}) => {
        if (lobbyRecord[code] == undefined) createLobby(socket.id, code)
        joinLobby(socket.id, user, carVisuals, lights, code)
        
        console.log("User", socket.id, "joined", code)

        const playerList = lobbyRecord[code]!.playerList

        const playerIDsList = playerList.map((obj) => {return obj.id!})
        io.to(playerIDsList).emit("lobbyRefresh", playerList)
    })

    //socket_IO - checkCode
    socket.on("checkCode", (code: string, ack) => {
        const res = lobbyRecord[code] ? true : false
        console.log("Code", code, "checked:", res)
        ack(res)
    })

    //socket_In - requestDefaultChange
    socket.on("requestDefaultChange", ({player, changeType}: DefaultChange) => {
        const code = playerRecord[socket.id]
        
        if (code && lobbyRecord[code]) {

            const playerList = lobbyRecord[code].playerList
            const idx = playerList.findIndex((player) => {return player.id == socket.id})
            const target = playerList[idx]
            
            switch (changeType) {
                case "username": {
                    target!.username = player!.username
                }
                case "color": {
                    target!.carVisuals.color = player!.carVisuals.color
                    break
                }
                case "model": {
                    target!.carVisuals.model = player!.carVisuals.model
                    break
                }
            }

            const playerIDsList = playerList.map((obj) => {return obj.id!})

            const change: DefaultChange = {
                player: target!,
                changeType
            }

            io.to(playerIDsList).emit("incomingDefaultChange", change)
        }
    })

    //socket_In - requestHotUpdate
    socket.on("requestHotUpdate", ({throttle, steer, lights}) => {
        const code = playerRecord[socket.id]
        if (code && lobbyRecord[code]) {

            const playerList = lobbyRecord[code].playerList
            const idx = playerList.findIndex((player) => {return player.id == socket.id})
            const target = playerList[idx]

            target!.throttle = throttle
            target!.steer = steer
            target!.lights = lights

            const playerIDsList = playerList.map((obj) => {return obj.id!})
            io.to(playerIDsList).emit("incomingHotUpdate", target)
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