import * as THREE from "three"
import { SoundTouchNode } from "@soundtouchjs/audio-worklet"
import processorUrl from "@soundtouchjs/audio-worklet/processor?url"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

import type { Vec3, CarModelName } from "../../shared/types"
import { config } from "../../shared/YAMLConfigs"
import { EngineAudio } from "./engineAudio"

//note - GLTF Loader
const modelsLoader = new GLTFLoader()

//Car Models
const [ giuliaGLTF, f40GLTF, tireGLTF ] = await Promise.all([
    modelsLoader.loadAsync("../assets/models/giulia.glb"),
    modelsLoader.loadAsync("../assets/models/f40.glb"),
    modelsLoader.loadAsync("../assets/models/tire.glb")
])

const models: Record<CarModelName | "tire", THREE.Group> = {
    "giulia": giuliaGLTF.scene,
    "f40": f40GLTF.scene,
    "tire": tireGLTF.scene
}

const soundTouchRegistrations = new WeakMap<AudioContext, Promise<void>>()

export async function initAudio(context: AudioContext): Promise<void> {

    if (!context.audioWorklet) {
        throw new Error("AudioWorklet is unavailable. Check HTTPS / secure context.")
    }

    let registration = soundTouchRegistrations.get(context)

    if (!registration) {
        registration = SoundTouchNode.register(context, processorUrl)
        soundTouchRegistrations.set(context, registration)
    }

    await registration
}

//CLASS - carLobbyVisual
export class carLobbyVisual {
    id: string
    model: CarModelName

    mesh: THREE.Group

    private chassis: THREE.Group
    private wheelMesh: THREE.Group[] = []

    private headlights: THREE.SpotLight[] = []
    private backlights: THREE.SpotLight[] = []

    throttle: number = 0
    steer: number = 0
    lights: boolean = false

    private currentWheelsSpeed: number = 0
    
    private engineAudio: EngineAudio | null = null

    //fun - constructor()
    constructor(id: string, model: CarModelName) {
        this.id = id
        this.model = model

        const carGroup = new THREE.Group()

        //note - Chassis
        const carChassis = models[model]!.clone(true)

        carChassis.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => mat.clone())
                } else {
                    child.material = child.material.clone()
                }

                const materials = Array.isArray(child.material) ? child.material : [child.material]

                materials.forEach((mat) => {
                    if (mat instanceof THREE.MeshStandardMaterial) {
                        switch (mat.name) {
                            case "headlights": {
                                mat.emissive.set(0xffffff)
                                mat.emissiveIntensity = 3
                                break
                            }
                            case "backlights": {
                                mat.emissive.set(0xff0000)
                                mat.emissiveIntensity = 3
                                break
                            }
                        }
                    }
                })
            }
        })

        carChassis.position.y = config.car.models[model].elevation
        this.chassis = carChassis
        carGroup.add(carChassis)

        //note - Wheels
        for (const i of [1, -1]) {
            for (const j of [1, -1]) {
                const wheel = models["tire"]!.clone(true)
                const wheelPos: Vec3 = config.car.models[model].wheel_pos
                wheel.position.set(wheelPos.x * j, wheelPos.y, wheelPos.z * i)

                const s = config.car.models[model].wheel_size
                wheel.scale.set(s, s, s)
                
                this.wheelMesh.push(wheel)
                carGroup.add(wheel)
            }
        }

        //note Headlights
        for (const i of [1, -1]) {
            const spotlight = new THREE.SpotLight(
                0xffffff,
                70,
                40,
                Math.PI / 3,
                0.5,
                2
            )

            const vec3 = config.car.models[model].headlights_pos
            spotlight.position.set(vec3.x * i, vec3.y, vec3.z)
            spotlight.target.position.set(vec3.x * i, vec3.y, vec3.z + 12)

            carGroup.add(spotlight)
            carGroup.add(spotlight.target)

            this.headlights.push(spotlight)
        }

        //note Backlights
        for (const i of [1, -1]) {
            const spotlight = new THREE.SpotLight(
                0xff0000,
                10,
                40,
                Math.PI / 2.3,
                0.5,
                2
            )

            const vec3 = config.car.models[model].backlights_pos
            spotlight.position.set(vec3.x * i, vec3.y, vec3.z)
            spotlight.target.position.set(vec3.x * i, vec3.y, vec3.z - 12)

            carGroup.add(spotlight)
            carGroup.add(spotlight.target)
            

            this.backlights.push(spotlight)
        }

        carGroup.position.y = 0.33 * config.car.models[model].wheel_size

        carGroup.traverse((child) => {
            if (child instanceof THREE.Mesh) child.castShadow = true
        })

        this.updateLights()
        this.mesh = carGroup
    }

    //fun - getDefaultColor()
    getDefaultColor(): THREE.ColorRepresentation {
        let color = 0xffffff

        this.chassis.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material]

                const paint = materials.find(mat => mat.name == "paint")

                if (paint instanceof THREE.MeshStandardMaterial) {
                    color = paint.color.getHex()
                }
            }
        })

        return color
    }

    //fun - setColor()
    setColor(color: THREE.ColorRepresentation): void {
        this.chassis.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material]

                const paint = materials.find(mat => mat.name == "paint")

                if (paint instanceof THREE.MeshStandardMaterial) {
                    paint.color.set(color)
                }
            }
        })
    }

    updateWheels(dt: number): void {

        this.currentWheelsSpeed = THREE.MathUtils.lerp(
            this.currentWheelsSpeed, this.throttle * 0.02 * dt, 1 - Math.exp(-5 * dt / 1000)
        )

        const currentSteer = THREE.MathUtils.lerp(
            this.wheelMesh[0]!.rotation.y, this.steer * 0.7, 1 - Math.exp(-5 * dt / 1000)
        )

        this.wheelMesh[0]!.rotation.y = currentSteer
        this.wheelMesh[1]!.rotation.y = currentSteer
        this.wheelMesh[2]!.rotateX(this.currentWheelsSpeed)
        this.wheelMesh[3]!.rotateX(this.currentWheelsSpeed)
    }

    updateLights(): void {
        this.chassis.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material]

                materials.forEach((mat) => {
                    if (mat instanceof THREE.MeshStandardMaterial) {
                        if (mat.name == "headlights" || mat.name == "backlights") {
                            mat.emissiveIntensity = this.lights ? 3 : 0
                        }
                    }
                })
            }
        })

        this.headlights.forEach((light) => {
            light.visible = this.lights
        })

        this.backlights.forEach((light) => {
            light.visible = this.lights
        })
    }

    initEngineAudio(listener: THREE.AudioListener): void {
        this.engineAudio = new EngineAudio(listener, this.mesh)
    }
    
    updateEngine(dt: number): void {
        this.engineAudio?.update(dt, this.throttle, this.model)
    }

    //fun - dispose()
    dispose(): void {
        this.engineAudio?.dispose(this.mesh)
        this.engineAudio = null
    }
}