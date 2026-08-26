import { supabase } from '../config/supabase.js';
import { showToast } from '../components/toast.js';

let unreadOrders = [];
let soundEnabled = localStorage.getItem('devo_notifications_sound') !== 'false';
let desktopEnabled = Notification.permission === 'granted';
let originalTitle = document.title || 'DEVO | لوحة تحكم الإدارة';
let realtimeChannel = null;
let currentUser = null;
let webNotificationsEnabled = true;

// جلب إعدادات البث في الموقع
async function loadNotificationSettings() {
    try {
        const { data, error } = await supabase
            .from('home_settings')
            .select('*')
            .eq('setting_key', 'web_notifications_enabled')
            .maybeSingle();
            
        if (!error && data) {
            webNotificationsEnabled = data.setting_value !== 'false';
        }
    } catch (e) {
        console.error('Error loading web notification settings:', e);
    }
}

// تهيئة نظام الإشعارات اللحظية
export async function initNotifications() {
    loadUserSession();
    await loadNotificationSettings();
    setupUI();
    
    if (webNotificationsEnabled) {
        await fetchUnreadNotifications();
        setupRealtimeSubscription();

        if (!isAuthStateListenerSet) {
            isAuthStateListenerSet = true;
            supabase.auth.onAuthStateChange(async (event) => {
                if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
                    loadUserSession();
                }
            });
        }

        // الاستماع لحدث التحديث اليدوي من صفحة إدارة الإشعارات لإعادة الجلب
        window.addEventListener('devo:notifications-updated', async () => {
            await fetchUnreadNotifications();
        });
    } else {
        // إخفاء مؤشر الإشعارات وتفريغ القائمة
        const badge = document.getElementById('notifications-badge');
        if (badge) {
            badge.classList.add('hidden');
            badge.classList.remove('flex');
        }
        const listContainer = document.getElementById('notifications-list');
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="p-8 text-center text-xs text-devo-muted flex flex-col items-center gap-2">
                    <i class="ph ph-bell-slash text-2xl opacity-40"></i>
                    تم تعطيل بث الإشعارات داخل الموقع
                </div>
            `;
        }
    }

    // اقتراح تفعيل إشعارات المتصفح للعمال والمسؤولين المسجلين إذا لم يفعلوا ذلك بعد
    if (webNotificationsEnabled && currentUser && 'Notification' in window && Notification.permission === 'default') {
        const alreadyPrompted = sessionStorage.getItem('devo_notification_prompted');
        if (!alreadyPrompted) {
            sessionStorage.setItem('devo_notification_prompted', 'true');
            setTimeout(async () => {
                const confirmed = await window.confirmDialog?.({
                    title: '🔔 تفعيل تنبيهات سطح المكتب',
                    message: 'هل ترغب في تفعيل إشعارات المتصفح الفورية لتلقي تنبيهات الطلبات وتحديثات المخازن اللحظية على جهازك؟',
                    confirmText: 'تفعيل الآن',
                    cancelText: 'ليس الآن'
                });
                
                if (confirmed) {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        showToast('تم تفعيل إشعارات سطح المكتب بنجاح 🔔', 'success');
                        // إرسال إشعار تجريبي
                        try {
                            new Notification('DEVO System', {
                                body: 'ستتلقى إشعارات هنا عند حدوث تغييرات بالسيستم.',
                                icon: './src/assets/icons/dv.png'
                            });
                        } catch (e) {}
                        
                        const desktopBtn = document.getElementById('request-desktop-notifications-btn');
                        if (desktopBtn) updateDesktopBtnUI();
                    } else {
                        showToast('تم رفض صلاحية الإشعارات', 'error');
                    }
                }
            }, 3000);
        }
    }
}

// تحميل بيانات الجلسة الحالية للمستخدم
function loadUserSession() {
    const sessionStr = localStorage.getItem('devo_session');
    if (sessionStr) {
        try { currentUser = JSON.parse(sessionStr); } catch (e) {}
    }
}

// إعداد عناصر واجهة المستخدم والتحكم بالإشعارات
function setupUI() {
    const bellBtn = document.getElementById('notifications-bell-btn');
    const dropdown = document.getElementById('notifications-dropdown');
    const clearBtn = document.getElementById('clear-notifications-btn');
    const soundCheckbox = document.getElementById('toggle-sound-checkbox');
    const desktopBtn = document.getElementById('request-desktop-notifications-btn');

    if (!bellBtn || !dropdown) return;

    // فتح وإغلاق القائمة المنسدلة للجرس
    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
    });

    // إغلاق القائمة عند النقر خارجها
    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    // تشغيل/تعطيل الصوت وحفظ التفضيل
    if (soundCheckbox) {
        soundCheckbox.checked = soundEnabled;
        soundCheckbox.addEventListener('change', (e) => {
            soundEnabled = e.target.checked;
            localStorage.setItem('devo_notifications_sound', soundEnabled);
            showToast(soundEnabled ? 'تم تفعيل التنبيه الصوتي 🔊' : 'تم كتم التنبيه الصوتي 🔇', 'info');
            if (soundEnabled) {
                playChimeSound();
            }
        });
    }

    // مسح كافة التنبيهات وتحديدها كمقروءة بالداتا بيز
    if (clearBtn) {
        clearBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (unreadOrders.length === 0) return;
            const validIds = unreadOrders
                .map(o => o?.id)
                .filter(id => id && typeof id === 'string' && id.trim() !== '');

            try {
                if (validIds.length > 0) {
                    for (let i = 0; i < validIds.length; i += 50) {
                        const chunk = validIds.slice(i, i + 50);
                        const { error } = await supabase
                            .from('system_notifications')
                            .update({ is_read: true })
                            .in('id', chunk);

                        if (error) console.warn('Warning marking notifications read chunk:', error);
                    }
                }

                unreadOrders = [];
                updateNotificationsListUI();
                updateAppBadge(0);
                showToast('تم مسح جميع الإشعارات وتحديدها كمقروءة', 'success');
                window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
            } catch (err) {
                console.error('Failed to clear notifications:', err);
                showToast('خطأ أثناء مسح الإشعارات', 'error');
            }
        });
    }

    // تفعيل إشعارات سطح المكتب
    if (desktopBtn) {
        updateDesktopBtnUI();
        desktopBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (Notification.permission === 'default') {
                const permission = await Notification.requestPermission();
                desktopEnabled = (permission === 'granted');
                updateDesktopBtnUI();
                if (desktopEnabled) {
                    showToast('تم تفعيل إشعارات سطح المكتب بنجاح 🔔', 'success');
                    sendDesktopNotification('تم تفعيل الإشعارات بنجاح!', {
                        body: 'ستتلقى إشعارات هنا عند حدوث تغييرات بالسيستم.'
                    });
                } else {
                    showToast('تم رفض صلاحية الإشعارات', 'error');
                }
            } else if (Notification.permission === 'denied') {
                showToast('صلاحية الإشعارات محظورة في متصفحك. يرجى تفعيلها من إعدادات الموقع.', 'warning');
            } else {
                showToast('إشعارات سطح المكتب مفعلة بالفعل 🎉', 'success');
            }
        });
    }
}

// تحديث زر تفعيل إشعارات سطح المكتب
function updateDesktopBtnUI() {
    const desktopBtn = document.getElementById('request-desktop-notifications-btn');
    if (!desktopBtn) return;
    
    if (Notification.permission === 'granted') {
        desktopBtn.innerHTML = `<i class="ph ph-check-circle text-devo-success text-sm"></i> <span>الإشعارات مفعلة</span>`;
        desktopBtn.className = "text-devo-success pointer-events-none flex items-center gap-1.5";
    } else if (Notification.permission === 'denied') {
        desktopBtn.innerHTML = `<i class="ph ph-x-circle text-devo-error text-sm"></i> <span>الإشعارات محظورة</span>`;
        desktopBtn.className = "text-devo-muted pointer-events-none flex items-center gap-1.5";
    } else {
        desktopBtn.innerHTML = `<i class="ph ph-desktop text-sm"></i> <span>تفعيل إشعارات سطح المكتب</span>`;
        desktopBtn.className = "text-devo-orange hover:text-devo-orange-hover transition-colors flex items-center gap-1.5 cursor-pointer";
    }
}

// جلب الإشعارات غير المقروءة والموجهة للمستخدم الحالي من الداتابيز
export async function fetchUnreadNotifications() {
    try {
        let query = supabase
            .from('system_notifications')
            .select('*')
            .eq('is_read', false)
            .eq('is_archived', false)
            .order('created_at', { ascending: false });

        if (currentUser) {
            if (currentUser.role === 'worker') {
                // العمال يستقبلون فقط التنبيهات الموجهة لهم مباشرة (كإسناد طلب لهم)
                query = query.eq('user_id', currentUser.id);
            } else {
                // المسؤولون يستقبلون الإشعارات العامة (user_id IS NULL) والإشعارات الموجهة لهم شخصياً
                query = query.or(`user_id.is.null,user_id.eq.${currentUser.id}`);
            }
        } else {
            query = query.is('user_id', null);
        }

        const { data, error } = await query;
        if (!error && data) {
            unreadOrders = data;
            updateNotificationsListUI();
            updateAppBadge(unreadOrders.length);
        }
    } catch (e) {
        console.error('Error fetching unread notifications:', e);
    }
}

let realtimeRetryTimeout = null;
let isAuthStateListenerSet = false;

// الاتصال اللحظي بـ Supabase لمراقبة جدول الإشعارات
function setupRealtimeSubscription() {
    if (realtimeChannel) {
        try {
            supabase.removeChannel(realtimeChannel);
        } catch (e) {}
        realtimeChannel = null;
    }

    realtimeChannel = supabase.channel('global_system_notifications_tracker')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_notifications' }, async (payload) => {
            const newNotif = payload.new;

            // فلترة الإشعار: هل هذا الإشعار موجه للمستخدم الحالي أم لا؟
            if (currentUser) {
                if (currentUser.role === 'worker') {
                    if (newNotif.user_id !== currentUser.id) return; // تجاهل التنبيهات التي ليست له
                } else {
                    if (newNotif.user_id !== null && newNotif.user_id !== currentUser.id) return; // تجاهل التنبيهات الخاصة ببعض العمال الآخرين
                }
            } else {
                if (newNotif.user_id !== null) return; // تجاهل التنبيهات الخاصة بالعمال
            }

            // تشغيل التنبيه الصوتي
            playChimeSound();

            // إضافة الطلب إلى أعلى قائمة غير المقروء محلياً
            unreadOrders.unshift(newNotif);

            // إظهار توست بالتحذير
            let toastType = 'warning';
            if (newNotif.type === 'out_of_stock') toastType = 'error';
            else if (newNotif.type === 'order_created') toastType = 'success';
            else if (newNotif.type === 'system_backup_completed') {
                toastType = 'info';
                // تأكيد رفع ملف النسخة الاحتياطية وإرساله كمستند مرفق إلى تليجرام
                import('../pages/admin/backup_restore.js').then(m => {
                    m.executeCloudAutoBackup(false).catch(e => console.warn('Background auto backup sync:', e));
                }).catch(e => {});
            }
            
            showToast(`🚨 ${newNotif.title}\n${newNotif.body}`, toastType);

            // إرسال إشعار سطح المكتب للمتصفح
            sendDesktopNotification(newNotif.title, {
                body: newNotif.body,
                tag: `notification-${newNotif.id}`
            });

            // تحديث الواجهة والعدادات
            updateNotificationsListUI();
            updateAppBadge(unreadOrders.length);

            // إرسال حدث عام لتحديث صفحة الإشعارات بالأدمن لو كانت مفتوحة حالياً
            window.dispatchEvent(new CustomEvent('devo:notifications-received'));
        })
        .subscribe(async (status, err) => {
            if (err && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
                console.warn('⚠️ تنبيه في اتصال قناة الإشعارات:', err);
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                const errStr = err ? String(err.message || err) : '';
                const isJwtExpired = errStr.includes('InvalidJWTToken') || errStr.includes('expired') || errStr.includes('1006') || errStr.includes('1000');

                if (isJwtExpired) {
                    console.warn('🔄 انتهت صلاحية رمز الـ JWT أو انقطع الاتصال، جاري تحديث الجلسة وإعادة المحاولة...');
                    try {
                        await supabase.auth.getSession();
                    } catch (refreshErr) {
                        console.error('فشل تحديث جلسة Supabase:', refreshErr);
                    }
                }

                if (!realtimeRetryTimeout) {
                    realtimeRetryTimeout = setTimeout(() => {
                        realtimeRetryTimeout = null;
                        if (webNotificationsEnabled) {
                            setupRealtimeSubscription();
                        }
                    }, 10000);
                }
            } else if (status === 'SUBSCRIBED') {
                if (realtimeRetryTimeout) {
                    clearTimeout(realtimeRetryTimeout);
                    realtimeRetryTimeout = null;
                }
            }
        });
}

// 🌐 إعادة الاتصال الفوري بالرادار عند عودة الإنترنت للجهاز 🌐
window.addEventListener('online', () => {
    if (webNotificationsEnabled) {
        setupRealtimeSubscription();
    }
});

// تحديث واجهة قائمة الإشعارات
function updateNotificationsListUI() {
    const listContainer = document.getElementById('notifications-list');
    const badge = document.getElementById('notifications-badge');
    if (!listContainer) return;

    if (unreadOrders.length === 0) {
        listContainer.innerHTML = `
            <div class="p-8 text-center text-xs text-devo-muted flex flex-col items-center gap-2">
                <i class="ph ph-bell-slash text-2xl opacity-40"></i>
                لا توجد إشعارات جديدة حالياً
            </div>
        `;
        if (badge) {
            badge.classList.add('hidden');
            badge.classList.remove('flex');
        }
        return;
    }

    if (badge) {
        badge.textContent = unreadOrders.length;
        badge.classList.remove('hidden');
        badge.classList.add('flex');
    }

    listContainer.innerHTML = unreadOrders.map(o => {
        const timeStr = new Date(o.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        
        let colorClass = 'bg-devo-orange';
        if (o.type === 'out_of_stock') colorClass = 'bg-devo-error';
        else if (o.type === 'order_created') colorClass = 'bg-devo-success';
        else if (o.type === 'order_assigned') colorClass = 'bg-blue-500';

        return `
            <div class="p-3 hover:bg-devo-gray/30 border-b border-devo-gray/20 transition-all cursor-pointer flex flex-col gap-1 text-right" data-order-id="${o.id}">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-white flex items-center gap-1">
                        <span class="w-1.5 h-1.5 ${colorClass} rounded-full animate-ping"></span>
                        ${o.title}
                    </span>
                    <span class="text-[10px] text-devo-muted font-medium">${timeStr}</span>
                </div>
                <div class="text-[11px] text-devo-muted mt-1 leading-relaxed truncate max-w-[280px]">
                    ${o.body}
                </div>
            </div>
        `;
    }).join('');

    // ربط الضغط على الإشعار بالتنقل والتحديث
    listContainer.querySelectorAll('[data-order-id]').forEach(el => {
        el.addEventListener('click', () => {
            const notifId = el.getAttribute('data-order-id');
            handleNotificationClick(notifId);
        });
    });
}

// معالجة الضغط على إشعار محدد
async function handleNotificationClick(notifId) {
    const notif = unreadOrders.find(o => String(o.id) === String(notifId));
    if (!notif) return;

    // إزالة الطلب محلياً
    unreadOrders = unreadOrders.filter(o => String(o.id) !== String(notifId));
    updateNotificationsListUI();
    updateAppBadge(unreadOrders.length);

    // تحديث المقروئية بالداتابيز
    try {
        await supabase
            .from('system_notifications')
            .update({ is_read: true })
            .eq('id', notifId);
        
        // إرسال تنبيه لتحديث صفحة الإشعارات لو كانت مفتوحة
        window.dispatchEvent(new CustomEvent('devo:notifications-updated'));
    } catch (err) {
        console.error(err);
    }

    // الانتقال والتوجيه التلقائي حسب نوع ومحتوى الإشعار
    if (notif.metadata) {
        if (notif.metadata.order_id) {
            const adminOrdersLink = document.querySelector('[data-target="view-admin-orders"]');
            if (adminOrdersLink) {
                adminOrdersLink.click();
            }
            setTimeout(() => {
                const row = document.getElementById(`admin-order-row-${notif.metadata.order_id}`);
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.classList.add('bg-devo-orange/30', 'transition-all', 'duration-500');
                    setTimeout(() => row.classList.remove('bg-devo-orange/30'), 3000);
                }
            }, 500);
        } else if (notif.metadata.model_id) {
            const modelsLink = document.querySelector('[data-target="view-models"]');
            if (modelsLink) {
                modelsLink.click();
            }
            // إذا كان كود الموديل معروفاً، نضعه بفلتر البحث
            setTimeout(() => {
                const searchInput = document.getElementById('model-search');
                if (searchInput) {
                    searchInput.value = notif.metadata.model_code || '';
                    searchInput.dispatchEvent(new Event('input'));
                }
            }, 500);
        }
    }

    // إغلاق القائمة المنسدلة
    const dropdown = document.getElementById('notifications-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}

// توليد نغمة تنبيه راقية برمجياً
export function playChimeSound() {
    if (!soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const now = audioCtx.currentTime;

        // النغمة الأولى: C5
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.value = 523.25;
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.1, now + 0.05);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        
        osc1.start(now);
        osc1.stop(now + 0.4);

        // النغمة الثانية: E5 بعد 0.12 ثانية
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = 659.25;
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        
        const note2Time = now + 0.12;
        gain2.gain.setValueAtTime(0, note2Time);
        gain2.gain.linearRampToValueAtTime(0.1, note2Time + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.001, note2Time + 0.5);
        
        osc2.start(note2Time);
        osc2.stop(note2Time + 0.5);
    } catch (e) {
        console.warn("AudioContext chime failed to play", e);
    }
}

// إرسال إشعار سطح المكتب للعميل
export function sendDesktopNotification(title, options = {}) {
    if (Notification.permission === 'granted') {
        try {
            const defaultOptions = {
                icon: './src/assets/icons/dv.png',
                badge: './src/assets/icons/dv.png',
                dir: 'rtl',
                ...options
            };
            const n = new Notification(title, defaultOptions);
            n.onclick = () => {
                window.focus();
                const adminOrdersLink = document.querySelector('[data-target="view-admin-orders"]');
                if (adminOrdersLink) adminOrdersLink.click();
            };
        } catch (e) {
            console.error('Failed to show notification', e);
        }
    }
}

// تحديث شارة أيقونة التطبيق وعنوان الصفحة
export function updateAppBadge(count) {
    if ('setAppBadge' in navigator) {
        if (count > 0) {
            navigator.setAppBadge(count).catch(e => console.warn('setAppBadge failed', e));
        } else {
            navigator.clearAppBadge().catch(e => console.warn('clearAppBadge failed', e));
        }
    }
    
    if (count > 0) {
        document.title = `(${count}) ${originalTitle}`;
    } else {
        document.title = originalTitle;
    }
}

// ============================================================
// 📱 إرسال وتأكيد وصول إشعار الأوردر على تليجرام مع إعادة المحاولة ومعالجة الأخطاء
// ============================================================
export async function deliverOrderTelegramNotification(orderId, orderData = null) {
    try {
        const { data: settings } = await supabase
            .from('home_settings')
            .select('*')
            .in('setting_key', ['telegram_enabled', 'telegram_bot_token', 'telegram_chat_id']);

        if (!settings) return;

        const isEnabled = settings.find(s => s.setting_key === 'telegram_enabled')?.setting_value !== 'false';
        const botToken = settings.find(s => s.setting_key === 'telegram_bot_token')?.setting_value?.trim();
        let chatId = settings.find(s => s.setting_key === 'telegram_chat_id')?.setting_value?.trim();

        if (!isEnabled || !botToken || !chatId) return;

        // Fetch complete order details if not fully provided
        let order = orderData;
        if (!order || !order.customer_name || !order.order_items) {
            const { data: fetchedOrder } = await supabase
                .from('orders')
                .select(`
                    *,
                    system_users!worker_id (full_name),
                    order_items (
                        *,
                        models (name, factory_code, classes (class_sizes (size_id)), model_sizes (size_id)),
                        colors (name)
                    )
                `)
                .eq('id', orderId)
                .maybeSingle();
            if (fetchedOrder) order = fetchedOrder;
        }

        if (!order) return;

        // Calculate series and pieces
        let totalSeries = 0;
        let totalPieces = 0;
        let itemsSummary = '';

        if (order.order_items && Array.isArray(order.order_items)) {
            order.order_items.forEach((item, idx) => {
                const q = item.quantity || item.qty || 0;
                const szCount = (item.models?.classes?.class_sizes?.length > 0 ? item.models.classes.class_sizes.length : item.models?.model_sizes?.length) || item.sizes_count || 1;
                const pcs = q * szCount;
                totalSeries += q;
                totalPieces += pcs;

                if (idx < 4) {
                    const mName = item.models?.name || item.model_name || 'موديل';
                    const cName = item.colors?.name || item.color_name || 'لون';
                    itemsSummary += `\n▫️ ${mName} (${cName}) • <b>${q} سيري</b> (${pcs} ق)`;
                }
            });
            if (order.order_items.length > 4) {
                itemsSummary += `\n▫️ <i>وغيرها (${order.order_items.length - 4} أصناف أخرى)...</i>`;
            }
        }

        const invNum = order.invoice_number || (orderId ? String(orderId).slice(0, 8) : 'جديد');
        const custName = order.customer_name || 'عميل نقدي';
        const phone1 = order.phone_1 || '-';
        const phone2 = order.phone_2 ? ` / ${order.phone_2}` : '';
        const address = order.address || 'غير محدد';
        const total = parseFloat(order.total_price || 0).toLocaleString('ar-EG');
        const deposit = parseFloat(order.deposit || 0).toLocaleString('ar-EG');
        const remaining = (parseFloat(order.total_price || 0) - parseFloat(order.deposit || 0)).toLocaleString('ar-EG');
        const cashier = order.system_users?.full_name || order.assigned_admin_name || 'DEVO';
        const notes = order.notes ? `\n📝 <b>ملاحظات:</b> ${order.notes}` : '';
        const cairoTime = new Date().toLocaleString('ar-EG');

        const htmlMessage = 
`🚨 <b>أوردر جديد قد وصل!</b>
━━━━━━━━━━━━
🧾 <b>رقم الأوردر:</b> #${invNum}
👤 <b>اسم العميل:</b> ${custName}
📞 <b>رقم الهاتف:</b> <code>${phone1}${phone2}</code>
📍 <b>العنوان:</b> ${address}
💵 <b>إجمالي المبلغ:</b> <b>${total} ج.م</b>
📥 <b>المدفوع (عربون):</b> ${deposit} ج.م
⏳ <b>المتبقي:</b> ${remaining} ج.م
📦 <b>الكمية:</b> <b>${totalSeries} سيري</b> (${totalPieces} قطعة)
👤 <b>الكاشير:</b> ${cashier}${itemsSummary}${notes}
━━━━━━━━━━━━
⏰ <i>${cairoTime}</i>`;

        const plainTextMessage = 
`🚨 أوردر جديد قد وصل!
━━━━━━━━━━━━
🧾 رقم الأوردر: #${invNum}
👤 اسم العميل: ${custName}
📞 رقم الهاتف: ${phone1}${phone2}
📍 العنوان: ${address}
💵 إجمالي المبلغ: ${total} ج.م (عربون: ${deposit} ج.م • متبقي: ${remaining} ج.م)
📦 الكمية: ${totalSeries} سيري (${totalPieces} قطعة)
👤 الكاشير: ${cashier}
━━━━━━━━━━━━
⏰ ${cairoTime}`;

        // Attempt delivery with automatic retries, supergroup migration handling, and plain text fallback
        let targetChatId = chatId;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            try {
                const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: targetChatId,
                        text: htmlMessage,
                        parse_mode: 'HTML'
                    })
                });

                const resData = await res.json();
                if (res.ok && resData.ok) {
                    console.log(`✅ Telegram order notification delivered successfully on attempt ${attempts}`);
                    return true;
                }

                console.warn(`⚠️ Telegram dispatch attempt ${attempts} failed:`, resData);

                // 1. معالجة ترقية الجروب إلى Supergroup (-100...)
                const newMigratedId = resData.parameters?.migrate_to_chat_id;
                if (newMigratedId || resData.description?.includes('upgraded to a supergroup chat') || (resData.description?.includes('chat not found') && !targetChatId.startsWith('-100'))) {
                    targetChatId = String(newMigratedId || ('-100' + targetChatId.replace(/^-/, '')));
                    await supabase.from('home_settings').upsert({
                        setting_key: 'telegram_chat_id',
                        setting_value: targetChatId
                    }, { onConflict: 'setting_key' });
                    continue;
                }

                // 2. معالجة أخطاء تحليل الـ HTML والتبديل للنص العادي
                if (resData.description?.includes("can't parse entities") || resData.description?.includes("Bad Request: can't parse")) {
                    const fallbackRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: targetChatId,
                            text: plainTextMessage
                        })
                    });
                    const fallbackData = await fallbackRes.json();
                    if (fallbackRes.ok && fallbackData.ok) {
                        console.log('✅ Telegram notification delivered via PlainText fallback');
                        return true;
                    }
                }

                // Wait 1 second before retrying
                await new Promise(r => setTimeout(r, 1000));
            } catch (netErr) {
                console.error(`Telegram network attempt ${attempts} error:`, netErr);
                await new Promise(r => setTimeout(r, 1200));
            }
        }
    } catch (err) {
        console.error('Error in deliverOrderTelegramNotification:', err);
    }
}
