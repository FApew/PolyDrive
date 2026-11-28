import * as THREE from "three"
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"
import Stats from "stats.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import { scene, cameraMain, audioMain } from "./runtime"

import { config } from "../../shared/YAMLConfigs"

//NOTE - Global Vars
let animationFrameId: number | null = null
let gameRenderer: THREE.WebGLRenderer | undefined
let gameLabelRenderer: CSS2DRenderer | undefined
let gameStats: Stats | undefined
let gameResizeHandler: (() => void) | undefined

//FUNCTION - gameSceneInit()
export async function gameSceneInit(): Promise<void> {
    scene.background = new THREE.Color(0x071431)

    //note - Camera Init
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        10000
    )
    camera.position.set(config.debug.camera.x, config.debug.camera.y, config.debug.camera.z)
    cameraMain.object = camera

    //note - Renderer Init
    gameRenderer = new THREE.WebGLRenderer({ antialias: true })
    gameRenderer.setSize(window.innerWidth, window.innerHeight)
    gameRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    gameRenderer.shadowMap.enabled = true
    gameRenderer.shadowMap.type = THREE.PCFShadowMap
    document.body.appendChild(gameRenderer.domElement)

    //note - 2D Renderer Init
    gameLabelRenderer = new CSS2DRenderer()
    gameLabelRenderer.setSize(window.innerWidth, window.innerHeight)
    gameLabelRenderer.domElement.style.position = "absolute"
    gameLabelRenderer.domElement.style.top = "0"
    gameLabelRenderer.domElement.style.pointerEvents = "none"
    document.body.appendChild(gameLabelRenderer.domElement)

    //note - Resize Handling
    gameResizeHandler = (): void => {
        cameraMain.object!.aspect = window.innerWidth / window.innerHeight
        cameraMain.object!.updateProjectionMatrix()

        gameRenderer?.setSize(window.innerWidth, window.innerHeight)
        gameLabelRenderer?.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener("resize", gameResizeHandler)

    //note - Stats Init
    gameStats = new Stats()
    gameStats.showPanel(0)
    document.body.appendChild(gameStats.dom)

    //note - Orbit Controls
    const controls = new OrbitControls(cameraMain.object, gameRenderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.target.set(config.debug.camera.tx, config.debug.camera.ty, config.debug.camera.tz)
    controls.update()
    cameraMain.controls = controls

    let lastFrame = 0, accumulator = 0

    //fun - gameLoop()
    function gameLoop(currentFrame: number): void {
        animationFrameId = requestAnimationFrame(gameLoop)
        
        if (lastFrame == 0) { lastFrame = currentFrame; return }

        const dt = (currentFrame - lastFrame) / 1000
        lastFrame = currentFrame

        accumulator += dt

        gameStats?.begin()

        while (accumulator >= 1 / config.game.physics_fps) {
            accumulator -= 1 / config.game.physics_fps
        }

        controls.update()
        gameRenderer?.render(scene, cameraMain.object!)
        gameLabelRenderer?.render(scene, cameraMain.object!)
        gameStats?.end()
    }
    animationFrameId = requestAnimationFrame(gameLoop)
}
//!FUNCTION