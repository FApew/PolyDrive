import type { CarModelName } from "../../shared/types";

export const modelList: CarModelName[] = ["giulia", "f40", "targa4s"]

export const imgs: Record<CarModelName, string> = {
    "giulia": "../assets/imgs/alfa.svg",
    "f40": "../assets/imgs/ferrari.svg",
    "targa4s": "../assets/imgs/porsche.svg"
}

const [giuliaRes, f40Res, targa4sRes] = [
    await fetch("../assets/engines/giulia.mr"),
    await fetch("../assets/engines/f40.mr"),
    await fetch("../assets/engines/targa4s.mr")
]

export const soundMRFiles: Record<CarModelName, string> = {
    giulia: await giuliaRes.text(),
    f40: await f40Res.text(),
    targa4s: await targa4sRes.text()
}