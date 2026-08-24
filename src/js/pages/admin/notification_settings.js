import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { requireAuth } from '../../services/auth.js';

let isInitialized = false;

// ============================================================
// 🎯 تهيئة واجهة إعدادات الإشعارات والتليجرام
// ============================================================
export async function initNotificationSettingsView() {
    const user = requireAuth(['owner', 'admin']);
    if (!user) {
        showToast('⛔ ليس لديك صلاحية للوصول لإعدادات الإشعارات', 'error');
        return;
    }

    setupWindowBindings();
    await loadTelegramSettings();
    isInitialized = true;
}

// ربط الدوال بنافذة المتصفح لتشغيل أحداث onclick من ملف HTML
function setupWindowBindings() {
    window.saveTelegramSettings = saveTelegramSettings;
    window.testTelegramConnection = testTelegramConnection;
    window.sendDailyReportToTelegramNow = sendDailyReportToTelegramNow;
    window.sendWeeklyReportToTelegramNow = sendWeeklyReportToTelegramNow;
    window.sendBackupToTelegramNow = sendBackupToTelegramNow;
}

// ============================================================
// 📥 تحميل إعدادات تليجرام من جدول home_settings
// ============================================================
export async function loadTelegramSettings() {
    try {
        const { data, error } = await supabase
            .from('home_settings')
            .select('*')
            .in('setting_key', [
                'telegram_enabled', 
                'telegram_stock_enabled', 
                'telegram_reports_enabled', 
                'web_notifications_enabled', 
                'telegram_bot_token', 
                'telegram_chat_id', 
                'telegram_stock_chat_id', 
                'telegram_backup_chat_id',
                'telegram_reports_chat_id',
                'telegram_reports_group_link',
                'telegram_daily_report_time',
                'telegram_weekly_report_day',
                'telegram_weekly_report_time'
            ]);
            
        if (error) throw error;
        
        const settings = {};
        if (data) {
            data.forEach(item => settings[item.setting_key] = item.setting_value);
        }
        
        const enabledInput = document.getElementById('telegram-enabled');
        const stockEnabledInput = document.getElementById('telegram-stock-enabled');
        const reportsEnabledInput = document.getElementById('telegram-reports-enabled');
        const webNotificationsInput = document.getElementById('web-notifications-enabled');
        const tokenInput = document.getElementById('telegram-bot-token');
        const chatInput = document.getElementById('telegram-chat-id');
        const stockChatInput = document.getElementById('telegram-stock-chat-id');
        const backupChatInput = document.getElementById('telegram-backup-chat-id');
        const reportsChatInput = document.getElementById('telegram-reports-chat-id');
        const reportsGroupLinkInput = document.getElementById('telegram-reports-group-link');
        const dailyTimeInput = document.getElementById('telegram-daily-report-time');
        const weeklyDayInput = document.getElementById('telegram-weekly-report-day');
        const weeklyTimeInput = document.getElementById('telegram-weekly-report-time');
        
        if (enabledInput) enabledInput.checked = settings['telegram_enabled'] === 'true';
        if (stockEnabledInput) stockEnabledInput.checked = settings['telegram_stock_enabled'] !== 'false';
        if (reportsEnabledInput) reportsEnabledInput.checked = settings['telegram_reports_enabled'] !== 'false';
        if (webNotificationsInput) webNotificationsInput.checked = settings['web_notifications_enabled'] !== 'false';
        if (tokenInput) tokenInput.value = settings['telegram_bot_token'] || '';
        if (chatInput) chatInput.value = settings['telegram_chat_id'] || '-5488929514';
        if (stockChatInput) stockChatInput.value = settings['telegram_stock_chat_id'] || '-1004482360716';
        if (backupChatInput) backupChatInput.value = settings['telegram_backup_chat_id'] || '-1004363122042';
        if (reportsChatInput) reportsChatInput.value = settings['telegram_reports_chat_id'] || '-1004352609361';
        if (reportsGroupLinkInput) reportsGroupLinkInput.value = settings['telegram_reports_group_link'] || 'https://t.me/+3LkR_kgCBPY3MzFk';
        if (dailyTimeInput) dailyTimeInput.value = settings['telegram_daily_report_time'] || '23:55';
        if (weeklyDayInput) weeklyDayInput.value = settings['telegram_weekly_report_day'] || 'friday';
        if (weeklyTimeInput) weeklyTimeInput.value = settings['telegram_weekly_report_time'] || '23:59';
    } catch (e) {
        console.error('Error loading Telegram settings:', e);
    }
}

// ============================================================
// 💾 حفظ إعدادات تليجرام في جدول home_settings
// ============================================================
export async function saveTelegramSettings() {
    const enabledInput = document.getElementById('telegram-enabled');
    const stockEnabledInput = document.getElementById('telegram-stock-enabled');
    const reportsEnabledInput = document.getElementById('telegram-reports-enabled');
    const webNotificationsInput = document.getElementById('web-notifications-enabled');
    const tokenInput = document.getElementById('telegram-bot-token');
    const chatInput = document.getElementById('telegram-chat-id');
    const stockChatInput = document.getElementById('telegram-stock-chat-id');
    const backupChatInput = document.getElementById('telegram-backup-chat-id');
    const reportsChatInput = document.getElementById('telegram-reports-chat-id');
    const reportsGroupLinkInput = document.getElementById('telegram-reports-group-link');
    const dailyTimeInput = document.getElementById('telegram-daily-report-time');
    const weeklyDayInput = document.getElementById('telegram-weekly-report-day');
    const weeklyTimeInput = document.getElementById('telegram-weekly-report-time');
    const btn = document.getElementById('save-tg-btn');
    
    if (!enabledInput || !tokenInput || !chatInput) return;
    
    const enabled = enabledInput.checked ? 'true' : 'false';
    const stockEnabled = stockEnabledInput ? (stockEnabledInput.checked ? 'true' : 'false') : 'true';
    const reportsEnabled = reportsEnabledInput ? (reportsEnabledInput.checked ? 'true' : 'false') : 'true';
    const webNotifications = webNotificationsInput ? (webNotificationsInput.checked ? 'true' : 'false') : 'true';
    const token = tokenInput.value.trim();
    const chat = chatInput.value.trim() || '-5488929514';
    const stockChat = stockChatInput ? stockChatInput.value.trim() : '-1004482360716';
    const backupChat = backupChatInput ? backupChatInput.value.trim() : '-1004363122042';
    const reportsChat = reportsChatInput ? reportsChatInput.value.trim() : '-1004352609361';
    const reportsGroupLink = reportsGroupLinkInput ? reportsGroupLinkInput.value.trim() : 'https://t.me/+3LkR_kgCBPY3MzFk';
    const dailyTime = dailyTimeInput ? dailyTimeInput.value : '23:55';
    const weeklyDay = weeklyDayInput ? weeklyDayInput.value : 'friday';
    const weeklyTime = weeklyTimeInput ? weeklyTimeInput.value : '23:59';
    
    if (enabled === 'true' && (!token || !chat)) {
        showToast('يرجى إدخال التوكن ومعرّف المحادثة لتفعيل التنبيهات', 'warning');
        return;
    }
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري الحفظ...`;
    }
    
    try {
        const updates = [
            { setting_key: 'telegram_enabled', setting_value: enabled },
            { setting_key: 'telegram_stock_enabled', setting_value: stockEnabled },
            { setting_key: 'telegram_reports_enabled', setting_value: reportsEnabled },
            { setting_key: 'web_notifications_enabled', setting_value: webNotifications },
            { setting_key: 'telegram_bot_token', setting_value: token },
            { setting_key: 'telegram_chat_id', setting_value: chat },
            { setting_key: 'telegram_stock_chat_id', setting_value: stockChat },
            { setting_key: 'telegram_backup_chat_id', setting_value: backupChat },
            { setting_key: 'telegram_reports_chat_id', setting_value: reportsChat },
            { setting_key: 'telegram_reports_group_link', setting_value: reportsGroupLink },
            { setting_key: 'telegram_daily_report_time', setting_value: dailyTime },
            { setting_key: 'telegram_weekly_report_day', setting_value: weeklyDay },
            { setting_key: 'telegram_weekly_report_time', setting_value: weeklyTime }
        ];
        
        const { error } = await supabase
            .from('home_settings')
            .upsert(updates, { onConflict: 'setting_key' });
            
        if (error) throw error;

        // تحديث جدول المواعيد تلقائياً في pg_cron
        try {
            await supabase.rpc('reschedule_telegram_reports_cron');
        } catch (cronErr) {
            console.warn('Cron rescheduling notice:', cronErr);
        }
        
        showToast('تم حفظ إعدادات ومواعيد تقارير تليجرام بنجاح 💾⏰', 'success');
    } catch (e) {
        console.error('Error saving Telegram settings:', e);
        showToast('خطأ أثناء حفظ الإعدادات في قاعدة البيانات', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-floppy-disk text-base"></i> حفظ الإعدادات`;
        }
    }
}

// ============================================================
// 🧪 تجربة وإرسال إشعار فحص فوري لبوت التليجرام
// ============================================================
export async function testTelegramConnection() {
    const tokenInput = document.getElementById('telegram-bot-token');
    const chatInput = document.getElementById('telegram-chat-id');
    const stockChatInput = document.getElementById('telegram-stock-chat-id');
    const backupChatInput = document.getElementById('telegram-backup-chat-id');
    const reportsChatInput = document.getElementById('telegram-reports-chat-id');
    const btn = document.getElementById('test-tg-btn');

    const token = tokenInput ? tokenInput.value.trim() : '';
    const chat = chatInput ? chatInput.value.trim() : '';
    const stockChat = stockChatInput ? stockChatInput.value.trim() : '';
    const backupChat = backupChatInput ? backupChatInput.value.trim() : '';
    const reportsChat = reportsChatInput ? reportsChatInput.value.trim() : '';

    if (!token) {
        showToast('يرجى كتابة Bot Token الخاص بك أولاً للتجربة', 'warning');
        return;
    }
    if (!chat && !stockChat && !backupChat && !reportsChat) {
        showToast('يرجى تحديد معرف محادثة واحد على الأقل للتجربة', 'warning');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري الاختبار...`;
    }

    let successCount = 0;
    let errorMsgs = [];

    const targetChats = [];
    if (chat) targetChats.push({ id: chat, name: 'مجموعة الطلبات' });
    if (stockChat && stockChat !== chat) targetChats.push({ id: stockChat, name: 'مجموعة المخزون' });
    if (backupChat && backupChat !== chat && backupChat !== stockChat) targetChats.push({ id: backupChat, name: 'مجموعة النسخ الاحتياطي' });
    if (reportsChat && reportsChat !== chat && reportsChat !== stockChat && reportsChat !== backupChat) targetChats.push({ id: reportsChat, name: 'مجموعة التقارير' });

    for (const target of targetChats) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: target.id,
                    text: `🧪 <b>رسالة فحص من سيستم مصنع DEVO</b>\nتم اختبار فحص الاتصال ببوت التليجرام الخاص بـ (<b>${target.name}</b>) بنجاح! ✅\n\n⏰ <i>التاريخ: ${new Date().toLocaleString('ar-EG')}</i>`,
                    parse_mode: 'HTML'
                })
            });

            const resData = await res.json();
            if (res.ok && resData.ok) {
                successCount++;
            } else {
                errorMsgs.push(`${target.name}: ${resData.description || 'فشل الإرسال'}`);
            }
        } catch (err) {
            errorMsgs.push(`${target.name}: ${err.message || 'فشل الاتصال بخوادم التليجرام'}`);
        }
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-paper-plane-tilt text-base"></i> تجربة البوت`;
    }

    if (successCount > 0 && errorMsgs.length === 0) {
        showToast('تم إرسال الرسالة التجريبية بنجاح إلى التليجرام 🚀', 'success');
    } else if (successCount > 0 && errorMsgs.length > 0) {
        showToast(`تم الإرسال بنجاح لـ ${successCount} محادثة مع وجود خطأ: ${errorMsgs.join(' | ')}`, 'warning');
    } else {
        showToast(`فشل اختبار الاتصال ببوت التليجرام: ${errorMsgs.join(' | ')}`, 'error');
    }
}

// ============================================================
// 📊 إرسال تقرير اليوم فورياً إلى جروب التليجرام
// ============================================================
export async function sendDailyReportToTelegramNow() {
    const btn = document.getElementById('send-daily-tg-report-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري إرسال تقرير اليوم...`;
    }

    try {
        const { data, error } = await supabase.rpc('generate_and_send_telegram_report', {
            p_report_type: 'daily'
        });

        if (error) throw error;
        if (data && data.success === false) {
            throw new Error(data.error || 'فشل توليد التقرير');
        }

        showToast('تم إرسال تقرير اليوم بنجاح إلى جروب التليجرام 📊🚀', 'success');
    } catch (e) {
        console.error('Error sending daily Telegram report:', e);
        showToast(`تعذر إرسال تقرير اليوم: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-chart-bar text-base"></i> تقرير اليوم`;
        }
    }
}

// ============================================================
// 📅 إرسال تقرير الأسبوع فورياً إلى جروب التليجرام
// ============================================================
export async function sendWeeklyReportToTelegramNow() {
    const btn = document.getElementById('send-weekly-tg-report-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري إرسال تقرير الأسبوع...`;
    }

    try {
        const { data, error } = await supabase.rpc('generate_and_send_telegram_report', {
            p_report_type: 'weekly'
        });

        if (error) throw error;
        if (data && data.success === false) {
            throw new Error(data.error || 'فشل توليد التقرير الأسبوعي');
        }

        showToast('تم إرسال تقرير الأسبوع بنجاح إلى جروب التليجرام 📅🚀', 'success');
    } catch (e) {
        console.error('Error sending weekly Telegram report:', e);
        showToast(`تعذر إرسال تقرير الأسبوع: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-calendar-check text-base"></i> تقرير الأسبوع`;
        }
    }
}

// ============================================================
// 🛡️ إرسال النسخة الاحتياطية فورياً إلى جروب النسخ الاحتياطي في تليجرام
// ============================================================
export async function sendBackupToTelegramNow() {
    const btn = document.getElementById('send-backup-tg-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري إرسال النسخة...`;
    }

    try {
        const { executeCloudAutoBackup } = await import('./backup_restore.js');
        await executeCloudAutoBackup(true);
        showToast('تم إنشاء ملف النسخة الاحتياطية وإرساله مباشرة لتليجرام 🛡️🚀', 'success');
    } catch (e) {
        console.error('Error sending Telegram backup:', e);
        showToast(`تعذر إرسال النسخة: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-shield-check text-base"></i> إرسال النسخة`;
        }
    }
}
