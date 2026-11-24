/**
 * Storefront-only Seasonal Atmosphere Engine for Winter Eid Theme.
 * Renders gentle GPU-friendly snowfall canvas, delicate SVG Eid crescent & lanterns,
 * frosted winter accents, and a slim dismissible Eid greeting ribbon.
 * Automatically tears down on Admin/Auth pages or when switching themes.
 */

import {
  normalizeSeasonalConfig,
  detectPageScope,
  shouldRenderSeasonalDecorations,
  getSnowParticleCount,
} from './seasonal_config.js';

const STYLE_ID = 'devo-seasonal-styles';
const SNOW_CANVAS_ID = 'devo-seasonal-snow-canvas';
const HERO_ORNAMENTS_ID = 'devo-winter-eid-hero-ornaments';
const GREETING_BAR_ID = 'devo-eid-greeting-bar';
const FOOTER_ACCENT_ID = 'devo-winter-eid-footer-accent';
const GREETING_DISMISS_KEY = 'devo_eid_greeting_dismissed';

let snowRafId = null;
let resizeHandler = null;
let visibilityHandler = null;
let reducedMotionMql = null;
let reducedMotionListener = null;
let snowParticles = [];
let activeSnowIntensity = 'light';

function getCurrentPageScope() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'storefront';
  return detectPageScope(window.location?.pathname || '', {
    hasAdminSidebar: Boolean(document.getElementById('main-sidebar') || document.getElementById('admin-topbar')),
    hasAuthForm: Boolean(document.getElementById('auth-form') || document.getElementById('login-container')),
  });
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stopSnowLoop() {
  if (snowRafId !== null) {
    cancelAnimationFrame(snowRafId);
    snowRafId = null;
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (reducedMotionMql && reducedMotionListener) {
    try {
      reducedMotionMql.removeEventListener('change', reducedMotionListener);
    } catch {
      // Safari fallback
    }
    reducedMotionListener = null;
    reducedMotionMql = null;
  }
  snowParticles = [];
  const canvas = document.getElementById(SNOW_CANVAS_ID);
  if (canvas) canvas.remove();
}

/**
 * Cleanly remove all seasonal DOM nodes, styles, and animation frames.
 */
export function teardownSeasonalEffects() {
  if (typeof document === 'undefined') return;
  stopSnowLoop();

  [STYLE_ID, HERO_ORNAMENTS_ID, GREETING_BAR_ID, FOOTER_ACCENT_ID].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  ['display-hero-title', 'display-hero-subtitle', 'hero-content-card'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.getAttribute('data-seasonal-styled') === 'true') {
      el.removeAttribute('data-seasonal-styled');
      el.style.removeProperty('color');
      el.style.removeProperty('background-color');
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
      el.style.removeProperty('border');
      el.style.removeProperty('box-shadow');
    }
  });

  if (document.documentElement) {
    document.documentElement.removeAttribute('data-seasonal-active');
    document.documentElement.removeAttribute('data-theme-preset');
  }
}

function createSnowParticles(width, height, count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const isIcyBlue = i % 3 === 0;
    list.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 1.4 + Math.random() * 2.6,
      speedY: 0.35 + Math.random() * 0.75,
      driftAmp: 0.25 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.008 + Math.random() * 0.012,
      opacity: isIcyBlue ? (0.34 + Math.random() * 0.28) : (0.55 + Math.random() * 0.35),
      isIcyBlue,
    });
  }
  return list;
}

function mountSnowCanvas(intensity) {
  stopSnowLoop();
  if (prefersReducedMotion()) return;

  const canvas = document.createElement('canvas');
  canvas.id = SNOW_CANVAS_ID;
  canvas.setAttribute('data-testid', 'seasonal-snow-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = [
    'position: fixed',
    'inset: 0',
    'width: 100vw',
    'height: 100vh',
    'pointer-events: none',
    'z-index: 15',
  ].join(';');

  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  activeSnowIntensity = intensity;
  let width = window.innerWidth || 1280;
  let height = window.innerHeight || 800;
  let lastFrameTime = 0;
  const FRAME_INTERVAL_MS = 40; // ~25fps gentle snowfall, ultra-light on CPU & battery

  const configureCanvas = () => {
    width = window.innerWidth || 1280;
    height = window.innerHeight || 800;
    canvas.width = Math.floor(width);
    canvas.height = Math.floor(height);

    const count = getSnowParticleCount(activeSnowIntensity, width, prefersReducedMotion());
    snowParticles = createSnowParticles(width, height, count);
  };

  configureCanvas();

  const renderFrame = (timestamp) => {
    if (document.hidden) {
      snowRafId = null;
      return;
    }

    if (timestamp && lastFrameTime && (timestamp - lastFrameTime) < FRAME_INTERVAL_MS) {
      snowRafId = requestAnimationFrame(renderFrame);
      return;
    }
    const stepScale = lastFrameTime ? Math.min(2, (timestamp - lastFrameTime) / 16.67) : 1;
    lastFrameTime = timestamp || performance.now();

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < snowParticles.length; i++) {
      const p = snowParticles[i];
      p.phase += p.phaseSpeed * stepScale;
      p.y += p.speedY * stepScale;
      p.x += Math.sin(p.phase) * p.driftAmp * stepScale;

      if (p.y > height + 8) {
        p.y = -8;
        p.x = Math.random() * width;
      } else if (p.x > width + 8) {
        p.x = -8;
      } else if (p.x < -8) {
        p.x = width + 8;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      if (p.isIcyBlue) {
        ctx.fillStyle = `rgba(74, 140, 198, ${p.opacity.toFixed(2)})`;
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity.toFixed(2)})`;
      }
      ctx.fill();

      if (!p.isIcyBlue && p.radius > 2.0) {
        ctx.strokeStyle = `rgba(116, 162, 206, ${(p.opacity * 0.48).toFixed(2)})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }

    snowRafId = requestAnimationFrame(renderFrame);
  };

  snowRafId = requestAnimationFrame(renderFrame);

  resizeHandler = () => configureCanvas();
  window.addEventListener('resize', resizeHandler, { passive: true });

  visibilityHandler = () => {
    if (document.hidden) {
      if (snowRafId !== null) {
        cancelAnimationFrame(snowRafId);
        snowRafId = null;
      }
    } else if (snowRafId === null && !prefersReducedMotion()) {
      snowRafId = requestAnimationFrame(renderFrame);
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  if (window.matchMedia) {
    reducedMotionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionListener = (e) => {
      if (e.matches) {
        stopSnowLoop();
      }
    };
    try {
      reducedMotionMql.addEventListener('change', reducedMotionListener);
    } catch {
      // Older Safari
    }
  }
}

function mountHeroOrnaments(config) {
  const existing = document.getElementById(HERO_ORNAMENTS_ID);
  if (existing) existing.remove();

  const heroSection = document.querySelector('#view-home section.hero-bg');
  if (!heroSection) return;

  const gold = config.gold_accent || '#d4af37';
  const deepGold = '#946816';
  const ice = config.ice_accent || '#3b82b6';

  const wrapper = document.createElement('div');
  wrapper.id = HERO_ORNAMENTS_ID;
  wrapper.setAttribute('data-testid', 'eid-hero-ornaments');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.className = 'devo-seasonal-ornament pointer-events-none absolute inset-0 overflow-hidden z-[5]';

  wrapper.innerHTML = `
    <!-- Soft Frosty Top Scrim so Eid ornaments stay crisp over any hero photo -->
    <div class="absolute top-0 left-0 right-0 h-32 pointer-events-none" style="background: linear-gradient(to bottom, rgba(244,248,252,0.72) 0%, rgba(244,248,252,0.22) 55%, transparent 100%);"></div>

    <!-- Top-Right Delicate Eid Crescent & Star Cluster -->
    <svg class="devo-eid-sway-slow absolute top-0 right-3 sm:right-8 md:right-14 w-24 sm:w-32 md:w-44 h-auto" viewBox="0 0 160 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Hanging Strings -->
      <line x1="56" y1="0" x2="56" y2="54" stroke="${deepGold}" stroke-width="1.4" stroke-opacity="0.78"/>
      <line x1="118" y1="0" x2="118" y2="86" stroke="${ice}" stroke-width="1.2" stroke-opacity="0.65"/>
      <line x1="22" y1="0" x2="22" y2="96" stroke="${deepGold}" stroke-width="1.1" stroke-opacity="0.6"/>

      <!-- Main Refined Crescent Moon -->
      <path d="M74 62C63 58 50 63 45 74C40 86 45 99 56 105C66 109 77 106 83 98C74 101 66 98 60 92C53 84 54 71 63 65C66 63 70 62 74 62Z" fill="${gold}" fill-opacity="0.58" stroke="${deepGold}" stroke-width="2" stroke-linejoin="round"/>
      <!-- Inner 8-Point Geometric Eid Star -->
      <path d="M71 76L73.2 81L78 83.2L73.2 85.4L71 90.4L68.8 85.4L64 83.2L68.8 81L71 76Z" fill="${deepGold}" stroke="#ffffff" stroke-width="0.7"/>

      <!-- Delicate Hanging Lantern -->
      <g transform="translate(106, 86)">
        <path d="M12 0L19 9H5L12 0Z" fill="${gold}" fill-opacity="0.6" stroke="${deepGold}" stroke-width="1.6"/>
        <path d="M5 9H19L21 28L12 38L3 28L5 9Z" fill="rgba(255,253,245,0.92)" stroke="${deepGold}" stroke-width="1.7"/>
        <path d="M12 14L15 20.5L12 27L9 20.5L12 14Z" fill="${gold}" fill-opacity="0.88"/>
        <circle cx="12" cy="42" r="2.3" fill="${deepGold}"/>
      </g>

      <!-- Snowflake Crystal Accent -->
      <g transform="translate(22, 104)" stroke="${ice}" stroke-width="1.6" stroke-opacity="0.9" stroke-linecap="round">
        <line x1="0" y1="-9" x2="0" y2="9"/>
        <line x1="-9" y1="0" x2="9" y2="0"/>
        <line x1="-6" y1="-6" x2="6" y2="6"/>
        <line x1="6" y1="-6" x2="-6" y2="6"/>
        <circle cx="0" cy="0" r="2.2" fill="#ffffff" stroke="${ice}" stroke-width="1.2"/>
      </g>
    </svg>

    <!-- Top-Left Balanced Hanging Lantern & Frost Crystal -->
    <svg class="devo-eid-sway-alt absolute top-0 left-3 sm:left-8 md:left-14 w-20 sm:w-28 md:w-36 h-auto" viewBox="0 0 140 190" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="48" y1="0" x2="48" y2="64" stroke="${deepGold}" stroke-width="1.4" stroke-opacity="0.75"/>
      <line x1="102" y1="0" x2="102" y2="48" stroke="${ice}" stroke-width="1.2" stroke-opacity="0.65"/>

      <!-- Left Lantern -->
      <g transform="translate(34, 64)">
        <circle cx="14" cy="2" r="2.4" stroke="${deepGold}" stroke-width="1.4"/>
        <path d="M14 4L22 14H6L14 4Z" fill="${gold}" fill-opacity="0.52" stroke="${deepGold}" stroke-width="1.5"/>
        <path d="M6 14H22L25 36L14 48L3 36L6 14Z" fill="rgba(255,253,245,0.88)" stroke="${deepGold}" stroke-width="1.6"/>
        <ellipse cx="14" cy="27" rx="3.4" ry="7" fill="${gold}" fill-opacity="0.78"/>
        <line x1="14" y1="48" x2="14" y2="55" stroke="${deepGold}" stroke-width="1.4"/>
        <circle cx="14" cy="57" r="2.3" fill="${deepGold}"/>
      </g>

      <!-- Frost Star -->
      <g transform="translate(102, 58)" stroke="${ice}" stroke-width="1.5" stroke-opacity="0.85" stroke-linecap="round">
        <line x1="0" y1="-9" x2="0" y2="9"/>
        <line x1="-9" y1="0" x2="9" y2="0"/>
        <line x1="-6" y1="-6" x2="6" y2="6"/>
        <line x1="6" y1="-6" x2="-6" y2="6"/>
        <circle cx="0" cy="0" r="2.3" fill="#ffffff" stroke="${deepGold}" stroke-width="1.2"/>
      </g>
    </svg>

    <!-- Subtle Geometric Winter-Eid Hairline Divider at Hero Bottom -->
    <div class="absolute bottom-2 left-1/2 -translate-x-1/2 w-[min(92%,720px)] flex items-center justify-center gap-3 opacity-80">
      <div class="h-px flex-1" style="background: linear-gradient(to left, ${deepGold}, transparent);"></div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" stroke="${deepGold}" stroke-width="1.5" fill="${gold}" fill-opacity="0.45"/>
      </svg>
      <div class="h-px flex-1" style="background: linear-gradient(to right, ${deepGold}, transparent);"></div>
    </div>
  `;

  heroSection.appendChild(wrapper);
}

function mountGreetingRibbon(config) {
  const existing = document.getElementById(GREETING_BAR_ID);
  if (existing) existing.remove();

  if (!config.greeting_bar_enabled) return;
  try {
    if (sessionStorage.getItem(GREETING_DISMISS_KEY) === '1') return;
  } catch {
    // ignore storage errors
  }

  const viewHome = document.getElementById('view-home');
  if (!viewHome) return;

  const ribbon = document.createElement('div');
  ribbon.id = GREETING_BAR_ID;
  ribbon.setAttribute('data-testid', 'eid-greeting-bar');
  ribbon.setAttribute('role', 'region');
  ribbon.setAttribute('aria-label', 'تهنئة العيد الشتوية');
  ribbon.className = 'devo-seasonal-ornament w-full border-b px-3 py-1.5 text-center relative z-20 transition-all duration-300';
  ribbon.style.background = 'linear-gradient(90deg, rgba(235,244,252,0.96) 0%, rgba(255,250,238,0.98) 50%, rgba(235,244,252,0.96) 100%)';
  ribbon.style.borderColor = 'rgba(212,175,55,0.32)';
  ribbon.style.color = '#0f2238';

  const safeText = String(config.greeting_text || '').replace(/[<>&"]/g, (ch) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
  }[ch]));

  ribbon.innerHTML = `
    <div class="max-w-7xl mx-auto flex items-center justify-center gap-2.5 pl-8 pr-2 min-h-[24px]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" class="shrink-0" aria-hidden="true">
        <path d="M17.5 14.5A6.5 6.5 0 0 1 9.5 6.5a6.5 6.5 0 1 0 8 8Z" fill="#d4af37" fill-opacity="0.35" stroke="#946816" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
      <span class="text-xs sm:text-sm font-bold tracking-wide truncate" style="color: #0f2238;">${safeText}</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" class="shrink-0 hidden sm:block" aria-hidden="true">
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke="#3b82b6" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <button type="button" id="btn-dismiss-eid-greeting" aria-label="إغلاق شريط تهنئة العيد" title="إغلاق"
        class="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5"
        style="color: #526b84;">
        <i class="ph ph-x text-sm"></i>
      </button>
    </div>
  `;

  viewHome.insertBefore(ribbon, viewHome.firstChild);

  const closeBtn = ribbon.querySelector('#btn-dismiss-eid-greeting');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      try {
        sessionStorage.setItem(GREETING_DISMISS_KEY, '1');
      } catch {
        // ignore
      }
      ribbon.remove();
    });
  }
}

function injectSeasonalStyles(config) {
  let styleEl = document.getElementById(STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }

  const gold = config.gold_accent || '#d4af37';
  const ice = config.ice_accent || '#3b82b6';

  styleEl.textContent = `
    @keyframes devoEidSway {
      0%, 100% { transform: rotate(-1.6deg); }
      50% { transform: rotate(1.6deg); }
    }
    @keyframes devoEidSwayAlt {
      0%, 100% { transform: rotate(1.4deg); }
      50% { transform: rotate(-1.4deg); }
    }
    .devo-eid-sway-slow {
      transform-origin: top center;
      animation: devoEidSway 7.5s ease-in-out infinite;
      will-change: transform;
    }
    .devo-eid-sway-alt {
      transform-origin: top center;
      animation: devoEidSwayAlt 8.8s ease-in-out infinite;
      will-change: transform;
    }
    @media (prefers-reduced-motion: reduce) {
      .devo-eid-sway-slow,
      .devo-eid-sway-alt {
        animation: none !important;
      }
    }

    /* Frosted Winter Hero Atmospheric Polish & Seamless Snowy Edge Fades */
    [data-seasonal-active="true"] #view-home section.hero-bg {
      background-image:
        radial-gradient(circle at 82% 18%, rgba(212, 175, 55, 0.14), transparent 44%),
        radial-gradient(circle at 18% 24%, rgba(59, 130, 182, 0.14), transparent 48%),
        linear-gradient(180deg, #eaf3fb 0%, #f4f8fc 68%, #f4f8fc 100%) !important;
    }
    [data-seasonal-active="true"] #hero-bg-top-fade {
      background-image: linear-gradient(to bottom, var(--devo-black, #f4f8fc), transparent) !important;
    }
    [data-seasonal-active="true"] #hero-bg-bottom-fade {
      background-image: linear-gradient(to top, var(--devo-black, #f4f8fc), transparent) !important;
    }

    ${config.frost_glass ? `
      [data-seasonal-active="true"] #hero-content-card {
        background-color: rgba(255, 255, 255, 0.78) !important;
        backdrop-filter: blur(14px) !important;
        -webkit-backdrop-filter: blur(14px) !important;
        border: 1px solid rgba(212, 175, 55, 0.32) !important;
        box-shadow: 0 20px 48px rgba(15, 34, 56, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
      }
      [data-seasonal-active="true"] #display-hero-title {
        color: #0f2238 !important;
      }
      [data-seasonal-active="true"] #display-hero-subtitle {
        color: #4a6580 !important;
      }
    ` : ''}

    /* Delicate Winter-Eid Card Hover Rim */
    [data-seasonal-active="true"] .product-card:hover,
    [data-seasonal-active="true"] .card-hover:hover {
      border-color: rgba(212, 175, 55, 0.55) !important;
      box-shadow: 0 12px 28px rgba(15, 34, 56, 0.09), 0 0 0 1px rgba(212, 175, 55, 0.22) !important;
    }

    /* Crisp Gold-Ice Accent Hairline on Footer Top */
    [data-seasonal-active="true"] footer {
      border-top: 1px solid rgba(212, 175, 55, 0.30) !important;
      background-image: radial-gradient(circle at 50% 0%, rgba(59, 130, 182, 0.06), transparent 65%);
    }

    /* Guarantee spotless invoice printing */
    @media print {
      #${SNOW_CANVAS_ID},
      #${HERO_ORNAMENTS_ID},
      #${GREETING_BAR_ID},
      .devo-seasonal-ornament {
        display: none !important;
      }
    }
  `;
}

/**
 * Apply or tear down seasonal effects for the active theme based on page scope.
 */
export function applySeasonalEffects(theme) {
  if (typeof document === 'undefined') return;

  const scope = getCurrentPageScope();
  if (document.documentElement) {
    document.documentElement.setAttribute('data-seasonal-scope', scope);
  }

  const config = normalizeSeasonalConfig(theme);
  if (!shouldRenderSeasonalDecorations(scope, config)) {
    teardownSeasonalEffects();
    return;
  }

  if (document.documentElement) {
    document.documentElement.setAttribute('data-seasonal-active', 'true');
    document.documentElement.setAttribute('data-theme-preset', config.preset);
  }

  injectSeasonalStyles(config);

  if (config.eid_ornaments) {
    mountHeroOrnaments(config);
  } else {
    const existing = document.getElementById(HERO_ORNAMENTS_ID);
    if (existing) existing.remove();
  }

  mountGreetingRibbon(config);

  if (config.frost_glass) {
    const titleEl = document.getElementById('display-hero-title');
    const subtitleEl = document.getElementById('display-hero-subtitle');
    const contentCard = document.getElementById('hero-content-card');
    if (titleEl) {
      titleEl.setAttribute('data-seasonal-styled', 'true');
      titleEl.style.setProperty('color', '#0f2238', 'important');
    }
    if (subtitleEl) {
      subtitleEl.setAttribute('data-seasonal-styled', 'true');
      subtitleEl.style.setProperty('color', '#4a6580', 'important');
    }
    if (contentCard) {
      contentCard.setAttribute('data-seasonal-styled', 'true');
      contentCard.style.backgroundColor = 'rgba(255, 255, 255, 0.82)';
      contentCard.style.backdropFilter = 'blur(14px)';
      contentCard.style.webkitBackdropFilter = 'blur(14px)';
      contentCard.style.border = '1px solid rgba(212, 175, 55, 0.34)';
      contentCard.style.boxShadow = '0 20px 48px rgba(15, 34, 56, 0.08)';
    }
  }

  if (config.snow_enabled) {
    mountSnowCanvas(config.snow_intensity);
  } else {
    stopSnowLoop();
  }
}
