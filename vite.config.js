import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumBuild = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  // Relative base so the build works from any path (e.g. GitHub Pages project site).
  base: './',
  plugins: [
    viteStaticCopy({
      targets: ['Workers', 'Assets', 'ThirdParty', 'Widgets'].map((d) => ({
        src: `${cesiumBuild}/${d}`,
        dest: 'cesium',
        rename: { stripBase: 4 }, // node_modules/cesium/Build/Cesium/<dir> -> cesium/<dir>
      })),
    }),
  ],
  build: { chunkSizeWarningLimit: 6000 },
  worker: { format: 'es' },
});
