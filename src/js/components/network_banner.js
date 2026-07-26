// ==========================================
// 📡 DEVO Network Status Monitor & Offline Banner 📡
// ==========================================

export function initNetworkStatusMonitor() {
    let banner = document.getElementById('devo-network-status-banner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'devo-network-status-banner';
        banner.className = 'fixed bottom-4 left-4 right-4 md:right-auto md:left-6 md:bottom-6 z-[999999] pointer-events-none transition-all duration-500 opacity-0 translate-y-8 max-w-md';
        document.body.appendChild(banner);
    }

    let hideTimeout = null;

    function showOfflineBanner() {
        if (hideTimeout) clearTimeout(hideTimeout);
        banner.innerHTML = `
            <div class="pointer-events-auto bg-red-950/95 text-red-100 border border-red-500/60 shadow-2xl rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-3 backdrop-blur-xl animate-pulse">
                <div class="flex items-center gap-3">
                    <span class="w-3 h-3 rounded-full bg-red-500 animate-ping shrink-0"></span>
                    <div>
                        <h5 class="font-bold text-xs sm:text-sm text-white">لا يوجد اتصال بالإنترنت لديك 📡</h5>
                        <p class="text-[11px] sm:text-xs text-red-200/90 mt-0.5">يتم عرض البيانات المحفوظة محلياً فقط لحين عودة الاتصال.</p>
                    </div>
                </div>
            </div>
        `;
        banner.classList.remove('opacity-0', 'translate-y-8');
        banner.classList.add('opacity-100', 'translate-y-0');
    }

    function showOnlineBanner() {
        if (hideTimeout) clearTimeout(hideTimeout);
        banner.innerHTML = `
            <div class="pointer-events-auto bg-emerald-950/95 text-emerald-100 border border-emerald-500/60 shadow-2xl rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-3 backdrop-blur-xl">
                <div class="flex items-center gap-3">
                    <span class="w-3 h-3 rounded-full bg-emerald-400 shrink-0"></span>
                    <div>
                        <h5 class="font-bold text-xs sm:text-sm text-white">تم إعادة الاتصال بالإنترنت بنجاح! ✨</h5>
                        <p class="text-[11px] sm:text-xs text-emerald-200/90 mt-0.5">تم تحديث البيانات وقنوات الاتصال اللحظية.</p>
                    </div>
                </div>
            </div>
        `;
        banner.classList.remove('opacity-0', 'translate-y-8');
        banner.classList.add('opacity-100', 'translate-y-0');

        hideTimeout = setTimeout(() => {
            banner.classList.remove('opacity-100', 'translate-y-0');
            banner.classList.add('opacity-0', 'translate-y-8');
        }, 3500);
    }

    // فحص الحالة المبدئية عند التحميل
    if (!navigator.onLine) {
        showOfflineBanner();
    }

    // استجابة للأحداث الفورية
    window.addEventListener('offline', () => {
        showOfflineBanner();
    });

    window.addEventListener('online', () => {
        showOnlineBanner();
    });
}
