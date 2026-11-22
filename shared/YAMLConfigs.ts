import YAML from "yaml"

import configTxt from "./config/config.yaml?raw"
import type { GameConfig } from "./config/configTypes"

export const config: GameConfig = YAML.parse(configTxt)