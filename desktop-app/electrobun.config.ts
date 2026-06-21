import type { ElectrobunConfig } from "electrobun";

export default {
  // Added baseUrl pointing to your GitHub Releases for auto-updates/patches
  baseUrl: "https://github.com/AlvinPlayz23/recode/releases/latest/download/",
  app: {
    name: "Recode",
    identifier: "dev.recode.desktop",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "web/dist": "views/main",
    },
    watch: [
      "electrobun.config.ts",
      "src/bun/**/*.ts",
      "web/index.html",
      "web/public",
      "web/src",
      "web/vite.config.ts",
    ],
  },
  scripts: {
    postPackage: "./scripts/patch-windows-dpi-manifest.ts",
  },
} satisfies ElectrobunConfig;
