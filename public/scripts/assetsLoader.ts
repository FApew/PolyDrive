import type { CarModelName } from "../../shared/types";

export const modelList: CarModelName[] = ["giulia", "f40"]

export const imgs: Record<CarModelName, string> = {
    "giulia": "../assets/imgs/alfa.svg",
    "f40": "../assets/imgs/ferrari.svg"
}

const [giuliaRes, f40Res] = [
    await fetch("../assets/engines/giulia.mr"),
    await fetch("../assets/engines/f40.mr")
]

export const soundMRFiles = {
    giulia: await giuliaRes.text(),
    f40: await f40Res.text()
}