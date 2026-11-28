import RAPIER from "@dimforge/rapier3d-compat"
import alea from "alea"

import type { TerrainData, TrackData, WorldManifest } from "../../shared/types"

import { genTrack } from "./track"
import { genTerrain } from "./terrain"

import { config } from "./config"

const RoomWorldRecord: Record<string, RoomWorld> = {}

export async function initializePhysics(): Promise<void> {
    await RAPIER.init()
}

//CLASS - RoomWorld
class RoomWorld {
    id: string
    seed: number

    world: RAPIER.World
    dimension: number

    random: () => number

    terrain!: TerrainData
    track!: TrackData

    //fun - constructor()
    constructor(id: string, seed: number) {
        this.id = id
        this.seed = seed

        this.world = new RAPIER.World({x: 0, y: -9.807, z: 0})
        this.world.timestep = 1 / config.game.physics_fps

        this.random = alea(seed)

        this.dimension = Math.round(this.random() * (config.terrain.size.max - config.terrain.size.min) + config.terrain.size.min)

        this.track = genTrack(this.random, this.dimension, seed)
        this.terrain = genTerrain(this.random)
    }

    dispose(): void {
        this.world.free()
    }
}
//!CLASS

//fun - createWorld()
export function createWorld(id: string, seed: number): WorldManifest {
    const roomWorld = new RoomWorld(id, seed)
    RoomWorldRecord[id] = roomWorld

    const manifest: WorldManifest = {
        id, seed,
        terrain: roomWorld.terrain,
        track: roomWorld.track,
        objects: []
    }

    return manifest
}

export function destroyWorld(id: string): void {
    const roomWorld = RoomWorldRecord[id]
    if (!roomWorld) return

    roomWorld.dispose()
    delete RoomWorldRecord[id]
}