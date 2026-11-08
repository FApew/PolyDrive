import * as THREE from "three"
import RAPIER from "@dimforge/rapier3d-compat"
export { RAPIER }

import { config } from "./YAMLConfigs"

import type { SyncObj, CarTune } from "./types"
const syncList: SyncObj[] = []

//fun - addSync()
export function addSync(obj: THREE.Object3D, body: RAPIER.RigidBody) {
    syncList.push({obj: obj, body: body})
}

//fun - clearSyncList()
export function clearSyncList() {
    syncList.length = 0
}

//fun - createWorld()
export function createWorld(): RAPIER.World {
    const world = new RAPIER.World({x: 0, y: -9.807, z: 0})
    world.timestep = 1 / config.game.physics_fps
    return world
}

//fun - updatePhysics()
export function updatePhysics(t = 0): void {
    for (const { obj, body } of syncList) {
        const p = body.translation()
        const q = body.rotation()

        if (body.isDynamic()) {
            const v = body.linvel()
            obj.position.set(p.x + v.x * t, p.y + v.y * t, p.z + v.z * t)
        } else {
            obj.position.set(p.x, p.y, p.z)
        }
        obj.quaternion.set(q.x, q.y, q.z, q.w)
    }
}

//fun createStaticTrimesh()
export function createStaticTrimesh(mesh: THREE.Mesh, world: RAPIER.World): void {
    mesh.updateWorldMatrix(true, false)

    //Split the world transform into its parts
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    mesh.matrixWorld.decompose(pos, quat, scale)

    //Bake ONLY the scale into the vertices
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

//fun createDynamicConvex()
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

//CLASS - RapierDebugger
export class RapierDebugger {
    mesh = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ vertexColors: true })
    )

    //fun - constructor()
    constructor() { this.mesh.frustumCulled = false }

    //fun - update()
    update(world: RAPIER.World) {
        const { vertices, colors } = world.debugRender()
        this.mesh.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3))
        this.mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4))
    }
}
//!CLASS

//CLASS - Car
export class Car {
    chassis: RAPIER.RigidBody
    vehicle: RAPIER.DynamicRayCastVehicleController
    wheelMeshes: THREE.Object3D[] = []
    current: CarTune
    wheelConnections: THREE.Vector3[] = []
    wheelDirections: THREE.Vector3[] = []
    currentSteer: number = 0
    handbrake = false

    //fun - constructor()
    constructor(world: RAPIER.World, mesh: THREE.Object3D, tune: CarTune, wheelMesh: THREE.Object3D) {
        mesh.updateWorldMatrix(true, false)

        //note - Chassis Physic Collider
        this.chassis = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
                .setRotation(mesh.quaternion)
                .setCanSleep(false)
                .setAngularDamping(4)
        )

        world.createCollider(
            RAPIER.ColliderDesc.cuboid(1.85 / 2, 0.3, 4.7 / 2)
                .setMass(1200)
                .setTranslation(0, 0, 0)
                .setFriction(0.1),
            this.chassis
        )

        //Vehicle Controller
        this.vehicle = world.createVehicleController(this.chassis)

        //note - Wheel Positions
        const wheelPos = [
            new THREE.Vector3(-0.762, 0,  1.4), // front left
            new THREE.Vector3( 0.762, 0,  1.4), // front right
            new THREE.Vector3(-0.762, 0, -1.4), // rear left
            new THREE.Vector3( 0.762, 0, -1.4), // rear right
        ]

        const wheelDirection = new THREE.Vector3(0, -1, 0)
        const wheelAxle = new THREE.Vector3(-1, 0, 0)

        wheelPos.forEach((p, i) => {
            this.vehicle.addWheel(
                p,
                wheelDirection,
                wheelAxle,
                0.4,
                0.35
            )

            this.wheelConnections.push(p.clone())
            this.wheelDirections.push(wheelDirection.clone())

            const wheel = new THREE.Group()

            const visual = wheelMesh.clone(true)

            wheel.add(visual)
            mesh.add(wheel)

            visual.scale.setScalar(1.5)
            this.wheelMeshes.push(wheel)
        })

        this.current = { ...tune }
        this.applyTune(this.current)

        addSync(mesh, this.chassis)
    }

    //fun - applyTune()
    applyTune(t: CarTune) {
        for (let i = 0; i < 4; i++) {
            this.vehicle.setWheelFrictionSlip(i, t.frictionSlip)
            this.vehicle.setWheelSideFrictionStiffness(i, t.sideFrictionStiffness)
            this.vehicle.setWheelSuspensionStiffness(i, t.suspensionStiffness)
            this.vehicle.setWheelSuspensionCompression(i, t.suspensionCompression)
            this.vehicle.setWheelSuspensionRelaxation(i, t.suspensionRelaxation)
            this.vehicle.setWheelMaxSuspensionTravel(i, t.maxSuspensionTravel)
            this.vehicle.setWheelMaxSuspensionForce(i, 20000)
        }
    }

    //fun - blendTo()
    blendTo(target: CarTune, dt: number, rate = 2) {
        const k = Math.min(1, dt * rate)
        for (const key of Object.keys(target) as (keyof CarTune)[]) {
            this.current[key] += (target[key] - this.current[key]) * k
        }
        this.applyTune(this.current)
    }

    //FUNCTION - drive()
    drive(throttle: number, brake: number, steer: number, handbrake: boolean, dt: number) {
        const speed = -this.vehicle.currentVehicleSpeed()
        document.getElementById("speed")!.innerHTML = Math.abs((speed * 3.6)).toFixed(2)

        const maxSteer = THREE.MathUtils.degToRad(35) / (1 + Math.abs(speed) * 0.15)

        //note - Steer Rate Limiter
        this.currentSteer = THREE.MathUtils.damp(
            this.currentSteer,
            steer,
            10, dt
        )

        
        for (let i = 2; i <= 3; i++) { this.vehicle.setWheelEngineForce(i, throttle * this.current.engineForce) } //note RWD
        for (let i = 0; i <= 1; i++) { this.vehicle.setWheelBrake(i, brake * 5000 * dt) } //note FW Brakes
        for (let i = 2; i <= 3; i++) { this.vehicle.setWheelBrake(i, brake * 2500 * dt) } //note RW Brakes

        for (let i = 0; i <= 1; i++) { this.vehicle.setWheelSteering(i, this.currentSteer * maxSteer) } //note Steer

        //note Handbrake
        if (handbrake) {
            for (let i = 0; i < 4; i++) {
                this.vehicle.setWheelBrake(i, 3000)
            }
        }

        const v = this.chassis.linvel()
        

        //note - Drag
        const DRAG_C = 1.8
        const k = -DRAG_C * speed * dt
        this.chassis.applyImpulse({ x: v.x * k, y: v.y * k, z: v.z * k }, true)

        //note - Downforce
        const DOWNFORCE_K = 7
        const down = Math.min(DOWNFORCE_K * speed ^ 2, 20000)
        this.chassis.applyImpulse({ x: 0, y: -down * dt, z: 0 }, true)

        this.vehicle.updateVehicle(dt)
    }
    //!FUNCTION

    //fun updateWheelMeshes()
    updateWheelMeshes() {
        const steeringAxis = new THREE.Vector3(0, 1, 0)
        const axleAxis = new THREE.Vector3(1, 0, 0)

        const spinQuat = new THREE.Quaternion()

        for (let i = 0; i < 4; i++) {
            const wheel = this.wheelMeshes[i]!

            const suspensionLength =
                this.vehicle.wheelSuspensionLength(i) ?? 0.4

            const steering =
                this.vehicle.wheelSteering(i) ?? 0

            const rotation =
                this.vehicle.wheelRotation(i) ?? 0

            // Suspension position
            wheel.position.copy(this.wheelConnections[i]!)
                .addScaledVector(this.wheelDirections[i]!, suspensionLength)

            // Steering + wheel rotation
            wheel.quaternion.setFromAxisAngle(steeringAxis, steering)

            spinQuat.setFromAxisAngle(axleAxis, rotation)
            wheel.quaternion.multiply(spinQuat)
        }
    }
}