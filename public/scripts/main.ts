import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import Stats from "stats.js"

import type { Lobby } from "./publicTypes"

//NOTE - Socket Init
import { io } from "socket.io-client"
const socket = io()
socket.on("connect", () => {
    console.log("SocketID:", socket.id)

    socket.emit("ping", Date.now())
})

socket.on("pong", (data) => {
    console.log("Latency:", Date.now() - data, "ms")
    
})

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
    //note - THREE Scene Init
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x050505)

    //note - THREE Camera Init
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        10000
    )
    camera.position.set(.5, 2, 4)
    camera.lookAt(0, 0, 0)

    //note - THREE Renderer Init
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    document.body.appendChild(renderer.domElement)

    //note - THREE Stats Init
    const stats = new Stats()
    stats.showPanel(0)
    document.body.appendChild(stats.dom)

    //note - GLTF Loader
    const loader = new GLTFLoader()
    
    //Car Models
    const [carGLTF, wheelGLTF] = await Promise.all([
        loader.loadAsync("../assets/models/f1.glb"),
        loader.loadAsync("../assets/models/tire.glb")
    ])
    const [carModel, wheelModel] = [carGLTF.scene, wheelGLTF.scene]

    //note - Resize Handling
    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()

        renderer.setSize(window.innerWidth, window.innerHeight)
    })

    //note - lighting
    const ambient = new THREE.AmbientLight(0xffffff, 1)
    scene.add(ambient)
        
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.position.set(20, 30, 10)
    sun.castShadow = true
    scene.add(sun)

    //note - Plane
    const planeGeo = new THREE.PlaneGeometry(100, 100)
    const planeMat = new THREE.MeshStandardMaterial({
        color: 0x141414,
        roughness: 1
    })
    const plane = new THREE.Mesh(planeGeo, planeMat)
    plane.rotateX(-Math.PI / 2)
    scene.add(plane)

    //fun - gameLoop()
    function renderLoop(): void {
        requestAnimationFrame(renderLoop)
        stats.begin()
    
        renderer.render(scene, camera)

        if (!lobby.solo) {

        }
    
        stats.end()
    }
    requestAnimationFrame(renderLoop)
}
//!FUNCTION