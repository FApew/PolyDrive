import * as THREE from "three"
import type { TrackData } from "../../shared/types"

import { config } from "./config"
import { genTrackCenterline } from "./trackCenterline"
const cfg = config.track

//FUNCTION - genTrack()
export function genTrack(random: () => number, dimension: number, seed: number): TrackData {

    const centerline = genTrackCenterline(seed, dimension)

    const curve = new THREE.CatmullRomCurve3(
        centerline.poses,
        true,
        "centripetal",
        0
    )

    const trackData: TrackData = {
        poses: curve.getPoints(cfg.centerline_samples),
        modeNodes: centerline.modeNodes
    }

    return trackData
}
//!FUNCTION