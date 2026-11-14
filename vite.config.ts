import { defineConfig } from "vite"
import { readFileSync } from "node:fs"

export default defineConfig({
    root: "public",

    server: {
        host: "0.0.0.0",
        port: 5173,
        https: {
            cert: readFileSync("./localhost+2.pem"),
            key: readFileSync("./localhost+2-key.pem"),
        },
        proxy: {
            "/socket.io": {
                target: "http://localhost:3000",
                ws: true
            }
        }
    },

    build: {
        outDir: "../dist",
        emptyOutDir: true
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
    ],
})