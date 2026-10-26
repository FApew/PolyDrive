export interface GameConfig {
    game: {
        default_fps: number
        physics_fps: number
    }

    debug: {
        debug_seed: number
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

    track: {
        min_segments: number
        max_segments: number
        max_segment_variation: number
        segment_border: number
        border: number
        center: number
        middle_cross_chance: number
        middle_cross_distance: number
        min_curve_angle: number
        max_curve_angle: number
        max_anchor_distance: number
        max_tries: number
    }
}