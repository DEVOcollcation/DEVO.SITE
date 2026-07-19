/**
 * Footer Renderer
 * يجلب إعدادات الموقع من Supabase ويُطبق الـ Footer Layout المناسب.
 */

import { supabase } from '../../config/supabase.js';
import { renderFooter } from './footer_layouts.js';

export async function initFooter() {
    try {
        const { data, error } = await supabase.from('home_settings').select('*');
        if (error || !data) {
            // Fallback: تطبيق الـ Footer الافتراضي
            renderFooter('simple', {});
            return;
        }

        const settings = {};
        data.forEach(item => settings[item.setting_key] = item.setting_value);

        const layoutId = settings.footer_layout || 'simple';
        renderFooter(layoutId, settings);

    } catch (e) {
        console.error('[Footer Renderer] Error loading settings:', e);
        renderFooter('simple', {});
    }
}
