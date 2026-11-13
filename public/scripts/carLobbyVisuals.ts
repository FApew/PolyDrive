import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

import type { Vec3, CarModelName } from "../../shared/types"
import { config } from "../../shared/YAMLConfigs"

//note - GLTF Loader
const loader = new GLTFLoader()
const models: Partial<Record<CarModelName | "tire", THREE.Group>> = {}

//Car Models
const [ giuliaGLTF, f40GLTF, tireGLTF ] = await Promise.all([
    loader.loadAsync("../assets/models/giulia.glb"),
    loader.loadAsync("../assets/models/f40.glb"),
    loader.loadAsync("../assets/models/tire.glb")
])

models["giulia"] = giuliaGLTF.scene
models["f40"] = f40GLTF.scene
models["tire"] = tireGLTF.scene

//CLASS - carLobbyVisual
export class carLobbyVisual {
    id: string
    mesh: THREE.Group

    chassis: THREE.Group
    wheelMesh: THREE.Group[] = []

    headlights: THREE.SpotLight[] = []
    backlights: THREE.SpotLight[] = []

    throttle: number = 0
    steer: number = 0
    lights: boolean = false
    currentWheelsSpeed: number = 0

    //fun - constructor()
    constructor(id: string, model: CarModelName) {
        this.id = id

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
}