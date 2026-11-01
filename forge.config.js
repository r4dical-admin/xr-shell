'use strict';

module.exports = {
  packagerConfig: {
    name: 'XR Shell',
    executableName: 'XR Shell',
    appBundleId: 'com.r4dical.xrshell',
    // Sign the complete bundle even when no Developer ID certificate is installed.
    // This is ad-hoc signing, not a substitute for Developer ID + notarization.
    osxSign: {
      identity: '-',
      identityValidation: false,
      // Hardened Runtime's library validation rejects Electron's ad-hoc-signed
      // frameworks because ad-hoc signatures have no common Team ID.
      optionsForFile: () => ({ hardenedRuntime: false })
    },
    asar: true,
    extraResource: [
      '.build/input-bridge',
      'mcp',
      'control-server.js',
      'bin',
      'progress-socket.js'
    ],
    ignore: [
      /^\/artifacts(?:\/|$)/,
      /^\/archive(?:\/|$)/,
      /^\/docs(?:\/|$)/,
      /^\/integration-profiles(?:\/|$)/,
      /^\/native(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/test(?:\/|$)/,
      /^\/\.build(?:\/|$)/
    ]
  },
  makers: [
    { name: '@electron-forge/maker-dmg' },
    { name: '@electron-forge/maker-zip' }
  ]
};
