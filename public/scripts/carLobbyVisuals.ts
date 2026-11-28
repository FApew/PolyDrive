
import * as THREE from "three"
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

import type { CarModelName } from "../../shared/types"
import { config } from "../../shared/YAMLConfigs"
import { EngineAudio } from "./engineAudio"

// GLTF Loader
const modelsLoader = new GLTFLoader()

// Car Models
const [giuliaGLTF, f40GLTF, targa4sGLTF, tireGLTF] = await Promise.all([
    modelsLoader.loadAsync("/models/giulia.glb"),
    modelsLoader.loadAsync("/models/f40.glb"),
    modelsLoader.loadAsync("/models/targa4s.glb"),
    modelsLoader.loadAsync("/models/tire.glb")
])

const models: Record<CarModelName | "tire", THREE.Group> = {
    giulia: giuliaGLTF.scene,
    f40: f40GLTF.scene,
    targa4s: targa4sGLTF.scene,
    tire: tireGLTF.scene
}

// CLASS - CarLobby
export class CarLobby {
    id: string
    model: CarModelName

    mesh: THREE.Group

    private chassis: THREE.Group
    private wheelMesh: THREE.Group[] = []

    private headlights: THREE.SpotLight[] = []
    private backlights: THREE.SpotLight[] = []

    usernameLabel: HTMLDivElement

    throttle: number = 0
    steer: number = 0
    lights: boolean = false

    private currentWheelsSpeed: number = 0
    private currentRPM: number = 0

    private engineAudio: EngineAudio | null = null

    // Constructor
    constructor(id: string, model: CarModelName) {
        this.id = id
        this.model = model

        const carGroup = new THREE.Group()

        // Chassis
        const carChassis = models[model]!.clone(true)

        carChassis.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => mat.clone())
                } else {
                    child.material = child.material.clone()
                }

                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material]

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

        // Wheels
        for (const i of [1, -1]) {
            for (const j of [1, -1]) {
                const wheel = models["tire"]!.clone(true)
                const wheelPos: THREE.Vector3 = config.car.models[model].wheel_pos

                wheel.position.set(
                    wheelPos.x * j,
                    wheelPos.y,
                    wheelPos.z * i
                )

                const s = config.car.models[model].wheel_size
                wheel.scale.set(s, s, s)

                this.wheelMesh.push(wheel)
                carGroup.add(wheel)
            }
        }

        // Headlights
        for (const i of [1, -1]) {
            const spotlight = new THREE.SpotLight(
                0xffffff,
                70,
                40,
                Math.PI / 4,
                0.5,
                2
            )

            const vec3 = config.car.models[model].headlights_pos

            spotlight.position.set(vec3.x * i, vec3.y, vec3.z)
            spotlight.target.position.set(
                vec3.x * i,
                vec3.y,
                vec3.z + 12
            )

            carGroup.add(spotlight)
            carGroup.add(spotlight.target)

            this.headlights.push(spotlight)
        }

        // Backlights
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
            spotlight.target.position.set(
                vec3.x * i,
                vec3.y,
                vec3.z - 12
            )

            carGroup.add(spotlight)
            carGroup.add(spotlight.target)

            this.backlights.push(spotlight)
        }

        //Username Label
        this.usernameLabel = document.createElement("div")
        this.usernameLabel.classList.add("usernameLabel")
        this.usernameLabel.innerHTML = "._."
        
        const label = new CSS2DObject(this.usernameLabel)
        label.position.set(0, 1.4, 0)
        carGroup.add(label)

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
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material]

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
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material]

                const paint = materials.find(mat => mat.name == "paint")

                if (paint instanceof THREE.MeshStandardMaterial) {
                    paint.color.set(color)
                }
            }
        })
    }

    //fun - updateWheels()
    updateWheels(dt: number): void {
        this.currentWheelsSpeed = THREE.MathUtils.lerp(
            this.currentWheelsSpeed,
            this.currentRPM > 1200 * 1.2
                ? dt * this.currentRPM * 2 * Math.PI / 60
                : 0,
            1 - Math.exp(-5 * dt / 1000)
        )

        const currentSteer = THREE.MathUtils.lerp(
            this.wheelMesh[0]!.rotation.y,
            this.steer * 0.7,
            1 - Math.exp(-5 * dt / 1000)
        )

        this.wheelMesh[0]!.rotation.y = currentSteer
        this.wheelMesh[1]!.rotation.y = currentSteer

        this.wheelMesh[2]!.rotateX(this.currentWheelsSpeed / 8000)
        this.wheelMesh[3]!.rotateX(this.currentWheelsSpeed / 8000)
    }

    //fun - updateLights()
    updateLights(): void {
        this.chassis.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material]

                materials.forEach((mat) => {
                    if (mat instanceof THREE.MeshStandardMaterial) {
                        if (mat.name == "headlights" || mat.name == "backlights") {
                            mat.emissiveIntensity = this.lights ? 3 : 0
                        }
                    }
                })
            }
        })

        this.headlights.forEach(light => {
            light.visible = this.lights
        })

        this.backlights.forEach(light => {
            light.visible = this.lights
        })
    }

    //fun - initEngineAudio()
    initEngineAudio(listener: THREE.AudioListener): void {
        this.engineAudio?.dispose()
        this.engineAudio = new EngineAudio(listener, this.mesh, this.model)
    }

    //fun - startEngineAudio()
    async startEngineAudio(): Promise<void> {
        await this.engineAudio?.start()
        //this.engineAudio?.setGear(0)
    }

    //fun - updateEngine()
    updateEngine(dt: number, master: number): void {
        if (this.engineAudio) {
            this.engineAudio.setThrottle(this.throttle)
            this.currentRPM = this.engineAudio.rpm
            this.engineAudio.update(master, dt / 1000)
            return
        }

        const idleRPM = 900
        const revLimit = 7000
        const targetRPM = this.throttle > 0 ? THREE.MathUtils.lerp(idleRPM, revLimit, 0.82) : idleRPM
        const smoothing =  this.throttle > 0 ? 1 - Math.exp(-3 * dt / 1000) : 1 - Math.exp(-1.5 * dt / 1000)

        this.currentRPM = THREE.MathUtils.lerp(
            this.currentRPM,
            targetRPM,
            smoothing
        )
    }

    //xfun - triggerEngineShift()
    /*triggerEngineShift(): void {
        this.engineAudio?.setTransmissionMode("automatic")
        //this.engineAudio?.shiftUp()
    }*/

    //fun - dispose()
    dispose(): void {
        this.engineAudio?.dispose()
        this.engineAudio = null
        this.usernameLabel.remove()
    }
}
