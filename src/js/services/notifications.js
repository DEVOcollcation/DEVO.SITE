import { supabase } from '../config/supabase.js';
import { showToast } from '../components/toast.js';

let unreadOrders = [];
let soundEnabled = localStorage.getItem('devo_notifications_sound') !== 'false';
let desktopEnabled = Notification.permission === 'granted';
let originalTitle = document.title || 'DEVO | لوحة تحكم الإدارة';
let realtimeChannel = null;

// تهيئة نظام الإشعارات اللحظية
export function initNotifications() {
    setupUI();
    setupRealtimeSubscription();
    updateAppBadge(0);
}

// إعداد عناصر واجهة المستخدم والتحكم بالإشعارات
function setupUI() {
    const bellBtn = document.getElementById('notifications-bell-btn');
    const dropdown = document.getElementById('notifications-dropdown');
    const clearBtn = document.getElementById('clear-notifications-btn');
    const soundCheckbox = document.getElementById('toggle-sound-checkbox');
    const desktopBtn = document.getElementById('request-desktop-notifications-btn');

    if (!bellBtn || !dropdown) return;

    // فتح وإغلاق القائمة المنسدلة
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

    // مسح كافة التنبيهات
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            unreadOrders = [];
            updateNotificationsListUI();
            updateAppBadge(0);
            showToast('تم مسح جميع الإشعارات', 'info');
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
                        body: 'ستتلقى إشعارات هنا عند وصول أوردرات جديدة.'
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

// الاتصال اللحظي بـ Supabase لمراقبة الطلبات الجديدة
function setupRealtimeSubscription() {
    if (realtimeChannel) {
        realtimeChannel.unsubscribe();
    }

    realtimeChannel = supabase.channel('global_orders_notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
            console.log('🔔 رادار الإشعارات: التقاط طلب جديد!', payload.new);
            
            // تشغيل التنبيه الصوتي
            playChimeSound();

            // جلب تفاصيل إضافية للطلب لعرضها بشكل جميل
            const { data, error } = await supabase
                .from('orders')
                .select('id, customer_name, total_price')
                .eq('id', payload.new.id)
                .maybeSingle();
                
            const orderInfo = data || payload.new;
            
            // إضافة الطلب إلى أعلى قائمة غير المقروء
            unreadOrders.unshift({
                id: orderInfo.id,
                customer_name: orderInfo.customer_name || 'عميل غير معروف',
                total_price: orderInfo.total_price || 0,
                created_at: new Date().toISOString()
            });

            // إظهار توست تحذيري مميز
            showToast(`🚨 أوردر جديد قد وصل! برقم #${orderInfo.id} للعميل: ${orderInfo.customer_name}`, 'warning');

            // إرسال إشعار سطح المكتب
            sendDesktopNotification(`أوردر جديد قد وصل! #${orderInfo.id}`, {
                body: `العميل: ${orderInfo.customer_name}\nالإجمالي: ${orderInfo.total_price} ج.م`,
                tag: `new-order-${orderInfo.id}`
            });

            // تحديث الواجهة والعداد
            updateNotificationsListUI();
            updateAppBadge(unreadOrders.length);
        })
        .subscribe((status, err) => {
            console.log('📡 حالة اتصال رادار الإشعارات اللحظية:', status);
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
        return `
            <div class="p-3 hover:bg-devo-gray/30 border-b border-devo-gray/20 transition-all cursor-pointer flex flex-col gap-1 text-right" data-order-id="${o.id}">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-white flex items-center gap-1">
                        <span class="w-1.5 h-1.5 bg-devo-orange rounded-full animate-ping"></span>
                        أوردر جديد #${o.id}
                    </span>
                    <span class="text-[10px] text-devo-muted font-medium">${timeStr}</span>
                </div>
                <div class="text-xs text-devo-muted flex justify-between items-center mt-1">
                    <span class="truncate max-w-[170px] text-devo-text">${o.customer_name}</span>
                    <span class="text-devo-orange font-bold font-mono">${o.total_price.toLocaleString('ar-EG')} ج.م</span>
                </div>
            </div>
        `;
    }).join('');

    // ربط الضغط على الإشعار بالتنقل
    listContainer.querySelectorAll('[data-order-id]').forEach(el => {
        el.addEventListener('click', () => {
            const orderId = el.getAttribute('data-order-id');
            handleNotificationClick(orderId);
        });
    });
}

// معالجة الضغط على إشعار محدد
function handleNotificationClick(orderId) {
    // إزالة الطلب من قائمة الإشعارات
    unreadOrders = unreadOrders.filter(o => String(o.id) !== String(orderId));
    updateNotificationsListUI();
    updateAppBadge(unreadOrders.length);

    // الانتقال إلى تبويب إدارة الأوردات
    const adminOrdersLink = document.querySelector('[data-target="view-admin-orders"]');
    if (adminOrdersLink) {
        // محاكاة الضغط لتبديل الواجهة
        adminOrdersLink.click();
    }

    // الانتقال والوميض للأوردر المحدد في الجدول
    setTimeout(() => {
        const row = document.getElementById(`admin-order-row-${orderId}`);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // تأثير وميض برتقالي جميل لجلب انتباه العين
            row.classList.add('bg-devo-orange/30', 'transition-all', 'duration-500');
            setTimeout(() => row.classList.remove('bg-devo-orange/30'), 3000);
        }
    }, 500);

    // إغلاق القائمة المنسدلة بعد الضغط
    const dropdown = document.getElementById('notifications-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}

// توليد نغمة تنبيه راقية برمجياً
export function playChimeSound() {
    if (!soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const now = audioCtx.currentTime;

        // النغمة الأولى: C5 (523.25 Hz)
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

        // النغمة الثانية: E5 (659.25 Hz) بعد فترة بسيطة
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
    // 1. تحديث شارة التطبيق المدمج (لأنظمة الديسكتوب و PWA)
    if ('setAppBadge' in navigator) {
        if (count > 0) {
            navigator.setAppBadge(count).catch(e => console.warn('setAppBadge failed', e));
        } else {
            navigator.clearAppBadge().catch(e => console.warn('clearAppBadge failed', e));
        }
    }
    
    // 2. تحديث عنوان التبويب بالمتصفح
    if (count > 0) {
        document.title = `(${count}) ${originalTitle}`;
    } else {
        document.title = originalTitle;
    }
}
