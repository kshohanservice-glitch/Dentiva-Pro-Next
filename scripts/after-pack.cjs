/**
 * electron-builder afterPack hook.
 *
 * V1.1 ISS-028: the NSIS installer crossed GitHub's 100 MB per-file push
 * limit (100.86 MB at 289949f) after the Electron 43 upgrade. The payload
 * audit (CI size report) showed dxcompiler.dll = 25.6 MB — Chromium's
 * DirectCompute compiler used ONLY for WebGPU shader compilation. Dentiva Pro
 * is a 2D React/Canvas UI with zero WebGPU usage; when the DLL is absent,
 * Chromium simply reports WebGPU unavailable (probe fails, no crash) and
 * rendering continues via the D3D/SwiftShader paths (libGLESv2, EGL and
 * vk_swiftshader.dll are all left untouched). Windows E2E + installed-artifact
 * smoke re-verify rendering on every CI run, so any regression fails the build.
 */
const fs = require('node:fs');
const path = require('node:path');

const STRIP = ['dxcompiler.dll'];

module.exports = async function afterPack(context) {
  const dir = context.appOutDir;
  for (const name of STRIP) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      fs.rmSync(file, { force: true });
      console.log(`afterPack: stripped ${name} (${size} bytes) from ${dir}`);
    }
  }
};
