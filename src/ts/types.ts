export interface GameConfig {
    game: {
        default_fps: number
        physics_fps: number
    }

    debug: {
        debug_seed: number
        show_segments: boolean
        show_points: boolean
        show_centerline: boolean
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
        centerline_samples: number

        min_segments: number
        max_segments: number
        max_segment_variation: number
        segment_border: number
        min_sector_length: number
        change_sector_chance: number

        border: number
        center: number
        
        max_tries: number

        casual: {
            segment_weight: number

            max_anchor_per_segment: number
            multiple_anchors_chance: number

            middle_cross_chance: number
            middle_cross_distance: number

            min_anchor_distance: number
            max_anchor_distance: number

            min_curve_angle: number
            max_curve_angle: number
        }

        f1: {
            segment_weight: number

            max_anchor_per_segment: number
            multiple_anchors_chance: number

            middle_cross_chance: number
            middle_cross_distance: number

            min_anchor_distance: number
            max_anchor_distance: number
            
            min_curve_angle: number
            max_curve_angle: number
        }

        rally: {
            segment_weight: number

            max_anchor_per_segment: number
            multiple_anchors_chance: number

            middle_cross_chance: number
            middle_cross_distance: number

            min_anchor_distance: number
            max_anchor_distance: number
            
            min_curve_angle: number
            max_curve_angle: number
        }

        touring: {
            segment_weight: number

            max_anchor_per_segment: number
            multiple_anchors_chance: number

            middle_cross_chance: number
            middle_cross_distance: number

            min_anchor_distance: number
            max_anchor_distance: number
            
            min_curve_angle: number
            max_curve_angle: number
        }

        hillclimb: {
            segment_weight: number

            max_anchor_per_segment: number
            multiple_anchors_chance: number

            middle_cross_chance: number
            middle_cross_distance: number

            min_anchor_distance: number
            max_anchor_distance: number
            
            min_curve_angle: number
            max_curve_angle: number
        }

        drift: {
            segment_weight: number

            max_anchor_per_segment: number
            multiple_anchors_chance: number

            middle_cross_chance: number
            middle_cross_distance: number

            min_anchor_distance: number
            max_anchor_distance: number
            
            min_curve_angle: number
            max_curve_angle: number
        }

        karting: {
            segment_weight: number

            max_anchor_per_segment: number
            multiple_anchors_chance: number

            middle_cross_chance: number
            middle_cross_distance: number

            min_anchor_distance: number
            max_anchor_distance: number
            
            min_curve_angle: number
            max_curve_angle: number
        }
    }
}

export type Mode = "casual" | "rally" | "f1" | "touring" | "hillclimb" | "drift" | "karting"
export type Segment = {weight: number, mode: Mode}