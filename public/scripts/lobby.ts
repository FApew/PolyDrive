import * as THREE from "three"
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"
import Stats from "stats.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import { config } from "../../shared/YAMLConfigs"
import { CarLobby } from "./carLobbyVisuals"
import { modelList } from "./assetsLoader"
import { updateInfos } from "./UI"

import { 
    params, socket, updateUrl, keys,
    scene, cameraMain,
    audioMain
} from "./main"

import type { CarVisuals, LobbyPlayer, TopRightInfo, LobbyCarList, CarModelName, Volumes, PlayerChangeType, DefaultChange } from "../../shared/types"

//SECTION - Initialization

//NOTE - Global Vars
let inLobby = false

const cars: LobbyCarList = { own: undefined, others: [] }

const model = modelList[Math.floor(Math.random() * modelList.length)]
export const currentCarVisuals: CarVisuals = {
    model: model!, 
    color: config.car.models[model!].default_color
}

const currentPlayer: LobbyPlayer = {
    id: undefined,
    username: "",
    ready: false,
    carVisuals: currentCarVisuals,
    throttle: 0,
    steer: 0,
    lights: false
}

export const volumes: Volumes = {
    main: config.settings.main_volume.default,
    engine: 0
}

export const topRightInfo: TopRightInfo = {
    username: "",
    code: "",
    carVisuals: currentCarVisuals
}

//!SECTION

//SECTION - Audio Handlers

//fun - syncAudioVisibility()
function syncAudioVisibility(): void {
    const context = audioMain.listener?.context
    if (!context) return

    audioMain.visibilityPromise = audioMain.visibilityPromise.then(async () => {
        if (context.state === "closed") return

        if (document.hidden && context.state === "running") {
            await context.suspend()
        } else if (!document.hidden && context.state !== "running") {
            await context.resume()
        }
    }).catch((error: unknown) => {
        console.error("Could not update audio for tab visibility:", error)
    })
}

//fun - activateAudio()
function activateAudio(): void {
    audioMain.listener ??= new THREE.AudioListener()

    const listener = audioMain.listener
    const context = listener.context
    const resume = context.state === "running" ? Promise.resolve() : context.resume()

    if (cameraMain.object && listener.parent !== cameraMain.object) cameraMain.object.add(listener)

    if (audioMain.state || audioMain.initPromise) {
        void resume.catch(error => console.error("Could not resume audio:", error))
        return
    }

    audioMain.initPromise = resume.then(() => {
        audioMain.state = true
        if (cameraMain.object && listener.parent !== cameraMain.object) cameraMain.object.add(listener)

        cars.own?.initEngineAudio(listener)
        void cars.own?.startEngineAudio()
    }).catch((error: unknown) => {
        audioMain.initPromise = undefined
        console.error("Could not initialize audio:", error)
    })
}

document.addEventListener("visibilitychange", syncAudioVisibility)
window.addEventListener("focus", syncAudioVisibility)
window.addEventListener("pageshow", syncAudioVisibility)

window.addEventListener("pointerdown", activateAudio)
window.addEventListener("keydown", activateAudio)

//!SECTION

//FUNCTION - lobbyInit()
export async function lobbyInit(): Promise<void> {
    currentPlayer.id = socket.id

    //note - Scene Init
    scene.background = new THREE.Color(0x070707)

    //note - Camera Init
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        10000
    )
    cameraMain.object = camera
    camera.position.set(-1.8, 1.67, 3.39)

    if (audioMain.listener) camera.add(audioMain.listener)

    //note - Renderer Init
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    document.body.appendChild(renderer.domElement)

    //note - 2D Renderer Init
    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(window.innerWidth, window.innerHeight)
    labelRenderer.domElement.style.position = "absolute"
    labelRenderer.domElement.style.top = "0"
    labelRenderer.domElement.style.pointerEvents = "none"
    document.body.appendChild(labelRenderer.domElement)

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

    cameraMain.controls = controls

    cameraMain.controls.update()

    //note - Stats Init
    const stats = new Stats()
    stats.showPanel(0)
    document.body.appendChild(stats.dom)

    //note - Resize Handling
    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()

        renderer.setSize(window.innerWidth, window.innerHeight)
        labelRenderer.setSize(window.innerWidth, window.innerHeight)
    })    

    //note - Car Init
    spawnCars([currentPlayer])

    let lastThrottle = 0, lastSteer = 0, lastLights = false
    let pressed: Partial<Record<string, boolean>> = {}
    let pt = -1

    //fun - renderLoop()
    function renderLoop(): void {
        requestAnimationFrame(renderLoop)
        stats.begin()

        const ct = performance.now()
        let dt = pt < 0 ? 1 : Math.min(ct - pt, 100)

        let throttle = keys["w"] ? 1 : 0
        if (keys["e"]) throttle = 0
        cars.own!.throttle = throttle

        const steer = (keys["a"] ? 1 : 0) - (keys["d"] ? 1 : 0)
        cars.own!.steer = steer

        let lights = lastLights
        if (keys["l"] != pressed["l"] && keys["l"]) lights = !lastLights

        cars.own!.lights = lights
        cars.own!.updateLights()
        
        if ((lastThrottle != throttle || lastSteer != steer || lastLights != lights) && inLobby) {
            //socket_Out - requestHotUpdate
            socket.emit("requestHotUpdate", {throttle, steer, lights})
        }

        cars.own!.updateWheels(dt)
        cars.others.forEach((car) => {
            car.updateWheels(dt)
        })

        cars.own!.updateEngine(dt, volumes.main / 75)
        cars.others.forEach((car) => {
            car.updateEngine(dt, volumes.main * 0.2 / 75)
        })
    
        cameraMain.controls!.update()

        renderer.render(scene, camera)
        labelRenderer.render(scene, camera)
        pt = ct
        lastThrottle = throttle
        lastSteer = steer
        lastLights = lights

        pressed["l"] = keys["l"]
        pressed["e"] = keys["e"]
        stats.end()
    }
    requestAnimationFrame(renderLoop)
}
//!FUNCTION

//SECTION - Scene Handlers

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

//fun - spawnCars()
function spawnCars(playerList: LobbyPlayer[]): void
function spawnCars(target: LobbyPlayer): void

function spawnCars(value: LobbyPlayer[] | LobbyPlayer): void {
    if (!Array.isArray(value)) {
        let mesh, idx = -1

        if (cars.own!.id == value.id) {
            mesh = cars.own!.mesh
            cars.own!.dispose()
        } else {
            idx = cars.others.findIndex((car) => {return car.id == value.id})
            mesh = cars.others[idx]!.mesh
            cars.others[idx]!.dispose()
        }

        const Xpos = mesh.position.x
        scene.remove(mesh)

        createCarInstance(value, Xpos, idx)

    } else {
        scene.clear()
        sceneSetup(false)

        cars.own?.dispose()
        cars.others.forEach(car => {
            car.dispose()
        })

        cars.others = []
        value.forEach((player: LobbyPlayer, idx: number) => {
            const Xpos = idx * 3

            createCarInstance(player, Xpos)
            spawnSpotlight(Xpos, 0)
        })

        cameraMain.controls!.target.set((value.length - 1) * 3 / 2, 0, 0)    
        cameraMain.controls!.minDistance = config.lobby.orbit_constraints.zoom.min * Math.sqrt(value.length)
        cameraMain.controls!.maxDistance = cameraMain.controls!.minDistance + (config.lobby.orbit_constraints.zoom.max - config.lobby.orbit_constraints.zoom.min) * Math.cbrt(value.length)
    }

    //fun - createCarInstance()
    function createCarInstance(player: LobbyPlayer, Xpos: number, idx?: number): void {
        const newCar = new CarLobby(player.id!, player.carVisuals.model)
        if (player.id == socket.id && audioMain.state && audioMain.listener) {
            newCar.initEngineAudio(audioMain.listener)
        }
        const z = (Math.random() - 0.5) * 0.2
        newCar.mesh.position.x = Xpos
        newCar.mesh.position.z = z

        changeColor(player.carVisuals.color, newCar)
        newCar.usernameLabel.innerHTML = player.username.length > 0 ? player.username : "._."
        newCar.usernameLabel.classList.toggle("ready", player.ready)

        if (player.id == socket.id || idx == -1) { cars.own = newCar }
        else {
            if (typeof idx == "number") { cars.others[idx] = newCar }
            else { cars.others.push(newCar) }
        }

        if (player.id == socket.id) void newCar.startEngineAudio()

        scene.add(newCar.mesh)
    }
}

//socket_In - lobbyRefresh
socket.on("lobbyRefresh", (playerList) => {spawnCars(playerList)})

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
    spotlight.target.position.set(x, 0, z)
    scene.add(spotlight)
    scene.add(spotlight.target)
}

//!SECTION

//SECTION - Lobby Handlers

//fun - createLobby()
export async function createLobby(): Promise<void> {
    //socket_IO - createLobby
    const res = await socket.emitWithAck("createLobby")

    joinLobby(res.code)
}

//fun isLobbyJoinable()
export async function isLobbyJoinable(code: string, codeCheck: boolean = true): Promise<boolean> {
    if (!isLobbyCode(code)) return false
    if (!await socket.emitWithAck("checkCode", code) && codeCheck) return false
    if (!await socket.emitWithAck("checkLobbySize", code)) return false

    return true
}

//fun - joinLobby()
export async function joinLobby(code: string, codeCheck: boolean = true): Promise<boolean> {
    if (!await isLobbyJoinable(code, codeCheck)) return false

    //socket_IO - joinLobby
    socket.emit("joinLobby", {code: code, user: currentPlayer.username, carVisuals: currentCarVisuals, lights: cars.own!.lights})

    topRightInfo.code = code
    inLobby = true
    params.set("code", code)

    updateInfos()
    updateUrl()
    updateUI()

    //fun - joinedLobby()
    function updateUI(): void {
        inLobby = true

        const joinButton = document.getElementById("join") as HTMLDivElement
        joinButton!.id = "ready"
        joinButton!.innerHTML = "ready"

        const createButton = document.getElementById("create") as HTMLDivElement
        createButton!.id = "leave"
        createButton!.innerHTML = "leave lobby"
    }

    return true
}

//fun - leaveLobby()
export function leaveLobby(): void {
    params.delete("code")
    updateUrl()
    location.reload()
}

//fun - isLobbyCode()
export function isLobbyCode(value: string): boolean {
    return /^[A-Z0-9]{5}$/.test(value)
}

//!SECTION

//SECTION - Changes Handlers

//fun - changeUser()
export function changeUsername(username: string): void {
    currentPlayer.username = username
    cars.own!.usernameLabel.innerHTML = username.length > 0 ? username : "._."

    sendChanges("username")
}

//fun - changeReadyState()
export function changeReadyState(state: boolean): void {
    currentPlayer.ready = state
    cars.own!.usernameLabel.classList.toggle("ready", state)

    sendChanges("ready")
}

///fun changeModel()
export function changeModel(model: CarModelName): void {
    currentPlayer.carVisuals.model = model
    //currentPlayer.carVisuals.color = config.car.models[model].default_color
    updateInfos()

    if (!inLobby) spawnCars(currentPlayer)
    changeColor(config.car.models[model].default_color)

    sendChanges("model")
}

//fun - changeColor()
export function changeColor(color: THREE.ColorRepresentation, target: CarLobby = cars.own!): void {
    target.setColor(color)
    if (target.id == socket.id) {
        currentPlayer.carVisuals.color = color
        updateInfos()

        sendChanges("color")
    }
}

//fun - changeVolume()
export function changeVolume(key: keyof Volumes, volume: number): void {
    volumes[key] = volume
}

//fun - sendChanges()
function sendChanges(changeType: PlayerChangeType): void {
    if (!inLobby) return

    const change: DefaultChange = {
        player: currentPlayer,
        changeType
    }

    socket.emit("requestDefaultChange", change)
}

//socket_In - incomingDefaultChange
socket.on("incomingDefaultChange", ({player, changeType}: DefaultChange) => {
    switch (changeType) {
        case "username": {
            if (player.id == socket.id) return

            const idx = cars.others.findIndex((obj) => {return obj.id == player.id})
            cars.others[idx]!.usernameLabel.innerHTML = player.username.length > 0 ? player.username : "._."

            break
        }
        case "ready": {
            if (player.id == socket.id) return

            const idx = cars.others.findIndex((obj) => {return obj.id == player.id})
            cars.others[idx]!.usernameLabel.classList.toggle("ready", player.ready)

            break
        }
        case "model": {
            spawnCars(player)

            break
        }
        case "color": {
            if (player.id == socket.id) return
            const idx = cars.others.findIndex((obj) => {return obj.id == player.id})

            cars.others[idx]?.setColor(player.carVisuals.color)

            break
        }
    }
})

//socket_In - incomingHotUpdate
socket.on("incomingHotUpdate", (player: LobbyPlayer) => {
    if (player.id == socket.id) return

    const idx = cars.others.findIndex((obj) => {return obj.id == player.id})
    const car = cars.others[idx]!

    car.throttle = player.throttle
    car.steer = player.steer
    car.lights = player.lights

    car.updateLights()
})

//!SECTION

//SECTION - StartingTimer`
const topText = document.getElementById("topText") as HTMLDivElement

//socket_In - initStartTimer
socket.on("initStartTimer", () => {
    topText.classList.add("selected")
    topText.innerHTML = `Starting in ${config.game.starting_timer}s`
})

//socket_In - startTimerUpdate
socket.on("startTimerUpdate", (sec: number) => {
    topText.innerHTML = `Starting in ${sec}s`
})

//socket_In - abortStartTimer
socket.on("abortStartTimer", () => {
    topText.classList.remove("selected")
})

socket.on("startTimerFinish", () => {
    topText.innerHTML = "Buon Anno"
})

//!SECTION