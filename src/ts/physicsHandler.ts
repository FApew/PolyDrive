import * as THREE from "three"
import * as CANNON from "cannon-es"

export function updatePhysics(world: CANNON.World, scene: THREE.Scene): void {
    world.bodies.forEach((body: CANNON.Body) => {

        const meshIdx: number = scene.children.findIndex(a => a.id == body.id)

        if (scene.children[meshIdx]) {
            scene.children[meshIdx].position.set(
                body.position.x,
                body.position.y,
                body.position.z
            )
            scene.children[meshIdx].quaternion.set(
                body.quaternion.x,
                body.quaternion.y,
                body.quaternion.z,
                body.quaternion.w
            )
        }
    })
}

export function addDetailedPlaneBody(mesh: THREE.Mesh, scene: THREE.Scene, world: CANNON.World) {
    const geometry = mesh.geometry
    const position = geometry.attributes.position
    const idx = geometry.index

    if (!position) {
        throw new Error("Geometry has no positions")
    }

    const vtxArr = [], idxArr = []

    for (let i = 0; i < position.count; i++) {
        vtxArr.push(
            position.getX(i),
            position.getY(i),
            position.getZ(i)
        )
    }

    if (idx) {
        for (let i = 0; i < idx.count; i++) {
            idxArr.push(idx.getX(i))
        }
    } else {
        for (let i = 0; i < position.count; i++) {
            idxArr.push(i)
        }
    }

    const shape = new CANNON.Trimesh(vtxArr, idxArr)
    const body = new CANNON.Body({mass: 0})
    body.addShape(shape)

    body.position.set(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z
    )
    body.quaternion.set(
        mesh.quaternion.x,
        mesh.quaternion.y,
        mesh.quaternion.z,
        mesh.quaternion.w
    )

    scene.add(mesh)
    world.addBody(body)
}