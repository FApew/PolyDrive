import * as THREE from "three"
import * as CANNON from "cannon-es"
import { createNoise2D } from "simplex-noise"
import alea from "alea"

import { addDetailedPlaneBody } from "./physicsHandler"
import { genTrackLine } from "./trackGenerator";

//NOTE - Config Init
import YAML from "yaml"
import type { GameConfig } from "./types"
import configTxt from "../config/config.yaml?raw"
const config: GameConfig = YAML.parse(configTxt)

//NOTE - genTerrain
export function genTerrain(seed: number, scene: THREE.Scene, world: CANNON.World) {
    const random = alea(seed)
    const planeDim = Math.round(random() * (config.terrain.max_size - config.terrain.min_size) + config.terrain.min_size)

    const maskRandom = alea(seed + 1)
    const noise = createNoise2D(random)
    const maskNoiseFun = createNoise2D(maskRandom)

    const geometry = genGeometry(seed, planeDim, noise, maskNoiseFun);

    // Give each triangle a slightly different grass-green shade.

    const centerline = genTrackLine(seed, planeDim, scene);

    const flatCenterlineCurve = new THREE.CatmullRomCurve3(
        centerline,
        true,
        "centripetal",
        0
    )

    const flatPoints = flatCenterlineCurve.getPoints(config.track.centerline_samples)

    flatPoints.forEach(point => {
        point.setY(getHeight(point.x, -point.z, seed, noise, maskNoiseFun, 0) + 2)
    })

    const centerlineCurve = new THREE.CatmullRomCurve3(
        flatPoints,
        true,
        "centripetal",
        0
    )

    showCenterline(centerlineCurve, scene)

    const material = new THREE.MeshStandardMaterial({
        color: 0x141414,//0x8fc005,
        vertexColors: false,
        flatShading: true,
        roughness: 1,
        metalness: 0
    });

    const terrainMesh = new THREE.Mesh(geometry, material)

    terrainMesh.rotateX(- Math.PI / 2)

    addDetailedPlaneBody(terrainMesh, scene, world)
} 

//NOTE - genGeometry
function genGeometry(seed: number, planeDim: number, noise: any, maskNoiseFun: any): any {

    const planeDensity = Math.round(planeDim * config.terrain.mesh_main_density)
    const geometry = new THREE.PlaneGeometry(
        planeDim, 
        planeDim, 
        planeDensity, 
        planeDensity
    )
    const position = geometry.attributes.position

    if (!position) {
        throw new Error("Geometry has no positions")
    }

    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i)
        const y = position.getY(i)

        position.setZ(i, getHeight(x, y, seed, noise, maskNoiseFun, 1))
    }

    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(z)
        ) {
            throw new Error(
                `Invalid vertex ${i}: (${x}, ${y}, ${z})`
            );
        }
    }

    geometry.computeVertexNormals()
    
    return geometry
}

function getHeight(x: number, y: number, seed: number, noise: any, maskNoiseFun: any, topNoise: number): number {

    const mainNoise = noise(
        x * config.terrain.main_frequency, 
        y * config.terrain.main_frequency
    ) * config.terrain.main_amplitude

    const mountainsNoise = noise(
        x * config.terrain.mountains_frequency, 
        y * config.terrain.mountains_frequency
    ) * config.terrain.mountains_amplitude

    const maskNoise = maskNoiseFun(
        x * config.terrain.mountains_chance + 1000,
        y * config.terrain.mountains_chance + 1000
    )
    const mountainsMask = THREE.MathUtils.smoothstep(
        (maskNoise + 1) / 2,
        0.55,
        0.8
    )

    const backgroundNoise = noise(
        x * config.terrain.background_frequency,
        y * config.terrain.background_frequency
    ) * config.terrain.background_amplitude

    return (mainNoise * topNoise + /*mountainsNoise * mountainsMask*/ backgroundNoise)
}

function showCenterline(curve: THREE.CatmullRomCurve3, scene: THREE.Scene): void {

    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(config.track.centerline_samples))
    const material = new THREE.LineBasicMaterial({ color: 0x000000 })

    const line = new THREE.Line(geometry, material)
    line.name = "Centerline"

    scene.add(line)
}