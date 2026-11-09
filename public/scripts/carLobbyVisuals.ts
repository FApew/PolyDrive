import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import type { GLTF } from "three/addons/loaders/GLTFLoader.js"

import type { Vec3, CarModelName } from "../../shared/types"
import { config } from "../../shared/YAMLConfigs"

//note - GLTF Loader
const loader = new GLTFLoader()
const models: Partial<Record<CarModelName | "tire", THREE.Group>> = {}

//Car Models
const [ giuliaGLTF, tireGLTF ] = await Promise.all([
    loader.loadAsync("../assets/models/giulia.glb"),
    loader.loadAsync("../assets/models/tire.glb")
])

models["giulia"] = giuliaGLTF.scene
models["tire"] = tireGLTF.scene

export class carLobbyVisual {
    mesh: THREE.Group
    wheelMesh: THREE.Group[] = []

    constructor(model: CarModelName) {

        const carGroup = new THREE.Group()

        const carChassis = models[model]!.clone(true)
        carChassis.position.y = config.car.models[model].elevation
        carGroup.add(carChassis)

        for (const i of [1, -1]) {
            for (const j of [1, -1]) {
                const wheel = models["tire"]!.clone(true)
                const wheelPos: Vec3 = config.car.models[model].wheel_pos
                wheel.position.set(wheelPos.x * j, wheelPos.y, wheelPos.z * i)
                
                this.wheelMesh.push(wheel)
                carGroup.add(wheel)
            }
        }

        this.mesh = carGroup
    }
}