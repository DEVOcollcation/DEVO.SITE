import { supabase } from '../config/supabase.js';
import { showToast } from '../components/toast.js';

let unreadOrders = [];
let soundEnabled = localStorage.getItem('devo_notifications_sound') !== 'false';
let desktopEnabled = Notification.permission === 'granted';
let originalTitle = document.title || 'DEVO | لوحة تحكم الإدارة';
let realtimeChannel = null;
let currentUser = null;

// تهيئة نظام الإشعارات اللحظية
export async function initNotifications() {
    loadUserSession();
    setupUI();
    await fetchUnreadNotifications();
    setupRealtimeSubscription();

    // الاستماع لحدث التحديث اليدوي من صفحة إدارة الإشعارات لإعادة الجلب
    window.addEventListener('devo:notifications-updated', async () => {
        await fetchUnreadNotifications();
    });

    // اقتراح تفعيل إشعارات المتصفح للعمال والمسؤولين المسجلين إذا لم يفعلوا ذلك بعد
    if (currentUser && 'Notification' in window && Notification.permission === 'default') {
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
            const ids = unreadOrders.map(o => o.id);
            try {
                const { error } = await supabase
                    .from('system_notifications')
                    .update({ is_read: true })
                    .in('id', ids);

                if (error) throw error;

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

// الاتصال اللحظي بـ Supabase لمراقبة جدول الإشعارات
function setupRealtimeSubscription() {
    if (realtimeChannel) {
        realtimeChannel.unsubscribe();
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
        .subscribe((status, err) => {
            console.log('📡 حالة اتصال رادار الإشعارات المركزي:', status);
            if (err) console.error('⚠️ خطأ في اتصال قناة الإشعارات:', err);
        });
}

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
