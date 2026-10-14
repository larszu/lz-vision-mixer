// CommonJS on purpose: the packaged package.json must not say "type": "module"
// (packaging trap of the av-planner skeleton); this package is "type": "commonjs".
module.exports = {
  appId: 'de.zumpelars.vision-mixer.graphics',
  productName: 'LZ Vision Mixer Graphics',
  copyright: `Copyright © ${new Date().getFullYear()} Lars Zumpe`,
  files: ['dist/**/*', 'package.json'],
  // Bundled OGraf graphics stay real files next to the app (process.resourcesPath/graphics), so their
  // folder path can be shown and users can copy them.
  extraResources: [{ from: 'graphics', to: 'graphics' }],
  directories: { output: 'release' },
  mac: {
    category: 'public.app-category.video',
    target: [
      { target: 'dmg', arch: 'universal' },
      { target: 'zip', arch: 'universal' },
    ],
    // Same universal-build settings as the other LZ apps: per-arch prebuilt binaries (none today,
    // but ws can pick up optional native helpers) must not abort @electron/universal, and the two
    // asars are kept apart instead of merged.
    x64ArchFiles: '**/prebuilds/*darwin*/**',
    mergeASARs: false,
    // Ad-hoc signature: arm64 macOS refuses completely unsigned binaries.
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
  },
  win: { target: ['nsis', 'portable'] },
  linux: { target: ['AppImage', 'deb'], category: 'AudioVideo', maintainer: 'Lars Zumpe' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  publish: [{ provider: 'github', owner: 'larszu', repo: 'lz-vision-mixer', releaseType: 'release' }],
}
