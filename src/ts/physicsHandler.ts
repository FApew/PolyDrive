import * as THREE from "three"
import * as CANNON from "cannon-es"

//NOTE - updatePhysics()
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

//NOTE - addDetailedPlaneBody()
export function addDetailedPlaneBody(
    mesh: THREE.Mesh,
    scene: THREE.Scene,
    world: CANNON.World
): void {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const idx = geometry.index;

    if (!position || !idx) {
        throw new Error("Terrain geometry needs positions and an index buffer");
    }

    //Max 16IntArray 
    const MAX_CHUNK_VERTICES = 30_000;

    let chunkVertices: number[] = [];
    let chunkIndices: number[] = [];
    let vertexMap = new Map<number, number>();

    let chunkCount = 0;

    //Recursive Function to generate all the Trimesh required
    function flushChunk(): void {
        if (chunkIndices.length === 0) return;

        const shape = new CANNON.Trimesh(
            chunkVertices,
            chunkIndices
        );

        const body = new CANNON.Body({ mass: 0 });
        body.addShape(shape);

        body.position.set(
            mesh.position.x,
            mesh.position.y,
            mesh.position.z
        );

        body.quaternion.set(
            mesh.quaternion.x,
            mesh.quaternion.y,
            mesh.quaternion.z,
            mesh.quaternion.w
        );

        world.addBody(body);
        chunkCount++;

        chunkVertices = [];
        chunkIndices = [];
        vertexMap = new Map<number, number>();
    }

    for (let i = 0; i < idx.count; i += 3) {
        const triangle = [
            idx.getX(i),
            idx.getX(i + 1),
            idx.getX(i + 2)
        ];

        const newVertices = new Set(
            triangle.filter(index => !vertexMap.has(index))
        );

        if (
            vertexMap.size > 0 &&
            vertexMap.size + newVertices.size > MAX_CHUNK_VERTICES
        ) {
            flushChunk();
        }

        for (const originalIndex of triangle) {
            let localIndex = vertexMap.get(originalIndex);

            if (localIndex === undefined) {
                localIndex = vertexMap.size;
                vertexMap.set(originalIndex, localIndex);

                chunkVertices.push(
                    position.getX(originalIndex),
                    position.getY(originalIndex),
                    position.getZ(originalIndex)
                );
            }

            chunkIndices.push(localIndex);
        }
    }

    flushChunk();
    scene.add(mesh);
}