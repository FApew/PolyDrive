import * as THREE from "three"
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import alea from "alea"

//NOTE - Config Init
import YAML from "yaml"
import type { GameConfig, Mode, Segment } from "./types"
import configTxt from "../config/config.yaml?raw"
import { rand } from "three/tsl"
const config: GameConfig = YAML.parse(configTxt)

let modes: Mode[] = ["casual", "f1", "rally", "touring", "hillclimb", "drift", "karting"]

//NOTE - genTrackLine()
export function genTrackLine(seed: number, planeDim: number, scene: THREE.Scene): THREE.Vector3[] {
    const random = alea(seed)
    
    const segments = getSegments(random)
    if (config.debug.show_segments) showDebugSegments(segments, planeDim, scene)

    const points = getPoints(segments, random, planeDim)
    if (config.debug.show_points) showDebugPoints(points, scene)

    if (config.debug.show_centerline) showDebugPath(points, scene)
    
    return points
}

//NOTE - getSegments()
function getSegments(random: any): Segment[] {
    let segmentN = Math.round(random() * (config.track.max_segments - config.track.min_segments)) + config.track.min_segments
    if (segmentN % 2 == 1) {
        if (segmentN < config.track.max_segments) {segmentN++}
        else {segmentN--}
    }
    console.log("segmentN:", segmentN)

    const MAX = Math.PI * 2
    const variation = segmentN * config.track.max_segment_variation

    let shuffledModes = arrShuffle(modes)

    let weights: Segment[] = []
    let sector = {i: 0, age: 0}

    let sum = 0
    for (let i = 0; i < segmentN; i++) {
        let base = MAX / segmentN

        base += (random() * 2 * variation / segmentN ) - variation / segmentN
        base = Math.max(0.001, base)

        if (
            random() > Math.pow(config.track.change_sector_chance, sector.age - config.track.min_sector_length) && 
            sector.age > config.track.min_sector_length &&
            segmentN - i > config.track.min_sector_length
        ) {
            sector.age = 0
            sector.i++
        }
        base *= config.track[shuffledModes[sector.i]!].segment_weight

        weights[i] = {weight: base, mode: shuffledModes[sector.i]!}
        sector.age++

        sum+=base
    }

    weights = weights.map(obj => {
        return {weight: obj.weight / sum * MAX, mode: obj.mode}
    })

    let angle = 0
    weights = weights.map(obj => {
        angle += obj.weight
        return {weight: angle - obj.weight, mode: obj.mode}
    })

    return weights

    function arrShuffle(arr: any[]): Mode[] {
        const a = [...arr]
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));

            [a[i], a[j]] = [a[j], a[i]]
        }
        return a
    }
}

//NOTE - getPoints()
function getPoints(segments: Segment[], random: any, planeDim: number): THREE.Vector3[] {
    const maxRadius = planeDim / 2 * (1 - config.track.border)
    const minRadius = planeDim / 2 * config.track.center

    let points: any[] = [], middleCross = 0, OO = 0, currentIdx = 0, pSegmentPoints = []
    const stTime = Date.now()

    for (let i = 0; i < segments.length && OO < 50000; i++) {
        const nextIdx = (i + 1) % segments.length

        const minTheta = segments[i]!.weight * (1 + config.track.segment_border)

        let maxTheta = segments[nextIdx]!.weight * (1 - config.track.segment_border)
        if (i == segments.length - 1) maxTheta += 2*Math.PI

        const currentMode: Mode = segments[i]!.mode

        let segmentPoints = 0
        pSegmentPoints[i] = currentIdx
        for (let j = 0; j < config.track[currentMode].max_anchor_per_segment && ++OO < 50000; j++) {

            if (
                j > 0 && 
                (Math.pow(config.track[currentMode].multiple_anchors_chance, j) < random() || i == segments.length - 1 || i == 0) ||
                (middleCross > 0 && j != 0) 
            ) break

            const theta = (
                currentIdx == 0 ? 
                (maxTheta + minTheta ) / 2 :
                (random() * Math.abs(maxTheta - minTheta)) + minTheta
            )

            let r, angle = -1, dist = -1, o = 0
            do {
                r = (random() * (maxRadius - minRadius)) + minRadius

                if (currentIdx > 1) angle = helperCalcAngle(points[currentIdx - 2], points[currentIdx - 1], {r: r, theta: theta})
                if (currentIdx > 0) {
                    const [pX, pY] = [points[currentIdx - 1].r * Math.cos(points[currentIdx - 1].theta), points[currentIdx - 1].r * Math.sin(points[currentIdx - 1].theta)]
                    const [x, y] = [r * Math.cos(theta), r * Math.sin(theta)]

                    dist = Math.hypot(x - pX, y - pY)
                }

            } while (
                ((dist != -1 && (dist > config.track[currentMode].max_anchor_distance || dist < config.track[currentMode].min_anchor_distance)) ||

                (angle != -1 && (angle < config.track[currentMode].min_curve_angle || angle > config.track[currentMode].max_curve_angle))) &&
                
                ++o < config.track.max_tries
            )

            if (o == config.track.max_tries && i > 1) {
                i -= 2
                //console.log("I Reverted", pSegmentPoints[i + 1],pSegmentPoints)
                currentIdx = pSegmentPoints[i + 1]!
                points.length = currentIdx
                pSegmentPoints.length = i + 2
                break
            }

            if (middleCross > 0) middleCross--

            if (
                currentIdx < segments.length - 2 && 
                currentIdx != 0 &&
                random() < config.track[currentMode].middle_cross_chance && 
                middleCross == 0
            ) {
                const crossRadius = (
                    random() * (minRadius - minRadius * config.track[currentMode].middle_cross_distance) + 
                    minRadius * config.track[currentMode].middle_cross_distance
                )

                if (currentIdx > 1) angle = helperCalcAngle(points[currentIdx - 2], points[currentIdx - 1], {r: crossRadius, theta: theta})

                const [pX, pY] = [points[currentIdx - 1].r * Math.cos(points[currentIdx - 1].theta), points[currentIdx - 1].r * Math.sin(points[currentIdx - 1].theta)]
                const [x, y] = [crossRadius * Math.cos(theta), crossRadius * Math.sin(theta)]

                dist = Math.hypot(x - pX, y - pY)
                
                if (
                    (dist == -1 || (dist < config.track[currentMode].max_anchor_distance && dist > config.track[currentMode].min_anchor_distance)) &&
                    (angle == -1 || (angle > config.track[currentMode].min_curve_angle && angle < config.track[currentMode].max_curve_angle))
                ) {
                    r = crossRadius
                    middleCross = 3
                }
            }

            if (i > 1 && j == 0) {
                let lastPoints = [ ...points ]
                lastPoints = lastPoints.slice(pSegmentPoints[i - 1]! - 1)
                lastPoints.push({r: r, theta: theta, i: currentIdx, m: currentMode})
                if ( lastPoints.length > 0) {
                    
                    //console.log(lastPoints, segmentPoints, pSegmentPoints)
                }
                

                lastPoints = lastPoints.map((point: any) => {
                    return new THREE.Vector3(
                        point.r*Math.cos(point.theta),
                        70,
                        point.r*Math.sin(point.theta)
                    )
                })

                if (lastPoints.length >= 4 && helperOverlap(lastPoints)) {
                    i -= 2
                    //console.log("OverlapDetected", pSegmentPoints[i + 1],pSegmentPoints)
                    currentIdx = pSegmentPoints[i + 1]!
                    points.length = currentIdx
                    pSegmentPoints.length = i + 2
                    break
                }
            }
            
            points[currentIdx] = {r: r, theta: theta, i: currentIdx, m: currentMode}
            currentIdx++
            segmentPoints++
        }
    }

    let angle0 = helperCalcAngle(points[points.length - 1], points[0], points[1]), o = 0
    while ((angle0 < config.track.casual.min_curve_angle || angle0 > config.track.casual.max_curve_angle) && ++o < config.track.max_tries) {
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

    console.log(OO, Date.now() - stTime)

    return points

    function helperCalcAngle(p1: any, p2: any, p3: any): number {
        const [x1, x2, x3] = [p1.r*Math.cos(p1.theta), p2.r*Math.cos(p2.theta), p3.r*Math.cos(p3.theta)]
        const [y1, y2, y3] = [p1.r*Math.sin(p1.theta), p2.r*Math.sin(p2.theta), p3.r*Math.sin(p3.theta)]

        const a1 = Math.atan2(y1 - y2, x1 - x2);
        const a2 = Math.atan2(y3 - y2, x3 - x2);

        const diff = Math.abs(a1 - a2);
        return Math.min(diff, 2 * Math.PI - diff) * 180 / Math.PI;
    }

    function helperOverlap(points: THREE.Vector3[], samples: number = config.track.centerline_samples * 10, tol: number = 1) {
        const curve = new THREE.CatmullRomCurve3(
            points,
            false,
            "centripetal",
            0
        )
        const p = curve.getPoints(samples)

        for (let i = 0; i < p.length; i++) {
            for (let j = i + 30; j < p.length; j++) {

                if (i == 0 || j == p.length) continue

                if (p[i]!.distanceTo(p[j]!) < tol) return true
            }
        }

        return false
    }
}

function showDebugSegments(segments: Segment[], planeDim: number, scene: THREE.Scene): void {
    const m = new THREE.LineBasicMaterial({ color: 0x0000ff });

    segments.forEach((point, idx) => {
        const g = new THREE.BufferGeometry().setFromPoints(
            [new THREE.Vector3(
                planeDim*Math.cos(point.weight) / 2 * config.track.center, 
                70,
                planeDim*Math.sin(point.weight) / 2 * config.track.center
            ), 
            new THREE.Vector3(
                planeDim*Math.cos(point.weight) / 2 * (1 - config.track.border), 
                70, 
                planeDim*Math.sin(point.weight) / 2 * (1 - config.track.border)
            )]
        )
        let color = 0xffffff
        if (idx != 0) {
            const COLORLIST = [0x9ad24b, 0xff1e00, 0xcd7823, 0x11bddf, 0x95d0cc, 0xffdb4d, 0xff7a66]
            color = COLORLIST[modes.indexOf(point.mode)]!
        }
        const m = new THREE.MeshBasicMaterial({ color });

        const line = new THREE.Line(g, m)
        scene.add(line)

        const g1 = new THREE.BoxGeometry(10, 10, 10)
        

        const cube = new THREE.Mesh(g1, m)
        cube.position.set(
                planeDim*Math.cos(point.weight) / 2 * (1 - config.track.border), 
                70, 
                planeDim*Math.sin(point.weight) / 2 * (1 - config.track.border)
            )

        
        scene.add(cube)
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

        const label = document.createElement("div");
        label.textContent = `N: ${i}`;
        label.style.color = "white";
        label.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
        label.style.padding = "4px 8px";
        label.style.borderRadius = "4px";

        const labelObject = new CSS2DObject(label);

        labelObject.position.set(0, 5, 0);

        cube.add(labelObject);  

        scene.add(cube)
    }
}

function showDebugPath(points: THREE.Vector3[], scene: THREE.Scene): void {
    const curve = new THREE.CatmullRomCurve3(
        points,
        true,
        "centripetal",
        0
    )

    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(500))
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00 })

    const line = new THREE.Line(geometry, material)
    line.name = "Centerline"

    scene.add(line)
}