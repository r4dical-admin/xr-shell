'use strict';

function hashHue(value) {
  let hash = 0;
  for (const character of String(value)) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function compileTheme(profile) {
  const bundleId = profile.app?.bundleId || 'unknown.app';
  const roles = profile.capabilities?.roles || {};
  let palette;
  let motif;
  let videoFilter;
  if (bundleId === 'com.apple.Terminal') {
    motif = 'terminal';
    palette = { accent: '#62f5c3', secondary: '#54ddff', surface: '#03130f', line: '#49dcae', ink: '#d8fff2' };
    videoFilter = 'saturate(.72) contrast(1.2) brightness(.82) hue-rotate(9deg)';
  } else if (bundleId === 'com.apple.TextEdit') {
    motif = 'writer';
    palette = { accent: '#ad91ff', secondary: '#62dcff', surface: '#0b0920', line: '#9079ef', ink: '#f1ecff' };
    videoFilter = 'saturate(.7) contrast(1.12) brightness(.9) hue-rotate(8deg)';
  } else {
    const hue = hashHue(bundleId);
    motif = roles.AXTextArea ? 'workspace' : roles.AXWebArea ? 'web' : 'system';
    palette = {
      accent: `hsl(${hue} 88% 68%)`,
      secondary: `hsl(${(hue + 42) % 360} 92% 68%)`,
      surface: `hsl(${hue} 44% 8%)`,
      line: `hsl(${hue} 72% 58%)`,
      ink: `hsl(${hue} 50% 94%)`
    };
    videoFilter = 'saturate(.78) contrast(1.14) brightness(.86)';
  }
  const roleEffects = {};
  for (const role of Object.keys(roles)) {
    roleEffects[role] = role === 'AXButton' ? 'holographic-control'
      : ['AXTextField', 'AXTextArea'].includes(role) ? 'luminous-input'
        : role.includes('Tab') ? 'navigation-rail'
          : role.includes('Scroll') ? 'energy-track'
            : role === 'AXStaticText' ? 'telemetry-label' : 'glass-region';
  }
  return { version: 2, name: `${profile.app?.name || 'App'} / ${motif}`, motif, palette, videoFilter, roleEffects };
}

const ALLOWED_EFFECTS = new Set(['holographic-control', 'luminous-input', 'navigation-rail', 'energy-track', 'telemetry-label', 'glass-region']);
const ALLOWED_FILTERS = new Set([
  'saturate(.72) contrast(1.2) brightness(.82) hue-rotate(9deg)',
  'saturate(.7) contrast(1.12) brightness(.9) hue-rotate(8deg)',
  'saturate(.82) contrast(1.18) brightness(.86)',
  'saturate(.68) contrast(1.24) brightness(.8) hue-rotate(18deg)',
  'saturate(.9) contrast(1.1) brightness(.9)'
]);

function normalizeGeneratedTheme(value, profile) {
  if (!value || value.version !== 3 || !value.palette) throw new Error('unsupported theme shape');
  const color = (name) => {
    const candidate = String(value.palette[name] || '');
    if (!/^#[0-9a-f]{6}$/i.test(candidate)) throw new Error(`invalid ${name} color`);
    return candidate;
  };
  const availableRoles = new Set(Object.keys(profile.capabilities?.roles || {}));
  const roleEffects = {};
  for (const [role, effect] of Object.entries(value.roleEffects || {})) {
    if (availableRoles.has(role) && ALLOWED_EFFECTS.has(effect)) roleEffects[role] = effect;
  }
  if (!ALLOWED_FILTERS.has(value.videoFilter)) throw new Error('invalid video filter');
  return {
    version: 3,
    name: String(value.name || `${profile.app?.name || 'App'} XR`).slice(0, 80),
    motif: /^[a-z0-9-]{2,32}$/.test(value.motif) ? value.motif : 'adaptive-xr',
    rationale: String(value.rationale || '').slice(0, 240),
    palette: { accent: color('accent'), secondary: color('secondary'), surface: color('surface'), line: color('line'), ink: color('ink') },
    videoFilter: value.videoFilter,
    roleEffects,
    generatedBy: 'codex-ax-theme-agent',
    generatedAt: new Date().toISOString()
  };
}

module.exports = { compileTheme, normalizeGeneratedTheme };
