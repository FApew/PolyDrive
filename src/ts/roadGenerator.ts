import * as THREE from "three"
import * as CANNON from "cannon-es"
import { createNoise2D } from "simplex-noise"
import alea from "alea"

import type { SideLines } from "./types"

import { config } from "./YAMLConfigs"

//FUNCTION - genRoad()
export function genRoad(seed: number, scene: THREE.Scene, world: CANNON.World, sideLines: SideLines) {

    const roadMesh = buildRoadMesh(sideLines)
    scene.add(roadMesh);

    const roadBody = buildRoadBody(roadMesh);
    world.addBody(roadBody)
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
            indices.push(a, b, c,  b, d, c)
        }
    }
}

//fun buildRoadObj()
function buildRoadBody(mesh: THREE.Mesh): CANNON.Body {

    const geometry = mesh.geometry
    const position = geometry.getAttribute("position")
    const index = geometry.getIndex()

    if (!index) {
        throw new Error("Road geometry has no index")
    }

    const vertices = Array.from(position.array as ArrayLike<number>)
    const indices = Array.from(index.array as ArrayLike<number>)

    const shape = new CANNON.Trimesh(vertices, indices)

    const body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        shape
    })

    // Apply the mesh's world transform to the collision body.
    mesh.updateMatrixWorld(true)

    const position3 = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()

    mesh.matrixWorld.decompose(position3, quaternion, scale)

    body.position.set(position3.x, position3.y, position3.z)
    body.quaternion.set(
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w
    )

    body.updateAABB()

    return body
}