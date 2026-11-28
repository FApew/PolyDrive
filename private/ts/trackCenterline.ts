import * as THREE from "three"
import alea from "alea"

import type { Centerline, Segment, Point, Mode, Range, PolarPoint, ModeNodes } from "../../shared/types"

import { config } from "./config"
const cfg = config.track

const modes: Mode[] = [
    "casual",
    "rally",
    "f1",
    "touring",
    "hillclimb",
    "drift",
    "karting"
]

//fun - genTrackCenterline()
export function genTrackCenterline(seed: number, dimension: number): Centerline {
    let segments: Segment[]
    let points: Point[]

    let newSeed = seed
    do {
        const newRandom: () => number = alea(newSeed)

        segments = getSegments(newRandom)

        points = getPoints(newRandom, dimension, segments)

        newSeed++
    } while (points.length < segments.length)

    if (points.length < segments.length) throw new Error("trackGenFailed")

    const poses = points.map((point: Point) => {return point.pose})
    const modeNodes = getModeNodes(points, poses)

    const centerline: Centerline = {points, poses, modeNodes}
    return centerline
}

//FUNCTION - getSegments()
function getSegments(random: () => number): Segment[] {
    //note - Segment Number
    let segN = Math.round(random() * (cfg.segments.max - cfg.segments.min) + cfg.segments.min)
    if (segN % 2 == 1) segN += segN < cfg.segments.max ? 1 : -1 //Always Even Number
    
    const shuffledModes = arrShuffle(modes) as Mode[]

    let segments: Segment[] = []
    const currSector = {idx: 0, age: 0}

    const base = 2 * Math.PI / segN

    let sum = 0, max = 2 * Math.PI
    for (let i = 0; i < segN; i++) {
        //note Weight Calculation
        let w = base
        w += (random() * 2*cfg.max_segment_variation) - cfg.max_segment_variation
        w = Math.max (0.001, w)

        //note - Sector Handler
        if (
            currSector.age > cfg.min_sector_length &&
            segN - i > cfg.min_sector_length &&
            random() > Math.pow(cfg.change_sector_chance, currSector.age - cfg.min_sector_length)
        ) {
            currSector.age = 0
            currSector.idx++
        }
        const mode = shuffledModes[currSector.idx]!

        w *= cfg[mode].segment_weight
        segments[i] = {weight: w, mode}

        currSector.age++
        sum+=w
    }

    segments = segments.map((obj: Segment) => {
        return {weight: obj.weight / sum * max, mode: obj.mode} as Segment
    })

    let angle = 0
    segments = segments.map((obj: Segment) => {
        angle += obj.weight
        return {weight: angle - obj.weight, mode: obj.mode}
    })

    return segments

    //fun - arrShuffle()
    function arrShuffle(arr: any[]): any[] {
        const a: any[] = [...arr]
        for (let i = a.length - 1; i > 0; i--) {
            const j: number = Math.floor(random() * (i + 1)) as number

            [a[i], a[j]] = [a[j], a[i]]
        }
        return a
    }
}
//!FUNCTION

//FUNCTION - getPoints()
function getPoints(random: () => number, dimension: number, segments: Segment[]): Point[] {
    //note - RadiusConstraints
    const radiusConstr: Range = {
        min: dimension / 2 * cfg.center,
        max: dimension / 2 * (1 - cfg.border)
    }

    const polarPoints: PolarPoint[] = []
    const prevSegPointsIdx: number[] = []

    //NOTE - Cycle Segments
    let middleCross = 0, globalIdx = 0, o = 0
    for (let i = 0; i < segments.length && o < cfg.max_tries * 100; i++) {
        const nextIdx = (i + 1) % segments.length

        //note - ThetaConstraints
        const thetaConstr: Range = {
            min: segments[i]!.weight * (1 + cfg.segment_border),
            max: segments[nextIdx]!.weight * (1 - cfg.segment_border)
        }
        if (i == segments.length - 1) thetaConstr.max += 2*Math.PI

        const currMode = segments[i]!.mode

        let segPointsN = 0
        prevSegPointsIdx[i] = globalIdx

        //NOTE - Cycle Anchors
        for (let j = 0; j < cfg[currMode].max_anchor_per_segment && ++o < cfg.max_tries * 100; j++) {

            //note - Multiple Anchors Randomizer
            if (
                j > 0 && 
                (
                    Math.pow(cfg[currMode].multiple_anchors_chance, j) < random()
                    || i == segments.length - 1
                    || i == 0
                ) ||
                (middleCross > 0 && j != 0)
            ) break

            //note Theta early value
            const theta = globalIdx == 0 ? 
                (thetaConstr.max + thetaConstr.min) / 2 :
                (random() * Math.abs(thetaConstr.max - thetaConstr.min)) + thetaConstr.min

            //Uses the previous segment Mode to check the first Anchor of the new segment
            const angleCheckMode = j == 0 ?
                segments[(i - 1 + segments.length) % segments.length]!.mode :
                currMode

            let radius = -1, angle = -1, dist = -1, oo = 0
            do {
                radius = (random() * (radiusConstr.max - radiusConstr.min) + radiusConstr.min)

                //note - Last 3 Anchors Angle Calc
                if (globalIdx > 1) {
                    angle = helper3PointsAngle(
                        polarPoints[globalIdx - 2]!,
                        polarPoints[globalIdx - 1]!,
                        {r: radius, theta, idx: globalIdx, mode: currMode}
                    )
                }

                //note - Last 2 Points Distance Calc
                if (globalIdx > 0) {
                    const prevPolarPoint = polarPoints[globalIdx - 1]!

                    const [prevX, prevY] = [
                        prevPolarPoint.r * Math.cos(prevPolarPoint.theta),
                        prevPolarPoint.r * Math.sin(prevPolarPoint.theta)
                    ]

                    const [currX, currY] = [
                        radius * Math.cos(theta),
                        radius * Math.sin(theta)
                    ]

                    dist = Math.hypot(currX - prevX, currY - prevY)
                }
            } while (
                (
                    (dist != -1 && !isValidDistance(dist, currMode)) ||
                    (angle != -1 && !isValidAngle(angle, angleCheckMode))
                ) && ++oo < cfg.max_tries
            )

            //note - Segment Reversion
            //Reverts 2 segment back
            if (oo == cfg.max_tries && i > 1) {
                i -= 2
                globalIdx = prevSegPointsIdx[i + 1]!

                polarPoints.length = globalIdx
                prevSegPointsIdx.length = i + 2

                break
            }

            //NOTE - Middle Crossing Handler
            if (middleCross > 0) middleCross--

            if (
                middleCross == 0 &&
                globalIdx < segments.length - 2 &&
                globalIdx != 0 &&
                random() < cfg[currMode].middle_cross_chance
            ) {
                const crossRadius = 
                    random() * (radiusConstr.min - radiusConstr.min * cfg[currMode].middle_cross_distance) +
                    radiusConstr.min * cfg[currMode].middle_cross_distance

                //note - Repeat Angle Calc
                if (globalIdx > 1) {
                    angle = helper3PointsAngle(
                        polarPoints[globalIdx - 2]!,
                        polarPoints[globalIdx - 1]!,
                        {r: crossRadius, theta, idx: globalIdx, mode: currMode}
                    )
                }

                //note - Repeat Distance Calc
                const prevPolarPoint = polarPoints[globalIdx - 1]!

                const [prevX, prevY] = [
                    prevPolarPoint.r * Math.cos(prevPolarPoint.theta),
                    prevPolarPoint.r * Math.sin(prevPolarPoint.theta)
                ]

                const [currX, currY] = [
                    crossRadius * Math.cos(theta),
                    crossRadius * Math.sin(theta)
                ]

                dist = Math.hypot(currX - prevX, currY - prevY)

                //note - Check Validity
                if (
                        (dist == -1 || isValidDistance(dist, currMode)) &&
                        (angle == -1 || isValidAngle(angle, angleCheckMode))
                ) {
                    radius = crossRadius
                    middleCross = 3
                }
            }

            //NOTE - Segment Points Overlap Check
            //Checks the point of the PREVIOUS sector
            if (i > 1 && j == 0) {
                let lastPolarPoints = [ ...polarPoints ]
                
                //All the Points of last sector
                lastPolarPoints = lastPolarPoints.slice(prevSegPointsIdx[i - 1]! - 1)

                //Add the new Point of this
                lastPolarPoints.push({r: radius, theta, idx: globalIdx, mode: currMode})

                const lastPoints: Point[] = lastPolarPoints.map((polarPoint: PolarPoint) => {
                    return {
                        pose: new THREE.Vector3(
                            polarPoint.r * Math.cos(polarPoint.theta),
                            0,
                            polarPoint.r * Math.sin(polarPoint.theta)
                        ),
                        mode: currMode
                    }
                })

                //If more than 4 points check for overlap
                if (lastPoints.length >= 4 && helperOverlap(lastPoints)) {
                    i -= 2
                    globalIdx = prevSegPointsIdx[i + 1]!

                    polarPoints.length = globalIdx
                    prevSegPointsIdx.length = i + 2

                    break
                }
            }

            //note Store Points
            polarPoints[globalIdx] = {r: radius, theta, idx: globalIdx, mode: currMode}
            globalIdx++
            segPointsN++
        }
    }

    //Check the angle of the first point
    if (polarPoints.length > 3) {
        let angle0 = helper3PointsAngle(
            polarPoints[polarPoints.length - 1]!,
            polarPoints[0]!,
            polarPoints[1]!
        )

        o = 0
        while (!isValidAngle(angle0, "casual") && ++o < cfg.max_tries) {
            polarPoints[0]!.r = (random() * (radiusConstr.max - radiusConstr.min) + radiusConstr.min)

            angle0 = helper3PointsAngle(
                polarPoints[polarPoints.length - 1]!,
                polarPoints[0]!,
                polarPoints[1]!
            )
        }
    }

    const points: Point[] = polarPoints.map((polarPoint: PolarPoint) => {
        return {
            pose: new THREE.Vector3(
                polarPoint.r * Math.cos(polarPoint.theta),
                0,
                polarPoint.r * Math.sin(polarPoint.theta),
            ),
            mode: polarPoint.mode
        }
    })

    return points

    //fun - helper3PointsAngle()
    function helper3PointsAngle(p1: PolarPoint, p2: PolarPoint, p3: PolarPoint): number {
        const [x1, x2, x3] = [
            p1.r * Math.cos(p1.theta), 
            p2.r * Math.cos(p2.theta), 
            p3.r * Math.cos(p3.theta)
        ]

        const [y1, y2, y3] = [
            p1.r * Math.sin(p1.theta), 
            p2.r * Math.sin(p2.theta), 
            p3.r * Math.sin(p3.theta)
        ]

        const a1 = Math.atan2(y3 - y2, x3 - x2)
        const a2 = Math.atan2(y1 - y2, x1 - x2)
        const dA = Math.abs(a2 - a1)

        return Math.min(dA, 2 * Math.PI - dA) * 180 / Math.PI
    }

    //fun isValidDistance()
    function isValidDistance(dist: number, mode: Mode): boolean {
        return (
            dist > cfg[mode].anchor_distance.min &&
            dist < cfg[mode].anchor_distance.max
        )
    }

    //fun - isValidAngle()
    function isValidAngle(angle: number, mode: Mode): boolean {
        return (
            angle > cfg[mode].curve_angle.min &&
            angle < cfg[mode].curve_angle.max
        )
    }

    //fun helperOverlap()
    function helperOverlap(points: Point[], samples: number = cfg.centerline_samples, tol = 10): boolean {
        const poses = points.map((point: Point) => {return point.pose})
        const curve = new THREE.CatmullRomCurve3(
            poses,
            false,
            "centripetal",
            0
        )

        const curvePoints = curve.getPoints(samples)
        for(let i = 0; i < curvePoints.length; i++) {
            for (let j = i + 2; j < curvePoints.length; j++) {
                if (i == 0 || j == curvePoints.length) continue

                if (curvePoints[i]!.distanceTo(curvePoints[j]!) < tol) return true
            }
        }

        return false
    }
}
//!FUNCTION

//fun - getModeNodes()
function getModeNodes(points: Point[], poses: THREE.Vector3[]): ModeNodes {
    const current = {idx: 0, mode: points[0]!.mode}

    const modeNodes: ModeNodes = {
        points: [0],
        turns: [0],
        modes: [current.mode]
    }
    
    const curve = new THREE.CatmullRomCurve3(
        poses,
        true,
        "centripetal",
        0
    )
    const curvePoints = curve.getPoints(cfg.centerline_samples)

    let prev = Infinity
    curvePoints.forEach((curvePoint, idx) => {
        if (current.idx == points.length - 1) return
        const dist = curvePoint.distanceTo(points[current.idx + 1]!.pose)

        if (prev < dist) {
            current.idx++
            current.mode = points[current.idx]!.mode

            if (points[current.idx - 1]!.mode != current.mode) {
                modeNodes.points.push(idx)
                modeNodes.turns.push(current.idx)
                modeNodes.modes.push(current.mode)
            }

            prev = Infinity
        } else {
            prev = dist
        }
    })

    return modeNodes
}