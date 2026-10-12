import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// O app publicado fica em ../desapego (GitHub Pages: /lovablex-celular/desapego/).
// base "./" deixa o mesmo build funcionar em qualquer pasta ou domínio.
export default defineConfig({
  base: "./",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../desapego", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/*.png", "offline.html"],
      manifest: {
        id: "./",
        name: "Desapego da Família",
        short_name: "Desapego",
        description: "Marketplace particular da família: anuncie, negocie e venda com facilidade.",
        lang: "pt-BR",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#F8F9F7",
        theme_color: "#17352F",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // só a "casca" do app vai para o cache; dados, mensagens e pagamentos vêm sempre da internet
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        globIgnores: ["config.js", "**/manrope-{cyrillic,greek,vietnamese}*"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.endsWith("/config.js"), handler: "NetworkFirst", options: { cacheName: "config" } },
          {
            // fotos dos anúncios: guardadas para abrir rápido, com limite de espaço
            urlPattern: ({ url }) => url.pathname.includes("/storage/v1/object/public/"),
            handler: "CacheFirst",
            options: { cacheName: "fotos", expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as never);
