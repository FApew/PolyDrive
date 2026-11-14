import * as THREE from "three"
import Stats from "stats.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import type { CarVisuals, LobbyPlayer, TopRightInfo, LobbyCarList, CarModelName } from "../../shared/types"

import { config } from "../../shared/YAMLConfigs"
import { carLobbyVisual, initAudio } from "./carLobbyVisuals"
import { modelList } from "./assetsLoader"
import { updateInfos } from "./UI"

let lobbyInitCheck: boolean = false
let inLobby = false

const cars: LobbyCarList = { own: undefined, others: [] }

const model = modelList[0/*Math.floor(Math.random() * modelList.length)*/]
export const currentCarVisuals: CarVisuals = {
    model: model!, 
    color: config.car.models[model!].default_color
}

const currentPlayer: LobbyPlayer = {
    id: undefined,
    carVisuals: currentCarVisuals,
    throttle: 0,
    steer: 0,
    lights: false
}

export const topRightInfo: TopRightInfo = {
    username: "",
    code: "",
    carVisuals: currentCarVisuals
}

const params = new URLSearchParams(window.location.search)

//NOTE - Socket Init
import { io } from "socket.io-client"
const socket = io()

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
    if (lobbyInitCheck) return
    currentPlayer.id = socket.id
    await lobbyInit()
    updateInfos()

    lobbyInitCheck = true

    //note - URL code param
    const code = params.get("code")
    if (code) {
        if (!isLobbyCode(code)) {
            params.delete("code")
            updateUrl()
        } else {
            joinLobby(code, false)
        }
    }
})

//note - User Interaction Audio Init
window.addEventListener("pointerdown", async () => {
    await audioListener.context.resume()
}, { once: true })

//NOTE - KeyPress Listener
const keys: Record<string, boolean> = {}

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true
})

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false
})

const scene = new THREE.Scene()
const audioListener = new THREE.AudioListener()
let controls: OrbitControls

//FUNCTION - lobbyInit()
async function lobbyInit(): Promise<void> {
    //note - Scene Init
    scene.background = new THREE.Color(0x070707)

    //note - Camera Init
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        10000
    )
    camera.position.set(-1.8, 1.67, 3.39)

    //note - Audio Init
    camera.add(audioListener)
    await initAudio(audioListener.context)

    //note - Renderer Init
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    document.body.appendChild(renderer.domElement)

    //note - Controls Init
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false

    controls.enableDamping = true
    controls.dampingFactor = 0.05

    controls.minPolarAngle = config.lobby.orbit_constraints.polar_angle.min / 180 * Math.PI
    controls.maxPolarAngle = config.lobby.orbit_constraints.polar_angle.max / 180 * Math.PI

    controls.minDistance = config.lobby.orbit_constraints.zoom.min
    controls.maxDistance = config.lobby.orbit_constraints.zoom.max
    
    controls.target.set(0, 0, 0)
    controls.update()

    //note - Stats Init
    const stats = new Stats()
    stats.showPanel(0)
    document.body.appendChild(stats.dom)

    //note - Resize Handling
    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()

        renderer.setSize(window.innerWidth, window.innerHeight)
    })    

    //note - Car Init
    spawnCars([currentPlayer])

    let lastThrottle = 0, lastSteer = 0, lastLights = false
    let pt = -1

    //fun - renderLoop()
    function renderLoop(): void {
        requestAnimationFrame(renderLoop)
        stats.begin()

        const ct = performance.now()
        let dt = pt ? ct - pt : 1

        const throttle = keys["w"] ? 1 : 0
        cars.own!.throttle = throttle

        const steer = (keys["a"] ? 1 : 0) - (keys["d"] ? 1 : 0)
        cars.own!.steer = steer

        const lights = keys["l"] ? true : false
        cars.own!.lights = lights
        cars.own!.updateLights()
        
        if ((lastThrottle != throttle || lastSteer != steer || lastLights != lights) && inLobby) {

            //socket_Out - REQcarUpdate
            socket.emit("REQcarUpdate", {throttle: throttle, steer: steer, lights: lights})
        }

        cars.own!.updateWheels(dt)
        cars.others.forEach((car) => {
            car.updateWheels(dt)
        })

        cars.own!.updateEngine(dt)
        cars.others.forEach((car) => {
            car.updateEngine(dt)
        })
    
        controls.update()

        renderer.render(scene, camera)
        pt = ct
        lastThrottle = throttle
        lastSteer = steer
        lastLights = lights
        stats.end()
    }
    requestAnimationFrame(renderLoop)
}
//!FUNCTION

//fun - joinedLobby()
async function joinedLobby(playerList: LobbyPlayer[]): Promise<void> {
    inLobby = true

    const joinButton = document.getElementById("join") as HTMLDivElement
    joinButton!.id = "ready"
    joinButton!.innerHTML = "ready"

    const createButton = document.getElementById("create") as HTMLDivElement
    createButton!.id = "leave"
    createButton!.innerHTML = "leave lobby"
}

//fun sceneSetup()
function sceneSetup(light: boolean = true): void {
    //Plane
    const planeGeo = new THREE.PlaneGeometry(100, 100)
    const planeMat = new THREE.MeshStandardMaterial({
        color: 0x141414,
        roughness: 0.9
    })
    const plane = new THREE.Mesh(planeGeo, planeMat)
    plane.receiveShadow = true
    plane.rotateX(-Math.PI / 2)
    scene.add(plane)

    //Lighting
    
    const ambient = new THREE.AmbientLight(0xffffff, 1)
    scene.add(ambient)

    if (light) spawnSpotlight(0, 0)
}

socket.on("lobbyRefresh", (playerList) => {
    spawnCars(playerList)
})

//fun - spawnCars()
function spawnCars(playerList: LobbyPlayer[]): void {
    scene.clear()
    sceneSetup(false)

    cars.own?.dispose()
    cars.others.forEach(car => {
        car.dispose()
    })

    cars.others = []
    playerList.forEach((player: LobbyPlayer, idx: number) => {
        const newCar = new carLobbyVisual(player.id!, player.carVisuals.model)
        newCar.initEngineAudio(audioListener)
        const x = 3 * idx + (Math.random() - 0.5) * 0.2, z = (Math.random() - 0.5) * 0.2
        newCar.mesh.position.x = x
        newCar.mesh.position.z = z
        setCarColor(player.carVisuals.color, newCar)

        if (player.id == socket.id) { cars.own = newCar }
        else {
            cars.others.push(newCar)
        }

        scene.add(newCar.mesh)

        spawnSpotlight(x, z)
    })

    controls.target.set((playerList.length - 1) * 3 / 2, 0, 0)    
    controls.minDistance = config.lobby.orbit_constraints.zoom.min * playerList.length
    controls.maxDistance = controls.minDistance + (config.lobby.orbit_constraints.zoom.max - config.lobby.orbit_constraints.zoom.min)
}

//fun - spawnSpotlight()
function spawnSpotlight(x: number, z: number): void {
    const spotlight = new THREE.SpotLight( 0xffffff, 150)
    spotlight.penumbra = 1
    spotlight.decay = 2
    spotlight.distance = 0
    
    spotlight.castShadow = true
    spotlight.shadow.mapSize.set(config.game.shadow_quality, config.game.shadow_quality)
    spotlight.shadow.camera.near = 0.5
    spotlight.shadow.camera.far = 50
    spotlight.shadow.bias = -0.0001
    spotlight.shadow.normalBias = 0.02

    spotlight.position.set(x, 10, z)
    spotlight.lookAt(x, 0, z)
    scene.add(spotlight)
}

//socket_In - RESvisibleChange
socket.on("RESvisibleChange", ({playerList, change}) => {
    if (change === "color") {
        playerList.forEach((player: LobbyPlayer) => {
            if (player.id == socket.id) return

            const idx = cars.others.findIndex((obj) => {return obj.id == player.id})
            cars.others[idx]!.setColor(player.carVisuals.color)

            cars.others[idx]!.throttle = player.throttle
            cars.others[idx]!.steer = player.steer
            cars.others[idx]!.lights = player.lights
            cars.others[idx]!.updateLights()
        })
    } else if (change === "input") {
        playerList.forEach((player: LobbyPlayer) => {
            
            if (player.id == socket.id) return

            const idx = cars.others.findIndex((obj) => {return obj.id == player.id})

            cars.others[idx]!.throttle = player.throttle
            cars.others[idx]!.steer = player.steer
            cars.others[idx]!.lights = player.lights
            cars.others[idx]!.updateLights()
        })
    } else if (change === "model") {
        spawnCars(playerList)
    }
})

///fun changeModel()
export function changeModel(model: CarModelName): void {
    currentCarVisuals.model = model
    currentCarVisuals.color = config.car.models[model].default_color
    updateInfos()

    if (inLobby) {
        //socket_Out - REQvisibleChange
        socket.emit("REQvisibleChange", {
            carVisuals: currentCarVisuals,
            change: "model"
        })
    } else { spawnCars([currentPlayer]) } 
    
}

//fun - setCarColor()
export function setCarColor(color: THREE.ColorRepresentation, target: carLobbyVisual = cars.own!): void {
    target.setColor(color)
    if (target.id == socket.id) {
        currentCarVisuals.color = color
        updateInfos()
    }

    if (inLobby) {

        //socket_Out - REQvisibleChange
        socket.emit("REQvisibleChange", {
            carVisuals: currentCarVisuals,
            change: "color"
        })
    }
}

//fun - createLobby()
export async function createLobby(): Promise<void> {
    //socket_IO - createLobby
    const res = await socket.emitWithAck("createLobby")

    joinLobby(res.code)
}

//fun - leaveLobby()
export function leaveLobby(): void {
    params.delete("code")
    updateUrl()
    location.reload()
}

//fun - joinLobby()
export async function joinLobby(code: string, codeCheck: boolean = true): Promise<boolean> {
    //socket_IO - checkCode
    if (!isLobbyCode(code)) {return false}
    if (!await socket.emitWithAck("checkCode", code) && codeCheck) { return false }

    //socket_IO - joinLobby
    const res = await socket.emitWithAck("joinLobby", {code: code, carVisuals: currentCarVisuals})

    topRightInfo.code = code
    inLobby = true
    updateInfos()

    params.set("code", code)
    updateUrl()

    joinedLobby(res.playerList)

    return true
}

//fun - isLobbyCode()
function isLobbyCode(value: string): boolean {
    return /^[A-Z0-9]{5}$/.test(value)
}

//fun - updateUrl()
function updateUrl(): void {
    const url = new URL(window.location.href)
    const code = params.get("code")

    if (code) {
        url.searchParams.set("code", code)
    } else {
        url.searchParams.delete("code")
    }

    window.history.replaceState({}, "", url)
}