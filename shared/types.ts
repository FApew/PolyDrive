import * as THREE from "three"
import RAPIER from "@dimforge/rapier3d-compat"
import { carLobbyVisual } from "../public/scripts/carLobbyVisuals"

export type Vec3 = {x: number, y: number, z: number}
export type Range = {min: number, max: number}

//SECTION - TrackGeneration

export type Point = {pose: THREE.Vector3, mode: Mode}
export type Segment = {weight: number, mode: Mode}

export type Mode = "casual" | "rally" | "f1" | "touring" | "hillclimb" | "drift" | "karting"
export type ModeNodes = {points: number[], turns: number[], modes: Mode[]}

export type Pivot = {pivot: THREE.Vector3, idx: number, lr: "left" | "right"}

export type NearTurn = {
    l: THREE.Vector3[][],
    r: THREE.Vector3[][],
    pivots: Pivot[]
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
    segment_weight: number
    track_width: number
    max_anchor_per_segment: number
    multiple_anchors_chance: number
    middle_cross_chance: number
    middle_cross_distance: number
    min_anchor_distance: number
    max_anchor_distance: number
    min_curve_angle: number
    max_curve_angle: number
}

//!SECTION

//SECTION - Physiscs

export type SyncObj = {
    obj: THREE.Object3D,
    body: RAPIER.RigidBody
}

//!SECTION

//SECTION - CarModel & Visuals & Audio

export type CarModelName = "giulia" | "f40"

export type CarVisuals = {
    model: CarModelName,
    color: THREE.ColorRepresentation
}

export type CarModel = {
    wheel_size: number
    wheel_pos: Vec3

    headlights_pos: Vec3
    backlights_pos: Vec3
    
    default_color: THREE.ColorRepresentation

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
    transmission?: TransmissionMode
    maxGears?: number
    upshiftRPM?: number
    downshiftRPM?: number
    wheelRadius?: number
}

export type EngineTelemetry = {
    rpm: number
    manifoldPressure: number
    levelerGain: number
    starterEngaged: boolean
    gear: number
    speed: number
}

//!SECTION

//SECTION - Players & Lobby

export type Lobby = {
    code: string,
    leader: string,
    playerList: LobbyPlayer[],
    state: "lobby" | "running"
}

export type LobbyPlayer = {
    id: string | undefined
    username: string
    carVisuals: CarVisuals
    throttle: number
    steer: number
    lights: boolean
}

export type LobbyCarList = {
    own: carLobbyVisual | undefined,
    others: carLobbyVisual[]
}

export type PlayerChangeType = "color" | "model" | "username"

export type DefaultChange = {
    player: LobbyPlayer
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
    type: "slider"
    label: string
    range: Range
    step: number
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