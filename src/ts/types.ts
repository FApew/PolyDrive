import * as THREE from "three"

export interface GameConfig {
    game: {
        default_fps: number
        physics_fps: number
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

        casual: {
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

        f1: {
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

        rally: {
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

        touring: {
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

        hillclimb: {
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

        drift: {
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

        karting: {
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
    }
}

export type Mode = "casual" | "rally" | "f1" | "touring" | "hillclimb" | "drift" | "karting"

export type Segment = {weight: number, mode: Mode}

export type Point = {pose: THREE.Vector3, mode: Mode}

export type ModeNodes = {points: number[], modes: Mode[]}

export type Pivot = {pivot: THREE.Vector3, idx: number, lr: "left" | "right"}

export type nearTurn = {
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