import * as THREE from "three"
import { 
    RAPIER, 
    createWorld, 
    RapierDebugger, 
    updatePhysics,
    clearSyncList,
    Car
} from "./physics"

import Stats from "stats.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import type { TrackContext } from "./types"
import { genTerrain } from "./terrainGenerator"

//SECTION - Inizialization
import { config } from "./YAMLConfigs"
await RAPIER.init()

//note - THREE Scene Init
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x071431)

//note - THREE Camera Init
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    10000
)
camera.position.set(config.debug.camera.x, config.debug.camera.y, config.debug.camera.z)

let followCamera = config.debug.camera_follow

const cameraOffset = new THREE.Vector3(0, 4, -4)
const cameraLookOffset = new THREE.Vector3(0, 1, 5)
const cameraTarget = new THREE.Vector3()

//note - THREE Renderer Init
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

//note - GLTF Loader
const loader = new GLTFLoader()

//Car Models
const [carGLTF, wheelGLTF] = await Promise.all([
    loader.loadAsync("./src/assets/models/car.glb"),
    loader.loadAsync("./src/assets/models/tire.glb")
])

const carModel = carGLTF.scene
const wheelModel = wheelGLTF.scene

//note - THREE Stats
const stats = new Stats()
stats.showPanel(0)
document.body.appendChild(stats.dom)

//note - RAPIER World Init
let world: RAPIER.World
const physicsDebug = new RapierDebugger()

//note - Car Init
let car: Car


//note - Resize Handling
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()

    renderer.setSize(window.innerWidth, window.innerHeight)
})

//note - OrbitControldebugg
const controls = new OrbitControls(camera, renderer.domElement);

controls.enableDamping = true;
controls.dampingFactor = 0.05;

controls.target.set(config.debug.camera.tx, config.debug.camera.ty, config.debug.camera.tz)
controls.update();

//!SECTION
newWorld()

//note - Key controls handlers
const keys: Record<string, boolean> = {}

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true
})

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false
})

//debugFun - Debug keys
window.addEventListener("keypress", (e) => {
    if (e.key == "t") {
        newWorld()
    } else if (e.key == "c") {
        console.log("Camera Debug Settings")
        console.log(
            "x:", camera.position.x, "\ny:", camera.position.y, "\nz:", camera.position.z,
            "\ntx:", controls.target.x, "\nty:", controls.target.y, "\ntz:", controls.target.z
        )
    } else if (e.key.toLowerCase() === "n") {
        followCamera = !followCamera

        controls.enabled = !followCamera

        console.log("Camera mode:", followCamera ? "Follow" : "Orbit")
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

    const finishlinePose = trackContext.centerlinePoints[trackContext.finishlinePoint]!

    const sun = new THREE.DirectionalLight(0xffffff, 3)
    sun.position.set(100, 150, 50)
    scene.add(sun)

    const carRoot = new THREE.Group()

    const carVisual = carModel.clone(true)
    carVisual.position.y = -0.2
    carVisual.position.z = 0.2

    carRoot.add(carVisual)

    carRoot.position.set(
        finishlinePose.x,
        finishlinePose.y + 3,
        finishlinePose.z
    )

    const tangent = getTangent(trackContext)

    debugDrawVect(
        tangent,
        new THREE.Vector3(
            finishlinePose.x,
            finishlinePose.y + 1.64,
            finishlinePose.z
        )
    )

    carRoot.lookAt(
        carRoot.position.clone().add(tangent)
    )

    scene.add(carRoot)

    car = new Car(
        world,
        carRoot,
        config.car.f1,
        wheelModel
    )

    //fun getTangent()
    function getTangent(trackContext: TrackContext): THREE.Vector3 {
        const l = trackContext.centerlinePoints.length
        const next = trackContext.centerlinePoints[(trackContext.finishlinePoint + 1) % l]!;
        const prev = trackContext.centerlinePoints[(trackContext.finishlinePoint - 1 + l) % l]!;

        const tangent = next.clone().sub(prev).normalize();
        return tangent
    }
}

//FUNCTION - gameLoop()
let lastFrameTime = 0, accumulator = 0
function gameLoop(currentFrame: number): void {
    requestAnimationFrame(gameLoop)

    if (lastFrameTime == 0) {
        lastFrameTime = currentFrame
        return
    }

    const deltaTime = (currentFrame - lastFrameTime) / 1000
    lastFrameTime = currentFrame

    accumulator += Math.min(deltaTime, 0.1)

    stats.begin()

    let steps = 0
    while (accumulator >= 1 / config.game.physics_fps) {
        const throttle = keys["w"] ? 1 : 0
        const brake = keys["s"] ? 1 : 0

        const steer = (keys["a"] ? 1 : 0) - (keys["d"] ? 1 : 0)

        const handbrake = keys["space"] ? true : false

        car.drive(
            throttle,
            brake,
            steer,
            handbrake,
            1 / config.game.physics_fps
        )

        world.step()
        steps++

        if (config.debug.show_cannon_debugger) physicsDebug.update(world)
        accumulator -= 1 / config.game.physics_fps
    }

    updatePhysics(accumulator)
    car.updateWheelMeshes()

    if (followCamera) {
        updateFollowCamera(deltaTime)
    } else {
        controls.update()
    }

    renderer.render(scene, camera)
    //labelRenderer.render(scene, camera);

    stats.end()
}

requestAnimationFrame(gameLoop)

//fun updateFollowCamera()
function updateFollowCamera(dt: number) {
    if (!followCamera || !car) return

    const chassis = car.chassis

    const p = chassis.translation()
    const q = chassis.rotation()

    const position = new THREE.Vector3(p.x, p.y, p.z)
    const rotation = new THREE.Quaternion(q.x, q.y, q.z, q.w)

    const desiredPosition = cameraOffset.clone()
        .applyQuaternion(rotation)
        .add(position)

    const desiredLook = cameraLookOffset.clone()
        .applyQuaternion(rotation)
        .add(position)

    const smoothness = 1 - Math.exp(-config.car.camera_follow_smoothness * dt)

    camera.position.lerp(desiredPosition, smoothness)
    cameraTarget.lerp(desiredLook, smoothness)

    camera.lookAt(cameraTarget)
}

//debugFun - debugDrawVect()
function debugDrawVect(v: THREE.Vector3, p: THREE.Vector3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([p, p.clone().add(v.clone().multiplyScalar(10))])
    const material = new THREE.LineBasicMaterial({color: 0x00ff00})

    const line = new THREE.Line(geometry, material)
    scene.add(line)
}