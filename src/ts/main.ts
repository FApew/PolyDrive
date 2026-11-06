import * as THREE from "three"
import { RAPIER, createWorld, RapierDebugger, updatePhysics, createStaticTrimesh, createDynamicConvex, clearSyncList } from "./physics"
import Stats from "stats.js"
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import type { TrackContext } from "./types"
import { genTerrain } from "./terrainGenerator"

//SECTION - Inizialization
import { config } from "./YAMLConfigs"
await RAPIER.init()

//NOTE - THREE Scene Init
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x071431)

//NOTE - THREE Camera Init
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    10000
)
camera.position.set(config.debug.camera.x, config.debug.camera.y, config.debug.camera.z);

//NOTE - THREE Renderer Init
const renderer = new THREE.WebGLRenderer({ antialias: true })

renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

document.body.appendChild(renderer.domElement)

const labelRenderer = new CSS2DRenderer();

labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.top = "0";
labelRenderer.domElement.style.left = "0";
labelRenderer.domElement.style.pointerEvents = "none";

document.body.appendChild(labelRenderer.domElement);

//NOTE - THREE Stats
const stats = new Stats()
stats.showPanel(0)
document.body.appendChild(stats.dom)

//NOTE - RAPIER World Init
let world: RAPIER.World
const physicsDebug = new RapierDebugger()

//NOTE - Resize Handling
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()

    renderer.setSize(window.innerWidth, window.innerHeight)
})

//NOTE - OrbitControldebugg
const controls = new OrbitControls(camera, renderer.domElement);

controls.enableDamping = true;
controls.dampingFactor = 0.05;

controls.target.set(config.debug.camera.tx, config.debug.camera.ty, config.debug.camera.tz)
controls.update();

//!SECTION
newWorld()

window.addEventListener("keypress", (e) => {
    if (e.key == "t") {
        newWorld()
    } else if (e.key == "c") {
        console.log("Camera Debug Settings")
        console.log(
            "x:", camera.position.x, "\ny:", camera.position.y, "\nz:", camera.position.z,
            "\ntx:", controls.target.x, "\nty:", controls.target.y, "\ntz:", controls.target.z
        )
    }
})

//fun newWorld()
function newWorld() {
    console.log("\n")

    scene.clear()
    scene.add(physicsDebug.mesh)

    world?.free()
    clearSyncList()
    world = createWorld()

    const seed = config.debug.lock_seed ? config.debug.debug_seed : Date.now()
    console.log("Seed:", seed)
    
    const trackContext: TrackContext = genTerrain(seed, scene, world)
    console.log(trackContext.finishlinePoint)

    const finishlinePose = trackContext.centerlinePoints[trackContext.finishlinePoint]!

    const sun = new THREE.DirectionalLight(0xffffff, 3)
    sun.position.set(100, 150, 50)
    scene.add(sun)

    //const geometry = new THREE.BoxGeometry(1.85, 1.64, 4.7)
    const geometry = new THREE.SphereGeometry()
    const material = new THREE.MeshStandardMaterial({
        color: 0xa17fff
    })

    const cube = new THREE.Mesh(geometry, material)
    cube.position.set(finishlinePose.x, finishlinePose.y + 1.64, finishlinePose.z)

    const tangent = getTangent(trackContext)

    debugDrawVect(tangent, new THREE.Vector3(finishlinePose.x, finishlinePose.y + 1.64, finishlinePose.z))

    console.log(tangent)

    cube.lookAt(cube.position.clone().add(tangent))
    scene.add(cube)

    // Create a matching Cannon physics body
    createDynamicConvex(cube, world, 20)
    

    //fun getTangent()
    function getTangent(trackContext: TrackContext): THREE.Vector3 {
        const l = trackContext.centerlinePoints.length
        const next = trackContext.centerlinePoints[(trackContext.finishlinePoint + 1) % l]!;
        const prev = trackContext.centerlinePoints[(trackContext.finishlinePoint - 1 + l) % l]!;


        const tangent = next.clone().sub(prev).normalize();
        return tangent
    }
}


//NOTE - gameLoop() Funciton
let lastFrameTime = 0, accumulator = 0, targetFps = config.game.default_fps
function gameLoop(currentFrame: number): void {
    requestAnimationFrame(gameLoop)

    if (lastFrameTime == 0) {
        lastFrameTime = currentFrame
        return
    }

    const deltaTime = currentFrame - lastFrameTime
    const interval = 1000 / targetFps

    if (deltaTime < interval) return

    lastFrameTime = currentFrame - (deltaTime % interval)
    accumulator += Math.min(deltaTime / 1000, 0.1)

    stats.begin()

    while (accumulator >= 1 / config.game.physics_fps) {
        world.step()
        if (config.debug.show_cannon_debugger) physicsDebug.update(world)
        accumulator -= 1 / config.game.physics_fps
    }

    updatePhysics()

    controls.update();
    renderer.render(scene, camera)
    //labelRenderer.render(scene, camera);

    stats.end()
}

requestAnimationFrame(gameLoop)

//debugFun - debugDrawVect()
function debugDrawVect(v: THREE.Vector3, p: THREE.Vector3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([p, p.clone().add(v.clone().multiplyScalar(10))])
    const material = new THREE.LineBasicMaterial({color: 0x00ff00})

    const line = new THREE.Line(geometry, material)
    scene.add(line)
}