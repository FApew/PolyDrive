import { defineConfig } from "vite"
import { readFileSync } from "node:fs"

export default defineConfig(({ command }) => ({
    publicDir: "public/assets",
    server: {
        host: "0.0.0.0",
        port: 5173,
        ...(command === "serve" ? {
            https: {
                cert: readFileSync(new URL("./localhost+2.pem", import.meta.url)),
                key: readFileSync(new URL("./localhost+2-key.pem", import.meta.url)),
            }
        } : {}),
        proxy: {
            "/socket.io": {
                target: "http://localhost:3000",
                ws: true
            }
        }
    },
    plugins: [
        {
            name: "fullReload",
            handleHotUpdate(ctx): void {
                console.log("[HMR]", ctx.file)

                ctx.server.ws.send({
                    type: "full-reload"
                })
            }
        }
    ]
}))