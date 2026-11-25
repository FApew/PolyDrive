import * as THREE from "three"
import type { AudioMain, CameraMain, RoomState } from "../../shared/types";

import {
    lobbyInit, isLobbyCode, isLobbyJoinable, joinLobby
} from "./lobby"

import { updateInfos } from "./UI"

//SECTION - Initialization

//NOTE - Global Vars
let state: RoomState = "lobby"

export const params = new URLSearchParams(window.location.search)

export const scene = new THREE.Scene()

export const audioMain: AudioMain = {
    listener: undefined,
    state: false,
    initPromise: undefined,
    visibilityPromise: Promise.resolve()
}

export const cameraMain: CameraMain = {
    object: undefined,
    controls: undefined
}

//NOTE - Socket Init
import { io } from "socket.io-client"
export const socket = io()

//socket_In - connect
socket.on("connect", () => {
    console.log("SocketID:", socket.id)
    socket.emit("ping", Date.now())
})

//socket_In - pong
socket.on("pong", (time: number) => {
    console.log("Latency:", Date.now() - time, "ms")
})

//socket_In - Init
socket.on("Init", async () => {
    const code = params.get("code")

    if (code) {
        if (!isLobbyCode(code)) {
            inLobby()
            invalidRoom()
        } else {
            if (!await isLobbyJoinable(code, false)) {
                inLobby()
                invalidRoom()
            }

            state = await getRoomState(code)

            switch (state) {
                case "lobby": {
                    await inLobby()
                    await joinLobby(code, false)

                    break
                }
            }
        }
    } else {
        inLobby()
    }

    async function inLobby(): Promise<void> {
        await lobbyInit()
        updateInfos()
    }

    function invalidRoom(): void {
        params.delete("code")
        updateUrl()
        alert("Code Invalid or Room Full")
    }
})

//NOTE - KeyPress Listener
export const keys: Record<string, boolean> = {}

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true
})

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false
})

//!SECTION

//SECTION - Room Handler

//fun - getRoomState()
async function getRoomState(code: string): Promise<RoomState> {
    const res = await socket.emitWithAck("getRoomState", code)
    return res
}

//!SECTION

//fun - updateUrl()
export function updateUrl(): void {
    const url = new URL(window.location.href)
    const code = params.get("code")

    if (code) {
        url.searchParams.set("code", code)
    } else {
        url.searchParams.delete("code")
    }

    window.history.replaceState({}, "", url)
}