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
}