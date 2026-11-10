import { defineConfig } from "vite"

export default defineConfig({
    root: "public",

    server: {
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

    plugins: [{
        name: "fullReload",
        handleHotUpdate(ctx): void {
            console.log("[HMR]", ctx.file)

            ctx.server.ws.send({
                type: "full-reload"
            })
        }
    }],
})