import * as THREE from "three"
import * as CANNON from "cannon-es"
import { createNoise2D } from "simplex-noise"
import alea from "alea"

import { addDetailedPlaneBody } from "./physicsHandler"
import { genTrackLine } from "./trackGenerator";

//NOTE - Config Init
import YAML from "yaml"
import type { GameConfig, Mode, ModeNodes, Pivot, nearTurn, SideLines } from "./types"
import configTxt from "../config/config.yaml?raw"
import { color, tan } from "three/tsl"
const config: GameConfig = YAML.parse(configTxt)

const modes: Mode[] = ["casual", "f1", "rally", "touring", "hillclimb", "drift", "karting"]

//NOTE - genTerrain()
export function genTerrain(seed: number, scene: THREE.Scene, world: CANNON.World) {
    const random = alea(seed)
    const planeDim = Math.round(random() * (config.terrain.max_size - config.terrain.min_size) + config.terrain.min_size)

    //Noise Functions
    const maskRandom = alea(seed + 1)
    const noise = createNoise2D(random)
    const maskNoiseFun = createNoise2D(maskRandom)

    //Terrain Geometry
    const geometry = genGeometry(seed, planeDim, noise, maskNoiseFun);

    //Terrain material & Mesh
    const material = new THREE.MeshStandardMaterial({
        color: 0x141414,//0x8fc005,
        vertexColors: false,
        flatShading: true,
        roughness: 1,
        metalness: 0
    });
    const terrainMesh = new THREE.Mesh(geometry, material)
    terrainMesh.rotateX(- Math.PI / 2)

    //Track Centerline
    const centerline = genTrackLine(seed, planeDim, scene);

    const flatCenterlineCurve = new THREE.CatmullRomCurve3(
        centerline.poses,
        true,
        "centripetal",
        0
    )

    const flatPoints = flatCenterlineCurve.getPoints(config.track.centerline_samples)

    //Track Length Calculation
    let sum = 0
    flatPoints.forEach((point, idx, arr) => {

        if (idx != arr.length - 1) sum += point!.distanceTo(arr[idx + 1]!)

        //Cast the flat centerline on the starter terrain
        point.setY(getHeight(point.x, -point.z, seed, noise, maskNoiseFun, 0) + 3)
    })
    console.log("Track Length:", parseFloat(sum.toFixed(2)), "m")

    console.log("Nodes:", centerline.modes.points)

    //True Centerline
    const centerlineCurve = new THREE.CatmullRomCurve3(
        flatPoints,
        true,
        "centripetal",
        0
    )
    

    const SideLines: SideLines = getSideLines(flatPoints, centerline.poses, centerline.modes, scene)

    if (config.debug.show_centerline) debugShowCenterline(centerlineCurve, scene)
    if (config.debug.show_side_lines) debugShowSidelines(SideLines, scene)
    
    addDetailedPlaneBody(terrainMesh, scene, world)
} 

//NOTE - genGeometry()
function genGeometry(seed: number, planeDim: number, noise: any, maskNoiseFun: any): any {

    //Generate THREE Geometry
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

    //Call Noise to set proper Heights
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

//NOTE - getHeight()
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

//NOTE - debugShowCenterline()
function debugShowCenterline(curve: THREE.CatmullRomCurve3, scene: THREE.Scene): void {

    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(config.track.centerline_samples))
    const material = new THREE.LineBasicMaterial({ color: 0xffffff })

    const line = new THREE.Line(geometry, material)
    line.name = "Centerline"

    scene.add(line)
}

//NOTE - debugShowSidelines()
function debugShowSidelines(sidelines: SideLines, scene: THREE.Scene): void {

    const leftCurve = new THREE.CatmullRomCurve3(
        sidelines.left,
        true,
        "centripetal",
        0
    )

    const rightCurve = new THREE.CatmullRomCurve3(
        sidelines.right,
        true,
        "centripetal",
        0
    )

    const g1 = new THREE.BufferGeometry().setFromPoints(leftCurve.getPoints(config.track.centerline_samples))
    const g2 = new THREE.BufferGeometry().setFromPoints(rightCurve.getPoints(config.track.centerline_samples))
    const material = new THREE.LineBasicMaterial({ color: 0xffffff })

    const line1 = new THREE.Line(g1, material)
    line1.name = "SideLineLeft"

    const line2 = new THREE.Line(g2, material)
    line1.name = "SideLineRight"

    scene.add(line1)
    scene.add(line2)
}

//SECTION - getSideLines()
function getSideLines(
    poses: THREE.Vector3[],
    turns: THREE.Vector3[], 
    modeNodes: ModeNodes, 
    scene: THREE.Scene
): SideLines {

    let leftPoints: THREE.Vector3[] = []
    let rightPoints: THREE.Vector3[] = []

    let nearTurns: nearTurn = {
        l: [],
        r: [],
        pivots: [],
        idx: 0,
        inTurn: false
    }

    for (let i = 0; i < turns.length * 2; i++) {
        nearTurns.l[i] = []
        nearTurns.r[i] = []
    }

    let prevInTurn = false

    //NOTE - trackSegments Handler
    poses.forEach((pose, idx) => {
        let phase = -1
        for (let i = 0; i < modeNodes.points.length; i++) {
            if (idx >= modeNodes.points[i]!) phase++
        }

        const mode = modeNodes.modes[phase]!

        const next = poses[(idx + 1) % poses.length]!;
        const prev = poses[(idx - 1 + poses.length) % poses.length]!;

        const tangent = next.clone().sub(prev).normalize();

        const perpendicular = new THREE.Vector3(
            -tangent.z,
            tangent.y,
            tangent.x
        ).normalize()

        leftPoints.push(new THREE.Vector3(
                pose.x - perpendicular.x * config.track[mode].track_width,
                pose.y - perpendicular.y * config.track[mode].track_width,
                pose.z - perpendicular.z * config.track[mode].track_width
            )
        )

        rightPoints.push(new THREE.Vector3(
                pose.x + perpendicular.x * config.track[mode].track_width,
                pose.y + perpendicular.y * config.track[mode].track_width,
                pose.z + perpendicular.z * config.track[mode].track_width
            )
        )

        prevInTurn = nearTurns.inTurn
        nearTurns.inTurn = false

        const turnDistance = helperTurnDistance(pose, turns)
        if (turnDistance < config.track.turn_size) {

            if (idx > 40 && turnDistance > config.track.inner_turn_min_distance && turnDistance < config.track.inner_turn_max_distance) {
                nearTurns.inTurn = true
                nearTurns.l[nearTurns.idx]!.push(leftPoints[idx]!)
                nearTurns.r[nearTurns.idx]!.push(rightPoints[idx]!)
            }
        }

        if (!nearTurns.inTurn && prevInTurn) {
            nearTurns.idx++
        }
    })

    if (config.debug.show_road_sections == 1) debugShowRoadLines(leftPoints, rightPoints, turns, poses)

    //NOTE - PivotCalculator
    for (let i = 0; i < nearTurns.l.length - 2; i+=2) {

        const leftCurve = new THREE.CatmullRomCurve3(
            nearTurns.l[i],
            false,
            "centripetal",
            0
        )

        const rightCurve = new THREE.CatmullRomCurve3(
            nearTurns.r[i],
            false,
            "centripetal",
            0
        )

        const leftPairCurve = new THREE.CatmullRomCurve3(
            nearTurns.l[i + 1],
            false,
            "centripetal",
            0
        )

        const rightPairCurve = new THREE.CatmullRomCurve3(
            nearTurns.r[i + 1],
            false,
            "centripetal",
            0
        )

        if (config.debug.show_turn_lines) debugShowTurnTangets(leftCurve, rightCurve, leftPairCurve, rightPairCurve)

        if (nearTurns.l[i]![0]!.distanceTo(nearTurns.l[i]![1]!) < nearTurns.r[i]![0]!.distanceTo(nearTurns.r[i]![1]!)) {
           //Left Turn

            const point = helperOverlap(leftCurve, leftPairCurve)
            if (config.debug.show_pivots) debugShowTurnPivot(point, scene)

            nearTurns.pivots.push({pivot: point, idx: i, lr: "left"})

        } else {
            //Right Turn

            const point = helperOverlap(rightCurve, rightPairCurve)
            if (config.debug.show_pivots) debugShowTurnPivot(point, scene)

            nearTurns.pivots.push({pivot: point, idx: i, lr: "right"})
        }
    }

    //NOTE - CornerFixer
    nearTurns.pivots.forEach(pivot => {
        if (pivot.lr == "left") {
            fixCorner(leftPoints, nearTurns.l, pivot, true)
            fixCorner(rightPoints, nearTurns.r, pivot, false)
        } else {
            fixCorner(rightPoints, nearTurns.r, pivot, true)
            fixCorner(leftPoints, nearTurns.l, pivot, false)
        }
    })

    if (config.debug.show_road_sections == 2) debugShowRoadLines(leftPoints, rightPoints, turns, poses)

    return {left: leftPoints, right: rightPoints}

    //NOTE - fixCorner()
    function fixCorner(sidePoints: THREE.Vector3[], nearTurnPoints: THREE.Vector3[][], pivot: Pivot, usePivot: boolean) {
        const firstTurnPoint = nearTurnPoints[pivot.idx]![0]!
        const lastTurnPoint = nearTurnPoints[pivot.idx + 1]![nearTurns.r[pivot.idx + 1]!.length - 1]!

        const avgY = (firstTurnPoint.y + lastTurnPoint.y) / 2

        const startIdx = sidePoints.indexOf(firstTurnPoint)
        const endIdx = sidePoints.indexOf(lastTurnPoint)

        if (usePivot) for (let i = startIdx; i <= endIdx; i++) {
            
            sidePoints[i]!.copy(pivot.pivot)
            sidePoints[i]!.y = avgY
        }

        /*let startFarOffset = 0
        for (let i = startIdx; i > 0; i--) {
            if (sidePoints[i]!.distanceTo(new THREE.Vector3(pivot.pivot.x, avgY, pivot.pivot.z)) < config.track.turn_smoothness) {
                startFarOffset++
            } else break
        }*/

        helperCurveSide(sidePoints, startIdx, endIdx, pivot.pivot.clone().setY(avgY), pivot.idx, nearTurnPoints, usePivot)
    }

    //NOTE - helperLerp()
    function helperCurveSide(
        sidePoints: THREE.Vector3[], 
        startIdx: number, 
        endIdx: number, 
        pivot: THREE.Vector3,
        idx: number,
        outerTurnPoints: THREE.Vector3[][],
        usePivot: boolean
    ): void {
        let farStartPoints: THREE.Vector3[] = []
        let farEndPoints: THREE.Vector3[] = []

        farStartPoints.push(sidePoints[startIdx - config.track.turn_smoothness]!)

        farEndPoints.push(sidePoints[endIdx + config.track.turn_smoothness]!)

        let curvePoints: THREE.Vector3[] = []
        if (usePivot) {
            curvePoints = curvePoints.concat(farStartPoints).concat(pivot).concat(farEndPoints)
        } else {
            const avgIdx = Math.round(
                (sidePoints.indexOf(outerTurnPoints[idx]![outerTurnPoints[idx]!.length - 1]!) + 
                sidePoints.indexOf(outerTurnPoints[idx + 1]![0]!)) / 2
            )

            curvePoints = curvePoints.concat(outerTurnPoints[idx]!)
            curvePoints = curvePoints.concat(sidePoints[avgIdx]!)
            curvePoints = curvePoints.concat(outerTurnPoints[idx + 1]!)
        }

        const curve = new THREE.CatmullRomCurve3(
            curvePoints,
            false,
            "centripetal",
            0
        )

        if (usePivot) {
            const farStartIdx = startIdx - config.track.turn_smoothness
            const farEndIdx = endIdx + config.track.turn_smoothness
            for (let i = farStartIdx; i < farEndIdx; i++) {
                const curvePoints = curve.getPoints(Math.floor(config.track.centerline_samples / 2))

                let curveIdx = Math.round((curvePoints.length - 1)* ((i - farStartIdx) / (farEndIdx - farStartIdx)))

                sidePoints[i]!.copy(curvePoints[curveIdx]!)
            }
        } else {
            for (let i = startIdx; i < endIdx; i++) {
                const curvePoints = curve.getPoints(Math.floor(config.track.centerline_samples / 2))

                let min = {val: Infinity, idx: -1}
                for (let j = 0; j < curvePoints.length; j++) {
                    const dist = curvePoints[j]!.clone().setY(0).distanceTo(sidePoints[i]!.clone().setY(0))

                    if (dist < min.val) {
                        min.val = dist
                        min.idx = j
                    }
                }

                if (min.val > 1) {
                    sidePoints[i]!.copy(curvePoints[min.idx]!)
                }
            }
        }

        if (config.debug.show_turn_lines) debugShowTurnLines(curve, scene)
    }

    //NOTE - debugShowTurnLines()
    function debugShowTurnLines(curve: THREE.CatmullRomCurve3, scene: THREE.Scene): void {

        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(config.track.centerline_samples))
        const material = new THREE.LineBasicMaterial({ color: 0x0000ff })

        const line = new THREE.Line(geometry, material)
        line.name = "Centerline"

        scene.add(line)
    }

    //NOTE - helperTurnDistance()
    function helperTurnDistance(pose: THREE.Vector3, turns: THREE.Vector3[]): number {

        let min = Infinity
        for (let i = 0; i < turns.length; i++) {
            let flatPose = new THREE.Vector3(pose.x, 0, pose.z)
            let flatTurn = new THREE.Vector3(turns[i]!.x, 0, turns[i]!.z)

            min = Math.min(min, flatPose.distanceTo(flatTurn))
        }

        return min
    }

    //NOTE - helperOverlap()
    function helperOverlap(curve1: THREE.CatmullRomCurve3, curve2: THREE.CatmullRomCurve3): any {
        let p1 = curve1.getPoints(config.track.centerline_samples / 100)
        let p2 = curve2.getPoints(config.track.centerline_samples / 100)

        p1 = p1.map(obj => {
            return new THREE.Vector3(
                obj.x,
                0,
                obj.z
            )
        })

        p2 = p2.map(obj => {
            return new THREE.Vector3(
                obj.x,
                0,
                obj.z
            )
        })

        let avgP1: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
        let avgP2: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
        let avgT1: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
        let avgT2: THREE.Vector3 = new THREE.Vector3(0, 0, 0)

        p1.forEach((pose, idx) => {
            const next = p1[(idx + 1) % p1.length]!;
            const prev = p1[(idx - 1 + p1.length) % p1.length]!;

            avgP1.add(pose)

            const tangent = next.clone().sub(prev).normalize();
            avgT1.add(tangent)
        })

        p2.forEach((pose, idx) => {
            const next = p2[(idx + 1) % p2.length]!;
            const prev = p2[(idx - 1 + p2.length) % p2.length]!;

            avgP2.add(pose)

            const tangent = next.clone().sub(prev).normalize();
            avgT2.add(tangent)
        })

        avgP1 = new THREE.Vector3(
            avgP1.x / p1.length,
            0,
            avgP1.z / p1.length,
        )

        avgP2 = new THREE.Vector3(
            avgP2.x / p2.length,
            0,
            avgP2.z / p2.length,
        )

        avgT1.normalize()
        avgT2.normalize()

        return getIntersection(avgP1, avgP2, avgT1, avgT2)

        //NOTE - getIntersection()
        function getIntersection(p1: THREE.Vector3, p2: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3): THREE.Vector3 {
            //Solve p1 + X*v1 = p2 + Y*v2
            const denominator = v1.x * v2.z - v1.z * v2.x

            const dx = p2.x - p1.x
            const dz = p2.z - p1.z

            const X = (dx * v2.z - dz * v2.x) / denominator

            return new THREE.Vector3(
                p1.x + X * v1.x,
                (p1.y + p2.y) / 2,
                p1.z + X * v1.z
            )
        }
    }

    //NOTE - debugShowRoadLines()
    function debugShowRoadLines(leftPoints: THREE.Vector3[], rightPoints: THREE.Vector3[], turns: THREE.Vector3[], poses: THREE.Vector3[]):void {
        for (let i = 0; i < leftPoints.length; i++) {
            const g = new THREE.BufferGeometry().setFromPoints([leftPoints[i]!, rightPoints[i]!])

            const distance = helperTurnDistance(poses[i]!, turns)

            let m
            if (distance < config.track.turn_size) {
                m = new THREE.LineBasicMaterial({ color: 0xff00ff })

                if (i > 40 && distance > config.track.inner_turn_min_distance && distance < config.track.inner_turn_max_distance) {
                    m = new THREE.LineBasicMaterial({ color: 0x00ffff })
                }

            } else {
                m = new THREE.LineBasicMaterial({ color: 0xffff00 })
            }

            const line = new THREE.Line(g, m)

            scene.add(line)
        }
    }

    //NOTE - debugShowTurnPivot()
    function debugShowTurnPivot(point: THREE.Vector3, scene: THREE.Scene): void {
        const g1 = new THREE.BoxGeometry(1, 1, 1)
        const m1 = new THREE.MeshBasicMaterial({ color: 0x000ff })

        const g2 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(point.x, 0, point.z), new THREE.Vector3(point.x, 25, point.z)])
        const m2 = new THREE.LineBasicMaterial({ color: 0x000ff })

        const cube = new THREE.Mesh(g1, m1)
        const line = new THREE.Line(g2, m2)
        cube.position.copy(point)
        cube.position.y = 25

        scene.add(cube)
        scene.add(line)
    }

    //NOTE - debugShowTurnTangets()
    function debugShowTurnTangets(lC: THREE.CatmullRomCurve3, lpC: THREE.CatmullRomCurve3, rC: THREE.CatmullRomCurve3, rpC: THREE.CatmullRomCurve3) {
        const g1 = new THREE.BufferGeometry().setFromPoints(lC.getPoints(config.track.centerline_samples / 20))
        const g2 = new THREE.BufferGeometry().setFromPoints(rC.getPoints(config.track.centerline_samples / 20))
        const g3 = new THREE.BufferGeometry().setFromPoints(lpC.getPoints(config.track.centerline_samples / 20))
        const g4 = new THREE.BufferGeometry().setFromPoints(rpC.getPoints(config.track.centerline_samples / 20))

        const m1 = new THREE.LineBasicMaterial({ color: 0x00ff00 })
        const m2 = new THREE.LineBasicMaterial({ color: 0xff0000 })

        const l = new THREE.Line(g1, m1)
        const r = new THREE.Line(g2, m1)
        const pl = new THREE.Line(g3, m2)
        const pr = new THREE.Line(g4, m2)
        scene.add(l)
        scene.add(r)
        scene.add(pl)
        scene.add(pr)
    }
}
//!SECTION