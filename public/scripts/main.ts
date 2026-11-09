import * as THREE from "three"
import Stats from "stats.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import type { CarVisuals, Player } from "../../shared/types"

import { config } from "../../shared/YAMLConfigs"
import { carLobbyVisual } from "./carLobbyVisuals"

export let defaultColor: THREE.ColorRepresentation

let lobbyInitCheck: boolean = false
let currentCarVisuals: CarVisuals = {model: "giulia", color: 0x000000}
let inLobby = false

let ownCar: carLobbyVisual

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
socket.on("Init", () => {
    if (lobbyInitCheck) return
    lobbyInit()
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
    const controls = new OrbitControls(camera, renderer.domElement)
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
    ownCar = new carLobbyVisual(socket.id!, "giulia")
    
    ownCar.mesh.position.y = 0.33
    scene.add(ownCar.mesh)

    defaultColor = ownCar.getDefaultColor()
    currentCarVisuals.color = defaultColor

    let currentSpeed = 0, currentSteer = 0, pt = -1

    //fun - renderLoop()
    function renderLoop(): void {
        requestAnimationFrame(renderLoop)
        stats.begin()

        const ct = performance.now()
        let dt = pt ? ct - pt : 1

        const throttle = keys["w"] ? 1 : 0
        const steer = (keys["a"] ? 1 : 0) - (keys["d"] ? 1 : 0)

        currentSpeed = THREE.MathUtils.lerp(currentSpeed, throttle * 0.1, 1 - Math.exp(-5 * dt / 1000))
        ownCar.wheelMesh[2]!.rotateX(currentSpeed)
        ownCar.wheelMesh[3]!.rotateX(currentSpeed)

        currentSteer = THREE.MathUtils.lerp(currentSteer, steer * 0.7, 1 - Math.exp(-5 * dt / 1000))
        ownCar.wheelMesh[0]!.rotation.y = currentSteer
        ownCar.wheelMesh[1]!.rotation.y = currentSteer
    
        controls.update()

        renderer.render(scene, camera)
        pt = ct
        stats.end()
    }
    requestAnimationFrame(renderLoop)
}
//!FUNCTION

//fun - joinedLobby()
async function joinedLobby(playerList: Player[]): Promise<void> {
    inLobby = true

    const joinButton = document.getElementById("join")
    joinButton!.id = "ready"
    joinButton!.innerHTML = "ready"

    const createButton = document.getElementById("create")
    createButton!.id = "leave"
    createButton!.innerHTML = "leave lobby"

    spawnCars(playerList)
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

//fun - spawnCars()
function spawnCars(playerList: Player[]): void {
    scene.clear()
    sceneSetup()

    playerList.forEach((player: Player, idx: number) => {
        const newCar = new carLobbyVisual(player.id, player.carVisuals.model)
        newCar.mesh.position.y = 0.33
        newCar.mesh.position.x = 3 * idx + (Math.random() - 0.5) * 0.2
        newCar.mesh.position.z = (Math.random() - 0.5) * 0.2
        setCarColor(player.carVisuals.color, newCar)

        if (socket.id == socket.id) ownCar = newCar

        scene.add(newCar.mesh)
    })
}

///fun// setCarModel()

//fun - setCarColor()
export function setCarColor(color: THREE.ColorRepresentation, target: carLobbyVisual = ownCar): void {
    target.setColor(color)
    if (target.id == socket.id) currentCarVisuals.color = color
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
    joinedLobby(res.playerList)

    return true
}