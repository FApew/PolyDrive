import * as THREE from "three"
import type { AudioMain, Volumes, CameraMain } from "../../shared/types"

import { config } from "../../shared/YAMLConfigs"

//NOTE - Socket Init
import { io } from "socket.io-client"
export const socket = io()

//socket_In - connect
socket.on("connect", () => {
    console.log("SocketID:", socket.id)
})

//socket_In - pong
socket.on("pong", (time: number) => {
    console.log("Latency:", Date.now() - time, "ms")
})

//note - params
export const params = new URLSearchParams(window.location.search)

//note - scene
export const scene = new THREE.Scene()

//note - CameraMain
export const cameraMain: CameraMain = {
    object: undefined,
    controls: undefined
}

//note - volumes
export const volumes: Volumes = {
    main: config.settings.main_volume.default,
    engine: 0
}

//note - AudioMain
export const audioMain: AudioMain = {
    listener: undefined,
    state: false,
    volumes: volumes,
    initPromise: undefined,
    visibilityPromise: Promise.resolve()
}

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

//NOTE - KeyPress Listener
export const keys: Record<string, boolean> = {}

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true
})

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false
})