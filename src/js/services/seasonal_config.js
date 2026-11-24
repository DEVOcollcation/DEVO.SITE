/**
 * Pure configuration, contrast utilities, and seasonal scope logic
 * for the Winter Eid Theme (شتاء العيد).
 * Kept free of DOM/network dependencies for fast unit testing.
 */

export const WINTER_EID_THEME_NAME = 'Winter Eid Theme';

export const WINTER_EID_SEASONAL_DEFAULTS = Object.freeze({
  enabled: true,
  preset: 'winter-eid',
  snow_enabled: true,
  snow_intensity: 'light', // 'light' | 'medium'
  eid_ornaments: true,
  frost_glass: true,
  greeting_bar_enabled: true,
  greeting_text: 'عيد سعيد — تشكيلة العيد الشتوية من ديفو',
  gold_accent: '#d4af37',
  ice_accent: '#3b82b6',
});

export const WINTER_EID_THEME_DEFINITION = {
  name: WINTER_EID_THEME_NAME,
  description: 'ثيم شتاء العيد — طابع شتوي فاتح بألوان ثلجية وزرقاء جليدية ولمسات ذهبية دافئة مع تساقط ثلوج وزخارف عيد هادئة.',
  is_system: true,
  colors: {
    page: {
      bg: '#f4f8fc',
      bg_secondary: '#ffffff',
      surface: '#ffffff',
      text: '#0f2238',
      text_muted: '#526b84',
      selection_bg: '#946816',
      selection_text: '#ffffff',
    },
    brand: {
      primary: '#946816',
      primary_hover: '#7c5510',
      secondary: '#e7f0f8',
      secondary_hover: '#d4e3f2',
    },
    borders: {
      color: '#d6e3f0',
      width: '1px',
      radius: '14px',
    },
    top_nav: {
      bg: '#ffffff',
      border: '#d6e3f0',
      logo: '#946816',
      text: '#0f2238',
      link_active: '#946816',
      link_hover: '#7c5510',
      icons: '#4f6b85',
      search_bg: '#f4f8fc',
      search_border: '#cbdbe9',
      search_text: '#0f2238',
    },
    hero: {
      bg: '#edf4fb',
      overlay: 'linear-gradient(to bottom, rgba(244,248,252,0.28), rgba(244,248,252,0.96))',
      title: '#0f2238',
      subtitle: '#4a6580',
    },
    buttons: {
      style_preset: 'solid',
      primary: {
        bg: '#946816',
        text: '#ffffff',
        border: 'transparent',
        hover_bg: '#7c5510',
        hover_text: '#ffffff',
        active_bg: '#66450c',
        disabled_bg: '#dce7f2',
        disabled_text: '#7f96ad',
      },
      secondary: {
        bg: '#e9f1f9',
        text: '#0f2238',
        border: '#c7daec',
        hover_bg: '#d9e6f3',
        hover_text: '#0f2238',
        active_bg: '#c7daec',
        disabled_bg: '#f4f8fc',
        disabled_text: '#8ba1b7',
      },
      success: {
        bg: '#0d9468',
        text: '#ffffff',
        border: 'transparent',
        hover_bg: '#0a7a55',
        hover_text: '#ffffff',
        active_bg: '#086345',
        disabled_bg: '#dce7f2',
        disabled_text: '#7f96ad',
      },
      warning: {
        bg: '#b47409',
        text: '#ffffff',
        border: 'transparent',
        hover_bg: '#965f07',
        hover_text: '#ffffff',
        active_bg: '#7a4c05',
        disabled_bg: '#dce7f2',
        disabled_text: '#7f96ad',
      },
      danger: {
        bg: '#dc2626',
        text: '#ffffff',
        border: 'transparent',
        hover_bg: '#b91c1c',
        hover_text: '#ffffff',
        active_bg: '#991b1b',
        disabled_bg: '#dce7f2',
        disabled_text: '#7f96ad',
      },
    },
    product_cards: {
      style_preset: 'bordered',
      bg: '#ffffff',
      border: '#d6e3f0',
      radius: '16px',
      title: '#0f2238',
      price: '#946816',
      category: '#526b84',
      shadow: '0 8px 24px rgba(15,34,56,0.06)',
      hover_effect: 'translate-y',
      hover_shadow: '0 14px 30px rgba(148,104,22,0.14)',
      badge_bg: '#946816',
      badge_text: '#ffffff',
    },
    modal: {
      bg: '#ffffff',
      border: '#cbdbe9',
      image_border: '#d6e3f0',
      price: '#946816',
      text: '#0f2238',
      text_secondary: '#526b84',
      quantity_bg: '#eef4fa',
      quantity_text: '#0f2238',
      size_active_bg: '#946816',
      size_active_text: '#ffffff',
      size_inactive_bg: '#eef4fa',
      size_inactive_text: '#4a6580',
      color_border_active: '#946816',
    },
    inputs: {
      bg: '#ffffff',
      border: '#c5d7e8',
      focus_border: '#946816',
      focus_ring: 'rgba(148,104,22,0.18)',
      placeholder: '#8098b0',
      text: '#0f2238',
      icons: '#526b84',
    },
    tables: {
      header_bg: '#edf4fb',
      header_text: '#3c556e',
      row_bg: '#ffffff',
      row_alt_bg: '#f7fafd',
      row_hover_bg: '#eef5fc',
      border: '#d6e3f0',
      selected_bg: 'rgba(148,104,22,0.08)',
      selected_text: '#946816',
    },
    sidebar: {
      bg: '#ffffff',
      border: '#d6e3f0',
      text: '#4a6580',
      text_hover: '#0f2238',
      text_active: '#946816',
      bg_active: 'rgba(148,104,22,0.10)',
      bg_hover: '#eef5fc',
      icons: '#5b7691',
      icons_active: '#946816',
    },
    footer: {
      bg: '#eaf2fa',
      border: '#d6e3f0',
      text: '#4a6580',
      link: '#3c556e',
      link_hover: '#946816',
      social_bg: '#ffffff',
      social_text: '#4a6580',
      social_hover_bg: '#946816',
      social_hover_text: '#ffffff',
    },
    shadows: {
      color: 'rgba(15,34,56,0.10)',
      size: '8px',
      blur: '28px',
    },
    scrollbar: {
      track: '#edf4fb',
      thumb: '#bdd0e3',
      thumb_hover: '#946816',
    },
    loading: {
      loader: '#946816',
      spinner: '#d6e3f0',
    },
  },
  fonts: {
    family: 'Tajawal, sans-serif',
    size_base: '16px',
  },
  animations: {
    transition_speed: '0.3s',
  },
  visuals: {
    glass_effect: true,
    blur_intensity: '12px',
    show_hero_image: true,
    hero_image_blend: 'luminosity',
  },
  seasonal: { ...WINTER_EID_SEASONAL_DEFAULTS },
};

/**
 * Expand 3-digit or 6-digit hex color to RGB tuple.
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('#')) return null;
  let clean = hex.trim();
  if (clean.length === 4) {
    clean = '#' + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16),
  };
}

/**
 * Determine whether a hex color is perceptually light (YIQ > 128).
 */
export function isHexColorLight(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 128;
}

/**
 * WCAG 2.1 relative luminance for contrast verification.
 */
export function computeRelativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const toLinear = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/**
 * WCAG 2.1 contrast ratio between two hex colors (1 to 21).
 */
export function getContrastRatio(hexA, hexB) {
  const l1 = computeRelativeLuminance(hexA);
  const l2 = computeRelativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a theme object supports the Winter Eid seasonal layer.
 */
export function isWinterEidTheme(theme) {
  if (!theme) return false;
  const seasonal = theme.seasonal || theme.variables?.seasonal;
  if (seasonal && seasonal.preset === 'winter-eid') return true;
  if (typeof theme.name === 'string' && theme.name.trim().toLowerCase() === WINTER_EID_THEME_NAME.toLowerCase()) {
    return true;
  }
  return false;
}

/**
 * Safely normalize a theme's seasonal configuration.
 * Returns null if the theme is not a seasonal theme.
 */
export function normalizeSeasonalConfig(theme) {
  if (!theme) return null;
  const raw = theme.seasonal || theme.variables?.seasonal || null;
  const isDefaultWinter = isWinterEidTheme(theme);

  if (!raw && !isDefaultWinter) return null;

  const merged = {
    ...WINTER_EID_SEASONAL_DEFAULTS,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  const intensity = merged.snow_intensity === 'medium' ? 'medium' : 'light';
  const greetingText = typeof merged.greeting_text === 'string' && merged.greeting_text.trim().length > 0
    ? merged.greeting_text.trim().slice(0, 120)
    : WINTER_EID_SEASONAL_DEFAULTS.greeting_text;

  return {
    enabled: Boolean(merged.enabled),
    preset: merged.preset || 'winter-eid',
    snow_enabled: Boolean(merged.snow_enabled),
    snow_intensity: intensity,
    eid_ornaments: Boolean(merged.eid_ornaments),
    frost_glass: Boolean(merged.frost_glass),
    greeting_bar_enabled: Boolean(merged.greeting_bar_enabled),
    greeting_text: greetingText,
    gold_accent: /^#[0-9a-fA-F]{6}$/.test(merged.gold_accent || '') ? merged.gold_accent : WINTER_EID_SEASONAL_DEFAULTS.gold_accent,
    ice_accent: /^#[0-9a-fA-F]{6}$/.test(merged.ice_accent || '') ? merged.ice_accent : WINTER_EID_SEASONAL_DEFAULTS.ice_accent,
  };
}

/**
 * Detect page scope so storefront gets full seasonal atmosphere
 * while Admin & Auth receive only the calm Winter Eid color palette.
 */
export function detectPageScope(pathname = '', markers = {}) {
  const path = String(pathname || '').toLowerCase();
  if (markers.hasAdminSidebar || path.includes('admin.html') || path.endsWith('/admin')) {
    return 'admin';
  }
  if (markers.hasAuthForm || path.includes('auth.html') || path.endsWith('/auth')) {
    return 'auth';
  }
  return 'storefront';
}

/**
 * Decide whether seasonal decorations/snowfall should mount on this page.
 */
export function shouldRenderSeasonalDecorations(scope, seasonalConfig) {
  if (scope !== 'storefront') return false;
  if (!seasonalConfig || !seasonalConfig.enabled) return false;
  return seasonalConfig.preset === 'winter-eid';
}

/**
 * Compute deterministic snowflake particle budget for smooth 60fps performance
 * across desktop & mobile while honoring prefers-reduced-motion.
 */
export function getSnowParticleCount(intensity, viewportWidth, prefersReducedMotion = false) {
  if (prefersReducedMotion) return 0;
  const isMobile = Number(viewportWidth) > 0 && Number(viewportWidth) < 768;
  if (intensity === 'medium') {
    return isMobile ? 24 : 52;
  }
  return isMobile ? 14 : 30;
}
