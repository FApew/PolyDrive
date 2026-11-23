import type { Car } from "../../private/ts/physics"
import type { Range, CarModel, CarTune, TrackTune, Settings } from "../types"

export type GameConfig = {
    game: {
        default_fps: number
        physics_fps: number

        shadow_quality: number

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

        models: {giulia: CarModel, f40: CarModel, targa4s: CarModel}

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

    settings: Settings
}