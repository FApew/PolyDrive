import * as THREE from "three"
import RAPIER from "@dimforge/rapier3d-compat"
export { RAPIER }

import { config } from "./YAMLConfigs"

import type { SyncObj } from "./types"
const syncList: SyncObj[] = []

export function addSync(mesh: THREE.Mesh, body: RAPIER.RigidBody) {
    syncList.push({mesh: mesh, body: body})
}

export function clearSyncList() {
    syncList.length = 0
}

export function createWorld(): RAPIER.World {
    const world = new RAPIER.World({x: 0, y: -9.807, z: 0})
    world.timestep = 1 / config.game.physics_fps
    return world
}

export function createStaticTrimesh(mesh: THREE.Mesh, world: RAPIER.World): void {
    mesh.updateWorldMatrix(true, false)

    // Split the world transform into its parts
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    mesh.matrixWorld.decompose(pos, quat, scale)

    // Bake ONLY the scale into the vertices (colliders can't be scaled afterwards)
    const g = mesh.geometry.clone().applyMatrix4(
        new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z)
    )
    const p = g.getAttribute("position")
    const idx = g.getIndex()

    const vtx = new Float32Array(p.array)
    const idxs = idx ? Uint32Array.from(idx.array) : Uint32Array.from({ length: p.count }, (_, i) => i)

    const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
    )

    world.createCollider(
        RAPIER.ColliderDesc.trimesh(vtx, idxs, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES),
        body
    )
    g.dispose()

    addSync(mesh, body)
}

export function createDynamicConvex(
    mesh: THREE.Mesh,
    world: RAPIER.World,
    mass: number
): RAPIER.RigidBody {
    mesh.updateWorldMatrix(true, false)

    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    mesh.matrixWorld.decompose(pos, quat, scale)

    const g = mesh.geometry.clone().applyMatrix4(
        new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z)
    )
    const points = new Float32Array(g.getAttribute("position").array)

    const desc = RAPIER.ColliderDesc.convexHull(points)
    if (!desc) {
        g.dispose()
        throw new Error("convexHull failed (degenerate or coplanar points)")
    }

    const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
            .setCcdEnabled(true)
    )

    world.createCollider(
        desc.setMass(mass).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body
    )
    g.dispose()

    addSync(mesh, body)
    return body
}

export class RapierDebugger {
    mesh = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ vertexColors: true })
    )

    constructor() { this.mesh.frustumCulled = false }

    update(world: RAPIER.World) {
        const { vertices, colors } = world.debugRender()
        this.mesh.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3))
        this.mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4))
    }
}

//NOTE - updatePhysics()
export function updatePhysics(): void {
    syncList.forEach(({mesh, body}) => {
        const p = body.translation()
        const q = body.rotation()
        mesh.position.set(p.x, p.y, p.z)
        mesh.quaternion.set(q.x, q.y, q.z, q.w)
    })
}