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
    console.log("segmentN:", segmentN)

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
    const maxDistance = (maxRadius - minRadius) / config.track.max_anchor_distance

    let points: any = [], middleCross = 0
    for (let i = 0; i < segments.length; i++) {
        const nextIdx = (i + 1) % segments.length

        const minTheta = segments[i]! * (1 + config.track.segment_border)
        let maxTheta = segments[nextIdx]! * (1 - config.track.segment_border)

        if (i == segments.length - 1) maxTheta += 2*Math.PI

        const theta = (
            i == 0 ? 
            (maxTheta - minTheta ) / 2 :
            (random() * Math.abs(maxTheta - minTheta)) + minTheta
        )

        let r, angle = -1, o = 0
        do {
            r = (random() * (maxRadius - minRadius)) + minRadius
            if (i > 1) angle = helperCalcAngle(points[i - 2], points[i - 1], {r: r, theta: theta})
        } while (
            (i > 0 && Math.abs(r - points[i - 1].r) > maxDistance) ||
            (angle == -1 || angle < config.track.min_curve_angle || angle > config.track.max_curve_angle) &&
            ++o < config.track.max_tries
        )

        //if (i > 2) console.log(helperCalcAngle(points[i - 2], points[i - 1], {r: r, theta: theta}), i, o)

        if (o == config.track.max_tries && i > 1) {
            i-=2
            continue
        }
        
        if (middleCross > 0) middleCross--


        if (
            i < segments.length - 2 && 
            i != 0 &&
            random() < config.track.middle_cross_chance && 
            middleCross == 0
        ) {
            let crossRadius = random() * (minRadius - minRadius * config.track.middle_cross_distance) + minRadius * config.track.middle_cross_distance
            if (i > 1) angle = helperCalcAngle(points[i - 2], points[i - 1], {r: r, theta: theta})
            
            if (
                Math.abs(crossRadius - points[i - 1].r) < maxDistance &&
                (angle == -1 || angle < config.track.min_curve_angle || angle > config.track.max_curve_angle)
            ) {
                r = crossRadius
                middleCross = 3
            }
        }
        
        points[i] = {r: r, theta: theta}
    }

    let angle0 = helperCalcAngle(points[points.length - 1], points[0], points[1]), o = 0
    while ((angle0 < config.track.min_curve_angle || angle0 > config.track.max_curve_angle) && ++o < config.track.max_tries) {
        points[0].r = (random() * (maxRadius - minRadius)) + minRadius

        angle0 = helperCalcAngle(points[points.length - 1], points[0], points[1])
    }

    points = points.map((point: any) => {
        return new THREE.Vector3(
            point.r*Math.cos(point.theta),
            70,
            point.r*Math.sin(point.theta)
        )
    })

    return points

    function helperCalcAngle(p1: any, p2: any, p3: any): number {
        const [x1, x2, x3] = [p1.r*Math.cos(p1.theta), p2.r*Math.cos(p2.theta), p3.r*Math.cos(p3.theta)]
        const [y1, y2, y3] = [p1.r*Math.sin(p1.theta), p2.r*Math.sin(p2.theta), p3.r*Math.sin(p3.theta)]

        const a1 = Math.atan2(y1 - y2, x1 - x2);
        const a2 = Math.atan2(y3 - y2, x3 - x2);

        const diff = Math.abs(a1 - a2);
        return Math.min(diff, 2 * Math.PI - diff) * 180 / Math.PI;
    }
}

function showDebugSegments(segments: number[], planeDim: number, scene: THREE.Scene): void {
    const m = new THREE.LineBasicMaterial({ color: 0x0000ff });

    segments.forEach(point => {
        const g = new THREE.BufferGeometry().setFromPoints(
            [new THREE.Vector3(
                planeDim*Math.cos(point) / 2 * config.track.center, 
                70,
                planeDim*Math.sin(point) / 2 * config.track.center
            ), 
            new THREE.Vector3(
                planeDim*Math.cos(point) / 2 * (1 - config.track.border), 
                70, 
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
    line1.position.y = 70
    line1.rotateX(Math.PI / 2)
    scene.add(line1)

    const g2 = new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(
            0, 0,
            planeDim / 2 * (1 - config.track.border), planeDim / 2 * (1 - config.track.border)
        ).getPoints(100)
    )
    const line2 = new THREE.LineLoop(g2, m)
    line2.position.y = 70
    line2.rotateX(Math.PI / 2)
    scene.add(line2)
}

function showDebugPoints(points: THREE.Vector3[], scene: THREE.Scene): void {
    for (let i = 0; i < points.length; i++) {
        const g = new THREE.BoxGeometry(5, 5, 5)

        const t = (i - 1) / (points.length - 1);
        let color = new THREE.Color().setHSL(t, 1, 0.5);
        if (i == 0) color.setHex(0xffffff)

        const m = new THREE.MeshBasicMaterial({ color });

        const cube = new THREE.Mesh(g, m)

        cube.position.set(points[i]!.x, 70, points[i]!.z)

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