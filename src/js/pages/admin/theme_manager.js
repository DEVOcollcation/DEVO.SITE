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
import { confirmDialog } from '../../components/modal.js';

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
async function loadThemes() {
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

  const ok = confirm(`هل أنت متأكد من تفعيل المظهر "${theme.name}" وتطبيقه على الموقع بالكامل وللمستخدمين؟`);
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

  const newName = prompt(`أدخل اسماً للمظهر المكرر:`, `${theme.name} Copy`);
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

  const ok = confirm(`هل أنت متأكد تماماً من حذف المظهر "${theme.name}" نهائياً من قاعدة البيانات؟ لا يمكن التراجع.`);
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
  const ok = confirm(`هل أنت متأكد من استعادة الإعدادات الافتراضية الأصلية للمظهر "${name}"؟ سيؤدي ذلك لإلغاء أي تعديلات تمت عليه.`);
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

const FIELD_MAP = {
  // 1. General & Page Tab
  'theme-page-bg': 'colors.page.bg',
  'theme-page-bg-secondary': 'colors.page.bg_secondary',
  'theme-page-text': 'colors.page.text',
  'theme-page-text-muted': 'colors.page.text_muted',
  'theme-page-selection-bg': 'colors.page.selection_bg',
  'theme-page-selection-text': 'colors.page.selection_text',
  'theme-brand-primary': 'colors.brand.primary',
  'theme-brand-primary-hover': 'colors.brand.primary_hover',
  
  // 2. Navigation & Hero Tab
  'theme-topnav-bg': 'colors.top_nav.bg',
  'theme-topnav-border': 'colors.top_nav.border',
  'theme-topnav-logo': 'colors.top_nav.logo',
  'theme-topnav-text': 'colors.top_nav.text',
  'theme-topnav-link-active': 'colors.top_nav.link_active',
  'theme-topnav-link-hover': 'colors.top_nav.link_hover',
  'theme-topnav-search-bg': 'colors.top_nav.search_bg',
  'theme-hero-bg': 'colors.hero.bg',
  'theme-hero-title': 'colors.hero.title',
  'theme-hero-subtitle': 'colors.hero.subtitle',
  'theme-hero-overlay': 'colors.hero.overlay',

  // 3. Buttons Tab
  'theme-btn-primary-bg': 'colors.buttons.primary.bg',
  'theme-btn-primary-text': 'colors.buttons.primary.text',
  'theme-btn-primary-hover-bg': 'colors.buttons.primary.hover_bg',
  'theme-btn-primary-disabled-bg': 'colors.buttons.primary.disabled_bg',
  
  'theme-btn-secondary-bg': 'colors.buttons.secondary.bg',
  'theme-btn-secondary-text': 'colors.buttons.secondary.text',
  'theme-btn-secondary-hover-bg': 'colors.buttons.secondary.hover_bg',
  'theme-btn-secondary-border': 'colors.buttons.secondary.border',

  'theme-btn-success-bg': 'colors.buttons.success.bg',
  'theme-btn-success-hover-bg': 'colors.buttons.success.hover_bg',
  
  'theme-btn-warning-bg': 'colors.buttons.warning.bg',
  'theme-btn-warning-hover-bg': 'colors.buttons.warning.hover_bg',
  
  'theme-btn-danger-bg': 'colors.buttons.danger.bg',
  'theme-btn-danger-hover-bg': 'colors.buttons.danger.hover_bg',

  // 4. Cards & Modals Tab
  'theme-pcard-bg': 'colors.product_cards.bg',
  'theme-pcard-border': 'colors.product_cards.border',
  'theme-pcard-price': 'colors.product_cards.price',
  'theme-pcard-title': 'colors.product_cards.title',
  'theme-pcard-radius': 'colors.product_cards.radius',
  'theme-pcard-hover-effect': 'colors.product_cards.hover_effect',
  'theme-modal-bg': 'colors.modal.bg',
  'theme-modal-price': 'colors.modal.price',

  // 5. Tables & Inputs Tab
  'theme-table-header-bg': 'colors.tables.header_bg',
  'theme-table-row-bg': 'colors.tables.row_bg',
  'theme-table-row-hover-bg': 'colors.tables.row_hover_bg',
  
  'theme-input-bg': 'colors.inputs.bg',
  'theme-input-border': 'colors.inputs.border',
  'theme-input-focus-border': 'colors.inputs.focus_border',

  // 6. Sidebar & Footer Tab
  'theme-sidebar-bg': 'colors.sidebar.bg',
  'theme-sidebar-bg-active': 'colors.sidebar.bg_active',
  'theme-sidebar-text-active': 'colors.sidebar.text_active',
  
  'theme-footer-bg': 'colors.footer.bg',
  'theme-footer-text': 'colors.footer.text',
  'theme-footer-link-hover': 'colors.footer.link_hover',

  // 7. Others Tab
  'theme-font-family': 'fonts.family',
  'theme-transition-speed': 'animations.transition_speed',
  'theme-shadows-color': 'colors.shadows.color',
  'theme-shadows-size': 'colors.shadows.size',
  'theme-scrollbar-thumb': 'colors.scrollbar.thumb',
  'theme-loader-color': 'colors.loading.loader'
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

window.triggerOpenCustomizer = function(id) {
  const theme = allThemes.find(t => t.id === id);
  if (!theme) return;

  document.getElementById('customizer-theme-id').value = id;
  document.getElementById('customizer-theme-name').textContent = theme.name;
  document.getElementById('customizer-theme-desc').textContent = theme.description || 'لا يوجد وصف متوفر لهذا المظهر.';
  
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

  // Glass effect mapping specifically
  const glassCheck = document.getElementById('theme-glass-effect');
  if (glassCheck) {
    glassCheck.checked = !!(variables.visuals?.glass_effect);
  }

  // Switch to default General Tab
  switchThemeTab('tab-general');

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

window.switchThemeTab = function(tabId) {
  // Hide all tab contents
  document.querySelectorAll('.theme-tab-content').forEach(content => {
    content.classList.add('hidden');
  });

  // Show selected tab content
  document.getElementById(tabId)?.classList.remove('hidden');

  // Manage navigation button styling
  document.querySelectorAll('#theme-tabs-nav button').forEach(btn => {
    btn.className = "theme-tab-btn px-4 py-2 rounded-lg text-xs font-bold text-devo-muted hover:text-white transition-colors whitespace-nowrap";
  });

  const activeBtn = document.getElementById(`btn-${tabId}`);
  if (activeBtn) {
    activeBtn.className = "theme-tab-btn px-4 py-2 rounded-lg text-xs font-bold text-devo-orange bg-devo-orange/10 transition-colors whitespace-nowrap active";
  }
};

async function saveThemeCustomizations() {
  const id = document.getElementById('customizer-theme-id').value;
  const theme = allThemes.find(t => t.id === id);
  if (!theme) return;

  // Build variables object based on base theme configs to preserve missing variables
  const variables = JSON.parse(JSON.stringify(theme.variables || DEFAULT_THEMES["Dark Theme"]));
  
  // Gather fields
  for (const [fieldId, path] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(fieldId);
    if (el) {
      let val = el.type === 'checkbox' ? el.checked : el.value;
      setNestedValue(variables, path, val);
    }
  }

  // Handle glass effect specifically
  const glassCheck = document.getElementById('theme-glass-effect');
  if (glassCheck) {
    if (!variables.visuals) variables.visuals = {};
    variables.visuals.glass_effect = glassCheck.checked;
    variables.visuals.blur_intensity = glassCheck.checked ? '8px' : '0px';
  }

  // Built-in shadow variables updates
  const shadowColor = document.getElementById('theme-shadows-color').value;
  const shadowSize = document.getElementById('theme-shadows-size').value || '10px';
  if (!variables.colors.shadows) variables.colors.shadows = {};
  variables.colors.shadows.color = shadowColor;
  variables.colors.shadows.size = shadowSize;
  variables.colors.shadows.blur = (parseInt(shadowSize) * 4) + 'px';

  // Apply button borders & hovers fallbacks automatically for convenience
  const btnTypes = ['primary', 'secondary', 'success', 'warning', 'danger'];
  btnTypes.forEach(type => {
    const btn = variables.colors.buttons[type];
    if (btn) {
      if (!btn.hover_text) btn.hover_text = btn.text;
      if (!btn.active_bg) btn.active_bg = btn.hover_bg;
    }
  });

  showToast('جاري حفظ التغييرات وتحديث المظهر...', 'info');

  try {
    await updateTheme(id, variables, theme.description);
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
