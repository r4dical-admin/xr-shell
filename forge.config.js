'use strict';

module.exports = {
  packagerConfig: {
    name: 'XR Shell',
    executableName: 'XR Shell',
    appBundleId: 'com.r4dical.xrshell',
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
