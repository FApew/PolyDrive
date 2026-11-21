import * as THREE from "three"

import type { AudioKey, CarModelName, CarModel, Harmonic, SoundConfig, HarmonicVoice, EngineAudioNodes } from "../../shared/types"
import { audios } from "./assetsLoader"

import { config } from "../../shared/YAMLConfigs"

//NOTE - CONSTS
const SAMPLE_BLEND_THRESHOLDS: readonly number[] = [0, 0.15, 0.35, 0.85, 1]
const SAMPLE_PITCH_OFFSETS: Record<AudioKey, number> = {
    idle: 0,
    lowOff: -0.025,
    lowOn: 0.015,
    medOff: -0.015,
    medOn: 0.025,
    highOff: -0.01,
    highOn: 0.035,
    maxRPM: 0.02
}

//CLASS - EngineAudio
export class EngineAudio {
    private readonly carConfig: CarModel

    private readonly ctx: AudioContext
    private readonly nodes: EngineAudioNodes

    private readonly harmonics: HarmonicVoice[]
    private readonly noise: {buffer: AudioBuffer, sources: AudioBufferSourceNode[]}
    private readonly sampleWeights = new Float64Array(SAMPLE_BLEND_THRESHOLDS.length)

    private readonly state = {
        previousThrottle: 0,
        lastPopTime: -Infinity,
        currentNormalizedRPM: 0,
        lastLimiterCutCycle: -1
    }

    //FUNCTION - constructor()
    constructor(listener: THREE.AudioListener, parent: THREE.Object3D, model: CarModelName) {
        const ctx = listener.context
        this.ctx = ctx
        this.nodes = createEngineAudioNodes(ctx, listener)

        this.carConfig = config.car.models[model]

        this.connectAudioGraph(this.carConfig.sound)
        this.connectSampleSaturation(this.carConfig.sound.samples)
        this.connectAudioBus(parent)

        this.noise = {buffer: createNoiseBuffer(ctx), sources: []}
        this.createSynthLayers(this.carConfig.sound)
        this.createSampleVoices()
        this.harmonics = this.createHarmonicVoices(this.carConfig.sound.synthesis.harmonics)

        //fun - createNoiseBuffer()
        function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
            const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
            const data = buffer.getChannelData(0)
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
            return buffer
        }
    }
    //!FUNCTION

    //FUNCTION - update()
    update(rawThrottle: number, rpm: number, master: number, dt: number): void {
        const now = this.ctx.currentTime
        const {min: idleRPM, max: redlineRPM} = this.carConfig.rpm

        const normalizedRPM = THREE.MathUtils.clamp((rpm - idleRPM) / (redlineRPM - idleRPM), 0, 1)
        const firingFrequency = rpm / 60 * this.carConfig.cylinders / 2

        const load = (0.3 + 0.7 * rawThrottle) * master

        //note - Master Volume
        this.nodes.output.master.gain.setTargetAtTime(
            this.carConfig.sound.samples.volume * master,
            now,
            0.025
        )

        this.state.currentNormalizedRPM = normalizedRPM
        this.updateLimiter(now, normalizedRPM, this.carConfig.sound.events.limiter)
        this.updateComb(now, normalizedRPM, this.carConfig.sound.effects.comb)
        this.updateHarmonics(now, rpm, firingFrequency, load, this.carConfig.sound.synthesis.harmonics)

        const lowRumbleLevel = this.updateLayers(now, normalizedRPM, rawThrottle, load, firingFrequency, this.carConfig.sound)

        this.updateSamples(now, normalizedRPM, rawThrottle, this.carConfig.sound.samples)
        this.updateTipIn(now, rawThrottle, lowRumbleLevel, this.carConfig.sound)
        this.updateOverrun(now, rawThrottle, normalizedRPM, this.carConfig.sound, dt)
        
        this.state.previousThrottle = rawThrottle
    }
    //!FUNCTION

    //fun - triggerShift()
    triggerShift(): void {
        // Briefly cut the engine, then layer configurable pops.
        const shift = this.carConfig.sound.events.shift_bangs
        const now = this.ctx.currentTime
        const cutEnd = now + shift.cut_ms / 1000

        this.nodes.mix.shiftCut.gain.cancelScheduledValues(now)
        this.nodes.mix.shiftCut.gain.setValueAtTime(1, now)
        this.nodes.mix.shiftCut.gain.linearRampToValueAtTime(1 - shift.depth, now + 0.01)
        this.nodes.mix.shiftCut.gain.setValueAtTime(1 - shift.depth, cutEnd)
        this.nodes.mix.shiftCut.gain.linearRampToValueAtTime(1, cutEnd + 0.02)

        for (let i = 0; i < shift.pops; i++) {
            this.firePop(now + 0.02 + i * 0.035, this.state.currentNormalizedRPM, shift.volume)
        }
    }

    //fun - dispose()
    dispose(parent: THREE.Object3D): void {
        //note - Sample Voices
        for (const key of (Object.keys(audios) as AudioKey[])) {
            const sample = this.nodes.samples.voices[key]
            if (!sample) continue

            sample.source.stop()
            sample.source.disconnect()
            sample.gain.disconnect()
        }

        //note - Shared Noise Sources
        this.noise.sources.forEach((source) => {
            source.stop()
            source.disconnect()
        })

        //note - Shared Mix Graph
        this.nodes.samples.mix.disconnect()
        this.nodes.samples.saturation.filter.disconnect()
        this.nodes.samples.saturation.drive.disconnect()
        this.nodes.samples.saturation.shaper.disconnect()
        this.nodes.samples.saturation.gain.disconnect()

        this.nodes.mix.engine.disconnect()
        this.nodes.mix.limiter.disconnect()
        this.nodes.mix.shiftCut.disconnect()
        this.nodes.mix.resonators.forEach((filter) => filter.disconnect())
        this.nodes.mix.comb.delay.disconnect()
        this.nodes.mix.comb.dry.disconnect()
        this.nodes.mix.comb.wet.disconnect()
        this.nodes.mix.final.disconnect()

        this.nodes.output.mix.disconnect()
        this.nodes.output.reverb.disconnect()
        this.nodes.output.reverbGain.disconnect()
        this.nodes.output.lowShelf.disconnect()
        this.nodes.output.presence.disconnect()
        this.nodes.output.highShelf.disconnect()
        this.nodes.output.compressor.disconnect()

        //note - Synth Layers
        this.nodes.layers.rumble.filter.disconnect()
        this.nodes.layers.rumble.gain.disconnect()
        this.nodes.layers.intake.highpass.disconnect()
        this.nodes.layers.intake.filter.disconnect()
        this.nodes.layers.intake.gain.disconnect()
        this.nodes.layers.exhaust.filter.disconnect()
        this.nodes.layers.exhaust.gain.disconnect()

        this.nodes.layers.subBass.oscillator.stop()
        this.nodes.layers.subBass.oscillator.disconnect()
        this.nodes.layers.subBass.filter.disconnect()
        this.nodes.layers.subBass.saturator.disconnect()
        this.nodes.layers.subBass.gain.disconnect()

        this.nodes.layers.lowRumble.oscillator.stop()
        this.nodes.layers.lowRumble.oscillator.disconnect()
        this.nodes.layers.lowRumble.gain.disconnect()

        this.nodes.layers.rasp.oscillator.stop()
        this.nodes.layers.rasp.oscillator.disconnect()
        this.nodes.layers.rasp.highpass.disconnect()
        this.nodes.layers.rasp.gain.disconnect()
        this.nodes.layers.rasp.noiseFilter.disconnect()
        this.nodes.layers.rasp.noiseGain.disconnect()

        //note - Harmonic Oscillators
        this.harmonics.forEach((harmonic) => {
            harmonic.node.stop()
            harmonic.node.disconnect()
            harmonic.gain.disconnect()
        })

        //note - Positional Output
        this.nodes.output.audioBus.disconnect()
        this.nodes.output.limiter.disconnect()
        this.nodes.output.master.disconnect()
        parent.remove(this.nodes.output.audioBus)
    }

    //fun - connectAudioGraph()
    private connectAudioGraph(sound: SoundConfig): void {
        const ctx = this.ctx
        const {effects, samples} = sound
        const masterGainNode = this.nodes.output.master
        masterGainNode.gain.value = samples.volume

        this.nodes.mix.limiter.gain.value = 1
        this.nodes.mix.shiftCut.gain.value = 1
        this.nodes.mix.engine.connect(this.nodes.mix.limiter)
        this.nodes.mix.limiter.connect(this.nodes.mix.shiftCut)

        let busOutput: AudioNode = this.nodes.mix.shiftCut
        for (const resonator of effects.resonators) {
            const filter = ctx.createBiquadFilter()
            filter.type = "peaking"
            filter.frequency.value = resonator.frequency
            filter.Q.value = resonator.q
            filter.gain.value = resonator.gain

            busOutput.connect(filter)
            busOutput = filter
            this.nodes.mix.resonators.push(filter)
        }

        const comb = effects.comb
        this.nodes.mix.comb.delay.delayTime.value = comb.delay_ms / 1000
        this.nodes.mix.comb.dry.gain.value = comb.enabled ? 1 - comb.mix : 1
        this.nodes.mix.comb.wet.gain.value = comb.enabled ? comb.mix : 0

        busOutput.connect(this.nodes.mix.comb.dry)
        busOutput.connect(this.nodes.mix.comb.delay)
        this.nodes.mix.comb.delay.connect(this.nodes.mix.comb.wet)
        this.nodes.mix.comb.dry.connect(this.nodes.mix.final)
        this.nodes.mix.comb.wet.connect(this.nodes.mix.final)

        const output = effects.output
        this.nodes.output.reverb.buffer = createReverbImpulse(ctx, output.reverb.seconds)
        this.nodes.output.reverb.normalize = false
        this.nodes.output.reverbGain.gain.value = output.reverb.mix

        this.nodes.output.lowShelf.type = "lowshelf"
        this.nodes.output.lowShelf.frequency.value = output.low_shelf.frequency
        this.nodes.output.lowShelf.gain.value = output.low_shelf.gain

        this.nodes.output.presence.type = "peaking"
        this.nodes.output.presence.frequency.value = output.presence.frequency
        this.nodes.output.presence.Q.value = output.presence.q
        this.nodes.output.presence.gain.value = output.presence.gain

        this.nodes.output.highShelf.type = "highshelf"
        this.nodes.output.highShelf.frequency.value = output.high_shelf.frequency
        this.nodes.output.highShelf.gain.value = output.high_shelf.gain

        this.nodes.output.compressor.threshold.value = -24
        this.nodes.output.compressor.knee.value = 8
        this.nodes.output.compressor.ratio.value = 2.2
        this.nodes.output.compressor.attack.value = 0.003
        this.nodes.output.compressor.release.value = 0.12

        this.nodes.output.limiter.threshold.value = -3
        this.nodes.output.limiter.knee.value = 0
        this.nodes.output.limiter.ratio.value = 12
        this.nodes.output.limiter.attack.value = 0.0008
        this.nodes.output.limiter.release.value = 0.04

        this.nodes.mix.final.connect(this.nodes.output.mix)
        this.nodes.mix.final.connect(this.nodes.output.reverb)
        this.nodes.output.reverb.connect(this.nodes.output.reverbGain)
        this.nodes.output.reverbGain.connect(this.nodes.output.mix)
        this.nodes.output.mix.connect(this.nodes.output.lowShelf)
        this.nodes.output.lowShelf.connect(this.nodes.output.presence)
        this.nodes.output.presence.connect(this.nodes.output.highShelf)
        this.nodes.output.highShelf.connect(this.nodes.output.compressor)
        this.nodes.output.compressor.connect(masterGainNode)
        masterGainNode.connect(this.nodes.output.limiter)

        //fun - createReverbImpulse()
        function createReverbImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
            const length = Math.floor(ctx.sampleRate * seconds)
            const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
            for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
                const data = impulse.getChannelData(channel)
                for (let i = 0; i < length; i++) {
                    const decay = Math.pow(1 - i / length, 3)
                    data[i] = (Math.random() * 2 - 1) * decay * 0.2
                }
            }
            return impulse
        }
    }

    //fun - connectSampleSaturation()
    private connectSampleSaturation(samples: SoundConfig["samples"]): void {
        const saturation = this.nodes.samples.saturation
        this.nodes.samples.mix.gain.value = 1
        this.nodes.samples.mix.connect(this.nodes.mix.engine)

        saturation.filter.type = "highpass"
        saturation.filter.frequency.value = samples.saturation.highpass
        saturation.drive.gain.value = samples.saturation.drive
        saturation.shaper.curve = createSaturationCurve(samples.saturation.kind)
        saturation.shaper.oversample = "4x"
        saturation.gain.gain.value = samples.saturation.mix

        this.nodes.samples.mix.connect(saturation.filter)
        saturation.filter.connect(saturation.drive)
        saturation.drive.connect(saturation.shaper)
        saturation.shaper.connect(saturation.gain)
        saturation.gain.connect(this.nodes.mix.engine)
    }

    //fun - connectAudioBus()
    private connectAudioBus(parent: THREE.Object3D): void {
        const audioBus = this.nodes.output.audioBus
        audioBus.setNodeSource(this.nodes.output.limiter as unknown as AudioScheduledSourceNode)
        audioBus.setRefDistance(5)
        audioBus.setRolloffFactor(1)
        parent.add(audioBus)
    }

    //fun - createSynthLayers()
    private createSynthLayers(sound: SoundConfig): void {
        const {layers, synthesis} = sound
        const {rumble, intake, exhaust, subBass, lowRumble, rasp} = this.nodes.layers

        const rumbleSource = this.createNoiseSource()
        rumble.filter.type = "lowpass"
        rumble.filter.frequency.value = layers.rumble.cutoff
        rumble.gain.gain.value = 0
        rumbleSource.connect(rumble.filter)
        rumble.filter.connect(rumble.gain)
        rumble.gain.connect(this.nodes.mix.engine)
        rumbleSource.start()

        const intakeSource = this.createNoiseSource()
        intake.highpass.type = "highpass"
        intake.highpass.frequency.value = 350
        intake.filter.type = "lowpass"
        intake.filter.frequency.value = layers.intake.cutoff.min
        intake.gain.gain.value = 0
        intakeSource.connect(intake.highpass)
        intake.highpass.connect(intake.filter)
        intake.filter.connect(intake.gain)
        intake.gain.connect(this.nodes.mix.engine)
        intakeSource.start()

        const exhaustSource = this.createNoiseSource()
        exhaust.filter.type = "bandpass"
        exhaust.filter.frequency.value = layers.exhaust.cutoff.min
        exhaust.filter.Q.value = layers.exhaust.q
        exhaust.gain.gain.value = 0
        exhaustSource.connect(exhaust.filter)
        exhaust.filter.connect(exhaust.gain)
        exhaust.gain.connect(this.nodes.mix.engine)
        exhaustSource.start()

        subBass.oscillator.type = "sine"
        subBass.oscillator.frequency.value = 0
        subBass.filter.type = "lowpass"
        subBass.filter.frequency.value = 140
        subBass.saturator.curve = createSaturationCurve("tube")
        subBass.saturator.oversample = "2x"
        subBass.gain.gain.value = 0
        subBass.oscillator.connect(subBass.filter)
        subBass.filter.connect(subBass.saturator)
        subBass.saturator.connect(subBass.gain)
        subBass.gain.connect(this.nodes.mix.engine)
        subBass.oscillator.start()

        lowRumble.oscillator.type = "sine"
        lowRumble.oscillator.frequency.value = synthesis.sub_bass.rumble_frequency
        lowRumble.gain.gain.value = 0
        lowRumble.oscillator.connect(lowRumble.gain)
        lowRumble.gain.connect(this.nodes.mix.engine)
        lowRumble.oscillator.start()

        rasp.oscillator.type = this.carConfig.cylinders == 6 ? "triangle" : "sine"
        rasp.oscillator.frequency.value = 0
        rasp.highpass.type = "highpass"
        rasp.highpass.frequency.value = synthesis.rasp.highpass
        rasp.gain.gain.value = 0
        rasp.oscillator.connect(rasp.highpass)
        rasp.highpass.connect(rasp.gain)
        rasp.gain.connect(this.nodes.mix.engine)
        rasp.oscillator.start()

        const raspNoiseSource = this.createNoiseSource()
        rasp.noiseFilter.type = "bandpass"
        rasp.noiseFilter.frequency.value = Math.sqrt(synthesis.rasp.cutoff.min * synthesis.rasp.cutoff.max)
        rasp.noiseFilter.Q.value = rasp.noiseFilter.frequency.value / (synthesis.rasp.cutoff.max - synthesis.rasp.cutoff.min)
        rasp.noiseGain.gain.value = 0
        raspNoiseSource.connect(rasp.noiseFilter)
        rasp.noiseFilter.connect(rasp.noiseGain)
        rasp.noiseGain.connect(this.nodes.mix.engine)
        raspNoiseSource.start()
    }

    //fun - createNoiseSource()
    private createNoiseSource(): AudioBufferSourceNode {
        const source = this.ctx.createBufferSource()

        source.buffer = this.noise.buffer
        source.loop = true
        this.noise.sources.push(source)

        return source
    }

    //fun - createSampleVoices()
    private createSampleVoices(): void {
        for (const key of (Object.keys(audios) as AudioKey[])) {
            const source = this.ctx.createBufferSource()

            source.buffer = audios[key]
            source.loop = true

            const gain = this.ctx.createGain()
            gain.gain.value = 0

            source.connect(gain)
            gain.connect(this.nodes.samples.mix)
            source.start()

            this.nodes.samples.voices[key] = {source, gain}
        }
    }

    //fun - createHarmonicVoices()
    private createHarmonicVoices(configs: Harmonic[]): HarmonicVoice[] {
        return configs.map((cfg, index) => {
            const node = this.ctx.createOscillator()
            node.frequency.value = 0
            node.type = cfg.wave
            node.detune.value = (index % 2 === 0 ? -1 : 1) * (1.5 + index * 0.35)

            const gain = this.ctx.createGain()
            gain.gain.value = 0
            gain.connect(this.nodes.mix.engine)
            node.connect(gain)
            node.start()

            return {node, gain}
        })
    }

    //fun - updateLimiter()
    private updateLimiter(
        now: number, normalizedRPM: number,
        limiter: SoundConfig["events"]["limiter"]
    ): void {
        const limiterCycle = Math.floor(now * limiter.rate_hz)
        const limiterPhase = now * limiter.rate_hz - limiterCycle
        const limiterActive = normalizedRPM >= limiter.min_rpm_normalized
        const limiterCut = limiterActive && limiterPhase < 0.42

        this.nodes.mix.limiter.gain.setTargetAtTime(limiterCut ? 1 - limiter.depth : 1, now, 0.003)

        if (limiterCut && limiterCycle !== this.state.lastLimiterCutCycle) {
            this.state.lastLimiterCutCycle = limiterCycle
            if (limiter.pop_on_cut) this.firePop(now, normalizedRPM, limiter.pop_volume)

        } else if (!limiterActive) {
            this.state.lastLimiterCutCycle = -1
        }
    }

    //fun - updateComb()
    private updateComb(now: number, normalizedRPM: number, comb: SoundConfig["effects"]["comb"]): void {
        if (comb.enabled) {
            this.nodes.mix.comb.delay.delayTime.setTargetAtTime(
                (comb.delay_ms + comb.tracking_ms * normalizedRPM) / 1000,
                now,
                0.12
            )
        }
    }

    //fun - updateHarmonics()
    private updateHarmonics(
        now: number, rpm: number,
        firingFrequency: number,
        load: number, harmonics: Harmonic[]
    ): void {
        for (let i = 0; i < this.harmonics.length; i++) {
            const voice = this.harmonics[i]!
            const config = harmonics[i]!
            voice.node.frequency.setTargetAtTime(config.order * firingFrequency, now, 0.02)
            voice.gain.gain.setTargetAtTime(
                gainCurve(config.gainByRPM, rpm) * config.master * load,
                now,
                0.05
            )
        }

        //fun - gainCurve()
        function gainCurve(points: {max: number, gain: number}[], rpm: number): number {
            if (rpm <= points[0]!.max) return points[0]!.gain

            for (let i = 0; i < points.length - 1; i++) {
                const a = points[i]!, b = points[i + 1]!
                if (rpm <= b.max) return a.gain + ((rpm - a.max) / (b.max - a.max)) * (b.gain - a.gain)
            }

            return points[points.length - 1]!.gain
        }
    }

    //fun - updateLayers()
    private updateLayers(
        now: number,
        normalizedRPM: number,
        throttle: number,
        load: number,
        firingFrequency: number,
        sound: SoundConfig
    ): number {
        const {layers, synthesis} = sound
        const {rumble, intake, exhaust, subBass, lowRumble, rasp} = this.nodes.layers

        rumble.filter.frequency.setTargetAtTime(layers.rumble.cutoff * (0.8 + normalizedRPM * 0.4), now, 0.12)
        rumble.gain.gain.setTargetAtTime(layers.rumble.volume * (1 - normalizedRPM * 0.45), now, 0.12)

        intake.filter.frequency.setTargetAtTime(
            THREE.MathUtils.lerp(layers.intake.cutoff.min, layers.intake.cutoff.max, normalizedRPM),
            now,
            0.1
        )
        intake.gain.gain.setTargetAtTime(
            layers.intake.volume * (0.15 + 0.85 * throttle) * (0.25 + 0.75 * normalizedRPM),
            now,
            0.1
        )

        exhaust.filter.frequency.setTargetAtTime(
            THREE.MathUtils.lerp(layers.exhaust.cutoff.min, layers.exhaust.cutoff.max, normalizedRPM),
            now,
            0.1
        )
        exhaust.gain.gain.setTargetAtTime(
            layers.exhaust.volume * (0.25 + 0.75 * load) * (0.35 + 0.65 * normalizedRPM),
            now,
            0.1
        )

        subBass.oscillator.frequency.setTargetAtTime(firingFrequency * 0.5, now, 0.04)
        subBass.gain.gain.setTargetAtTime(synthesis.sub_bass.volume * (0.3 + 0.7 * throttle), now, 0.08)

        const lowRumbleLevel = synthesis.sub_bass.rumble_volume
            * (1 - normalizedRPM * 0.65)
            * (0.3 + 0.7 * throttle)
        lowRumble.gain.gain.setTargetAtTime(lowRumbleLevel, now, 0.1)

        const raspLevel = synthesis.rasp.volume
            * THREE.MathUtils.smoothstep(normalizedRPM, synthesis.rasp.min_rpm_normalized, 1)
            * (0.2 + 0.8 * throttle)
        rasp.oscillator.frequency.setTargetAtTime(firingFrequency, now, 0.04)
        rasp.gain.gain.setTargetAtTime(raspLevel, now, 0.08)
        rasp.noiseGain.gain.setTargetAtTime(raspLevel, now, 0.08)

        return lowRumbleLevel
    }

    //fun - updateSamples()
    private updateSamples(
        now: number,
        normalizedRPM: number,
        throttle: number,
        samples: SoundConfig["samples"]
    ): void {
        let totalWeight = 0
        for (let i = 0; i < SAMPLE_BLEND_THRESHOLDS.length; i++) {
            const threshold = SAMPLE_BLEND_THRESHOLDS[i]!
            const distance = (normalizedRPM - threshold) / 0.18
            const weight = i === 4 && normalizedRPM < 0.97 ? 0 : Math.exp(-0.5 * distance * distance)
            this.sampleWeights[i] = weight
            totalWeight += weight
        }

        for (let i = 0; i < this.sampleWeights.length; i++) {
            this.sampleWeights[i] = Math.sqrt(this.sampleWeights[i]! / totalWeight)
        }

        const idle = this.sampleWeights[0]!
        const low = this.sampleWeights[1]!
        const med = this.sampleWeights[2]!
        const high = this.sampleWeights[3]!
        const maxRPM = this.sampleWeights[4]!

        const on = Math.sin(throttle * Math.PI / 2)
        const off = Math.cos(throttle * Math.PI / 2)

        const pitchCurve = Math.log1p(9 * normalizedRPM) / Math.log1p(9)
        const basePitch = THREE.MathUtils.lerp(samples.pitch.min, samples.pitch.max, pitchCurve)

        for (const key of (Object.keys(audios) as AudioKey[])) {
            const sample = this.nodes.samples.voices[key]
            if (!sample) continue

            sample.source.playbackRate.setTargetAtTime(basePitch + SAMPLE_PITCH_OFFSETS[key], now, 0.15)
        }

        const sampleVolume = samples.volume > 0 ? (samples.volume + Math.pow(normalizedRPM, 1.8) * 0.2) / samples.volume : 0

        this.setSampleVolume("idle", idle * sampleVolume, now)

        this.setSampleVolume("lowOff", low * off * sampleVolume, now)
        this.setSampleVolume("lowOn", low * on * sampleVolume, now)

        this.setSampleVolume("medOff", med * off * sampleVolume, now)
        this.setSampleVolume("medOn", med * on * sampleVolume, now)

        this.setSampleVolume("highOff", high * off * sampleVolume, now)
        this.setSampleVolume("highOn", high * on * sampleVolume, now)

        this.setSampleVolume("maxRPM", maxRPM * sampleVolume, now)
    }

    //fun - setSampleVolume()
    private setSampleVolume(key: AudioKey, volume: number, now: number): void {
        const sample = this.nodes.samples.voices[key]
        if (sample) sample.gain.gain.setTargetAtTime(volume, now, 0.08)
    }

    //fun - updateTipIn()
    private updateTipIn(now: number, throttle: number, lowRumbleLevel: number, sound: SoundConfig): void {
        const tipIn = sound.events.tip_in
        if (throttle - this.state.previousThrottle < tipIn.threshold) return

        const samples = sound.samples
        const endTime = now + 0.02
        const decay = tipIn.decay / 3
        const sampleGain = this.nodes.samples.mix.gain
        const saturationDrive = this.nodes.samples.saturation.drive.gain
        const rumbleGain = this.nodes.layers.lowRumble.gain.gain

        sampleGain.cancelScheduledValues(now)
        sampleGain.setValueAtTime(1, now)
        sampleGain.linearRampToValueAtTime(1 + tipIn.gain, endTime)
        sampleGain.setTargetAtTime(1, endTime, decay)

        saturationDrive.cancelScheduledValues(now)
        saturationDrive.setValueAtTime(samples.saturation.drive, now)
        saturationDrive.linearRampToValueAtTime(samples.saturation.drive + tipIn.drive, endTime)
        saturationDrive.setTargetAtTime(samples.saturation.drive, endTime, decay)

        rumbleGain.cancelScheduledValues(now)
        rumbleGain.setValueAtTime(lowRumbleLevel, now)
        rumbleGain.linearRampToValueAtTime(lowRumbleLevel * (1 + tipIn.drive), endTime)
        rumbleGain.setTargetAtTime(lowRumbleLevel, endTime, decay)
    }

    //fun - updateOverrun()
    private updateOverrun(
        now: number,
        throttle: number,
        normalizedRPM: number,
        sound: SoundConfig,
        dt: number
    ): void {
        const {overrun, pops} = sound.events
        const crackleChance = 1 - Math.exp(-overrun.density * Math.max(0, dt) / 1000)

        if (
            !(throttle < 0.12) ||
            !(normalizedRPM >= overrun.min_rpm_normalized) ||
            !(now - this.state.lastPopTime >= pops.cooldown) ||
            !(pops.volume > 0) ||
            !(Math.random() < crackleChance)
        ) return

        const volumeScale = overrun.volume * (0.65 + Math.random() * 0.7)
        const durationScale = 0.7 + Math.random() * 0.6
        this.firePop(now, normalizedRPM, volumeScale, durationScale)
        this.state.lastPopTime = now
    }

    //fun - firePop()
    private firePop(
        now: number,
        normalizedRPM: number,
        volumeScale = 1,
        durationScale = 1
    ): void {
        const popConfig = this.carConfig.sound.events.pops
        const source = this.ctx.createBufferSource()
        source.buffer = this.noise.buffer

        // Band-pass filtering gives noise a short exhaust-pop character.
        const filter = this.ctx.createBiquadFilter()
        filter.type = "bandpass"
        filter.frequency.value = popConfig.frequency * (0.85 + Math.random() * 0.3)
        filter.Q.value = 1.5

        const gain = this.ctx.createGain()
        const endTime = now + popConfig.duration * durationScale
        const volume = popConfig.volume * volumeScale *
            THREE.MathUtils.smoothstep(normalizedRPM, popConfig.min_rpm_normalized, 1)

        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.linearRampToValueAtTime(volume, now + 0.006)
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime)

        source.connect(filter)
        filter.connect(gain)
        gain.connect(this.nodes.mix.final)

        source.onended = (): void => {
            source.disconnect()
            filter.disconnect()
            gain.disconnect()
        }

        source.start(now)
        source.stop(endTime)
    }
}
//!CLASS

//fun - createEngineAudioNodes()
function createEngineAudioNodes(ctx: AudioContext, listener: THREE.AudioListener): EngineAudioNodes {
    const engineAudioNodes: EngineAudioNodes = {
        //note - Engine Mix
        mix: {
            engine: ctx.createGain(),
            limiter: ctx.createGain(),
            shiftCut: ctx.createGain(),
            resonators: [],
            comb: {delay: ctx.createDelay(0.02), dry: ctx.createGain(), wet: ctx.createGain()},
            final: ctx.createGain()
        },

        //note - Sample Layers
        samples: {
            voices: {},
            mix: ctx.createGain(),
            saturation: {
                filter: ctx.createBiquadFilter(),
                drive: ctx.createGain(),
                shaper: ctx.createWaveShaper(),
                gain: ctx.createGain()
            }
        },

        //note - Synth Layers
        layers: {
            rumble: {filter: ctx.createBiquadFilter(), gain: ctx.createGain()},
            intake: {
                highpass: ctx.createBiquadFilter(),
                filter: ctx.createBiquadFilter(),
                gain: ctx.createGain()
            },
            exhaust: {filter: ctx.createBiquadFilter(), gain: ctx.createGain()},
            subBass: {
                oscillator: ctx.createOscillator(),
                filter: ctx.createBiquadFilter(),
                saturator: ctx.createWaveShaper(),
                gain: ctx.createGain()
            },
            lowRumble: {oscillator: ctx.createOscillator(), gain: ctx.createGain()},
            rasp: {
                oscillator: ctx.createOscillator(),
                highpass: ctx.createBiquadFilter(),
                gain: ctx.createGain(),
                noiseFilter: ctx.createBiquadFilter(),
                noiseGain: ctx.createGain()
            }
        },

        //note - Output
        output: {
            master: ctx.createGain(),
            audioBus: new THREE.PositionalAudio(listener),
            mix: ctx.createGain(),
            reverb: ctx.createConvolver(),
            reverbGain: ctx.createGain(),
            lowShelf: ctx.createBiquadFilter(),
            presence: ctx.createBiquadFilter(),
            highShelf: ctx.createBiquadFilter(),
            compressor: ctx.createDynamicsCompressor(),
            limiter: ctx.createDynamicsCompressor()
        }
    }

    return engineAudioNodes
}

//fun - createSaturationCurve()
function createSaturationCurve(kind: "tube" | "hard"): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(2048)
    for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1
        curve[i] = kind === "tube"
            ? Math.tanh(2.5 * x) / Math.tanh(2.5)
            : THREE.MathUtils.clamp(x * 1.5, -1, 1)
    }
    return curve
}