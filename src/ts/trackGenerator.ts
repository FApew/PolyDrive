import * as THREE from "three"
import alea from "alea"

//NOTE - Config Init
import YAML from "yaml"
import type { GameConfig } from "./types"
import configTxt from "../config/config.yaml?raw"
const config: GameConfig = YAML.parse(configTxt)

//NOTE - genTrackLine()
export function genTrackLine(seed: number, planeDim: number, scene: THREE.Scene): THREE.CatmullRomCurve3 {
    const random = alea(seed)
    
    const segments = getSegments(random)
    showDebugSegments(segments, planeDim, scene)

    const points = getPoints(segments, random, planeDim)
    showDebugPoints(points, scene)

    const curve = new THREE.CatmullRomCurve3(
        points,
        true,
        "centripetal",
        0
    )
    showDebugPath(curve, scene)
    
    return curve
}

//NOTE - getSegments()
function getSegments(random: any): number[] {
    let segmentN = Math.round(random() * (config.track.max_segments - config.track.min_segments)) + config.track.min_segments
    if (segmentN % 2 == 1) segmentN++
    const MAX = Math.PI * 2
    const variation = segmentN * config.track.max_segment_variation

    let weights: number[] = []

    let sum = 0
    for (let i = 0; i < segmentN; i++) {
        let base = MAX / segmentN * i

        base += (random() * 2*variation) - variation

        weights[i] = base
        sum+=base
    }

    weights.map(obj => obj / sum * MAX)

    return weights
}

//NOTE - getPoints()
function getPoints(segments: number[], random: any, planeDim: number): THREE.Vector3[] {
    const maxRadius = planeDim / 2 * (1 - config.track.border)
    const minRadius = planeDim / 2 * config.track.center

    let points: any = [], middleCross = 0
    for (let i = 0; i < segments.length; i++) {
        const nextIdx = (i + 1) % segments.length

        const minTheta = segments[i]! * (1 + config.track.segment_border)
        let maxTheta = segments[nextIdx]! * (1 - config.track.segment_border)

        if (i == segments.length - 1) maxTheta += 2*Math.PI

        let theta = (random() * Math.abs(maxTheta - minTheta)) + minTheta
        let r = (random() * (maxRadius - minRadius)) + minRadius

        if (middleCross > 0) middleCross--

        if (i < segments.length - 2)
        if (random() < config.track.middle_cross_chance && middleCross == 0) {
            //theta += Math.PI
            r = random() * minRadius / 2
            middleCross = 3
        }
        
        points.push({r: r, theta: theta})
    }

    points = points.map((point: any) => {
        return new THREE.Vector3(
            point.r*Math.cos(point.theta),
            50,
            point.r*Math.sin(point.theta)
        )
    })

    return points
}

function showDebugSegments(segments: number[], planeDim: number, scene: THREE.Scene): void {
    const m = new THREE.LineBasicMaterial({ color: 0x0000ff });

    segments.forEach(point => {
        const g = new THREE.BufferGeometry().setFromPoints(
            [new THREE.Vector3(
                planeDim*Math.cos(point) / 2 * config.track.center, 
                50,
                planeDim*Math.sin(point) / 2 * config.track.center
            ), 
            new THREE.Vector3(
                planeDim*Math.cos(point) / 2 * (1 - config.track.border), 
                50, 
                planeDim*Math.sin(point) / 2 * (1 - config.track.border)
            )]
        )

        const line = new THREE.Line(g, m)
        scene.add(line)
    })

    const g1 = new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(
            0, 0,
            planeDim / 2 * config.track.center, planeDim / 2 * config.track.center
        ).getPoints(100)
    )
    const line1 = new THREE.LineLoop(g1, m)
    line1.position.y = 50
    line1.rotateX(Math.PI / 2)
    scene.add(line1)

    const g2 = new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(
            0, 0,
            planeDim / 2 * (1 - config.track.border), planeDim / 2 * (1 - config.track.border)
        ).getPoints(100)
    )
    const line2 = new THREE.LineLoop(g2, m)
    line2.position.y = 50
    line2.rotateX(Math.PI / 2)
    scene.add(line2)
}

function showDebugPoints(points: THREE.Vector3[], scene: THREE.Scene): void {
    for (let i = 0; i < points.length; i++) {
        const g = new THREE.BoxGeometry(5, 5, 5)
        const m = new THREE.MeshBasicMaterial({ color: 0xff0000 })
        const cube = new THREE.Mesh(g, m)

        cube.position.set(points[i]!.x, 50, points[i]!.z)

        scene.add(cube)
    }
}

function showDebugPath(curve: THREE.CatmullRomCurve3, scene: THREE.Scene): void {
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(500))
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00 })

    const line = new THREE.Line(geometry, material)
    line.name = "Centerline"

    scene.add(line)
}