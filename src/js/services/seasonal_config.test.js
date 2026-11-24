import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WINTER_EID_THEME_NAME,
  WINTER_EID_THEME_DEFINITION,
  WINTER_EID_SEASONAL_DEFAULTS,
  isHexColorLight,
  getContrastRatio,
  isWinterEidTheme,
  normalizeSeasonalConfig,
  detectPageScope,
  shouldRenderSeasonalDecorations,
  getSnowParticleCount,
} from './seasonal_config.js';

test('Winter Eid palette satisfies WCAG AA contrast requirements', () => {
  const { page, brand, buttons } = WINTER_EID_THEME_DEFINITION.colors;

  assert.equal(isHexColorLight(page.bg), true);
  assert.equal(isHexColorLight(page.surface), true);
  assert.equal(isHexColorLight(page.text), false);

  // Primary text on snow canvas and card surface (>= 4.5:1)
  assert.ok(getContrastRatio(page.text, page.bg) >= 10, 'Primary text on snow bg must have high contrast');
  assert.ok(getContrastRatio(page.text, page.surface) >= 12, 'Primary text on card surface must have high contrast');

  // Muted text on snow canvas and card surface (>= 4.5:1)
  assert.ok(getContrastRatio(page.text_muted, page.bg) >= 4.5, 'Muted text must meet WCAG AA on page bg');
  assert.ok(getContrastRatio(page.text_muted, page.surface) >= 4.5, 'Muted text must meet WCAG AA on card bg');

  // Primary antique gold accent passes AA both as white-text button and as text on light surfaces
  assert.ok(getContrastRatio(buttons.primary.text, buttons.primary.bg) >= 4.5, 'White text on primary gold button must pass AA');
  assert.ok(getContrastRatio(brand.primary, page.bg) >= 4.5, 'Gold accent text on snow bg must pass AA');
});

test('isHexColorLight handles 3-digit, 6-digit, dark, and invalid values', () => {
  assert.equal(isHexColorLight('#0a0a0a'), false);
  assert.equal(isHexColorLight('#0b0f19'), false);
  assert.equal(isHexColorLight('#fff'), true);
  assert.equal(isHexColorLight('#f4f8fc'), true);
  assert.equal(isHexColorLight('#fdf6e2'), true);
  assert.equal(isHexColorLight(''), false);
  assert.equal(isHexColorLight(null), false);
});

test('normalizeSeasonalConfig preserves legacy themes as non-seasonal and normalizes Winter Eid', () => {
  assert.equal(normalizeSeasonalConfig({ name: 'Dark Theme', colors: {} }), null);
  assert.equal(normalizeSeasonalConfig({ name: 'Light Theme', colors: {} }), null);

  const byName = normalizeSeasonalConfig({ name: WINTER_EID_THEME_NAME });
  assert.ok(byName);
  assert.equal(byName.enabled, true);
  assert.equal(byName.preset, 'winter-eid');
  assert.equal(byName.snow_intensity, 'light');
  assert.equal(byName.greeting_text, WINTER_EID_SEASONAL_DEFAULTS.greeting_text);

  const customized = normalizeSeasonalConfig({
    name: 'My Cloned Eid Theme',
    variables: {
      seasonal: {
        preset: 'winter-eid',
        enabled: true,
        snow_enabled: false,
        snow_intensity: 'medium',
        eid_ornaments: true,
        greeting_text: '   كل عام وأنتم بخير   ',
      },
    },
  });
  assert.equal(isWinterEidTheme({ variables: { seasonal: { preset: 'winter-eid' } } }), true);
  assert.equal(customized.snow_enabled, false);
  assert.equal(customized.snow_intensity, 'medium');
  assert.equal(customized.greeting_text, 'كل عام وأنتم بخير');
});

test('page scope restricts decorations strictly to storefront while keeping admin and auth calm', () => {
  const activeConfig = normalizeSeasonalConfig(WINTER_EID_THEME_DEFINITION);

  assert.equal(detectPageScope('/index.html', {}), 'storefront');
  assert.equal(detectPageScope('/', {}), 'storefront');
  assert.equal(detectPageScope('/admin.html', {}), 'admin');
  assert.equal(detectPageScope('/anything', { hasAdminSidebar: true }), 'admin');
  assert.equal(detectPageScope('/auth.html', {}), 'auth');
  assert.equal(detectPageScope('/login', { hasAuthForm: true }), 'auth');

  assert.equal(shouldRenderSeasonalDecorations('storefront', activeConfig), true);
  assert.equal(shouldRenderSeasonalDecorations('admin', activeConfig), false);
  assert.equal(shouldRenderSeasonalDecorations('auth', activeConfig), false);
  assert.equal(shouldRenderSeasonalDecorations('storefront', { ...activeConfig, enabled: false }), false);
});

test('snow particle budget scales for mobile and disables on reduced motion', () => {
  assert.equal(getSnowParticleCount('light', 1440, true), 0);
  assert.equal(getSnowParticleCount('medium', 390, true), 0);

  const desktopLight = getSnowParticleCount('light', 1440, false);
  const mobileLight = getSnowParticleCount('light', 390, false);
  const desktopMedium = getSnowParticleCount('medium', 1440, false);
  const mobileMedium = getSnowParticleCount('medium', 390, false);

  assert.ok(mobileLight > 0 && mobileLight < desktopLight);
  assert.ok(mobileMedium > mobileLight && mobileMedium < desktopMedium);
  assert.ok(desktopMedium > desktopLight);
});
