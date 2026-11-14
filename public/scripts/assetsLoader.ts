import * as THREE from "three"
import type { AudioKey, CarModelName } from "../../shared/types";

export const modelList: CarModelName[] = ["giulia", "f40"]

export const imgs: Record<CarModelName, string> = {
    "giulia": "../assets/imgs/alfa.svg",
    "f40": "../assets/imgs/ferrari.svg"
}

const audioLoader = new THREE.AudioLoader()

const [idleBuffer, lowOffBuffer, lowOnBuffer, medOffBuffer, medOnBuffer, highOffBuffer, highOnBuffer, maxRpmBuffer] = await Promise.all([
    audioLoader.loadAsync("../assets/sounds/idle.wav"),
    audioLoader.loadAsync("../assets/sounds/low_off.wav"),
    audioLoader.loadAsync("../assets/sounds/low_on.wav"),
    audioLoader.loadAsync("../assets/sounds/med_off.wav"),
    audioLoader.loadAsync("../assets/sounds/med_on.wav"),
    audioLoader.loadAsync("../assets/sounds/high_off.wav"),
    audioLoader.loadAsync("../assets/sounds/high_on.wav"),
    audioLoader.loadAsync("../assets/sounds/maxRPM.wav"),
])

export const audios: Record<AudioKey, AudioBuffer> = {
    "idle": idleBuffer,
    "lowOff": lowOffBuffer,
    "lowOn": lowOnBuffer,
    "medOff": medOffBuffer,
    "medOn": medOnBuffer,
    "highOff": highOffBuffer,
    "highOn": highOnBuffer,
    "maxRPM": maxRpmBuffer
}