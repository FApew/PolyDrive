import * as THREE from "three"
import { createEngineSound, type EngineSound } from "engine-sound"

import type { CarModelName, TransmissionMode, EngineAudioOptions, EngineTelemetry } from "../../shared/types"
import { soundMRFiles } from "./assetsLoader"

//CLASS - EngineAudio
export class EngineAudio {
    private static active = new Set<EngineAudio>() //Live instances

    private listener: THREE.AudioListener
    private mesh: THREE.Group
    private model: CarModelName

    private engine: EngineSound | null = null
    private audio: THREE.PositionalAudio | null = null

    private ready: Promise<void>
    private disposed = false

    private transmission: TransmissionMode
    private maxGears: number

    private upshiftRPM: number
    private downshiftRPM: number

    private shiftCooldown = 0
    private readonly shiftDelay = 0.4

    private wheelRadius: number

    // Public simulation state
    rpm: number = 0
    gear: number = 0
    speed: number = 0
    wheelRPM: number = 0
    throttle: number = 0

    constructor(
        listener: THREE.AudioListener,
        mesh: THREE.Group,
        model: CarModelName,
        options: EngineAudioOptions = {}
    ) {
        this.listener = listener
        this.mesh = mesh
        this.model = model

        this.transmission = options.transmission ?? "manual"

        this.maxGears = options.maxGears ?? (model === "giulia" ? 8 : 5)

        this.upshiftRPM = options.upshiftRPM ?? 6800
        this.downshiftRPM = options.downshiftRPM ?? 3000

        this.wheelRadius = options.wheelRadius ?? 0.34

        this.ready = this.init(model)
    }

    //fun - init()
    private async init(model: CarModelName): Promise<void> {

        const engine = await createEngineSound({
            context: this.listener.context,
            destination: null
        })

        await engine.loadMr(soundMRFiles[model])

        if (this.disposed) {
            engine.dispose()
            return
        }

        this.engine = engine

        engine.addEventListener("telemetry", (event: Event) => {
            const data = (event as CustomEvent<EngineTelemetry>).detail

            this.rpm = data.rpm
            this.gear = data.gear
            this.speed = data.speed

            this.wheelRPM = (this.speed / (2 * Math.PI * this.wheelRadius)) * 60
        })

        engine.setGear(0)
        engine.setThrottle(0)

        const audio = new THREE.PositionalAudio(this.listener)

        audio.setNodeSource(engine.node)
        audio.setRefDistance(2)
        audio.setRolloffFactor(0)
        audio.setDistanceModel("inverse")

        this.mesh.add(audio)
        this.audio = audio

        EngineAudio.active.add(this)
    }

    //fun - start()
    async start(): Promise<void> {
        await this.ready

        if (!this.engine || this.disposed) return

        await this.listener.context.resume()

        this.engine.setIgnition(true)
        this.engine.setStarter(true)
    }

    //fun - stop()
    stop(): void {
        if (!this.engine) return

        this.setThrottle(0)
        this.engine.setGear(0)
        this.engine.setIgnition(false)

        this.gear = 0
    }

    //fun - setThrottle()
    setThrottle(value: number): void {
        this.throttle = THREE.MathUtils.clamp(value, 0, 1)

        this.engine?.setThrottle(this.throttle)
    }

    /*setTransmissionMode(mode: TransmissionMode): void {
        this.transmission = mode

        if (mode === "automatic" && this.gear === 0) {
            this.setGear(1)
        }
    }*/

    /*setGear(gear: number): void {
        if (!this.engine || this.disposed) return

        const targetGear = THREE.MathUtils.clamp(
            Math.round(gear),
            0,
            this.maxGears
        )

        if (targetGear === this.gear) return

        this.engine.setGear(targetGear)

        this.gear = targetGear
        this.shiftCooldown = this.shiftDelay
    }

    shiftUp(): void {
        if (this.transmission !== "manual") return

        this.setGear(this.gear + 1)
    }

    shiftDown(): void {
        if (this.transmission !== "manual") return

        this.setGear(this.gear - 1)
    }

    private automaticShift(dt: number): void {
        if (this.transmission !== "automatic") return
        if (this.gear === 0) return
        if (this.shiftCooldown > 0) return

        if (
            this.rpm >= this.upshiftRPM &&
            this.gear < this.maxGears
        ) {
            this.setGear(this.gear + 1)
        } else if (
            this.rpm <= this.downshiftRPM &&
            this.gear > 1
        ) {
            this.setGear(this.gear - 1)
        }
    }*/

    //fun - update()
    update(master: number, dt: number): void {
        if (!this.engine || this.disposed) return

        this.shiftCooldown = Math.max(
            0,
            this.shiftCooldown - dt
        )

        //this.automaticShift(dt)

        const n = Math.max(1, EngineAudio.active.size)
        const crowdGain = 1 / n

        this.audio?.setVolume(
            THREE.MathUtils.clamp(master, 0, 1) * crowdGain
        )
    }

    //fun - dispose()
    dispose(): void {
        this.disposed = true

        EngineAudio.active.delete(this)

        if (this.audio) {
            this.audio.removeFromParent()

            try {
                this.audio.disconnect()
            } catch (error) {
                console.warn("[EngineAudio] Audio disconnect failed:", error)
            }

            this.audio = null
        }

        this.engine?.dispose()
        this.engine = null
    }
}
//!CLASS

const installed = new WeakSet<THREE.AudioListener>()

//fun - installLimiter()
export function installLimiter(listener: THREE.AudioListener): void {
    if (installed.has(listener)) return
    installed.add(listener)

    const limiter = listener.context.createDynamicsCompressor()
    limiter.threshold.value = -16
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.1

    listener.setFilter(limiter)
    listener.setMasterVolume(0.5)
}