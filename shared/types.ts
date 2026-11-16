import * as THREE from "three"
import RAPIER from "@dimforge/rapier3d-compat"
import { carLobbyVisual } from "../public/scripts/carLobbyVisuals"

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

        models: {giulia: CarModel, f40: CarModel}

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
export type Range = {min: number, max: number} // numeric bounds

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

    cylinders: number // firing count
    rpm: Range // engine speed range

    sound: SoundConfig
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
    id: string | undefined,
    carVisuals: CarVisuals
    throttle: number,
    steer: number,
    lights: boolean
    shift: boolean
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

export type AudioKey = "idle" | "lowOff" | "lowOn" | "medOff" | "medOn" | "highOff" | "highOn" | "maxRPM"

export type Harmonic = {
    order: number //harmonic N
    master: number //Overall volume
    gainByRPM: {
        max: number //Upper RPM bound
        gain: number //Harmonic volume
    }[]
    wave: OscillatorType //Wave Type
}

export type Resonator = {
    frequency: number //Resonant frequency
    q: number //Resonance width
    gain: number //Resonance volume
}

export type SoundConfig = {
    samples: {
        volume: number //Sample volume
        pitch: Range
        saturation: {
            kind: "tube" | "hard" //Saturation style
            drive: number //Distortion strength
            mix: number //Parallel blend
            highpass: number
        }
    }

    synthesis: {
        harmonics: Harmonic[] //Engine tone layers
        sub_bass: {
            volume: number
            rumble_frequency: number
            rumble_volume: number
        }
        rasp: {
            volume: number 
            highpass: number
            cutoff: Range //Freq band
            min_rpm_normalized: number //Sart RPM
        }
    }

    layers: {
        rumble: {
            volume: number
            cutoff: number //Rumble freqs
        }
        intake: {
            volume: number
            cutoff: Range //Intake freqs
        }
        exhaust: {
            volume: number
            cutoff: Range //Exhaust freqs
            q: number //Exhaust resonance width
        }
    }
    
    effects: {
        resonators: Resonator[] //Exhaust resonators
        comb: {
            enabled: boolean
            delay_ms: number
            tracking_ms: number //RPM delay change
            mix: number //Comb effect volume
        }
        output: {
            reverb: {
                mix: number //Reverb volume
                seconds: number
            }
            low_shelf: {
                frequency: number
                gain: number //Bass boost volume
            }
        }
    }

    events: {
        tip_in: {
            threshold: number //Throttle change trigger
            gain: number //Sample gain spike
            drive: number //Saturation increase
            decay: number //Fade time
        }

        overrun: {
            min_rpm_normalized: number //Crackle start RPM
            density: number //Crackles per second
            volume: number //Crackle loudness
        }

        limiter: {
            min_rpm_normalized: number //Limiter start RPM
            rate_hz: number //Cut cycles per second
            depth: number //Cut volume depth
            pop_on_cut: boolean //Pop for each cut
            pop_volume: number
        }

        shift_bangs: {
            cut_ms: number //Shift cut duration
            depth: number //Shift cut depth
            pops: number //Shift pop count
            volume: number //Shift pop level
        }

        pops: {
            volume: number //Pop loudness
            frequency: number //Pop filter pitch
            duration: number
            min_rpm_normalized: number //Pop start RPM
            cooldown: number //Pop spacing
        }
    }
}

export type SampleVoice = {
    source: AudioBufferSourceNode
    gain: GainNode
}

export type HarmonicVoice = {
    node: OscillatorNode
    gain: GainNode
}

export type EngineAudioNodes = {
    mix: {
        engine: GainNode
        limiter: GainNode
        shiftCut: GainNode
        resonators: BiquadFilterNode[]
        comb: {delay: DelayNode, dry: GainNode, wet: GainNode}
        final: GainNode
    }
    samples: {
        voices: Partial<Record<AudioKey, SampleVoice>>
        mix: GainNode
        saturation: {filter: BiquadFilterNode, drive: GainNode, shaper: WaveShaperNode, gain: GainNode}
    }
    layers: {
        rumble: {filter: BiquadFilterNode, gain: GainNode}
        intake: {highpass: BiquadFilterNode, filter: BiquadFilterNode, gain: GainNode}
        exhaust: {filter: BiquadFilterNode, gain: GainNode}
        subBass: {oscillator: OscillatorNode, filter: BiquadFilterNode, saturator: WaveShaperNode, gain: GainNode}
        lowRumble: {oscillator: OscillatorNode, gain: GainNode}
        rasp: {
            oscillator: OscillatorNode
            highpass: BiquadFilterNode
            gain: GainNode
            noiseFilter: BiquadFilterNode
            noiseGain: GainNode
        }
    }
    output: {
        master: GainNode
        audioBus: THREE.PositionalAudio
        mix: GainNode
        reverb: ConvolverNode
        reverbGain: GainNode
        lowShelf: BiquadFilterNode
        compressor: DynamicsCompressorNode
        limiter: DynamicsCompressorNode
    }
}