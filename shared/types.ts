import * as THREE from "three"
import RAPIER from "@dimforge/rapier3d-compat"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { CarLobby } from "../public/scripts/carLobbyVisuals"

export type Range = {min: number, max: number}

//SECTION - TrackGeneration

export type Point = {pose: THREE.Vector3, mode: Mode}
export type PolarPoint = {r: number, theta: number, idx: number, mode: Mode}
export type Segment = {weight: number, mode: Mode}

export type Mode = "casual" | "rally" | "f1" | "touring" | "hillclimb" | "drift" | "karting"
export type ModeNodes = {points: number[], turns: number[], modes: Mode[]}

export type Centerline = {
    points: Point[],
    poses: THREE.Vector3[],
    modeNodes: ModeNodes
}

export type Pivot = {pivot: THREE.Vector3, idx: number, lr: "left" | "right"}

export type NearTurn = {
    l: THREE.Vector3[][],
    r: THREE.Vector3[][],
    pivots: Pivot[],
    idx: number,
    inTurn: boolean
}

export type SideLines = {
    left: THREE.Vector3[],
    right: THREE.Vector3[]
}

export type TrackContext = {
    centerlineCurve: THREE.CatmullRomCurve3,
    centerlinePoints: THREE.Vector3[],
    finishlinePoint: number
}

export type TrackTune = {
    segment_weight: number,
    track_width: number,
    max_anchor_per_segment: number,
    multiple_anchors_chance: number,
    middle_cross_chance: number,
    middle_cross_distance: number,
    anchor_distance: Range,
    curve_angle: Range
}

//!SECTION

//SECTION - Physiscs & World Generation

export type SyncObj = {
    obj: THREE.Object3D,
    body: RAPIER.RigidBody
}

export type TerrainData = undefined/*{
    heightmap: Float32Array
}*/

export type TrackData = {
    poses: THREE.Vector3[]
    modeNodes: ModeNodes
}

export type WorldObjectModelName = "rock"

export type WorldObject = {
    id: number,
    model: WorldObjectModelName,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    scale: THREE.Vector3
}

export type WorldManifest = {
    id: string,
    seed: number,

    terrain: TerrainData,
    track: TrackData,
    objects: WorldObject[]
}

//!SECTION

//SECTION - CarModel & Visuals & Audio

export type CameraMain = {
    object: THREE.PerspectiveCamera | undefined,
    controls: OrbitControls | undefined
}

export type AudioMain = {
    listener: THREE.AudioListener | undefined,
    state: boolean,
    volumes: Volumes,
    initPromise: Promise<void> | undefined,
    visibilityPromise: Promise<void>
}

export type CarModelName = "giulia" | "f40" | "targa4s"

export type CarVisuals = {
    model: CarModelName,
    color: THREE.ColorRepresentation
}

export type CarModel = {
    wheel_size: number,
    wheel_pos: THREE.Vector3,

    headlights_pos: THREE.Vector3,
    backlights_pos: THREE.Vector3,
    
    default_color: THREE.ColorRepresentation,

    elevation: number
}

export type CarTune = {
    frictionSlip: number,
    sideFrictionStiffness: number,
    suspensionStiffness: number,
    suspensionCompression: number,
    suspensionRelaxation: number,
    maxSuspensionTravel: number,
    engineForce: number
}

export type TransmissionMode = "manual" | "automatic"

export type EngineAudioOptions = {
    transmission?: TransmissionMode,
    maxGears?: number,
    upshiftRPM?: number,
    downshiftRPM?: number,
    wheelRadius?: number
}

export type EngineTelemetry = {
    rpm: number,
    manifoldPressure: number,
    levelerGain: number,
    starterEngaged: boolean,
    gear: number,
    speed: number
}

//!SECTION

//SECTION - Players & Rooms & Lobby

export type RoomState = "lobby" | "starting" | "running"

export type Room = {
    code: string,
    leader: string,
    playerList: LobbyPlayer[],
    state: RoomState,
    manifest: WorldManifest | null
}

export type LobbyPlayer = {
    id: string | undefined,
    username: string,
    ready: boolean,
    carVisuals: CarVisuals,
    throttle: number,
    steer: number,
    lights: boolean
}

export type LobbyCarList = {
    own: CarLobby | undefined,
    others: CarLobby[]
}

export type PlayerChangeType = "color" | "model" | "username" | "ready"

export type DefaultChange = {
    player: LobbyPlayer,
    changeType: PlayerChangeType
}

//!SECTION

//SECTION - UIs

export type TopRightInfo = {
    username: string,
    code: string,
    carVisuals: CarVisuals
}

export type SettingSlider = {
    type: "slider",
    label: string,
    range: Range,
    step: number,
    default: number
}

export type SettingsIDs = "main_volume"

export type Settings = {
    main_volume: SettingSlider
}

export type Volumes = {
    main: number,
    engine: number
}

//!SECTION