import * as THREE from "three"
import type { RoomState, WorldManifest } from "../../shared/types";

import { params, socket, updateUrl, scene } from "./runtime"

import { config } from "../../shared/YAMLConfigs"
import { updateInfos, closeSideBar } from "./UI"
import {lobbyInit, isLobbyCode, isLobbyJoinable, joinLobby, clearLobby} from "./lobby"
import { gameSceneInit } from "./game";

import { changeReadyState } from "./lobby"

//SECTION - Initialization
socket.emit("ping", Date.now())

//NOTE - Global Vars
let state: RoomState = "lobby"

//socket_In - Init
socket.on("Init", async () => {
    const code = params.get("code")

    if (code) {
        if (!isLobbyCode(code)) {
            await inLobby()
            invalidRoom()
            loadingScreen.classList.remove("selected")
        } else {
            if (!await isLobbyJoinable(code, false)) {
                await inLobby()
                invalidRoom()
                loadingScreen.classList.remove("selected")
            }

            state = await getRoomState(code)

            switch (state) {
                case "lobby": {
                    await inLobby()
                    await joinLobby(code, false)
                    loadingScreen.classList.remove("selected")

                    break
                }

                default: {
                    await inLobby()
                    invalidRoom()
                    loadingScreen.classList.remove("selected")
                }
            }
        }
    } else {
        await inLobby()
        loadingScreen.classList.remove("selected")
    }

    //changeReadyState(true)

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

//!SECTION

//SECTION - Room Handler
const $ = (id: string): HTMLElement => {return document.getElementById(id)!}
const topText = $("topText") as HTMLDivElement
const loadingScreen = $("loadingScreen") as HTMLDivElement

//socket_In - initStartTimer
socket.on("initStartTimer", () => {
    topText.classList.add("selected")
    topText.innerHTML = `Starting in ${config.game.starting_timer}s`
})

//socket_In - startTimerUpdate
socket.on("startTimerUpdate", (sec: number) => {
    topText.innerHTML = `Starting in ${sec}s`
})

//socket_In - abortStartTimer
socket.on("abortStartTimer", () => {
    topText.classList.remove("selected")
})

//socket_In - startTimerFinish
socket.on("startTimerFinish", () => {
    topText.classList.remove("selected")
    loadingScreen.classList.add("selected")
    closeSideBar()
})

//socket_In - gameRoomLoadingDone
socket.on("gameRoomLoadingDone", (manifest: WorldManifest) => {
    clearLobby()
    gameSceneInit()
    
    console.log(manifest)
    debugShowCenterline(manifest.track.poses, scene)

    loadingScreen.classList.remove("selected")
})

//fun - getRoomState()
async function getRoomState(code: string): Promise<RoomState> {
    const res = await socket.emitWithAck("getRoomState", code)
    return res
}

//!SECTION

//SECTION - DebugFun

//debugFun - debugShowCenterline()
function debugShowCenterline(poses: THREE.Vector3[], scene: THREE.Scene): void {

    const geometry = new THREE.BufferGeometry().setFromPoints(poses)
    const material = new THREE.LineBasicMaterial({ color: 0xffffff })

    const line = new THREE.Line(geometry, material)
    line.name = "Centerline"

    scene.add(line)
}

//!SECTION