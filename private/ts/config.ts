import fs from "node:fs"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import type { GameConfig } from "../../shared/config/configTypes"

const configPath = fileURLToPath(new URL("../../shared/config/config.yaml", import.meta.url))
const configTxt = fs.readFileSync(configPath, "utf-8")

export const config: GameConfig = YAML.parse(configTxt)