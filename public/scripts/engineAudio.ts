import * as THREE from "three"
import { SoundTouchNode } from "@soundtouchjs/audio-worklet"

import type { AudioKey, CarModelName } from "../../shared/types"
import { audios } from "./assetsLoader"

import { config } from "../../shared/YAMLConfigs"

export class EngineAudio {
    private currentRPM = 0
    private currentThrottle = 0

    private engineAudios: Partial<Record<AudioKey, THREE.PositionalAudio>> = {}
    private enginePitchNodes: Partial<Record<AudioKey, SoundTouchNode>> = {}

    private engineBus: GainNode | null = null

    private rumbleOscillators: OscillatorNode[] = []
    private rumbleGains: GainNode[] = []
    private rumbleFilter: BiquadFilterNode | null = null
    private rumbleMaster: GainNode | null = null

    private midToneOscillators: OscillatorNode[] = []
    private midToneGains: GainNode[] = []
    private midToneMaster: GainNode | null = null

    private highToneOscillators: OscillatorNode[] = []
    private highToneGains: GainNode[] = []
    private highToneMaster: GainNode | null = null

    private engineOsc: OscillatorNode | null = null
    private engineFilter: BiquadFilterNode | null = null
    private engineToneGain: GainNode | null = null

    constructor(listener: THREE.AudioListener, parent: THREE.Object3D) {
        const context = listener.context
        
        // Positional audio bus
        const engineBus = context.createGain()
        engineBus.gain.value = 0.8
        this.engineBus = engineBus

        const busAudio = new THREE.PositionalAudio(listener)
        busAudio.setNodeSource(engineBus as unknown as AudioScheduledSourceNode)
        busAudio.setRefDistance(5)
        busAudio.setRolloffFactor(1)

        parent.add(busAudio)

        // Sample layers
        for (const key of Object.keys(audios) as AudioKey[]) {
            const audio = new THREE.PositionalAudio(listener)

            audio.setBuffer(audios[key])
            audio.setLoop(true)
            audio.setVolume(0)
            audio.setRefDistance(5)
            audio.setRolloffFactor(1)

            const pitchNode = new SoundTouchNode({ context })

            pitchNode.playbackRate.value = 1
            audio.setFilter(pitchNode)

            this.engineAudios[key] = audio
            this.enginePitchNodes[key] = pitchNode

            parent.add(audio)
            audio.play()
        }

        // Helper for procedural oscillator layers
        const createOscillatorLayer = (
            type: OscillatorType,
            harmonics: { multiplier: number; volume: number; detune?: number }[],
            master: GainNode
        ): void => {
            for (const harmonic of harmonics) {
                const oscillator = context.createOscillator()
                const gain = context.createGain()

                oscillator.type = type
                oscillator.frequency.value = 40 * harmonic.multiplier
                oscillator.detune.value = harmonic.detune ?? 0

                gain.gain.value = harmonic.volume

                oscillator.connect(gain)
                gain.connect(master)
                oscillator.start()

                if (master === this.rumbleMaster) {
                    this.rumbleOscillators.push(oscillator)
                    this.rumbleGains.push(gain)
                } else if (master === this.midToneMaster) {
                    this.midToneOscillators.push(oscillator)
                    this.midToneGains.push(gain)
                } else if (master === this.highToneMaster) {
                    this.highToneOscillators.push(oscillator)
                    this.highToneGains.push(gain)
                }
            }
        }

        // Low engine rumble
        this.rumbleMaster = context.createGain()
        this.rumbleMaster.gain.value = 0

        this.rumbleFilter = context.createBiquadFilter()
        this.rumbleFilter.type = "lowpass"
        this.rumbleFilter.frequency.value = 350
        this.rumbleFilter.Q.value = 0.8

        this.rumbleMaster.connect(this.rumbleFilter)
        this.rumbleFilter.connect(engineBus)

        createOscillatorLayer("sawtooth", [
            { multiplier: 1, volume: 0.45 },
            { multiplier: 2, volume: 0.25 },
            { multiplier: 3, volume: 0.12 },
            { multiplier: 4, volume: 0.06 }
        ], this.rumbleMaster)

        // Midrange engine tone
        this.midToneMaster = context.createGain()
        this.midToneMaster.gain.value = 0
        this.midToneMaster.connect(engineBus)

        createOscillatorLayer("triangle", [
            { multiplier: 1, volume: 0.55 },
            { multiplier: 2, volume: 0.25, detune: -4 },
            { multiplier: 3, volume: 0.12, detune: 5 },
            { multiplier: 4, volume: 0.06, detune: -8 }
        ], this.midToneMaster)

        // High-revving engine tone
        this.highToneMaster = context.createGain()
        this.highToneMaster.gain.value = 0
        this.highToneMaster.connect(engineBus)

        createOscillatorLayer("sine", [
            { multiplier: 1, volume: 0.65 },
            { multiplier: 2, volume: 0.35, detune: 3 },
            { multiplier: 3, volume: 0.22, detune: -4 },
            { multiplier: 4, volume: 0.12, detune: 6 },
            { multiplier: 5, volume: 0.07, detune: -7 }
        ], this.highToneMaster)

        // Filtered sawtooth engine body
        this.engineOsc = context.createOscillator()
        this.engineOsc.type = "sawtooth"
        this.engineOsc.frequency.value = 45

        this.engineFilter = context.createBiquadFilter()
        this.engineFilter.type = "lowpass"
        this.engineFilter.frequency.value = 350
        this.engineFilter.Q.value = 1.2

        this.engineToneGain = context.createGain()
        this.engineToneGain.gain.value = 0

        this.engineOsc.connect(this.engineFilter)
        this.engineFilter.connect(this.engineToneGain)
        this.engineToneGain.connect(engineBus)

        this.engineOsc.start()
    }

    update(dt: number, throttle: number, model: CarModelName, engineRPM?: number): void {
        if (!this.engineAudios.idle) return

        const now = this.enginePitchNodes.idle!.context.currentTime
        const delta = dt / 1000

        // Smooth inputs
        const targetThrottle = THREE.MathUtils.clamp(throttle, 0, 1)
        const targetRPM = THREE.MathUtils.clamp(engineRPM ?? targetThrottle, 0, 1)

        this.currentRPM = THREE.MathUtils.damp(
            this.currentRPM,
            targetRPM,
            targetRPM > this.currentRPM ? 2 : 4,
            delta
        )

        this.currentThrottle = THREE.MathUtils.damp(
            this.currentThrottle,
            targetThrottle,
            2.5,
            delta
        )

        // Slight engine RPM variation
        const wobble = (
            Math.sin(now * 7.3) +
            Math.sin(now * 12.9 + 1.7) +
            Math.sin(now * 3.1 + 4.2)
        ) / 3

        const rpm = THREE.MathUtils.clamp(
            this.currentRPM + wobble * 0.008 * (1 - this.currentRPM * 0.6),
            0,
            1
        )

        // Low engine rumble
        if (this.rumbleMaster && this.rumbleFilter) {
            const frequency = THREE.MathUtils.lerp(
                config.car.models[model].sound.rumble_freq.min, 
                config.car.models[model].sound.rumble_freq.max, 
                rpm
            )

            this.rumbleOscillators.forEach((oscillator, i) => {
                oscillator.frequency.setTargetAtTime(
                    frequency * (i + 1),
                    now,
                    0.12
                )
            })

            // Dynamically open the low-pass filter
            this.rumbleFilter.frequency.setTargetAtTime(
                frequency,
                now,
                0.15
            )

            // Strong bass, especially under acceleration
            const rumbleVolume =
                config.car.models[model].sound.rumble_volume +
                Math.pow(rpm, 1.4) * 0.30 +
                throttle * 0.20

            this.rumbleMaster.gain.setTargetAtTime(
                rumbleVolume,
                now,
                0.15
            )
        }

        // Midrange engine tone
        if (this.midToneMaster) {
            const frequency = THREE.MathUtils.lerp(
                config.car.models[model].sound.midtone_freq.min,
                config.car.models[model].sound.midtone_freq.max, 
                rpm
            )

            this.midToneOscillators.forEach((oscillator, i) => {
                oscillator.frequency.setTargetAtTime(
                    frequency * (i + 1),
                    now,
                    0.12
                )
            })

            const midFade = 1 - THREE.MathUtils.smoothstep(rpm, 0.90, 0.97)

            const midVolume =
                (config.car.models[model].sound.midtone_volume + rpm * 0.1) *
                (0.35 + throttle * 0.15) *
                midFade

            this.midToneMaster.gain.setTargetAtTime(
                midVolume,
                now,
                0.12
            )
        }

        // High-revving engine tone
        if (this.highToneMaster) {
            const highRPM = THREE.MathUtils.smoothstep(rpm, config.car.models[model].sound.hightone_rpms, 0.95)

            const frequency = THREE.MathUtils.lerp(
                config.car.models[model].sound.hightone_freq.min,
                config.car.models[model].sound.hightone_freq.max,
                Math.pow(rpm, 1.65)
            )

            this.highToneOscillators.forEach((oscillator, i) => {
                oscillator.frequency.setTargetAtTime(
                    frequency * (i + 1),
                    now,
                    0.07
                )
            })

            const highVolume =
                Math.pow(highRPM, 1.6) *
                (config.car.models[model].sound.hightone_volume + throttle * 0.18) * 0.3

            this.highToneMaster.gain.setTargetAtTime(
                highVolume,
                now,
                0.08
            )
        }

        // Main filtered engine body
        if (this.engineOsc && this.engineFilter && this.engineToneGain) {
            this.engineOsc.frequency.setTargetAtTime(
                THREE.MathUtils.lerp(
                    config.car.models[model].sound.body_freq.min, 
                    config.car.models[model].sound.body_freq.max, 
                    rpm
                ),
                now,
                0.08
            )

            this.engineFilter.Q.setTargetAtTime(
                THREE.MathUtils.lerp(1.2, 2.5, rpm),
                now,
                0.1
            )

            const engineVolume =
                config.car.models[model].sound.body_volume +
                Math.pow(rpm, 1.5) * 0.12 +
                throttle * 0.06

             this.engineToneGain.gain.setTargetAtTime(
                engineVolume,
                now,
                0.1
            )
        }

        // Sample blending
        const throttleCurve = Math.pow(throttle, 2.5)

        const thresholds = [0, 0.15, 0.35, 0.85, 1]
        const spread = 0.18

        const weights = thresholds.map((threshold, i) => {
            if (i === 4 && rpm < 0.97) return 0

            const distance = (rpm - threshold) / spread
            return Math.exp(-0.5 * distance * distance)
        })

        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

        for (let i = 0; i < weights.length; i++) {
            weights[i] = Math.sqrt(weights[i]! / totalWeight)
        }

        const [idle, low, med, high, maxRPM] = weights

        const on = throttleCurve
        const off = 1 - throttleCurve

        // Sample pitch
        const pitchCurve = Math.log1p(9 * rpm) / Math.log1p(9)

        const basePitch = THREE.MathUtils.lerp(
            config.car.models[model].sound.pitch.min,
            config.car.models[model].sound.pitch.max,
            pitchCurve
        )

        const pitchOffsets: Record<AudioKey, number> = {
            idle: 0,
            lowOff: -0.025,
            lowOn: 0.015,
            medOff: -0.015,
            medOn: 0.025,
            highOff: -0.01,
            highOn: 0.035,
            maxRPM: 0.02
        }

        for (const key of Object.keys(this.enginePitchNodes) as AudioKey[]) {
            const node = this.enginePitchNodes[key]
            if (!node) continue

            node.pitch.setTargetAtTime(
                basePitch + pitchOffsets[key],
                now,
                0.15
            )

            node.playbackRate.setTargetAtTime(1, now, 0.15)
        }

        // Sample master volume
        const volume = config.car.models[model].sound.main_volume + Math.pow(rpm, 1.8) * 0.20

        const setVolume = (key: AudioKey, value: number): void => {
            const audio = this.engineAudios[key]
            if (!audio) return

            audio.gain.gain.setTargetAtTime(value, now, 0.08)
        }

        setVolume("idle", idle! * volume)

        setVolume("lowOff", low! * off * volume)
        setVolume("lowOn", low! * on * volume)

        setVolume("medOff", med! * off * volume)
        setVolume("medOn", med! * on * volume)

        setVolume("highOff", high! * off * volume)
        setVolume("highOn", high! * on * volume)

        setVolume("maxRPM", maxRPM! * volume)
    }

    dispose(parent: THREE.Object3D): void {
        // Stop procedural oscillators
        this.engineOsc?.stop()

        this.rumbleOscillators.forEach(o => o.stop())
        this.midToneOscillators.forEach(o => o.stop())
        this.highToneOscillators.forEach(o => o.stop())

        // Disconnect procedural nodes
        this.rumbleOscillators.forEach(o => o.disconnect())
        this.rumbleGains.forEach(g => g.disconnect())
        this.rumbleFilter?.disconnect()
        this.rumbleMaster?.disconnect()

        this.midToneOscillators.forEach(o => o.disconnect())
        this.midToneGains.forEach(g => g.disconnect())
        this.midToneMaster?.disconnect()

        this.highToneOscillators.forEach(o => o.disconnect())
        this.highToneGains.forEach(g => g.disconnect())
        this.highToneMaster?.disconnect()

        this.engineOsc?.disconnect()
        this.engineFilter?.disconnect()
        this.engineToneGain?.disconnect()

        this.engineBus?.disconnect()

        // Stop sample layers
        for (const key of Object.keys(this.engineAudios) as AudioKey[]) {
            this.engineAudios[key]?.stop()
            this.enginePitchNodes[key]?.disconnect()
        }

        // Clear references
        this.rumbleOscillators = []
        this.rumbleGains = []
        this.rumbleFilter = null
        this.rumbleMaster = null

        this.midToneOscillators = []
        this.midToneGains = []
        this.midToneMaster = null

        this.highToneOscillators = []
        this.highToneGains = []
        this.highToneMaster = null

        this.engineOsc = null
        this.engineFilter = null
        this.engineToneGain = null

        this.engineBus = null

        this.engineAudios = {}
        this.enginePitchNodes = {}

        parent.removeFromParent()
    }
}