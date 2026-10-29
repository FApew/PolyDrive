import * as THREE from "three"
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import alea from "alea"

//note - Config Init
import YAML from "yaml"
import type { GameConfig, Mode, Segment, Point, ModeNodes } from "./types"
import configTxt from "../config/config.yaml?raw"
const config: GameConfig = YAML.parse(configTxt)

const modes: Mode[] = ["casual", "f1", "rally", "touring", "hillclimb", "drift", "karting"]

//fun - genTrackLine()
export function genTrackLine(seed: number, planeDim: number, scene: THREE.Scene): {poses: THREE.Vector3[], modes: ModeNodes} {
    const random = alea(seed)
    const stTime = Date.now()
    
    //Points and Segments Array
    let points: Point[]
    let segments: Segment[]
    

    //Do While to try everything maximum of <config.track.max_tries> times
    let o = 0
    do {
        //Segment generation
        segments = getSegments(random)

        //Points Generation
        points = getPoints(segments, random, planeDim)
        o++
    } while (points.length < segments.length && o < config.track.max_tries) 

    console.log("Segments:", segments.length)
    console.log("Elapsed:", Date.now() - stTime, "ms")

    //Track generation failed
    if (points.length < segments.length) throw new Error("hell nahh")

    const poses = points.map(point => {
        return new THREE.Vector3(
            point.pose.x,
            point.pose.y,
            point.pose.z
        )
    })

    let modeNodes: ModeNodes = getModeNodes(points, poses)

    //Debugging toggles
    if (config.debug.show_segments) showDebugSegments(segments, planeDim, scene)
    if (config.debug.show_points) showDebugPoints(poses, scene)
    if (config.debug.show_floating_centerline) showDebugPath(poses, scene)
    
    return {poses: poses, modes: modeNodes}
}

//FUNCTION - getSegments()
function getSegments(random: any): Segment[] {
    //note - segmentN Calculator
    let segmentN = Math.round(random() * (config.track.max_segments - config.track.min_segments)) + config.track.min_segments
    if (segmentN % 2 == 1) {
        if (segmentN < config.track.max_segments) {segmentN++}
        else {segmentN--}
    }

    //Randomness Consts
    const MAX = Math.PI * 2
    const variation = segmentN * config.track.max_segment_variation

    //Shuffle the orders of available modes
    let shuffledModes = arrShuffle(modes)

    let weights: Segment[] = []
    let sector = {i: 0, age: 0}

    let sum = 0
    for (let i = 0; i < segmentN; i++) {
        let base = MAX / segmentN

        //Base segment value (weight = 1)
        base += (random() * 2 * variation / segmentN ) - variation / segmentN
        base = Math.max(0.001, base)

        //note - Mode Changer
        if (
            random() > Math.pow(config.track.change_sector_chance, sector.age - config.track.min_sector_length) && 
            sector.age > config.track.min_sector_length &&
            segmentN - i > config.track.min_sector_length
        ) {
            sector.age = 0
            sector.i++
        }

        //Chance sector size relaative to the sector
        base *= config.track[shuffledModes[sector.i]!].segment_weight

        weights[i] = {weight: base, mode: shuffledModes[sector.i]!}
        sector.age++ //Age the sector

        sum+=base
    }

    //Map the weights to normalize them
    weights = weights.map(obj => {
        return {weight: obj.weight / sum * MAX, mode: obj.mode}
    })

    let angle = 0
    weights = weights.map(obj => { //Normalize angle units
        angle += obj.weight
        return {weight: angle - obj.weight, mode: obj.mode}
    })

    return weights

    //fun - arrShuffle()
    function arrShuffle(arr: any[]): Mode[] {
        const a = [...arr]
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));

            [a[i], a[j]] = [a[j], a[i]]
        }
        return a
    }
}
//!FUNCTION

//FUNCTION - getPoints()
function getPoints(segments: Segment[], random: any, planeDim: number): Point[] {
    const maxRadius = planeDim / 2 * (1 - config.track.border)
    const minRadius = planeDim / 2 * config.track.center

    let points: any[] = [], middleCross = 0, OO = 0, currentIdx = 0, pSegmentPoints = []

    //note - Segments FOR loop
    for (let i = 0; i < segments.length && OO < config.track.max_tries * 100; i++) {
        const nextIdx = (i + 1) % segments.length

        //MinTheta calculation
        const minTheta = segments[i]!.weight * (1 + config.track.segment_border)

        //MaxTheta calculation and normalization
        let maxTheta = segments[nextIdx]!.weight * (1 - config.track.segment_border)
        if (i == segments.length - 1) maxTheta += 2*Math.PI

        const currentMode: Mode = segments[i]!.mode

        let segmentPoints = 0 //Local counter for points inside a segment
        pSegmentPoints[i] = currentIdx //Store the index of the first point in a sector ( used for reverts )

        //note Points FOR loop
        for (let j = 0; j < config.track[currentMode].max_anchor_per_segment && ++OO < config.track.max_tries * 100; j++) {

            //Generate only one point by chance
            if (
                j > 0 && 
                (Math.pow(config.track[currentMode].multiple_anchors_chance, j) < random() || i == segments.length - 1 || i == 0) ||
                (middleCross > 0 && j != 0) 
            ) break

            //note - THETA first calculation
            const theta = (
                currentIdx == 0 ? 
                (maxTheta + minTheta ) / 2 :
                (random() * Math.abs(maxTheta - minTheta)) + minTheta
            )

            //note - Radius calculation loop
            let r, angle = -1, dist = -1, o = 0
            do {
                r = (random() * (maxRadius - minRadius)) + minRadius

                //Calculate Angle if this is at least the 3 point
                if (currentIdx > 1) angle = helperCalcAngle(
                    points[currentIdx - 2], //Second to last point
                    points[currentIdx - 1], //Last point
                    {r: r, theta: theta} //Current Point
                )

                //Calculate Distance if this is at least the 2 point
                if (currentIdx > 0) {
                    const [pX, pY] = [points[currentIdx - 1].r * Math.cos(points[currentIdx - 1].theta), points[currentIdx - 1].r * Math.sin(points[currentIdx - 1].theta)]
                    const [x, y] = [r * Math.cos(theta), r * Math.sin(theta)]

                    dist = Math.hypot(x - pX, y - pY)
                }
            } while (
                (
                    (
                        dist != -1 && ( //Distance based Checks
                            dist > config.track[currentMode].max_anchor_distance || 
                            dist < config.track[currentMode].min_anchor_distance
                        )
                    ) || (
                        angle != -1 && ( //Angle based Checks
                            angle < config.track[currentMode].min_curve_angle || 
                            angle > config.track[currentMode].max_curve_angle
                        )
                    )
                ) && ++o < config.track.max_tries
            )

            //note - Sector Reversion
            //Revert to 2 previous sectors if no points are available
            if (o == config.track.max_tries && i > 1) {
                i -= 2
                currentIdx = pSegmentPoints[i + 1]!
                points.length = currentIdx
                pSegmentPoints.length = i + 2
                break
            }

            if (middleCross > 0) middleCross--

            //note - Middle Cross IF
            if (
                currentIdx < segments.length - 2 &&  //No last 2 points
                currentIdx != 0 && //No first point
                random() < config.track[currentMode].middle_cross_chance && //Chance
                middleCross == 0 //U can middleCross
            ) {
                //note - crossRadius Calculation
                const crossRadius = (
                    random() * (minRadius - minRadius * config.track[currentMode].middle_cross_distance) + 
                    minRadius * config.track[currentMode].middle_cross_distance
                )

                //Get the new angle
                if (currentIdx > 1) angle = helperCalcAngle(
                    points[currentIdx - 2], points[currentIdx - 1], 
                    {r: crossRadius, theta: theta}
                )

                //Get the new distance
                const [pX, pY] = [points[currentIdx - 1].r * Math.cos(points[currentIdx - 1].theta), points[currentIdx - 1].r * Math.sin(points[currentIdx - 1].theta)]
                const [x, y] = [crossRadius * Math.cos(theta), crossRadius * Math.sin(theta)]
                dist = Math.hypot(x - pX, y - pY)
                
                //IF to check validity of new distance and new angle
                //If distance OR angle are invalid.. just use old radius
                if (
                    (
                        dist == -1 || (
                            dist < config.track[currentMode].max_anchor_distance && 
                            dist > config.track[currentMode].min_anchor_distance
                        )
                    ) && (
                        angle == -1 || (
                            angle > config.track[currentMode].min_curve_angle && 
                            angle < config.track[currentMode].max_curve_angle
                        )
                    )
                ) {
                    r = crossRadius
                    middleCross = 3
                }
            }

            //note - Overlap check
            //Checks if the last sector has overlaps
            if (i > 1 && j == 0) {
                let lastPoints = [ ...points ]
                lastPoints = lastPoints.slice(pSegmentPoints[i - 1]! - 1) //Get all the points from last secotr
                lastPoints.push({r: r, theta: theta, i: currentIdx, m: currentMode}) //Add the first one form the current

                //Map the point array from {radius, theta} to {x, y, z}
                lastPoints = lastPoints.map((point: any) => {
                    return new THREE.Vector3(
                        point.r*Math.cos(point.theta),
                        70,
                        point.r*Math.sin(point.theta)
                    )
                })

                //If at least 4 elements are present check for any invalid overlap
                //Revert if any overlap is found
                if (lastPoints.length >= 4 && helperOverlap(lastPoints)) {
                    i -= 2
                    currentIdx = pSegmentPoints[i + 1]!
                    points.length = currentIdx
                    pSegmentPoints.length = i + 2
                    break
                }
            }
            
            points[currentIdx] = {r: r, theta: theta, i: currentIdx, m: currentMode} //Save the last point
            currentIdx++ //Increment gloabl index
            segmentPoints++ //Increment local point count
        }
    }

    if (points.length > 3) {
        let angle0 = helperCalcAngle(points[points.length - 1], points[0], points[1]), o = 0
        while ((angle0 < config.track.casual.min_curve_angle || angle0 > config.track.casual.max_curve_angle) && ++o < config.track.max_tries) {
            points[0].r = (random() * (maxRadius - minRadius)) + minRadius

            angle0 = helperCalcAngle(points[points.length - 1], points[0], points[1])
        }
    }

    points = points.map((point: any) => {
        return {
            pose: new THREE.Vector3(
                point.r*Math.cos(point.theta),
                70,
                point.r*Math.sin(point.theta)
            ),
            mode: point.m
        }
    })

    return points

    //fun - helperCalcAngle()
    function helperCalcAngle(p1: any, p2: any, p3: any): number {
        const [x1, x2, x3] = [p1.r*Math.cos(p1.theta), p2.r*Math.cos(p2.theta), p3.r*Math.cos(p3.theta)]
        const [y1, y2, y3] = [p1.r*Math.sin(p1.theta), p2.r*Math.sin(p2.theta), p3.r*Math.sin(p3.theta)]

        const a1 = Math.atan2(y1 - y2, x1 - x2);
        const a2 = Math.atan2(y3 - y2, x3 - x2);

        const diff = Math.abs(a1 - a2);
        return Math.min(diff, 2 * Math.PI - diff) * 180 / Math.PI;
    }

    //fun - helperOverlap()
    function helperOverlap(points: THREE.Vector3[], samples: number = config.track.centerline_samples, tol: number = 10) {
        const curve = new THREE.CatmullRomCurve3(
            points,
            false,
            "centripetal",
            0
        )
        const p = curve.getPoints(samples)

        for (let i = 0; i < p.length; i++) {
            for (let j = i + 2; j < p.length; j++) {

                if (i == 0 || j == p.length) continue

                if (p[i]!.distanceTo(p[j]!) < tol) return true
            }
        }

        return false
    }
}
//!FUNCTION

//fun - getModeNodes()
function getModeNodes(points: Point[], poses: THREE.Vector3[]): ModeNodes {
    
    //Current Mode set to first
    let current = {idx: 0, mode: points[0]!.mode} 

    //modeNodes object init
    let modeNodes: ModeNodes = {points: [0], turns: [0], modes: [current.mode]}

    //Create a copy of the centerline curve
    const curve = new THREE.CatmullRomCurve3(
        poses,
        true,
        "centripetal",
        0
    )
    const curvePoints = curve.getPoints(config.track.centerline_samples)

    let previous = Infinity
    curvePoints.forEach((curvePoint, idx) => {
        if (current.idx == points.length - 1) return //Skip last point

        //Distance from the current point to the sector change turn
        const dist = curvePoint.distanceTo(points[current.idx + 1]!.pose)

        if (previous < dist) {
            current.idx++
            current.mode = points[current.idx]!.mode
            
            if (points[current.idx - 1]!.mode != current.mode) {
                modeNodes.points.push(idx) //Store the index of the closest point
                modeNodes.turns.push(current.idx) //Advance to next sector change turn
                modeNodes.modes.push(current.mode) //Save the last mode
            }

            previous = Infinity
        } else {
            previous = dist
        }  
    })

    return modeNodes
}

//fun - showDebugSegments()
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

//fun - showdebugPoints()
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

//fun - showDebugPath()
function showDebugPath(points: THREE.Vector3[], scene: THREE.Scene): void {

    const curve = new THREE.CatmullRomCurve3(
        points,
        true,
        "centripetal",
        0
    )

    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(config.track.centerline_samples))
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00 })

    const line = new THREE.Line(geometry, material)
    line.name = "Centerline"

    scene.add(line)
}