import * as THREE from "three"
import * as CANNON from "cannon-es"
import Stats from "stats.js"
import CannonDebugger from "cannon-es-debugger"
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { updatePhysics } from "./physicsHandler"
import { genTerrain } from "./terrainGenerator"

//SECTION - Inizialization
//NOTE - Config Init
import YAML from "yaml"
import type { GameConfig } from "./types"
import configTxt from "../config/config.yaml?raw"
const config: GameConfig = YAML.parse(configTxt)

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
camera.position.set(274, 60, 128);
camera.lookAt(0, 0, 0)

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

//NOTE - CANNON World Init
const world = new CANNON.World()

world.gravity.set(0, -9.81, 0)
world.allowSleep = true

//NOTE - Resize Handling
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()

    renderer.setSize(window.innerWidth, window.innerHeight)
})

//NOTE - CannonDebugger Init
const cannonDebugger = CannonDebugger(scene, world)

//NOTE - OrbitControldebugg
const controls = new OrbitControls(camera, renderer.domElement);

controls.enableDamping = true;
controls.dampingFactor = 0.05;

controls.target.set(274, 22, 128)
controls.update();

//!SECTION

function update() {
    
    updatePhysics(world, scene)
}

const sun = new THREE.DirectionalLight(0xffffff, 3);

sun.position.set(100, 150, 50);
scene.add(sun);

let seed = config.debug.debug_seed
//Date.now()
console.log("Seed:", seed)

genTerrain(seed, scene, world)

window.addEventListener("keypress", (e) => {
    if (e.key == "t") {
        scene.clear()

        world.bodies.slice().forEach(body => world.removeBody(body))
        world.constraints.slice().forEach(constraint => world.removeConstraint(constraint))

        world.clearForces()

        let seed = config.debug.debug_seed //Date.now()
        console.log("\n")
        console.log("Seed:", seed)
        genTerrain(seed, scene, world)

        const sun = new THREE.DirectionalLight(0xffffff, 3);

        sun.position.set(100, 150, 50);
        scene.add(sun);
    }
})

const geometry = new THREE.BoxGeometry(1.85, 1.64, 4.7);
const material = new THREE.MeshStandardMaterial({
    color: 0xa17fff
});

const cube = new THREE.Mesh(geometry, material);
cube.position.set(0, 5, 0);
scene.add(cube);

// Create a matching Cannon physics body
const cubeBody = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(new CANNON.Vec3(1.85 / 2, 1.64 / 2, 4.7 / 2))
});

cubeBody.position.set(
    cube.position.x,
    cube.position.y,
    cube.position.z
);
world.addBody(cubeBody)

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
        
        world.step(1 / config.game.physics_fps)
        accumulator -= 1 / config.game.physics_fps
    }

    update()

    if (config.debug.show_cannon_debugger) cannonDebugger.update();
    controls.update();
    renderer.render(scene, camera)
    //labelRenderer.render(scene, camera);

    stats.end()
}

requestAnimationFrame(gameLoop)