import * as THREE from "three"
import Stats from "stats.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import { config } from "../../shared/YAMLConfigs"
import type { Lobby } from "../../shared/types"
import { carLobbyVisual } from "./carLobbyVisuals"

//NOTE - Socket Init
import { io } from "socket.io-client"
const socket = io()

//socket_In - connect
socket.on("connect", () => {
    console.log("SocketID:", socket.id)

    socket.emit("ping", Date.now())
})

//socket_In - pong
socket.on("pong", (data) => {
    console.log("Latency:", Date.now() - data, "ms")
})

//socket_In - genLobby
socket.on("genLobby", () => {
    lobbyInit()
})

//note - Lobby OBJ
const lobby: Lobby = {
    solo: true,
    code: undefined
}

//FUNCTION - lobbyInit()
async function lobbyInit() {
    //note - Scene Init
    const scene = new THREE.Scene()
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
    controls.enablePan = true

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

    //note - Lighting Init
    const ambient = new THREE.AmbientLight(0xffffff, 1)
    scene.add(ambient)

    const spotlight = new THREE.SpotLight( 0xffffff, 150)
    spotlight.penumbra = 1
    spotlight.decay = 2
    spotlight.distance = 0
    spotlight.position.set(0, 10, 0)
    spotlight.lookAt(0, 0, 0)
    scene.add(spotlight)

    //note - Plane Init
    const planeGeo = new THREE.PlaneGeometry(100, 100)
    const planeMat = new THREE.MeshStandardMaterial({
        color: 0x141414,
        roughness: 1
    })
    const plane = new THREE.Mesh(planeGeo, planeMat)
    plane.rotateX(-Math.PI / 2)
    scene.add(plane)

    //note - Car Init
    const car = new carLobbyVisual("giulia")
    
    car.mesh.position.y = 0.33
    scene.add(car.mesh)

    let currentSpeed = 0, currentSteer = 0

    //fun - gameLoop()
    let pt = -1
    function renderLoop(): void {
        requestAnimationFrame(renderLoop)
        stats.begin()

        const ct = performance.now()
        let dt = pt ? ct - pt : 1

        const throttle = keys["w"] ? 1 : 0
        const steer = (keys["a"] ? 1 : 0) - (keys["d"] ? 1 : 0)

        currentSpeed = THREE.MathUtils.lerp(currentSpeed, throttle * 0.1, 1 - Math.exp(-5 * dt / 1000))
        car.wheelMesh[2]!.rotateX(currentSpeed)
        car.wheelMesh[3]!.rotateX(currentSpeed)

        currentSteer = THREE.MathUtils.lerp(currentSteer, steer * 0.7, 1 - Math.exp(-5 * dt / 1000))
        car.wheelMesh[0]!.rotation.y = currentSteer
        car.wheelMesh[1]!.rotation.y = currentSteer
    
        controls.update()

        renderer.render(scene, camera)
        pt = ct
        stats.end()
    }
    requestAnimationFrame(renderLoop)
}
//!FUNCTION

//NOTE - KeyPress Listener
const keys: Record<string, boolean> = {}

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true
})

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false
})