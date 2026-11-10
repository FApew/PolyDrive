import * as THREE from "three"
import RAPIER from "@dimforge/rapier3d-compat"
import { carLobbyVisual } from "../public/scripts/carLobbyVisuals"

export type GameConfig = {
    game: {
        default_fps: number
        physics_fps: number
        codes_lenght: number
        username_lenght: number
    }

    debug: {
        show_cannon_debugger: boolean

        show_segments: boolean
        show_points: boolean
        show_floating_centerline: boolean
        show_centerline: boolean
        show_side_lines: boolean
        show_pivots: boolean
        show_turn_lines: boolean
        show_road_sections: 2 | 1 | 0

        camera : { x: number, y: number, z: number, tx: number, ty: number, tz: number }

        camera_follow: boolean

        debug_seed: number
        lock_seed: boolean
    }

    terrain: {
        min_size: number
        max_size: number
        mesh_main_density: number
        main_frequency: number
        main_amplitude: number
        background_frequency: number
        background_amplitude: number
        mountains_frequency: number
        mountains_amplitude: number
        mountains_chance: number
    }

    lobby: {
        orbit_constraints: {
            polar_angle: Range
            zoom: Range
        }
    }

    road: {
        elevation: number
        thickness: number
    }

    car: {
        camera_follow_smoothness: number

        models: {giulia: CarModel}

        tuning: { f1: CarTune }
    }

    track: {
        centerline_samples: number

        turn_size: number
        inner_turn_max_distance: number
        inner_turn_min_distance: number
        turn_smoothness: number

        min_segments: number
        max_segments: number
        max_segment_variation: number
        segment_border: number
        min_sector_length: number
        change_sector_chance: number

        border: number
        center: number

        max_tries: number

        casual: TrackTune
        f1: TrackTune
        rally: TrackTune
        touring: TrackTune
        hillclimb: TrackTune
        drift: TrackTune
        karting: TrackTune
    }
}

export type Vec3 = {x: number, y: number, z: number}
export type Range = {min: number, max: number}

export type Mode = "casual" | "rally" | "f1" | "touring" | "hillclimb" | "drift" | "karting"

export type Segment = {weight: number, mode: Mode}

export type Point = {pose: THREE.Vector3, mode: Mode}

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

export type CarModelName = "giulia"

export type CarVisuals = {
    model: CarModelName,
    color: THREE.ColorRepresentation
}

export type CarModel = {
    wheel_pos: Vec3
    elevation: number
}

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

export type SyncObj = {
    obj: THREE.Object3D,
    body: RAPIER.RigidBody
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

export type LobbyPlayer = {
    id: string,
    carVisuals: CarVisuals
    throttle: number,
    steer: number
}

export type Lobby = {
    code: string,
    leader: string,
    playerList: LobbyPlayer[],
    state: "lobby" | "running"
}

export type TopRightInfo = {
    username: string,
    code: string,
    carVisuals: CarVisuals
}

export type LobbyCarList = {
    own: carLobbyVisual | undefined,
    others: carLobbyVisual[]
}