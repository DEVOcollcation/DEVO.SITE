import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { retrySingleTelegramNotification, retryFailedTelegramNotifications } from '../../services/notifications.js';

let allNotifications = [];
let activeFilter = 'all'; // 'all', 'unread', 'archived'

// تهيئة صفحة الإشعارات
export async function initNotificationsView() {
    setupWindowBindings();
    await fetchNotifications();
    
    // الاستماع لحدث تلقي إشعار جديد لتحديث القائمة تلقائياً
    window.addEventListener('devo:notifications-received', handleRealtimeRefresh);
}

// إلغاء الاستماع عند الحاجة لتجنب تسريب الذاكرة
function handleRealtimeRefresh() {
    fetchNotifications();
}

// ربط الدوال بنافذة المتصفح لتشغيل أحداث onclick من ملف HTML
function setupWindowBindings() {
    window.changeNotificationFilter = changeNotificationFilter;
    window.bulkMarkNotificationsRead = bulkMarkNotificationsRead;
    window.bulkArchiveNotifications = bulkArchiveNotifications;
    window.bulkDeleteNotifications = bulkDeleteNotifications;
    window.broadcastCustomNotification = broadcastCustomNotification;
    window.toggleNotificationRead = toggleNotificationRead;
    window.toggleNotificationArchive = toggleNotificationArchive;
    window.deleteNotification = deleteNotification;
    window.viewNotificationTarget = viewNotificationTarget;
    window.saveTelegramSettings = saveTelegramSettings;
    window.toggleTelegramSettingsCard = toggleTelegramSettingsCard;
    window.testTelegramConnection = testTelegramConnection;
    window.sendDailyReportToTelegramNow = sendDailyReportToTelegramNow;
    window.sendWeeklyReportToTelegramNow = sendWeeklyReportToTelegramNow;
    window.sendMonthlyReportToTelegramNow = sendMonthlyReportToTelegramNow;
    window.sendYearlyReportToTelegramNow = sendYearlyReportToTelegramNow;
    window.sendBackupToTelegramNow = sendBackupToTelegramNow;
    window.retrySingleTelegramNotification = async (id) => {
        const res = await retrySingleTelegramNotification(id);
        if (res.success) {
            showToast(res.message, 'success');
            await fetchNotifications();
        } else {
            showToast(res.message, 'error');
        }
    };
    window.retryFailedTelegramNotifications = async () => {
        await retryFailedTelegramNotifications();
        await fetchNotifications();
        showToast('تمت محاولة إعادة إرسال الإشعارات المعلقة', 'info');
    };
}

// 1. جلب الإشعارات بالكامل من قاعدة البيانات
export async function fetchNotifications() {
    try {
        const { data, error } = await supabase
            .from('system_notifications')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        allNotifications = data || [];
        updateStats();
        renderNotifications();
    } catch (e) {
        console.error('Error fetching notifications:', e);
        showToast('حدث خطأ أثناء تحميل الإشعارات', 'error');
    }
}

// 2. تحديث مؤشرات الإحصائيات في الصفحة
function updateStats() {
    const totalEl = document.getElementById('notify-stat-total');
    const unreadEl = document.getElementById('notify-stat-unread');

    if (totalEl) totalEl.textContent = `الكل: ${allNotifications.length}`;
    if (unreadEl) {
        const unreadCount = allNotifications.filter(n => !n.is_read && !n.is_archived).length;
        unreadEl.textContent = `غير مقروء: ${unreadCount}`;
    }
}

// 3. عرض كروت الإشعارات بالصفحة
function renderNotifications() {
    const listContainer = document.getElementById('notifications-manager-list');
    if (!listContainer) return;

    let filtered = allNotifications;
    if (activeFilter === 'unread') {
        filtered = allNotifications.filter(n => !n.is_read && !n.is_archived);
    } else if (activeFilter === 'archived') {
        filtered = allNotifications.filter(n => n.is_archived);
    } else {
        // فلتر "الكل" يعرض كافة الإشعارات غير المؤرشفة بشكل افتراضي لتنظيم الواجهة
        filtered = allNotifications.filter(n => !n.is_archived);
    }

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="p-16 text-center bg-devo-dark border border-devo-gray rounded-xl text-devo-muted flex flex-col items-center gap-3">
                <i class="ph ph-bell-slash text-4xl opacity-40"></i>
                <span>لا توجد إشعارات تطابق التصفية الحالية</span>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = filtered.map(n => {
        const dateStr = new Date(n.created_at).toLocaleString('ar-EG', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // تحديد الأيقونة وكلاسات الألوان حسب نوع الإشعار
        let iconClass = 'ph ph-info bg-devo-info/10 text-devo-info';
        if (n.type === 'order_created') iconClass = 'ph ph-shopping-cart bg-devo-success/10 text-devo-success';
        else if (n.type === 'order_updated') iconClass = 'ph ph-pencil-simple bg-devo-warning/10 text-devo-warning';
        else if (n.type === 'out_of_stock') iconClass = 'ph ph-warning bg-devo-error/10 text-devo-error';
        else if (n.type === 'order_assigned') iconClass = 'ph ph-user-gear bg-blue-500/10 text-blue-400';
        else if (n.type === 'custom_broadcast') iconClass = 'ph ph-broadcast bg-devo-orange/10 text-devo-orange';

        // تنسيق الخلفية ونقاط الحالة بناء على المقروئية
        const cardBg = n.is_read ? 'bg-devo-dark/40 opacity-70 border-devo-gray/50' : 'bg-devo-dark border-devo-orange/30';
        const unreadIndicator = n.is_read ? '' : '<span class="w-2.5 h-2.5 bg-devo-orange rounded-full animate-pulse shrink-0"></span>';

        // أزرار التحكم بالمقروئية
        const readBtnHtml = n.is_read 
            ? `<button onclick="toggleNotificationRead('${n.id}', false)" class="p-1.5 hover:bg-white/10 rounded text-devo-muted hover:text-white transition-colors" title="تحديد كغير مقروء"><i class="ph ph-envelope-open text-base"></i></button>`
            : `<button onclick="toggleNotificationRead('${n.id}', true)" class="p-1.5 hover:bg-white/10 rounded text-devo-orange hover:text-devo-orangeHover transition-colors" title="تحديد كمقروء"><i class="ph ph-envelope text-base"></i></button>`;

        // أزرار التحكم بالأرشفة
        const archiveBtnHtml = n.is_archived
            ? `<button onclick="toggleNotificationArchive('${n.id}', false)" class="p-1.5 hover:bg-white/10 rounded text-devo-orange transition-colors" title="إلغاء الأرشفة"><i class="ph ph-archive-box text-base"></i></button>`
            : `<button onclick="toggleNotificationArchive('${n.id}', true)" class="p-1.5 hover:bg-white/10 rounded text-devo-muted hover:text-white transition-colors" title="أرشفة الإشعار"><i class="ph ph-archive text-base"></i></button>`;

        // زر الانتقال للمحتوى المرتبط
        let linkBtnHtml = '';
        if (n.metadata && n.metadata.order_id) {
            linkBtnHtml = `<button onclick="viewNotificationTarget('${n.metadata.order_id}')" class="px-2.5 py-1 bg-devo-orange/10 hover:bg-devo-orange text-devo-orange hover:text-white rounded text-[11px] font-bold transition-all flex items-center gap-1">
                <i class="ph ph-eye text-sm"></i> عرض الطلب
            </button>`;
        } else if (n.metadata && n.metadata.model_id) {
            linkBtnHtml = `<a href="admin.html?admin_model=${n.metadata.model_id}" class="px-2.5 py-1 bg-devo-orange/10 hover:bg-devo-orange text-devo-orange hover:text-white rounded text-[11px] font-bold transition-all flex items-center gap-1">
                <i class="ph ph-eye text-sm"></i> عرض الموديل
            </a>`;
        }

        // شارة وحالة الإرسال للتليجرام مع زر إعادة المحاولة الفورية في حال التعثر
        let telegramBadgeHtml = '';
        if (n.telegram_status === 'failed') {
            telegramBadgeHtml = `
                <div class="flex items-center gap-1.5">
                    <span class="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded flex items-center gap-1" title="${n.telegram_last_error || 'فشل الإرسال'}">
                        <i class="ph ph-warning-circle"></i> تعذر إرسال التليجرام
                    </span>
                    <button onclick="retrySingleTelegramNotification('${n.id}')" class="px-2 py-0.5 bg-sky-500/10 hover:bg-sky-500 text-sky-400 hover:text-white border border-sky-500/30 rounded text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer" title="إعادة المحاولة الآن">
                        <i class="ph ph-arrows-clockwise text-xs"></i> إعادة المحاولة
                    </button>
                </div>
            `;
        } else if (n.telegram_status === 'sent') {
            telegramBadgeHtml = `
                <span class="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1" title="تم الإرسال بنجاح إلى تليجرام">
                    <i class="ph ph-check-circle"></i> تليجرام ✅
                </span>
            `;
        }

        return `
            <div class="border p-4 rounded-xl shadow-sm flex items-start gap-4 transition-all ${cardBg}" id="notify-card-${n.id}">
                <!-- الأيقونة التعبيرية -->
                <div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${iconClass}"></div>
                
                <!-- محتوى الإشعار -->
                <div class="flex-1 min-w-0 space-y-1 text-right">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-bold text-sm text-white">${n.title}</span>
                        ${unreadIndicator}
                        ${telegramBadgeHtml}
                        <span class="text-[10px] text-devo-muted mr-auto font-mono">${dateStr}</span>
                    </div>
                    <p class="text-xs text-devo-muted leading-relaxed whitespace-pre-wrap">${n.body}</p>
                    
                    <div class="flex items-center justify-between pt-2 border-t border-devo-gray/20 mt-2">
                        <!-- رابط الانتقال السريع -->
                        <div>${linkBtnHtml}</div>
                        
                        <!-- أدوات التحكم الفردية -->
                        <div class="flex items-center gap-1">
                            ${readBtnHtml}
                            ${archiveBtnHtml}
                            <button onclick="deleteNotification('${n.id}')" class="p-1.5 hover:bg-devo-error/10 rounded text-devo-muted hover:text-devo-error transition-colors" title="حذف الإشعار">
                                <i class="ph ph-trash text-base"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 4. تغيير فلتر التصفية النشط
export function changeNotificationFilter(filter) {
    activeFilter = filter;
    ['all', 'unread', 'archived'].forEach(f => {
        const btn = document.getElementById(`filter-notify-${f}`);
        if (btn) {
            if (f === filter) {
                btn.className = "px-3 py-1.5 rounded-md text-xs font-bold transition-all text-white bg-devo-orange shadow-md";
            } else {
                btn.className = "px-3 py-1.5 rounded-md text-xs font-bold transition-all text-devo-muted hover:text-white";
            }
        }
    });
    renderNotifications();
}

// 5. تعديل حالة إشعار واحد (قراءة / عدم قراءة)
export async function toggleNotificationRead(id, isRead) {
    try {
        const { error } = await supabase
            .from('system_notifications')
            .update({ is_read: isRead })
            .eq('id', id);

        if (error) throw error;

        const idx = allNotifications.findIndex(n => n.id === id);
        if (idx > -1) {
            allNotifications[idx].is_read = isRead;
            updateStats();
            renderNotifications();
            // إرسال حدث لتحديث جرس الهيدر تلقائياً
            window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
        }
    } catch (e) {
        showToast('خطأ أثناء تعديل حالة الإشعار', 'error');
    }
}

// أرشفة إشعار واحد
export async function toggleNotificationArchive(id, isArchived) {
    try {
        const { error } = await supabase
            .from('system_notifications')
            .update({ is_archived: isArchived })
            .eq('id', id);

        if (error) throw error;

        const idx = allNotifications.findIndex(n => n.id === id);
        if (idx > -1) {
            allNotifications[idx].is_archived = isArchived;
            updateStats();
            renderNotifications();
            window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
        }
    } catch (e) {
        showToast('خطأ أثناء أرشفة الإشعار', 'error');
    }
}

// حذف إشعار واحد نهائياً
export async function deleteNotification(id) {
    const confirm = await confirmDialog({
        title: 'تأكيد الحذف',
        body: 'هل أنت متأكد من رغبتك في حذف هذا الإشعار نهائياً من قاعدة البيانات؟',
        confirmText: 'نعم، احذف',
        cancelText: 'إلغاء'
    });
    if (!confirm) return;

    try {
        const { error } = await supabase
            .from('system_notifications')
            .delete()
            .eq('id', id);

        if (error) throw error;

        allNotifications = allNotifications.filter(n => n.id !== id);
        updateStats();
        renderNotifications();
        window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
        showToast('تم حذف الإشعار بنجاح', 'success');
    } catch (e) {
        showToast('خطأ أثناء حذف الإشعار', 'error');
    }
}

// 6. إجراءات جماعية
// تحديد الكل كمقروء
export async function bulkMarkNotificationsRead() {
    try {
        const unreadIds = allNotifications
            .filter(n => !n.is_read)
            .map(n => n?.id)
            .filter(id => id && typeof id === 'string' && id.trim() !== '');

        if (unreadIds.length === 0) {
            showToast('لا توجد إشعارات غير مقروءة حالياً', 'info');
            return;
        }

        for (let i = 0; i < unreadIds.length; i += 50) {
            const chunk = unreadIds.slice(i, i + 50);
            const { error } = await supabase
                .from('system_notifications')
                .update({ is_read: true })
                .in('id', chunk);

            if (error) console.warn('Error marking chunk read:', error);
        }

        allNotifications.forEach(n => n.is_read = true);
        updateStats();
        renderNotifications();
        window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
        showToast('تم تحديد جميع الإشعارات كمقروءة', 'success');
    } catch (e) {
        showToast('حدث خطأ أثناء تحديث الإشعارات', 'error');
    }
}

// أرشفة جميع الإشعارات غير المؤرشفة
export async function bulkArchiveNotifications() {
    try {
        const nonArchivedIds = allNotifications
            .filter(n => !n.is_archived)
            .map(n => n?.id)
            .filter(id => id && typeof id === 'string' && id.trim() !== '');

        if (nonArchivedIds.length === 0) {
            showToast('جميع الإشعارات مؤرشفة بالفعل', 'info');
            return;
        }

        for (let i = 0; i < nonArchivedIds.length; i += 50) {
            const chunk = nonArchivedIds.slice(i, i + 50);
            const { error } = await supabase
                .from('system_notifications')
                .update({ is_archived: true })
                .in('id', chunk);

            if (error) console.warn('Error archiving chunk:', error);
        }

        allNotifications.forEach(n => n.is_archived = true);
        updateStats();
        renderNotifications();
        window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
        showToast('تم أرشفة جميع الإشعارات بنجاح', 'success');
    } catch (e) {
        showToast('حدث خطأ أثناء أرشفة الإشعارات', 'error');
    }
}

// حذف جميع الإشعارات من قاعدة البيانات
export async function bulkDeleteNotifications() {
    if (allNotifications.length === 0) {
        showToast('قائمة الإشعارات فارغة بالفعل', 'info');
        return;
    }

    const confirm = await confirmDialog({
        title: 'حذف جميع الإشعارات',
        body: 'هل أنت متأكد من رغبتك في حذف جميع الإشعارات نهائياً من قاعدة البيانات؟ لا يمكن التراجع عن هذا الإجراء.',
        confirmText: 'نعم، احذف الكل',
        cancelText: 'إلغاء'
    });
    if (!confirm) return;

    try {
        const ids = allNotifications
            .map(n => n?.id)
            .filter(id => id && typeof id === 'string' && id.trim() !== '');

        if (ids.length > 0) {
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const { error } = await supabase
                    .from('system_notifications')
                    .delete()
                    .in('id', chunk);

                if (error) console.warn('Error deleting chunk:', error);
            }
        }

        allNotifications = [];
        updateStats();
        renderNotifications();
        window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
        showToast('تم تفريغ كافة الإشعارات بنجاح', 'success');
    } catch (e) {
        showToast('حدث خطأ أثناء مسح الإشعارات', 'error');
    }
}

// 7. بث إشعار مخصص لجميع المستخدمين متصلين
export async function broadcastCustomNotification() {
    const titleInput = document.getElementById('broadcast-title');
    const bodyInput = document.getElementById('broadcast-body');
    const btn = document.getElementById('broadcast-btn');

    if (!titleInput || !bodyInput) return;

    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();

    if (!title || !body) {
        showToast('يرجى ملء جميع حقول بث التنبيه', 'warning');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري البث...`;
    }

    const tgTargetInput = document.getElementById('broadcast-tg-target');
    const tgTarget = tgTargetInput ? tgTargetInput.value : 'none';

    try {
        const { error } = await supabase
            .from('system_notifications')
            .insert([{
                type: 'custom_broadcast',
                title: title,
                body: body,
                metadata: { 
                    broadcasted_by: 'Admin Panel',
                    telegram_target: tgTarget
                }
            }]);

        if (error) throw error;

        titleInput.value = '';
        bodyInput.value = '';
        showToast('تم بث الإشعار بنجاح لجميع الأجهزة والعمال المتصلين 🎉', 'success');
        
        await fetchNotifications();
    } catch (e) {
        console.error('Broadcast failed:', e);
        showToast('حدث خطأ أثناء بث الإشعار عبر النظام', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-paper-plane-tilt text-base"></i> بث التنبيه الآن`;
        }
    }
}

// 8. الانتقال التلقائي للهدف (مثل الطلب)
export function viewNotificationTarget(orderId) {
    const adminOrdersLink = document.querySelector('[data-target="view-admin-orders"]');
    if (adminOrdersLink && typeof window.switchView === 'function') {
        window.switchView('view-admin-orders', adminOrdersLink);
        setTimeout(() => {
            const row = document.getElementById(`admin-order-row-${orderId}`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.add('bg-devo-orange/30', 'transition-all', 'duration-500');
                setTimeout(() => row.classList.remove('bg-devo-orange/30'), 3000);
            }
        }, 500);
    }
}

// 9. جلب إعدادات تليجرام من جدول home_settings
async function loadTelegramSettings() {
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

// 10. حفظ إعدادات تليجرام في جدول home_settings
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

// 11. إظهار/إخفاء لوحة إعدادات التليجرام السرية
export function toggleTelegramSettingsCard() {
    const card = document.getElementById('telegram-settings-card');
    const icon = document.getElementById('tg-lock-icon');
    if (!card || !icon) return;
    
    if (card.classList.contains('hidden')) {
        card.classList.remove('hidden');
        icon.className = 'ph ph-lock-simple-open text-base';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        card.classList.add('hidden');
        icon.className = 'ph ph-lock text-base';
    }
}

// 12. تجربة وإرسال إشعار فحص فوري لبوت التليجرام
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

// 13. إرسال تقرير اليوم فورياً إلى جروب التليجرام
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
        await fetchNotifications();
    } catch (e) {
        console.error('Error sending daily Telegram report:', e);
        showToast(`تعذر إرسال تقرير اليوم: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-chart-bar text-base"></i> إرسال تقرير اليوم الآن`;
        }
    }
}

// 14. إرسال تقرير الأسبوع فورياً إلى جروب التليجرام
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
        await fetchNotifications();
    } catch (e) {
        console.error('Error sending weekly Telegram report:', e);
        showToast(`تعذر إرسال تقرير الأسبوع: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-calendar-check text-base"></i> إرسال تقرير الأسبوع الآن`;
        }
    }
}

// 14-ب. إرسال تقرير الشهر فورياً إلى جروب التليجرام
export async function sendMonthlyReportToTelegramNow() {
    const btn = document.getElementById('send-monthly-tg-report-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري إرسال تقرير الشهر...`;
    }

    try {
        const { data, error } = await supabase.rpc('generate_and_send_telegram_report', {
            p_report_type: 'monthly'
        });

        if (error) throw error;
        if (data && data.success === false) {
            throw new Error(data.error || 'فشل توليد التقرير الشهري');
        }

        showToast('تم إرسال تقرير الشهر بنجاح إلى جروب التليجرام 🗓️🚀', 'success');
        await fetchNotifications();
    } catch (e) {
        console.error('Error sending monthly Telegram report:', e);
        showToast(`تعذر إرسال تقرير الشهر: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-calendar-blank text-base"></i> تقرير الشهر`;
        }
    }
}

// 14-ج. إرسال تقرير السنة فورياً إلى جروب التليجرام
export async function sendYearlyReportToTelegramNow() {
    const btn = document.getElementById('send-yearly-tg-report-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> جاري إرسال تقرير السنة...`;
    }

    try {
        const { data, error } = await supabase.rpc('generate_and_send_telegram_report', {
            p_report_type: 'yearly'
        });

        if (error) throw error;
        if (data && data.success === false) {
            throw new Error(data.error || 'فشل توليد التقرير السنوي');
        }

        showToast('تم إرسال تقرير السنة بنجاح إلى جروب التليجرام 🏆🚀', 'success');
        await fetchNotifications();
    } catch (e) {
        console.error('Error sending yearly Telegram report:', e);
        showToast(`تعذر إرسال تقرير السنة: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-trophy text-base"></i> تقرير السنة`;
        }
    }
}

// 15. إرسال النسخة الاحتياطية فورياً إلى جروب النسخ الاحتياطي في تليجرام
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
        await fetchNotifications();
    } catch (e) {
        console.error('Error sending Telegram backup:', e);
        showToast(`تعذر إرسال النسخة: ${e.message || 'خطأ غير متوقع'}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-shield-check text-base"></i> إرسال النسخة الآن`;
        }
    }
}

// دالة مساعدة للتحقق من تسليم التقرير لجروب التقارير مع معالجة معرفات السوبر جروب (-100)
async function deliverTelegramReportClientSide(rpcData) {
    if (!rpcData || !rpcData.formatted_message) return;

    const { data: settings } = await supabase
        .from('home_settings')
        .select('*')
        .in('setting_key', ['telegram_bot_token', 'telegram_reports_chat_id', 'telegram_chat_id']);

    const botToken = settings?.find(s => s.setting_key === 'telegram_bot_token')?.setting_value;
    let reportsChatId = settings?.find(s => s.setting_key === 'telegram_reports_chat_id')?.setting_value || rpcData.chat_id || '-1004352609361';

    if (!botToken || !reportsChatId) return;

    try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: reportsChatId,
                text: rpcData.formatted_message,
                parse_mode: 'HTML'
            })
        });

        const resData = await res.json();
        if (!res.ok || !resData.ok) {
            // 1. معالجة ترقية المجموعة إلى Supergroup والحصول على المعرف الجديد مباشرة من تليجرام
            const newMigratedId = resData.parameters?.migrate_to_chat_id;
            if (newMigratedId || resData.description?.includes('upgraded to a supergroup chat')) {
                const targetNewId = String(newMigratedId || ('-100' + reportsChatId.replace(/^-/, '')));
                const retryRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: targetNewId,
                        text: rpcData.formatted_message,
                        parse_mode: 'HTML'
                    })
                });
                const retryData = await retryRes.json();
                if (retryRes.ok && retryData.ok) {
                    await supabase.from('home_settings').upsert({
                        setting_key: 'telegram_reports_chat_id',
                        setting_value: targetNewId
                    }, { onConflict: 'setting_key' });
                    
                    const reportsChatInput = document.getElementById('telegram-reports-chat-id');
                    if (reportsChatInput) reportsChatInput.value = targetNewId;
                    return;
                }
            }

            // 2. إذا كان الخطأ chat not found ولم يكن المعرف يبدأ بـ -100
            if (resData.description?.includes('chat not found') && !reportsChatId.startsWith('-100')) {
                const supergroupId = '-100' + reportsChatId.replace(/^-/, '');
                const retryRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: supergroupId,
                        text: rpcData.formatted_message,
                        parse_mode: 'HTML'
                    })
                });
                const retryData = await retryRes.json();
                if (retryRes.ok && retryData.ok) {
                    await supabase.from('home_settings').upsert({
                        setting_key: 'telegram_reports_chat_id',
                        setting_value: supergroupId
                    }, { onConflict: 'setting_key' });
                    
                    const reportsChatInput = document.getElementById('telegram-reports-chat-id');
                    if (reportsChatInput) reportsChatInput.value = supergroupId;
                    return;
                }
            }

            if (resData.description?.includes('bot is not a member') || resData.description?.includes('Forbidden')) {
                throw new Error('البوت ليس عضواً في جروب التقارير! يرجى إضافة البوت للجروب ورفعه مشرفاً أولاً.');
            }
            throw new Error(`خطأ من تليجرام: ${resData.description || 'فشل الإرسال'}`);
        }
    } catch (err) {
        console.warn('Client-side telegram delivery check:', err);
        throw err;
    }
}
