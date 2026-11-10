import * as THREE from "three"
import Stats from "stats.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import type { CarVisuals, LobbyPlayer, TopRightInfo, LobbyCarList } from "../../shared/types"

import { config } from "../../shared/YAMLConfigs"
import { carLobbyVisual } from "./carLobbyVisuals"
import { updateInfos } from "./UI"

export let defaultColor: THREE.ColorRepresentation

let lobbyInitCheck: boolean = false
const currentCarVisuals: CarVisuals = {model: "giulia", color: 0x000000}
let inLobby = false

let cars: LobbyCarList = { own: undefined, others: []}

export const topRightInfo: TopRightInfo = {
    username: "",
    code: "",
    carVisuals: currentCarVisuals
}

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
    await lobbyInit()
    updateInfos()

    lobbyInitCheck = true
})

//NOTE - KeyPress Listener
const keys: Record<string, boolean> = {}

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true
})

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false
})

const scene = new THREE.Scene()
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

    //note - Renderer Init
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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

    sceneSetup()

    //note - Car Init
    cars.own = new carLobbyVisual(socket.id!, "giulia")
    
    cars.own.mesh.position.y = 0.33
    scene.add(cars.own.mesh)

    defaultColor = cars.own.getDefaultColor()
    currentCarVisuals.color = defaultColor

    let lastThrottle = 0, lastSteer = 0
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
        
        if ((lastThrottle != throttle || lastSteer != steer) && inLobby) {
            socket.emit("REQwheelsUpdate", {throttle: throttle, steer: steer})
        }

        cars.own!.updateWheels(dt)
        cars.others.forEach((car) => {
            car.updateWheels(dt)
        })
    
        controls.update()

        renderer.render(scene, camera)
        pt = ct
        lastThrottle = throttle
        lastSteer = steer
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
function sceneSetup(): void {
    //Plane
    const planeGeo = new THREE.PlaneGeometry(100, 100)
    const planeMat = new THREE.MeshStandardMaterial({
        color: 0x141414,
        roughness: 1
    })
    const plane = new THREE.Mesh(planeGeo, planeMat)
    plane.rotateX(-Math.PI / 2)
    scene.add(plane)

    //Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 1)
    scene.add(ambient)

    const spotlight = new THREE.SpotLight( 0xffffff, 150)
    spotlight.penumbra = 1
    spotlight.decay = 2
    spotlight.distance = 0
    spotlight.position.set(0, 10, 0)
    spotlight.lookAt(0, 0, 0)
    scene.add(spotlight)
}

socket.on("lobbyRefresh", (playerList) => {
    spawnCars(playerList)
})

//fun - spawnCars()
function spawnCars(playerList: LobbyPlayer[]): void {
    scene.clear()
    sceneSetup()

    cars.others = []
    playerList.forEach((player: LobbyPlayer, idx: number) => {
        const newCar = new carLobbyVisual(player.id, player.carVisuals.model)
        newCar.mesh.position.y = 0.33
        newCar.mesh.position.x = 3 * idx + (Math.random() - 0.5) * 0.2
        newCar.mesh.position.z = (Math.random() - 0.5) * 0.2
        setCarColor(player.carVisuals.color, newCar)

        if (player.id == socket.id) { cars.own = newCar }
        else {
            cars.others.push(newCar)
        }

        scene.add(newCar.mesh)
    })

    controls.target.set((playerList.length - 1) * 3 / 2, 0, 0)    
}

socket.on("RESvisibleChange", ({playerList, change}) => {
    if (change === "color") {
        playerList.forEach((player: LobbyPlayer) => {
            if (player.id == socket.id) return

            const idx = cars.others.findIndex((obj) => {return obj.id == player.id})
            cars.others[idx]!.setColor(player.carVisuals.color)
        })
    } else if (change === "wheels") {
        console.log("reqRes")
        playerList.forEach((player: LobbyPlayer) => {
            
            if (player.id == socket.id) return

            const idx = cars.others.findIndex((obj) => {return obj.id == player.id})

            cars.others[idx]!.throttle = player.throttle
            cars.others[idx]!.steer = player.steer
        })
    }
})

///fun// setCarModel()

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
    location.reload()
}

//fun - joinLobby()
export async function joinLobby(code: string): Promise<boolean> {
    //socket_IO - checkCode
    if (!await socket.emitWithAck("checkCode", code)) { return false }

    //socket_IO - joinLobby
    const res = await socket.emitWithAck("joinLobby", {code: code, carVisuals: currentCarVisuals})

    topRightInfo.code = code
    inLobby = true
    updateInfos()

    joinedLobby(res.playerList)

    return true
}