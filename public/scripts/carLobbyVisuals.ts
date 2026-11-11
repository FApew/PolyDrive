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
    throttle: number = 0
    steer: number = 0
    currentWheelsSpeed: number = 0

    //fun - constructor()
    constructor(id: string, model: CarModelName) {
        this.id = id

        const carGroup = new THREE.Group()

        //note - Chassis
        const carChassis = models[model]!.clone(true)

        carChassis.traverse(child => {
            if (child instanceof THREE.Mesh) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => mat.clone())
                } else {
                    child.material = child.material.clone()
                }
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

        carGroup.position.y = 0.33 * config.car.models[model].wheel_size
        this.mesh = carGroup
    }

    //fun - getDefaultColor()
    getDefaultColor(): number {
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
}