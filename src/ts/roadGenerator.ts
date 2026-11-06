import * as THREE from "three"
import { RAPIER, createStaticTrimesh } from "./physics"
import { createNoise2D } from "simplex-noise"
import alea from "alea"

import type { SideLines } from "./types"

import { config } from "./YAMLConfigs"

//FUNCTION - genRoad()
export function genRoad(
    seed: number, 
    scene: THREE.Scene,
    world: RAPIER.World,
    centerline: THREE.Vector3[],
    turns: THREE.Vector3[],
    sectorChange: number[],
    sideLines: SideLines
): number {

    const roadMesh = buildRoadMesh(sideLines)
    scene.add(roadMesh);
    createStaticTrimesh(roadMesh, world)
    

    const finishlinePoint = getFinishlinePoint(centerline, turns, sectorChange)
    return finishlinePoint
}

//fun - buildRoadMesh()
function buildRoadMesh(side: SideLines, tileLength = 10, thickness = config.road.thickness): THREE.Mesh {
    const { left, right } = side
    const n = left.length

    const down = new THREE.Vector3(0, -thickness, 0)
    const loop = (pts: THREE.Vector3[]) => Array.from({ length: n + 1 }, (obj, i) => pts[i % n]!)  // closes the loop

    const [topL, topR] = [loop(left), loop(right)]
    const [botL, botR] = [topL.map(p => p.clone().add(down)), topR.map(p => p.clone().add(down))]

    const dist: number[] = [0]
    for (let i = 1; i <= n; i++) dist.push(dist[i - 1]! + topL[i]!.distanceTo(topL[i - 1]!))

    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    addStrip(topL, topR)   // top
    addStrip(botR, botL)   // bottom
    addStrip(botL, topL)   // left
    addStrip(topR, botR)   // right

    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(indices)
    g.computeVertexNormals()

    const m = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.9
    })

    return new THREE.Mesh(g, m)

    //fun - addStrip()
    function addStrip(A: THREE.Vector3[], B: THREE.Vector3[]) {
        const base = positions.length / 3
        for (let i = 0; i <= n; i++) {
            positions.push(A[i]!.x, A[i]!.y, A[i]!.z, B[i]!.x, B[i]!.y, B[i]!.z)
            uvs.push(0, dist[i]! / tileLength, 1, dist[i]! / tileLength)
        }
        for (let i = 0; i < n; i++) {
            const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3
            indices.push(a, b, c, b, d, c)
        }
    }
}

//FUNCTION - getFinishLinePoint()
function getFinishlinePoint(
    centerline: THREE.Vector3[],
    turns: THREE.Vector3[],
    sectorChange: number[]
): number {
    
    let bestIdx = 0
    let firstPose: number
    let lastPose: number
    
    let check: boolean, forbiddenIdxs: number[] = []
    do {
        let tmp = -Infinity
        for (let i = 0; i < turns.length; i++) {
            const nextIdx = (i + 1) % turns.length

            const dist = turns[i]!.distanceTo(turns[nextIdx]!)

            console.log(i, nextIdx, dist)

            if (dist > tmp && forbiddenIdxs.indexOf(i) == -1) {
                tmp = dist
                bestIdx = i
            }
        }

        const nextBestIdx = (bestIdx + 1) % turns.length

        firstPose = getClosestCurvePoint(centerline, turns[bestIdx]!)
        lastPose = getClosestCurvePoint(centerline, turns[nextBestIdx]!)

        const off = bestIdx == 0 ? Math.floor(config.track.centerline_samples / 2) : 0
        const offset = (n: number): number => {
            return (n + off) % config.track.centerline_samples
        }

        check = false
        sectorChange.forEach((pose: number) => {
            if (offset(pose) > offset(firstPose) && offset(pose) < offset(lastPose)) {
                check = true
                forbiddenIdxs.push(bestIdx)
            }
        })
    } while (check)

    console.log(firstPose, lastPose)

    console.log("Best: ", bestIdx)

    const off = bestIdx == 0 ? Math.floor(config.track.centerline_samples / 2) : 0
    const offset = (n: number): number => {
        return (n + off) % config.track.centerline_samples
    }

    return offset(Math.floor((offset(lastPose) - offset(firstPose)) * .7 + offset(firstPose)))

    //fun getClosestCurvePoint()
    function getClosestCurvePoint(curve: THREE.Vector3[], point: THREE.Vector3): number {
        let idx = 0, tmp = Infinity

        for (let i = 0; i < curve.length; i++) {
            const dist = point.distanceTo(curve[i]!)

            if (dist < tmp) {
                tmp = dist
                idx = i
            }
        }

        return idx
    }
}