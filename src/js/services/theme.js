import { supabase } from '../config/supabase.js';

// Fallback Default Themes Configuration matching DB seeds
export const DEFAULT_THEMES = {
  "Dark Theme": {
    "name": "Dark Theme",
    "description": "المظهر الداكن الافتراضي الخاص بالنظام بألوان برتقالية وسوداء متناسقة.",
    "is_system": true,
    "colors": {
      "page": {
        "bg": "#0a0a0a",
        "bg_secondary": "#171717",
        "surface": "#171717",
        "text": "#f5f5f5",
        "text_muted": "#a3a3a3",
        "selection_bg": "#f97316",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#f97316",
        "primary_hover": "#ea580c",
        "secondary": "#262626",
        "secondary_hover": "#404040"
      },
      "top_nav": {
        "bg": "#171717",
        "border": "#262626",
        "logo": "#f97316",
        "text": "#f5f5f5",
        "link_active": "#f97316",
        "link_hover": "#ea580c",
        "icons": "#a3a3a3",
        "search_bg": "#0a0a0a",
        "search_border": "#262626",
        "search_text": "#f5f5f5"
      },
      "hero": {
        "bg": "#0a0a0a",
        "overlay": "linear-gradient(to bottom, rgba(10,10,10,0.4), rgba(10,10,10,1))",
        "title": "#ffffff",
        "subtitle": "#a3a3a3"
      },
      "buttons": {
        "primary": { "bg": "#f97316", "text": "#ffffff", "border": "transparent", "hover_bg": "#ea580c", "hover_text": "#ffffff", "active_bg": "#c2410c", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" },
        "secondary": { "bg": "#262626", "text": "#f5f5f5", "border": "#404040", "hover_bg": "#404040", "hover_text": "#ffffff", "active_bg": "#525252", "disabled_bg": "#171717", "disabled_text": "#737373" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" }
      },
      "product_cards": {
        "bg": "#171717",
        "border": "#262626",
        "radius": "16px",
        "title": "#f5f5f5",
        "price": "#f97316",
        "category": "#a3a3a3",
        "shadow": "0 4px 20px rgba(0,0,0,0.4)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 30px rgba(249,115,22,0.15)",
        "badge_bg": "#f97316",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#171717",
        "border": "#262626",
        "image_border": "#262626",
        "price": "#f97316",
        "text": "#f5f5f5",
        "text_secondary": "#a3a3a3",
        "quantity_bg": "#262626",
        "quantity_text": "#f5f5f5",
        "size_active_bg": "#f97316",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#262626",
        "size_inactive_text": "#a3a3a3",
        "color_border_active": "#f97316"
      },
      "inputs": {
        "bg": "#171717",
        "border": "#262626",
        "focus_border": "#f97316",
        "focus_ring": "rgba(249,115,22,0.2)",
        "placeholder": "#737373",
        "text": "#f5f5f5",
        "icons": "#a3a3a3"
      },
      "tables": {
        "header_bg": "#171717",
        "header_text": "#a3a3a3",
        "row_bg": "#171717",
        "row_alt_bg": "#1e1e1e",
        "row_hover_bg": "#262626",
        "border": "#262626",
        "selected_bg": "rgba(249,115,22,0.1)",
        "selected_text": "#f97316"
      },
      "sidebar": {
        "bg": "#171717",
        "border": "#262626",
        "text": "#a3a3a3",
        "text_hover": "#f5f5f5",
        "text_active": "#f97316",
        "bg_active": "rgba(249,115,22,0.1)",
        "bg_hover": "#262626",
        "icons": "#a3a3a3",
        "icons_active": "#f97316"
      },
      "footer": {
        "bg": "#0a0a0a",
        "border": "#171717",
        "text": "#a3a3a3",
        "link": "#a3a3a3",
        "link_hover": "#f97316",
        "social_bg": "#171717",
        "social_text": "#a3a3a3",
        "social_hover_bg": "#f97316",
        "social_hover_text": "#ffffff"
      },
      "shadows": {
        "color": "rgba(0,0,0,0.8)",
        "size": "10px",
        "blur": "40px"
      },
      "scrollbar": {
        "track": "#0a0a0a",
        "thumb": "#262626",
        "thumb_hover": "#f97316"
      },
      "loading": {
        "loader": "#f97316",
        "spinner": "#262626"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  },
  "Light Theme": {
    "name": "Light Theme",
    "description": "مظهر فاتح عصري ومريح للعين يبرز الهوية البرتقالية للموقع.",
    "is_system": true,
    "colors": {
      "page": {
        "bg": "#fafafa",
        "bg_secondary": "#ffffff",
        "surface": "#ffffff",
        "text": "#171717",
        "text_muted": "#737373",
        "selection_bg": "#f97316",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#f97316",
        "primary_hover": "#ea580c",
        "secondary": "#f5f5f5",
        "secondary_hover": "#e5e5e5"
      },
      "top_nav": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "logo": "#f97316",
        "text": "#171717",
        "link_active": "#f97316",
        "link_hover": "#ea580c",
        "icons": "#737373",
        "search_bg": "#fafafa",
        "search_border": "#e5e5e5",
        "search_text": "#171717"
      },
      "hero": {
        "bg": "#fafafa",
        "overlay": "linear-gradient(to bottom, rgba(250,250,250,0.3), rgba(250,250,250,1))",
        "title": "#171717",
        "subtitle": "#737373"
      },
      "buttons": {
        "primary": { "bg": "#f97316", "text": "#ffffff", "border": "transparent", "hover_bg": "#ea580c", "hover_text": "#ffffff", "active_bg": "#c2410c", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" },
        "secondary": { "bg": "#f5f5f5", "text": "#171717", "border": "#d4d4d4", "hover_bg": "#e5e5e5", "hover_text": "#171717", "active_bg": "#d4d4d4", "disabled_bg": "#fafafa", "disabled_text": "#a3a3a3" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" }
      },
      "product_cards": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "radius": "16px",
        "title": "#171717",
        "price": "#f97316",
        "category": "#737373",
        "shadow": "0 4px 15px rgba(0,0,0,0.05)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 25px rgba(249,115,22,0.1)",
        "badge_bg": "#f97316",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "image_border": "#e5e5e5",
        "price": "#f97316",
        "text": "#171717",
        "text_secondary": "#737373",
        "quantity_bg": "#f5f5f5",
        "quantity_text": "#171717",
        "size_active_bg": "#f97316",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#f5f5f5",
        "size_inactive_text": "#737373",
        "color_border_active": "#f97316"
      },
      "inputs": {
        "bg": "#ffffff",
        "border": "#d4d4d4",
        "focus_border": "#f97316",
        "focus_ring": "rgba(249,115,22,0.15)",
        "placeholder": "#a3a3a3",
        "text": "#171717",
        "icons": "#737373"
      },
      "tables": {
        "header_bg": "#f5f5f5",
        "header_text": "#737373",
        "row_bg": "#ffffff",
        "row_alt_bg": "#fafafa",
        "row_hover_bg": "#f5f5f5",
        "border": "#e5e5e5",
        "selected_bg": "rgba(249,115,22,0.05)",
        "selected_text": "#f97316"
      },
      "sidebar": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "text": "#737373",
        "text_hover": "#171717",
        "text_active": "#f97316",
        "bg_active": "rgba(249,115,22,0.08)",
        "bg_hover": "#f5f5f5",
        "icons": "#737373",
        "icons_active": "#f97316"
      },
      "footer": {
        "bg": "#fafafa",
        "border": "#e5e5e5",
        "text": "#737373",
        "link": "#737373",
        "link_hover": "#f97316",
        "social_bg": "#ffffff",
        "social_text": "#737373",
        "social_hover_bg": "#f97316",
        "social_hover_text": "#ffffff"
      },
      "shadows": {
        "color": "rgba(0,0,0,0.1)",
        "size": "6px",
        "blur": "20px"
      },
      "scrollbar": {
        "track": "#fafafa",
        "thumb": "#d4d4d4",
        "thumb_hover": "#f97316"
      },
      "loading": {
        "loader": "#f97316",
        "spinner": "#e5e5e5"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  },
  "Warm Theme": {
    "name": "Warm Theme",
    "description": "مظهر دافئ مريح بلون بيج رملي وهادي مع لمسات برتقالية ناعمة.",
    "is_system": true,
    "colors": {
      "page": {
        "bg": "#fdf6e2",
        "bg_secondary": "#f4ebd0",
        "surface": "#f4ebd0",
        "text": "#2e2315",
        "text_muted": "#705a41",
        "selection_bg": "#f97316",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#f97316",
        "primary_hover": "#ea580c",
        "secondary": "#ebdcb9",
        "secondary_hover": "#c4b28d"
      },
      "top_nav": {
        "bg": "#f4ebd0",
        "border": "#e6d5b8",
        "logo": "#f97316",
        "text": "#2e2315",
        "link_active": "#f97316",
        "link_hover": "#ea580c",
        "icons": "#705a41",
        "search_bg": "#fdf6e2",
        "search_border": "#e6d5b8",
        "search_text": "#2e2315"
      },
      "hero": {
        "bg": "#fdf6e2",
        "overlay": "linear-gradient(to bottom, rgba(253,246,226,0.3), rgba(253,246,226,1))",
        "title": "#2e2315",
        "subtitle": "#705a41"
      },
      "buttons": {
        "primary": { "bg": "#f97316", "text": "#ffffff", "border": "transparent", "hover_bg": "#ea580c", "hover_text": "#ffffff", "active_bg": "#c2410c", "disabled_bg": "#ebdcb9", "disabled_text": "#705a41" },
        "secondary": { "bg": "#ebdcb9", "text": "#2e2315", "border": "#c4b28d", "hover_bg": "#c4b28d", "hover_text": "#2e2315", "active_bg": "#b5a37e", "disabled_bg": "#fdf6e2", "disabled_text": "#705a41" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#ebdcb9", "disabled_text": "#705a41" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#ebdcb9", "disabled_text": "#705a41" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#ebdcb9", "disabled_text": "#705a41" }
      },
      "product_cards": {
        "bg": "#f4ebd0",
        "border": "#e6d5b8",
        "radius": "16px",
        "title": "#2e2315",
        "price": "#f97316",
        "category": "#705a41",
        "shadow": "0 4px 15px rgba(112,90,65,0.08)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 25px rgba(249,115,22,0.1)",
        "badge_bg": "#f97316",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#f4ebd0",
        "border": "#e6d5b8",
        "image_border": "#e6d5b8",
        "price": "#f97316",
        "text": "#2e2315",
        "text_secondary": "#705a41",
        "quantity_bg": "#ebdcb9",
        "quantity_text": "#2e2315",
        "size_active_bg": "#f97316",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#ebdcb9",
        "size_inactive_text": "#705a41",
        "color_border_active": "#f97316"
      },
      "inputs": {
        "bg": "#fdf6e2",
        "border": "#c4b28d",
        "focus_border": "#f97316",
        "focus_ring": "rgba(249,115,22,0.15)",
        "placeholder": "#a8957e",
        "text": "#2e2315",
        "icons": "#705a41"
      },
      "tables": {
        "header_bg": "#ebdcb9",
        "header_text": "#705a41",
        "row_bg": "#f4ebd0",
        "row_alt_bg": "#ebdcb9",
        "row_hover_bg": "#c4b28d",
        "border": "#e6d5b8",
        "selected_bg": "rgba(249,115,22,0.08)",
        "selected_text": "#f97316"
      },
      "sidebar": {
        "bg": "#f4ebd0",
        "border": "#e6d5b8",
        "text": "#705a41",
        "text_hover": "#2e2315",
        "text_active": "#f97316",
        "bg_active": "rgba(249,115,22,0.08)",
        "bg_hover": "#ebdcb9",
        "icons": "#705a41",
        "icons_active": "#f97316"
      },
      "footer": {
        "bg": "#fdf6e2",
        "border": "#e6d5b8",
        "text": "#705a41",
        "link": "#705a41",
        "link_hover": "#f97316",
        "social_bg": "#f4ebd0",
        "social_text": "#705a41",
        "social_hover_bg": "#f97316",
        "social_hover_text": "#ffffff"
      },
      "shadows": {
        "color": "rgba(46,35,21,0.15)",
        "size": "6px",
        "blur": "20px"
      },
      "scrollbar": {
        "track": "#fdf6e2",
        "thumb": "#c4b28d",
        "thumb_hover": "#f97316"
      },
      "loading": {
        "loader": "#f97316",
        "spinner": "#e6d5b8"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  },
  "Midnight Theme": {
    "name": "Midnight Theme",
    "description": "مظهر غامق بلون كحلي جذاب وتفاصيل عصرية تدمج التكنولوجيا بالفخامة.",
    "is_system": true,
    "colors": {
      "page": {
        "bg": "#0b0f19",
        "bg_secondary": "#161e2e",
        "surface": "#161e2e",
        "text": "#f3f4f6",
        "text_muted": "#9ca3af",
        "selection_bg": "#f97316",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#f97316",
        "primary_hover": "#ea580c",
        "secondary": "#1f2937",
        "secondary_hover": "#374151"
      },
      "top_nav": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "logo": "#f97316",
        "text": "#f3f4f6",
        "link_active": "#f97316",
        "link_hover": "#ea580c",
        "icons": "#9ca3af",
        "search_bg": "#0b0f19",
        "search_border": "#1f2937",
        "search_text": "#f3f4f6"
      },
      "hero": {
        "bg": "#0b0f19",
        "overlay": "linear-gradient(to bottom, rgba(11,15,25,0.4), rgba(11,15,25,1))",
        "title": "#ffffff",
        "subtitle": "#9ca3af"
      },
      "buttons": {
        "primary": { "bg": "#f97316", "text": "#ffffff", "border": "transparent", "hover_bg": "#ea580c", "hover_text": "#ffffff", "active_bg": "#c2410c", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" },
        "secondary": { "bg": "#1f2937", "text": "#f3f4f6", "border": "#374151", "hover_bg": "#374151", "hover_text": "#ffffff", "active_bg": "#4b5563", "disabled_bg": "#161e2e", "disabled_text": "#6b7280" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" }
      },
      "product_cards": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "radius": "16px",
        "title": "#f3f4f6",
        "price": "#f97316",
        "category": "#9ca3af",
        "shadow": "0 4px 20px rgba(0,0,0,0.4)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 30px rgba(249,115,22,0.15)",
        "badge_bg": "#f97316",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "image_border": "#1f2937",
        "price": "#f97316",
        "text": "#f3f4f6",
        "text_secondary": "#9ca3af",
        "quantity_bg": "#1f2937",
        "quantity_text": "#f3f4f6",
        "size_active_bg": "#f97316",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#1f2937",
        "size_inactive_text": "#9ca3af",
        "color_border_active": "#f97316"
      },
      "inputs": {
        "bg": "#0b0f19",
        "border": "#374151",
        "focus_border": "#f97316",
        "focus_ring": "rgba(249,115,22,0.2)",
        "placeholder": "#4b5563",
        "text": "#f3f4f6",
        "icons": "#9ca3af"
      },
      "tables": {
        "header_bg": "#1f2937",
        "header_text": "#9ca3af",
        "row_bg": "#161e2e",
        "row_alt_bg": "#1f2937",
        "row_hover_bg": "#374151",
        "border": "#1f2937",
        "selected_bg": "rgba(249,115,22,0.1)",
        "selected_text": "#f97316"
      },
      "sidebar": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "text": "#9ca3af",
        "text_hover": "#f3f4f6",
        "text_active": "#f97316",
        "bg_active": "rgba(249,115,22,0.1)",
        "bg_hover": "#1f2937",
        "icons": "#9ca3af",
        "icons_active": "#f97316"
      },
      "footer": {
        "bg": "#0b0f19",
        "border": "#161e2e",
        "text": "#9ca3af",
        "link": "#9ca3af",
        "link_hover": "#f97316",
        "social_bg": "#161e2e",
        "social_text": "#9ca3af",
        "social_hover_bg": "#f97316",
        "social_hover_text": "#ffffff"
      },
      "shadows": {
        "color": "rgba(0,0,0,0.5)",
        "size": "10px",
        "blur": "40px"
      },
      "scrollbar": {
        "track": "#0b0f19",
        "thumb": "#1f2937",
        "thumb_hover": "#f97316"
      },
      "loading": {
        "loader": "#f97316",
        "spinner": "#1f2937"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  }
};

/**
 * Apply the theme config values to HTML body and create dynamic style rules.
 */
export function applyTheme(theme) {
  if (!theme || !theme.colors) return;

  const colors = theme.colors;
  const fonts = theme.fonts || {};
  const animations = theme.animations || {};
  const visuals = theme.visuals || {};

  // 1. Get or create stylesheet
  let styleEl = document.getElementById('devo-theme-styles-dynamic');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'devo-theme-styles-dynamic';
    document.head.appendChild(styleEl);
  }

  // 2. Build CSS Variables block
  let cssText = `
    :root {
      /* Page Level Backgrounds & Texts */
      --devo-black: ${colors.page.bg} !important;
      --devo-dark: ${colors.page.bg_secondary || colors.page.surface} !important;
      --devo-gray: ${colors.borders?.color || '#262626'} !important;
      --devo-gray-hover: ${colors.brand?.secondary_hover || '#404040'} !important;
      --devo-orange: ${colors.brand?.primary || '#f97316'} !important;
      --devo-orange-hover: ${colors.brand?.primary_hover || '#ea580c'} !important;
      --devo-text: ${colors.page.text || '#f5f5f5'} !important;
      --devo-muted: ${colors.page.text_muted || '#a3a3a3'} !important;
      --devo-success: ${colors.alerts?.success?.text || '#10b981'} !important;
      --devo-error: ${colors.alerts?.error?.text || '#ef4444'} !important;
      --devo-warning: ${colors.alerts?.warning?.text || '#f59e0b'} !important;
      --devo-info: ${colors.alerts?.info?.text || '#3b82f6'} !important;

      /* Selection Color */
      --selection-bg: ${colors.page.selection_bg || '#f97316'} !important;
      --selection-text: ${colors.page.selection_text || '#ffffff'} !important;

      /* Shadows */
      --shadow-color: ${colors.shadows?.color || 'rgba(0,0,0,0.8)'} !important;
      --shadow-size: ${colors.shadows?.size || '10px'} !important;
      --shadow-blur: ${colors.shadows?.blur || '40px'} !important;
      --shadow-devo-float: 0 var(--shadow-size) var(--shadow-blur) -10px var(--shadow-color) !important;

      /* Borders */
      --border-color: ${colors.borders?.color || '#262626'} !important;
      --border-width: ${colors.borders?.width || '1px'} !important;
      --border-radius-base: ${colors.borders?.radius || '12px'} !important;

      /* Scrollbar */
      --scrollbar-track: ${colors.scrollbar?.track || '#0a0a0a'} !important;
      --scrollbar-thumb: ${colors.scrollbar?.thumb || '#262626'} !important;
      --scrollbar-thumb-hover: ${colors.scrollbar?.thumb_hover || '#f97316'} !important;

      /* Loader */
      --loader-color: ${colors.loading?.loader || '#f97316'} !important;
      --spinner-track: ${colors.loading?.spinner || '#262626'} !important;

      /* Transitions */
      --transition-speed: ${animations.transition_speed || '0.3s'} !important;

      /* Fonts */
      --font-family: ${fonts.family || "'Tajawal', sans-serif"} !important;
      --font-size-base: ${fonts.size_base || '16px'} !important;
    }

    body {
      background-color: var(--devo-black) !important;
      color: var(--devo-text) !important;
      font-family: var(--font-family) !important;
      font-size: var(--font-size-base) !important;
    }

    body, input, select, textarea, button, span, p, h1, h2, h3, h4, h5, h6, td, th {
      font-family: var(--font-family) !important;
    }

    ::selection {
      background-color: var(--selection-bg) !important;
      color: var(--selection-text) !important;
    }

    /* Scrollbars Custom Overrides */
    ::-webkit-scrollbar {
      width: 6px !important;
      height: 6px !important;
    }
    ::-webkit-scrollbar-track {
      background: var(--scrollbar-track) !important;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb) !important;
      border-radius: 4px !important;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-hover) !important;
    }

    /* Target loaders / spinners */
    .ph-spinner {
      color: var(--loader-color) !important;
    }
  `;

  // 3. Modals & Shadows Overrides
  cssText += `
    .shadow-devo-float, .shadow-2xl {
      box-shadow: var(--shadow-devo-float) !important;
    }
  `;

  // 4. Top Navigation Overrides
  if (colors.top_nav) {
    cssText += `
      /* Header & Topnav Elements */
      header, .top-navigation, #admin-topbar, .bg-devo-dark.border-b.border-devo-gray {
        background-color: ${colors.top_nav.bg} !important;
        border-color: ${colors.top_nav.border} !important;
        color: ${colors.top_nav.text} !important;
      }
      header a, .top-navigation a, #admin-topbar a {
        color: ${colors.top_nav.text} !important;
      }
      header a.active, .top-navigation a.active, #admin-topbar a.active {
        color: ${colors.top_nav.link_active} !important;
      }
      header a:hover, .top-navigation a:hover, #admin-topbar a:hover {
        color: ${colors.top_nav.link_hover} !important;
      }
      header i, .top-navigation i, #admin-topbar i {
        color: ${colors.top_nav.icons} !important;
      }
      header input, .top-navigation input, #admin-topbar input {
        background-color: ${colors.top_nav.search_bg} !important;
        border-color: ${colors.top_nav.search_border} !important;
        color: ${colors.top_nav.search_text} !important;
      }
    `;
  }

  // 5. Hero Overrides
  if (colors.hero) {
    cssText += `
      .hero-bg, [data-theme-hero="true"] {
        background-image: ${colors.hero.overlay ? colors.hero.overlay + ', ' : ''} var(--hero-bg-url, url('')) !important;
        background-color: ${colors.hero.bg} !important;
      }
      .hero-bg h1, [data-theme-hero="true"] h1 {
        color: ${colors.hero.title} !important;
      }
      .hero-bg p, [data-theme-hero="true"] p {
        color: ${colors.hero.subtitle} !important;
      }
    `;
  }

  // 6. Buttons Styling
  if (colors.buttons) {
    const btnTypes = ['primary', 'secondary', 'success', 'warning', 'danger'];
    btnTypes.forEach(type => {
      const btn = colors.buttons[type];
      if (btn) {
        // We override standard bg, text, borders for tailwind custom button classes
        cssText += `
          .btn-${type}, button.btn-${type}, [data-btn="${type}"] {
            background-color: ${btn.bg} !important;
            color: ${btn.text} !important;
            border: 1px solid ${btn.border || 'transparent'} !important;
          }
          .btn-${type}:hover, button.btn-${type}:hover, [data-btn="${type}"]:hover {
            background-color: ${btn.hover_bg} !important;
            color: ${btn.hover_text || btn.text} !important;
            border-color: ${btn.hover_border || btn.border || 'transparent'} !important;
          }
          .btn-${type}:active, button.btn-${type}:active, [data-btn="${type}"]:active {
            background-color: ${btn.active_bg || btn.hover_bg} !important;
          }
          .btn-${type}:disabled, button.btn-${type}:disabled, [data-btn="${type}"]:disabled {
            background-color: ${btn.disabled_bg || '#262626'} !important;
            color: ${btn.disabled_text || '#a3a3a3'} !important;
            border-color: transparent !important;
            cursor: not-allowed;
            opacity: 0.6;
          }
        `;
      }
    });
  }

  // 7. Inputs Overrides
  if (colors.inputs) {
    cssText += `
      input:not([type="checkbox"]):not([type="radio"]):not([type="color"]), select, textarea {
        background-color: ${colors.inputs.bg} !important;
        border-color: ${colors.inputs.border} !important;
        color: ${colors.inputs.text} !important;
      }
      input::placeholder, textarea::placeholder, select::placeholder {
        color: ${colors.inputs.placeholder} !important;
      }
      input:focus, select:focus, textarea:focus {
        border-color: ${colors.inputs.focus_border} !important;
        box-shadow: 0 0 0 2px ${colors.inputs.focus_ring} !important;
        outline: none !important;
      }
    `;
  }

  // 8. Tables Styling
  if (colors.tables) {
    cssText += `
      table {
        border-color: ${colors.tables.border} !important;
      }
      table border-devo-gray {
        border-color: ${colors.tables.border} !important;
      }
      thead, thead th, table th, tr.bg-devo-dark\\/50 {
        background-color: ${colors.tables.header_bg} !important;
        color: ${colors.tables.header_text} !important;
      }
      tbody tr, table tr {
        background-color: ${colors.tables.row_bg} !important;
        border-bottom: 1px solid ${colors.tables.border} !important;
      }
      tbody tr:nth-child(even), table tr:nth-child(even) {
        background-color: ${colors.tables.row_alt_bg || colors.tables.row_bg} !important;
      }
      tbody tr:hover, table tr:hover {
        background-color: ${colors.tables.row_hover_bg} !important;
      }
      tbody tr.selected, table tr.selected {
        background-color: ${colors.tables.selected_bg} !important;
        color: ${colors.tables.selected_text} !important;
      }
    `;
  }

  // 9. Sidebar Overrides
  if (colors.sidebar) {
    cssText += `
      #main-sidebar, aside {
        background-color: ${colors.sidebar.bg} !important;
        border-color: ${colors.sidebar.border} !important;
      }
      #main-sidebar .nav-link, aside a, .sidebar-item {
        color: ${colors.sidebar.text} !important;
      }
      #main-sidebar .nav-link:hover, aside a:hover, .sidebar-item:hover {
        background-color: ${colors.sidebar.bg_hover} !important;
        color: ${colors.sidebar.text_hover} !important;
      }
      #main-sidebar .nav-link.bg-devo-orange\\/10, #main-sidebar .nav-link.text-devo-orange, aside a.active, .sidebar-item.active {
        background-color: ${colors.sidebar.bg_active} !important;
        color: ${colors.sidebar.text_active} !important;
      }
      #main-sidebar .nav-link i, aside a i, .sidebar-item i {
        color: ${colors.sidebar.icons} !important;
      }
      #main-sidebar .nav-link.bg-devo-orange\\/10 i, #main-sidebar .nav-link.text-devo-orange i, aside a.active i, .sidebar-item.active i {
        color: ${colors.sidebar.icons_active} !important;
      }
    `;
  }

  // 10. Footer Overrides
  if (colors.footer) {
    cssText += `
      footer {
        background-color: ${colors.footer.bg} !important;
        border-color: ${colors.footer.border} !important;
        color: ${colors.footer.text} !important;
      }
      footer a, footer button {
        color: ${colors.footer.link} !important;
      }
      footer a:hover, footer button:hover {
        color: ${colors.footer.link_hover} !important;
      }
      footer .social-btn, footer a[id^="link-"] {
        background-color: ${colors.footer.social_bg} !important;
        color: ${colors.footer.social_text} !important;
      }
      footer .social-btn:hover, footer a[id^="link-"]:hover {
        background-color: ${colors.footer.social_hover_bg} !important;
        color: ${colors.footer.social_hover_text} !important;
      }
    `;
  }

  // 11. Cards Styling
  if (colors.cards) {
    // Product cards (gallery, home, warehouse)
    cssText += `
      .product-card, [data-card-type="product"], .card-hover {
        background-color: ${colors.cards.product.bg || colors.product_cards?.bg} !important;
        border-color: ${colors.cards.product.border || colors.product_cards?.border} !important;
        border-radius: ${colors.cards.product.radius || colors.product_cards?.radius} !important;
        box-shadow: ${colors.cards.product.shadow || colors.product_cards?.shadow} !important;
        transition: transform var(--transition-speed), box-shadow var(--transition-speed) !important;
      }
      .product-card:hover, [data-card-type="product"]:hover, .card-hover:hover {
        box-shadow: ${colors.product_cards?.hover_shadow || '0 10px 30px rgba(0,0,0,0.5)'} !important;
        ${colors.cards.product.hover_anim === 'translate-y' || colors.product_cards?.hover_effect === 'translate-y' ? 'transform: translateY(-4px) !important;' : ''}
        ${colors.cards.product.hover_anim === 'scale' || colors.product_cards?.hover_effect === 'scale' ? 'transform: scale(1.02) !important;' : ''}
      }
      .product-card h3, .product-card h4 {
        color: ${colors.product_cards?.title || colors.page.text} !important;
      }
      .product-card .price {
        color: ${colors.product_cards?.price || colors.brand.primary} !important;
      }
      .product-card .category {
        color: ${colors.product_cards?.category || colors.page.text_muted} !important;
      }

      /* Statistics Cards */
      .stat-card, [data-card-type="statistics"] {
        background-color: ${colors.cards.statistics.bg} !important;
        border-color: ${colors.cards.statistics.border} !important;
        border-radius: ${colors.cards.statistics.radius} !important;
        box-shadow: ${colors.cards.statistics.shadow} !important;
      }
      
      /* Dashboard Cards */
      .dashboard-card, [data-card-type="dashboard"] {
        background-color: ${colors.cards.dashboard.bg} !important;
        border-color: ${colors.cards.dashboard.border} !important;
        border-radius: ${colors.cards.dashboard.radius} !important;
        box-shadow: ${colors.cards.dashboard.shadow} !important;
      }
      
      /* Order Cards */
      .order-card, [data-card-type="order"], .bg-devo-dark.border.border-devo-gray.rounded-xl.p-4 {
        background-color: ${colors.cards.order.bg} !important;
        border-color: ${colors.cards.order.border} !important;
        border-radius: ${colors.cards.order.radius} !important;
        box-shadow: ${colors.cards.order.shadow} !important;
      }
    `;
  }

  // 12. Alerts & Badges Overrides
  if (colors.alerts) {
    cssText += `
      .alert-success, .bg-devo-success\\/10 { background-color: ${colors.alerts.success.bg} !important; color: ${colors.alerts.success.text} !important; border-color: ${colors.alerts.success.border} !important; }
      .alert-error, .alert-danger, .bg-devo-error\\/10 { background-color: ${colors.alerts.error.bg} !important; color: ${colors.alerts.error.text} !important; border-color: ${colors.alerts.error.border} !important; }
      .alert-warning, .bg-devo-warning\\/10 { background-color: ${colors.alerts.warning.bg} !important; color: ${colors.alerts.warning.text} !important; border-color: ${colors.alerts.warning.border} !important; }
      .alert-info, .bg-devo-info\\/10 { background-color: ${colors.alerts.info.bg} !important; color: ${colors.alerts.info.text} !important; border-color: ${colors.alerts.info.border} !important; }
    `;
  }
  if (colors.badges) {
    cssText += `
      .badge-orange, .badge-primary, .bg-devo-orange { background-color: ${colors.badges.orange.bg} !important; color: ${colors.badges.orange.text} !important; }
      .badge-success, .bg-devo-success { background-color: ${colors.badges.success.bg} !important; color: ${colors.badges.success.text} !important; }
      .badge-error, .badge-danger, .bg-devo-error { background-color: ${colors.badges.error.bg} !important; color: ${colors.badges.error.text} !important; }
      .badge-warning, .bg-devo-warning { background-color: ${colors.badges.warning.bg} !important; color: ${colors.badges.warning.text} !important; }
      .badge-info, .bg-devo-info { background-color: ${colors.badges.info.bg} !important; color: ${colors.badges.info.text} !important; }
    `;
  }

  // 13. Product Details Modal Overrides
  if (colors.modal) {
    cssText += `
      #order-details-modal > div, #product-details-modal > div, [data-modal="details"] {
        background-color: ${colors.modal.bg} !important;
        border-color: ${colors.modal.border} !important;
      }
      #order-details-modal img, #product-details-modal img {
        border-color: ${colors.modal.image_border} !important;
      }
      .price-text, .text-devo-orange {
        color: ${colors.modal.price} !important;
      }
      #order-details-modal .text-white, #product-details-modal .text-white, [data-modal="details"] .text-white {
        color: ${colors.page.text} !important;
      }
      /* Quantity Counter Controls */
      .qty-control, .quantity-control {
        background-color: ${colors.modal.quantity_bg} !important;
        color: ${colors.modal.quantity_text} !important;
      }
      /* Size Selector Controls */
      .size-option, .size-selector-btn {
        background-color: ${colors.modal.size_inactive_bg} !important;
        color: ${colors.modal.size_inactive_text} !important;
      }
      .size-option.active, .size-selector-btn.active {
        background-color: ${colors.modal.size_active_bg} !important;
        color: ${colors.modal.size_active_text} !important;
      }
      /* Color Selector Controls */
      .color-option.active {
        border-color: ${colors.modal.color_border_active} !important;
        box-shadow: 0 0 0 2px ${colors.modal.color_border_active} !important;
      }
    `;
  }

  // 14. Toasts & Cart Overrides
  if (colors.toasts) {
    cssText += `
      .toast-container > div, #toast-container > div {
        background-color: ${colors.toasts.bg} !important;
        border: 1px solid ${colors.toasts.border} !important;
        color: ${colors.toasts.text} !important;
      }
    `;
  }
  if (colors.cart) {
    cssText += `
      #cart-sidebar, .cart-sidebar {
        background-color: ${colors.cart.bg} !important;
        border-color: ${colors.cart.border} !important;
        color: ${colors.cart.text} !important;
      }
      .cart-totals {
        background-color: ${colors.cart.totals_bg} !important;
        color: ${colors.cart.totals_text} !important;
      }
    `;
  }

  styleEl.innerHTML = cssText;
}

/**
 * Sync the active theme from the database.
 * Updates local cache and applies theme changes.
 */
export async function syncActiveTheme() {
  try {
    const { data: theme, error } = await supabase
      .from('themes')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.warn('Supabase theme sync error:', error.message);
      loadCachedOrFallback();
      return;
    }

    if (theme) {
      const cachedStr = localStorage.getItem('devo_active_theme');
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        // Only update cache and re-apply if it is a different theme or has been updated
        if (cached.id !== theme.id || cached.updated_at !== theme.updated_at || JSON.stringify(cached.colors) !== JSON.stringify(theme.variables.colors)) {
          updateCacheAndApply(theme);
        } else {
          // Re-apply cached details just to be safe
          applyTheme(cached);
        }
      } else {
        updateCacheAndApply(theme);
      }
    } else {
      // No active theme in DB, use Dark Theme default
      loadCachedOrFallback();
    }
  } catch (e) {
    console.error('Failed to sync active theme:', e);
    loadCachedOrFallback();
  }
}

function updateCacheAndApply(dbTheme) {
  const themeObj = {
    id: dbTheme.id,
    name: dbTheme.name,
    description: dbTheme.description,
    is_system: dbTheme.is_system,
    updated_at: dbTheme.updated_at,
    colors: dbTheme.variables.colors,
    fonts: dbTheme.variables.fonts,
    animations: dbTheme.variables.animations,
    visuals: dbTheme.variables.visuals
  };
  localStorage.setItem('devo_active_theme', JSON.stringify(themeObj));
  applyTheme(themeObj);
}

function loadCachedOrFallback() {
  const cachedStr = localStorage.getItem('devo_active_theme');
  if (cachedStr) {
    try {
      applyTheme(JSON.parse(cachedStr));
    } catch (e) {
      applyTheme(DEFAULT_THEMES["Dark Theme"]);
    }
  } else {
    applyTheme(DEFAULT_THEMES["Dark Theme"]);
  }
}

// --- Admin Panel API Operations ---

export async function loadAllThemes() {
  try {
    const { data, error } = await supabase
      .from('themes')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Auto-heal/seed missing system themes in database if the logged in user is admin/owner
    const sessionStr = localStorage.getItem('devo_session');
    if (sessionStr && data) {
      try {
        const session = JSON.parse(sessionStr);
        if (session && ['owner', 'admin'].includes(session.role)) {
          const dbSystemThemeNames = data.filter(t => t.is_system).map(t => t.name);
          const missingSystemThemes = Object.keys(DEFAULT_THEMES).filter(name => !dbSystemThemeNames.includes(name));
          
          if (missingSystemThemes.length > 0) {
            console.log('Seeding missing system themes:', missingSystemThemes);
            const inserts = missingSystemThemes.map(name => ({
              name: name,
              description: DEFAULT_THEMES[name].description,
              is_system: true,
              is_active: false,
              variables: DEFAULT_THEMES[name]
            }));
            
            const { data: seeded, error: seedErr } = await supabase
              .from('themes')
              .insert(inserts)
              .select();
              
            if (!seedErr && seeded) {
              const combined = [...data, ...seeded];
              combined.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
              return combined;
            }
          }
        }
      } catch (e) {
        console.warn('Auto-seeding system themes failed:', e.message);
      }
    }

    return data;
  } catch (e) {
    console.warn('Using system themes list. Error:', e.message);
    // Return system defaults as fallback list
    return Object.keys(DEFAULT_THEMES).map((name, index) => ({
      id: `sys-${index}`,
      name: name,
      description: DEFAULT_THEMES[name].description,
      is_system: true,
      is_active: index === 0, // Dark active
      variables: DEFAULT_THEMES[name]
    }));
  }
}

export async function createNewTheme(name, baseOnThemeVariables, description = '') {
  const { data, error } = await supabase
    .from('themes')
    .insert({
      name: name,
      description: description || 'تم إنشاؤه مخصصاً بواسطة لوحة التحكم.',
      is_active: false,
      is_system: false,
      variables: baseOnThemeVariables
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTheme(themeId, variables, description) {
  const { data, error } = await supabase
    .from('themes')
    .update({
      variables: variables,
      description: description,
      updated_at: new Date().toISOString()
    })
    .eq('id', themeId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function activateTheme(themeId) {
  // Set all is_active to false
  const { error: resetError } = await supabase
    .from('themes')
    .update({ is_active: false })
    .neq('id', themeId);
    
  if (resetError) throw resetError;

  // Set selected is_active to true
  const { data: updatedTheme, error: selectError } = await supabase
    .from('themes')
    .update({ is_active: true })
    .eq('id', themeId)
    .select()
    .single();

  if (selectError) throw selectError;

  // Refresh current active cache
  updateCacheAndApply(updatedTheme);
  return updatedTheme;
}

export async function duplicateTheme(themeId, newName) {
  // Fetch source theme
  const { data: source, error: fetchError } = await supabase
    .from('themes')
    .select('*')
    .eq('id', themeId)
    .single();

  if (fetchError) throw fetchError;

  // Create duplicate
  const { data: duplicated, error: insertError } = await supabase
    .from('themes')
    .insert({
      name: newName,
      description: `نسخة مكررة من ${source.name}.`,
      is_active: false,
      is_system: false,
      variables: source.variables
    })
    .select()
    .single();

  if (insertError) throw insertError;
  return duplicated;
}

export async function deleteTheme(themeId) {
  // Verify it is not active or system
  const { data: check, error: fetchError } = await supabase
    .from('themes')
    .select('*')
    .eq('id', themeId)
    .single();

  if (fetchError) throw fetchError;
  if (check.is_active) throw new Error('لا يمكن حذف المظهر النشط حالياً.');
  if (check.is_system) throw new Error('لا يمكن حذف المظاهر الافتراضية للنظام.');

  const { error: deleteError } = await supabase
    .from('themes')
    .delete()
    .eq('id', themeId);

  if (deleteError) throw deleteError;
  return true;
}

export async function resetSystemTheme(themeId, name) {
  const original = DEFAULT_THEMES[name];
  if (!original) throw new Error('مظهر النظام غير معرّف في الكود البرمجي الرئيسي.');
  
  return await updateTheme(themeId, original, original.description);
}
