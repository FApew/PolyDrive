import express from "express"
import { dirname, join } from "path"
import { createServer } from "http"
import { fileURLToPath } from "url"
import { Server } from "socket.io"

import type { Room, LobbyPlayer, CarVisuals, DefaultChange, RoomState, WorldManifest } from "./shared/types"

//SECTION - General Server Init
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { config } from "./private/ts/config"

import { initializePhysics, createWorld, destroyWorld } from "./private/ts/physics"

const PORT = process.env.PORT || 3000

const app = express()
const server = createServer(app)
const io = new Server(server)

app.set("trust proxy", true)

//Frontend
app.use(express.static(join(__dirname, "dist")))

//!SECTION

//SECTION - Room Engine
const roomRecord: Record<string, Room> = {}
const playerRecord: Record<string, string> = {}

//fun - generateCode()
function generateCode(length: number = config.game.codes_length): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

    let ret
    do {
        const random = new Uint32Array(length)
        crypto.getRandomValues(random)
        ret = Array.from(random, (n) => {return chars[n % chars.length]}).join("")
    } while (Object.hasOwn(roomRecord, ret))

    return ret
}

//fun - createRoom()
function createRoom(id: string, code: string): void {
    const newRoom: Room = {
        code: code,
        leader: id,
        playerList: [],
        state: "lobby",
        manifest: null
    }
    roomRecord[code] = newRoom
}

//fun - joinRoom()
function joinRoom(id: string, username: string, carVisuals: CarVisuals, lights: boolean, code: string): void {
    const newPlayer: LobbyPlayer = {
        id: id,
        username: username,
        ready: false,
        carVisuals: carVisuals,
        throttle: 0,
        steer: 0,
        lights: lights
    }

    roomRecord[code]!.playerList.push(newPlayer)
    playerRecord[id] = code
}

//fun - leaveRoom()
function leaveRoom(id: string): void {
    const code = playerRecord[id]
    if (code && roomRecord[code]) {
        if (roomRecord[code].state == "starting") { roomRecord[code].state = "lobby" }
        
        const playerList = roomRecord[code].playerList

        const idx = playerList.findIndex((player) => {return player.id == id})
        playerList.splice(idx, 1)
        delete playerRecord[id]

        const playerIDsList = playerList.map((obj) => {return obj.id!})
        if (playerIDsList.length > 0) {
            if (roomRecord[code].leader == id) { roomRecord[code].leader = playerIDsList[0]! }

            switch (roomRecord[code].state) {
                case "lobby": {
                    io.to(playerIDsList).emit("lobbyRefresh", playerList)
                    
                    break
                }
            }
        }

        if (playerList.length == 0) {
            destroyRoom(code)
        }
    }
}

//fun - destroyRoom()
function destroyRoom(code: string): void {
    if (!roomRecord[code]) return

    if (roomRecord[code].state == "running") destroyWorld(code)

    delete roomRecord[code]
}

//fun - checkReadyState()
function checkReadyState(lobby: Room): void {
    const idx = lobby.playerList.findIndex((obj) => {return obj.ready == false})

    if (idx == -1) {
        initStartTimer(lobby)
    } else if (lobby.state == "starting") {
        abortStartTimer(lobby)
    }
}

//!SECTION

//SECTION - Game Phase Handlers

//fun - initStartTimer()
async function initStartTimer(room: Room): Promise<void> {
    room.state = "starting";
    const playerIDsList = room.playerList.map((obj) => {return obj.id!})

    //socket_Out - initStartTimer
    io.to(playerIDsList).emit("initStartTimer")

    for (let i = config.game.starting_timer - 1; i >= 0; i--) {
        await new Promise((res) => {setTimeout(res, 1000)})

        if ((room.state as Room["state"]) == "lobby") return

        //socket_Out - startTimerUpdate
        io.to(playerIDsList).emit("startTimerUpdate", i)
    }

    timerFinished(room)
}

//fun - abortStartTimer()
function abortStartTimer(lobby: Room): void {
    lobby.state = "lobby";
    const playerIDsList = lobby.playerList.map((obj) => {return obj.id!})

    //socket_Out - abortStartTimer
    io.to(playerIDsList).emit("abortStartTimer")
}

//fun - timerFinished()
async function timerFinished(room: Room): Promise<void> {
    const playerIDsList = room.playerList.map((obj) => {return obj.id!})

    room.state = "running"

    io.to(playerIDsList).emit("startTimerFinish")
    await new Promise((res) => {setTimeout(res, 5)})
    const pt = Date.now()

    const manifest = getWorldManifest(room.code)
    room.manifest = manifest

    await new Promise((res) => {setTimeout(res, 5)})

    const dt = Date.now() - pt
    if (dt < 500 ) await new Promise((res) => {setTimeout(res, 500 - dt)})
    io.to(playerIDsList).emit("gameRoomLoadingDone", manifest)
}

//!SECTION

//SECTION - Game Physics & Objects

//fun - generateWorldManifest()
function getWorldManifest(code: string, seed: number = Date.now()): WorldManifest {
    return createWorld(code, seed)
}

//fun - destroyWorld()
function DestroyWorld(code: string): void {
    destroyWorld(code)
}

//SECTION IO Handler
io.on("connection", (socket) => {

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
        createRoom(socket.id, code)

        ack({code: code})
    })

    //socket_IO - joinLobby
    socket.on("joinLobby", ({code, user, carVisuals, lights}) => {
        if (roomRecord[code] == undefined) createRoom(socket.id, code)
        joinRoom(socket.id, user, carVisuals, lights, code)

        const playerList = roomRecord[code]!.playerList

        const playerIDsList = playerList.map((obj) => {return obj.id!})
        io.to(playerIDsList).emit("lobbyRefresh", playerList)
    })

    //socket_IO - checkCode
    socket.on("checkCode", (code: string, ack) => {
        const res = roomRecord[code] ? true : false
        ack(res)
    })

    //socket_IO - checkLobbySize
    socket.on("checkLobbySize", (code: string, ack) => {
        let res = true
        if (roomRecord[code]) {
            res = roomRecord[code].playerList.length < config.game.lobby_max_size
        }
        
        ack(res)
    })

    //socket_IO - getRoomState
    socket.on("getRoomState", (code: string, ack) => {
        let res: RoomState

        if (roomRecord[code]) {
            res = roomRecord[code]!.state
        } else {
            res = "lobby"
        }

        ack(res)
    })

    //socket_In - requestDefaultChange
    socket.on("requestDefaultChange", ({player, changeType}: DefaultChange) => {
        const code = playerRecord[socket.id]
        
        if (code && roomRecord[code]) {

            const playerList = roomRecord[code].playerList
            const idx = playerList.findIndex((player) => {return player.id == socket.id})
            const target = playerList[idx]
            
            switch (changeType) {
                case "username": {
                    target!.username = player!.username
                    break
                }
                case "ready": {
                    target!.ready = player!.ready
                    checkReadyState(roomRecord[code])
                    break
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
        if (code && roomRecord[code]) {

            const playerList = roomRecord[code].playerList
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
        leaveRoom(socket.id)
    })
})
//!SECTION

await initializePhysics()

server.listen(PORT, () => {
    console.log(`PORT ${PORT} OPEN`)
})