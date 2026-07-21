import { 
  loadAllThemes, 
  createNewTheme, 
  updateTheme, 
  activateTheme, 
  duplicateTheme, 
  deleteTheme,
  DEFAULT_THEMES,
  applyTheme,
  resetSystemTheme
} from '../../services/theme.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog, promptDialog } from '../../components/modal.js';

let isInitialized = false;
let allThemes = [];
let activeThemeId = null;

export async function initThemeManagerView() {
  if (isInitialized) return;

  // Form submit listeners
  document.getElementById('theme-create-form')?.addEventListener('submit', handleCreateTheme);
  
  // Setup dual color inputs binding (hex textbox <-> picker)
  setupColorBindings();
  
  // Load themes
  await loadThemes();
  isInitialized = true;
}

// --- Load and Render Themes ---
export async function loadThemes() {
  const container = document.getElementById('themes-grid-container');
  container.innerHTML = `
    <div class="col-span-full py-12 text-center text-devo-muted">
      <i class="ph ph-spinner animate-spin text-4xl text-devo-orange mb-3 block mx-auto"></i>
      جاري تحميل المظاهر المتاحة...
    </div>
  `;

  try {
    const data = await loadAllThemes();
    allThemes = data;
    
    // Update stats counters
    updateThemeStats();
    
    // Render list
    renderThemesGrid();
  } catch (e) {
    console.error('Theme load error:', e);
    showToast('خطأ في تحميل المظاهر من الخادم', 'error');
  }
}

function updateThemeStats() {
  let activeTheme = allThemes.find(t => t.is_active);
  let systemCount = allThemes.filter(t => t.is_system).length;
  let customCount = allThemes.filter(t => !t.is_system).length;

  document.getElementById('theme-stat-total').textContent = allThemes.length;
  document.getElementById('theme-stat-active').textContent = activeTheme ? activeTheme.name : 'لا يوجد مظهر نشط';
  document.getElementById('theme-stat-system').textContent = systemCount;
  document.getElementById('theme-stat-custom').textContent = customCount;
}

function renderThemesGrid() {
  const container = document.getElementById('themes-grid-container');
  if (allThemes.length === 0) {
    container.innerHTML = `<div class="col-span-full py-12 text-center text-devo-muted">لا يوجد مظاهر مسجلة في النظام</div>`;
    return;
  }

  container.innerHTML = allThemes.map(t => {
    const isAct = t.is_active;
    const isSys = t.is_system;
    
    // Get key colors for quick preview dots
    const colors = t.variables?.colors || {};
    const pageBg = colors.page?.bg || '#0a0a0a';
    const primary = colors.brand?.primary || '#f97316';
    const text = colors.page?.text || '#f5f5f5';
    const surface = colors.page?.bg_secondary || colors.page?.surface || '#171717';

    // Buttons
    const activateBtn = isAct 
      ? `<button disabled class="flex-1 py-2 bg-devo-success/10 text-devo-success border border-devo-success/20 rounded-lg text-xs font-bold flex items-center justify-center gap-1 cursor-default"><i class="ph ph-check-circle"></i> المظهر النشط</button>`
      : `<button onclick="window.triggerActivateTheme('${t.id}')" class="flex-1 py-2 bg-devo-orange hover:bg-devo-orangeHover text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1"><i class="ph ph-lightning"></i> تفعيل المظهر</button>`;

    const deleteBtn = (isSys || isAct)
      ? `<button disabled class="w-10 h-10 bg-devo-gray/10 text-devo-muted border border-devo-gray/20 rounded-lg flex items-center justify-center cursor-not-allowed" title="لا يمكن حذف المظهر النشط أو مظاهر النظام الافتراضية"><i class="ph ph-lock text-sm"></i></button>`
      : `<button onclick="window.triggerDeleteTheme('${t.id}')" class="w-10 h-10 bg-devo-error/10 hover:bg-devo-error text-devo-error hover:text-white rounded-lg flex items-center justify-center transition-colors" title="حذف المظهر"><i class="ph ph-trash text-sm"></i></button>`;

    const customizeBtn = isSys
      ? `<button onclick="window.triggerResetSystemTheme('${t.id}', '${t.name}')" class="w-10 h-10 bg-devo-black hover:bg-yellow-500/10 text-yellow-500 border border-devo-gray hover:border-yellow-500/30 rounded-lg flex items-center justify-center transition-colors" title="استعادة الإعدادات الافتراضية للمظهر"><i class="ph ph-arrow-counter-clockwise text-sm"></i></button>`
      : `<button onclick="window.triggerOpenCustomizer('${t.id}')" class="w-10 h-10 bg-devo-black hover:bg-devo-gray text-white border border-devo-gray rounded-lg flex items-center justify-center transition-colors" title="تخصيص وتعديل المتغيرات"><i class="ph ph-paint-brush-broad text-sm"></i></button>`;

    const badgeClass = isSys 
      ? 'bg-devo-gray text-devo-muted border border-devo-gray/40' 
      : 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
    const badgeText = isSys ? 'نظام (System)' : 'مخصص (Custom)';

    return `
      <div class="bg-devo-dark border ${isAct ? 'border-devo-orange ring-1 ring-devo-orange' : 'border-devo-gray'} rounded-2xl p-5 flex flex-col gap-4 transition-all hover:border-devo-grayHover shadow-md relative group">
        
        <!-- Info -->
        <div class="flex justify-between items-start">
          <div class="space-y-1">
            <h4 class="text-white font-bold text-base flex items-center gap-2">
              ${t.name}
              ${isAct ? `<span class="w-2.5 h-2.5 rounded-full bg-devo-success shadow-[0_0_8px_rgba(16,185,129,0.6)]" title="نشط"></span>` : ''}
            </h4>
            <p class="text-devo-muted text-xs leading-relaxed max-w-[200px] block truncate" title="${t.description || ''}">${t.description || 'لا يوجد وصف'}</p>
          </div>
          <span class="text-[10px] font-bold px-2 py-1 rounded ${badgeClass}">
            ${badgeText}
          </span>
        </div>

        <!-- Color Previews Dots -->
        <div class="bg-devo-black/40 border border-devo-gray/50 rounded-xl p-3.5 flex items-center justify-between">
          <span class="text-xs text-devo-muted font-bold">لوحة الألوان الأساسية:</span>
          <div class="flex gap-2">
            <span class="w-6 h-6 rounded-full border border-devo-gray flex items-center justify-center shadow-inner" style="background-color: ${pageBg}" title="خلفية الصفحة الرئيسية: ${pageBg}"></span>
            <span class="w-6 h-6 rounded-full border border-devo-gray flex items-center justify-center shadow-inner" style="background-color: ${surface}" title="الخلفية الفرعية: ${surface}"></span>
            <span class="w-6 h-6 rounded-full border border-devo-gray flex items-center justify-center shadow-inner" style="background-color: ${primary}" title="اللون المميز/البراند: ${primary}"></span>
            <span class="w-6 h-6 rounded-full border border-devo-gray flex items-center justify-center shadow-inner" style="background-color: ${text}" title="لون الخطوط: ${text}"></span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2 border-t border-devo-gray pt-4 mt-auto">
          ${activateBtn}
          ${customizeBtn}
          <button onclick="window.triggerDuplicateTheme('${t.id}')" class="w-10 h-10 bg-devo-black hover:bg-devo-gray text-white border border-devo-gray rounded-lg flex items-center justify-center transition-colors" title="تكرار وعمل نسخة (Duplicate)"><i class="ph ph-copy text-sm"></i></button>
          ${deleteBtn}
        </div>

      </div>
    `;
  }).join('');
}

// --- Create Theme ---
function openCreateThemeModal() {
  const modal = document.getElementById('theme-create-modal');
  const baseSelect = document.getElementById('new-theme-base');
  
  if (baseSelect) {
    baseSelect.innerHTML = allThemes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  }

  document.getElementById('new-theme-name').value = '';
  document.getElementById('new-theme-desc').value = '';

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => modal.classList.remove('opacity-0'), 10);
  setTimeout(() => modal.querySelector(':scope > div').classList.remove('scale-95'), 10);
}
window.openCreateThemeModal = openCreateThemeModal;

function closeCreateThemeModal() {
  const modal = document.getElementById('theme-create-modal');
  modal.classList.add('opacity-0');
  modal.querySelector(':scope > div').classList.add('scale-95');
  setTimeout(() => {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }, 300);
}
window.closeCreateThemeModal = closeCreateThemeModal;

async function handleCreateTheme(e) {
  e.preventDefault();
  
  const name = document.getElementById('new-theme-name').value.trim();
  const description = document.getElementById('new-theme-desc').value.trim();
  const baseId = document.getElementById('new-theme-base').value;

  if (!name) return showToast('يرجى كتابة اسم المظهر', 'error');

  const baseTheme = allThemes.find(t => t.id === baseId);
  if (!baseTheme) return showToast('المظهر المختار للبناء عليه غير متوفر', 'error');

  // Check unique name local
  if (allThemes.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    return showToast('اسم المظهر هذا مسجل مسبقاً، يرجى كتابة اسم آخر فريد.', 'error');
  }

  showToast('جاري إنشاء المظهر...', 'info');

  try {
    const data = await createNewTheme(name, baseTheme.variables, description);
    showToast('تم إنشاء المظهر بنجاح ✓', 'success');
    closeCreateThemeModal();
    
    // Reload
    await loadThemes();

    // Open Customizer directly for new theme
    window.triggerOpenCustomizer(data.id);
  } catch (error) {
    console.error('Create theme error:', error);
    showToast('فشل إنشاء المظهر: ' + error.message, 'error');
  }
}

// --- Activate Theme ---
window.triggerActivateTheme = async function(id) {
  const theme = allThemes.find(t => t.id === id);
  if (!theme) return;

  const ok = await confirmDialog({
    title: 'تفعيل المظهر',
    message: `هل أنت متأكد من تفعيل المظهر "${theme.name}" وتطبيقه على الموقع بالكامل وللمستخدمين؟`,
    confirmText: 'تفعيل المظهر',
    cancelText: 'إلغاء',
    isDestructive: false
  });
  if (!ok) return;

  showToast('جاري تفعيل المظهر وتطبيق المتغيرات البصرية...', 'info');

  try {
    await activateTheme(id);
    showToast('تم تفعيل وتطبيق المظهر بنجاح ✓', 'success');
    await loadThemes();
  } catch (error) {
    console.error('Theme activation error:', error);
    showToast('فشل تفعيل المظهر: ' + error.message, 'error');
  }
};

// --- Duplicate Theme ---
window.triggerDuplicateTheme = async function(id) {
  const theme = allThemes.find(t => t.id === id);
  if (!theme) return;

  const newName = await promptDialog({
    title: 'تكرار المظهر',
    message: 'أدخل اسماً للمظهر المكرر:',
    defaultValue: `${theme.name} Copy`,
    confirmText: 'نسخ المظهر',
    cancelText: 'إلغاء'
  });
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) return showToast('اسم المظهر مطلوب لتكراره', 'error');

  // Verify unique
  if (allThemes.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) {
    return showToast('اسم المظهر هذا مكرر ومسجل بالفعل', 'error');
  }

  showToast('جاري نسخ وتكرار المظهر...', 'info');

  try {
    await duplicateTheme(id, trimmed);
    showToast('تم تكرار المظهر بنجاح ✓', 'success');
    await loadThemes();
  } catch (error) {
    console.error('Duplicate theme error:', error);
    showToast('فشل تكرار المظهر: ' + error.message, 'error');
  }
};

// --- Delete Theme ---
window.triggerDeleteTheme = async function(id) {
  const theme = allThemes.find(t => t.id === id);
  if (!theme) return;

  if (theme.is_active) {
    return showToast('لا يمكن حذف المظهر النشط حالياً.', 'error');
  }
  if (theme.is_system) {
    return showToast('لا يمكن حذف المظاهر الافتراضية للنظام.', 'error');
  }

  const ok = await confirmDialog({
    title: 'حذف المظهر',
    message: `هل أنت متأكد تماماً من حذف المظهر "${theme.name}" نهائياً من قاعدة البيانات؟ لا يمكن التراجع.`,
    confirmText: 'حذف نهائياً',
    cancelText: 'إلغاء',
    isDestructive: true
  });
  if (!ok) return;

  showToast('جاري حذف المظهر...', 'info');

  try {
    await deleteTheme(id);
    showToast('تم حذف المظهر بنجاح ✓', 'success');
    await loadThemes();
  } catch (error) {
    console.error('Delete theme error:', error);
    showToast('فشل حذف المظهر: ' + error.message, 'error');
  }
};

// --- Reset System Theme ---
window.triggerResetSystemTheme = async function(id, name) {
  const ok = await confirmDialog({
    title: 'استعادة المظهر الافتراضي',
    message: `هل أنت متأكد من استعادة الإعدادات الافتراضية الأصلية للمظهر "${name}"؟ سيؤدي ذلك لإلغاء أي تعديلات تمت عليه.`,
    confirmText: 'استعادة الافتراضي',
    cancelText: 'إلغاء',
    isDestructive: true
  });
  if (!ok) return;

  showToast('جاري استعادة المظهر الافتراضي للنظام...', 'info');

  try {
    const updated = await resetSystemTheme(id, name);
    showToast('تم استعادة الإعدادات الافتراضية بنجاح ✓', 'success');
    await loadThemes();
    
    // If the reset theme is the active theme, re-apply it instantly
    if (updated.is_active) {
      const themeObj = {
        id: updated.id,
        name: updated.name,
        colors: updated.variables.colors,
        fonts: updated.variables.fonts,
        animations: updated.variables.animations,
        visuals: updated.variables.visuals
      };
      applyTheme(themeObj);
    }
  } catch (error) {
    console.error('Reset system theme error:', error);
    showToast('فشل استعادة المظهر: ' + error.message, 'error');
  }
};

// --- Theme Variable Customizer Modal Logic ---

// --- Theme Variable Customizer Modal Logic ---

const FIELD_MAP = {
  'theme-page-bg': 'colors.page.bg',
  'theme-page-bg-secondary': 'colors.page.bg_secondary',
  'theme-page-text': 'colors.page.text',
  'theme-page-text-muted': 'colors.page.text_muted',
  'theme-brand-primary': 'colors.brand.primary',
  'theme-buttons-style': 'colors.buttons.style_preset',
  'theme-cards-style': 'colors.product_cards.style_preset',
  'theme-font-family': 'fonts.family',
  'theme-hero-show-image': 'visuals.show_hero_image',
  'theme-hero-image-blend': 'visuals.hero_image_blend'
};

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const parent = parts.reduce((acc, part) => {
    if (!acc[part]) acc[part] = {};
    return acc[part];
  }, obj);
  parent[last] = value;
}

function isHexColorLight(hex) {
  if (!hex || hex[0] !== '#') return false;
  let fullHex = hex;
  if (hex.length === 4) {
    fullHex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  const r = parseInt(fullHex.substring(1, 3), 16) || 0;
  const g = parseInt(fullHex.substring(3, 5), 16) || 0;
  const b = parseInt(fullHex.substring(5, 7), 16) || 0;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128;
}

function adjustColorBrightness(hex, percent) {
  if (!hex || hex[0] !== '#') return hex;
  let fullHex = hex;
  if (hex.length === 4) {
    fullHex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  let R = parseInt(fullHex.substring(1, 3), 16) || 0;
  let G = parseInt(fullHex.substring(3, 5), 16) || 0;
  let B = parseInt(fullHex.substring(5, 7), 16) || 0;

  R = parseInt(R * (100 + percent) / 100);
  G = parseInt(G * (100 + percent) / 100);
  B = parseInt(B * (100 + percent) / 100);

  R = (R < 255) ? R : 255;
  G = (G < 255) ? G : 255;
  B = (B < 255) ? B : 255;

  R = (R > 0) ? R : 0;
  G = (G > 0) ? G : 0;
  B = (B > 0) ? B : 0;

  const rHex = R.toString(16).padStart(2, '0');
  const gHex = G.toString(16).padStart(2, '0');
  const bHex = B.toString(16).padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`;
}

window.triggerOpenCustomizer = function(id) {
  const theme = allThemes.find(t => t.id === id);
  if (!theme) return;

  document.getElementById('customizer-theme-id').value = id;
  document.getElementById('customizer-theme-name').textContent = theme.name;
  document.getElementById('customizer-theme-desc').textContent = theme.description || 'لا يوجد وصف متوفر لهذا المظهر.';
  document.getElementById('theme-custom-desc').value = theme.description || '';
  
  const footerInfo = document.getElementById('customizer-theme-info-footer');
  if (footerInfo) {
    footerInfo.textContent = `ID: ${theme.id} | ${theme.is_system ? 'مظهر افتراضي بالنظام (محمي)' : 'مظهر مخصص للموقع'}`;
  }

  // Populate values into form fields
  const variables = theme.variables || {};
  
  for (const [fieldId, path] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(fieldId);
    let val = getNestedValue(variables, path);
    
    if (el) {
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else {
        el.value = val || '';
      }
      
      // Update text input next to picker if applicable
      const txtId = fieldId.replace('theme-', 'txt-');
      const valId = fieldId.replace('theme-', 'val-');
      const textInput = document.getElementById(txtId);
      const valLabel = document.getElementById(valId);
      
      if (textInput && el.type === 'color') {
        textInput.value = el.value;
      }
      if (valLabel) {
        valLabel.textContent = el.value;
      }
    }
  }

  // Display Customizer modal
  const modal = document.getElementById('theme-customizer-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => modal.classList.remove('opacity-0'), 10);
  setTimeout(() => modal.querySelector(':scope > div').classList.remove('scale-95'), 10);
};

window.closeThemeCustomizerModal = function() {
  const modal = document.getElementById('theme-customizer-modal');
  modal.classList.add('opacity-0');
  modal.querySelector(':scope > div').classList.add('scale-95');
  setTimeout(() => {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }, 300);
};

async function saveThemeCustomizations() {
  const id = document.getElementById('customizer-theme-id').value;
  const theme = allThemes.find(t => t.id === id);
  if (!theme) return;

  const pageBg = document.getElementById('theme-page-bg').value;
  const pageBgSec = document.getElementById('theme-page-bg-secondary').value;
  const pageText = document.getElementById('theme-page-text').value;
  const pageTextMuted = document.getElementById('theme-page-text-muted').value;
  const brandPrimary = document.getElementById('theme-brand-primary').value;
  const btnStylePreset = document.getElementById('theme-buttons-style').value;
  const cardStylePreset = document.getElementById('theme-cards-style').value;
  const fontFamily = document.getElementById('theme-font-family').value;
  const showHeroImg = document.getElementById('theme-hero-show-image').value === 'true';
  const heroImgBlend = document.getElementById('theme-hero-image-blend').value;
  const newDescription = document.getElementById('theme-custom-desc').value;

  const isLight = isHexColorLight(pageBg);
  const darkAlpha = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
  const darkAlphaFocus = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';

  // Build a complete theme variables structure derived from the inputs
  const variables = {
    colors: {
      page: {
        bg: pageBg,
        bg_secondary: pageBgSec,
        surface: pageBgSec,
        text: pageText,
        text_muted: pageTextMuted,
        selection_bg: brandPrimary,
        selection_text: '#ffffff'
      },
      brand: {
        primary: brandPrimary,
        primary_hover: adjustColorBrightness(brandPrimary, -12)
      },
      top_nav: {
        bg: pageBgSec,
        border: darkAlpha,
        logo: brandPrimary,
        text: pageText,
        link_active: brandPrimary,
        link_hover: brandPrimary,
        search_bg: pageBg,
        search_border: darkAlpha,
        search_text: pageText,
        icons: pageTextMuted,
        icons_active: brandPrimary
      },
      hero: {
        bg: pageBgSec,
        title: pageText,
        subtitle: pageTextMuted,
        overlay: isLight ? 'linear-gradient(rgba(255,255,255,0.7), rgba(255,255,255,0.95))' : 'linear-gradient(rgba(10,10,10,0.6), rgba(10,10,10,0.95))'
      },
      buttons: {
        style_preset: btnStylePreset,
        primary: {
          bg: brandPrimary,
          text: '#ffffff',
          hover_bg: adjustColorBrightness(brandPrimary, -12),
          disabled_bg: isLight ? '#e5e5e5' : '#262626',
          disabled_text: isLight ? '#a3a3a3' : '#737373'
        },
        secondary: {
          bg: pageBg,
          text: pageText,
          border: darkAlphaFocus,
          hover_bg: pageBgSec
        },
        success: {
          bg: '#10b981',
          text: '#ffffff',
          hover_bg: '#059669'
        },
        warning: {
          bg: '#f59e0b',
          text: '#ffffff',
          hover_bg: '#d97706'
        },
        danger: {
          bg: '#ef4444',
          text: '#ffffff',
          hover_bg: '#dc2626'
        }
      },
      inputs: {
        bg: pageBg,
        border: darkAlphaFocus,
        text: pageText,
        focus_border: brandPrimary
      },
      cards: {
        product: {
          bg: pageBgSec,
          border: darkAlpha,
          radius: cardStylePreset === 'rounded-pill' ? '24px' : '16px',
          shadow: cardStylePreset === 'shadowed' ? (isLight ? '0 10px 30px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.01)' : '0 10px 30px rgba(0,0,0,0.4)') : 'none',
          hover_anim: 'translate-y'
        },
        statistics: {
          bg: pageBgSec,
          border: darkAlpha,
          radius: cardStylePreset === 'rounded-pill' ? '24px' : '16px',
          shadow: cardStylePreset === 'shadowed' ? (isLight ? '0 10px 30px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.01)' : '0 10px 30px rgba(0,0,0,0.4)') : 'none'
        },
        dashboard: {
          bg: pageBgSec,
          border: darkAlpha,
          radius: cardStylePreset === 'rounded-pill' ? '24px' : '16px',
          shadow: cardStylePreset === 'shadowed' ? (isLight ? '0 10px 30px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.01)' : '0 10px 30px rgba(0,0,0,0.4)') : 'none'
        },
        order: {
          bg: pageBgSec,
          border: darkAlpha,
          radius: cardStylePreset === 'rounded-pill' ? '24px' : '16px',
          shadow: cardStylePreset === 'shadowed' ? (isLight ? '0 10px 30px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.01)' : '0 10px 30px rgba(0,0,0,0.4)') : 'none'
        }
      },
      product_cards: {
        style_preset: cardStylePreset,
        bg: pageBgSec,
        border: darkAlpha,
        radius: cardStylePreset === 'rounded-pill' ? '24px' : '16px',
        shadow: cardStylePreset === 'shadowed' ? (isLight ? '0 10px 30px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.01)' : '0 10px 30px rgba(0,0,0,0.4)') : 'none',
        title: pageText,
        price: brandPrimary,
        category: pageTextMuted,
        hover_shadow: '0 15px 35px rgba(0,0,0,0.2)',
        hover_effect: 'translate-y'
      },
      modal: {
        bg: pageBgSec,
        border: darkAlphaFocus,
        radius: cardStylePreset === 'rounded-pill' ? '24px' : '16px',
        shadow: isLight ? '0 20px 50px rgba(0,0,0,0.1)' : '0 20px 50px rgba(0,0,0,0.6)'
      },
      tables: {
        border: darkAlpha,
        header_bg: pageBg,
        header_text: pageTextMuted,
        row_bg: pageBgSec,
        row_hover_bg: isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)'
      },
      sidebar: {
        bg: pageBg,
        border: darkAlpha,
        text: pageTextMuted,
        text_hover: pageText,
        bg_hover: pageBgSec,
        bg_active: brandPrimary + '1a',
        text_active: brandPrimary,
        icons: pageTextMuted,
        icons_active: brandPrimary
      },
      footer: {
        bg: pageBg,
        border: darkAlpha,
        text: pageTextMuted,
        social_bg: pageBgSec,
        social_text: pageTextMuted,
        social_hover_bg: brandPrimary,
        social_hover_text: '#ffffff',
        link_hover: brandPrimary
      },
      scrollbar: {
        track: pageBg,
        thumb: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)',
        thumb_hover: brandPrimary
      },
      shadows: {
        color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.5)',
        size: '10px',
        blur: '40px'
      },
      loading: {
        loader: brandPrimary,
        spinner: pageBgSec
      }
    },
    fonts: {
      family: fontFamily,
      size_base: '16px'
    },
    animations: {
      transition_speed: '0.3s'
    },
    visuals: {
      glass_effect: cardStylePreset === 'glass',
      blur_intensity: cardStylePreset === 'glass' ? '12px' : '0px',
      show_hero_image: showHeroImg,
      hero_image_blend: heroImgBlend
    }
  };

  showToast('جاري حفظ التغييرات وتحديث المظهر...', 'info');

  try {
    await updateTheme(id, variables, newDescription);
    showToast('تم حفظ تعديلات المظهر وتطبيقها بنجاح ✓', 'success');
    closeThemeCustomizerModal();
    
    // Reload database themes list
    await loadThemes();

    // If we updated the active theme, immediately re-apply to current admin window dynamically
    if (theme.is_active) {
      const updatedTheme = allThemes.find(t => t.id === id);
      if (updatedTheme) {
        const themeObj = {
          id: updatedTheme.id,
          name: updatedTheme.name,
          colors: updatedTheme.variables.colors,
          fonts: updatedTheme.variables.fonts,
          animations: updatedTheme.variables.animations,
          visuals: updatedTheme.variables.visuals
        };
        applyTheme(themeObj);
      }
    }
  } catch (error) {
    console.error('Save customization error:', error);
    showToast('خطأ في حفظ المظهر: ' + error.message, 'error');
  }
}

window.saveThemeCustomizations = saveThemeCustomizations;

// Setup dual bindings for color input pickers <-> text hex displays
function setupColorBindings() {
  for (const fieldId of Object.keys(FIELD_MAP)) {
    const el = document.getElementById(fieldId);
    if (el && el.type === 'color') {
      const txtId = fieldId.replace('theme-', 'txt-');
      const valId = fieldId.replace('theme-', 'val-');
      
      const textInput = document.getElementById(txtId);
      const valLabel = document.getElementById(valId);
      
      if (textInput) {
        // Sync color picker -> text box & visual label
        el.addEventListener('input', () => {
          textInput.value = el.value;
          if (valLabel) valLabel.textContent = el.value;
        });

        // Sync text box -> color picker & visual label
        textInput.addEventListener('input', () => {
          let val = textInput.value.trim();
          // Verify valid hex color
          if (/^#[0-9A-F]{6}$/i.test(val)) {
            el.value = val;
            if (valLabel) valLabel.textContent = val;
          }
        });
      }
    }
  }
}
