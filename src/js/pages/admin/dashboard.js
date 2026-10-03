import { getCurrentSession } from '../../services/auth.js';

let clockInterval = null;
let dhikrInterval = null;
let chosenGreeting = null;

const GREETINGS = {
    morning: [
        'صباح الخير', 'صباح الخير ☀️', 'صباح النور', 'صباح الورد', 'صباح الفل',
        'طاب صباحك', 'طاب يومك', 'طاب يومك ☀️', 'صباحك سعيد', 'أسعد الله صباحك',
        'يومك سعيد', 'صباح الخير والسرور'
    ],
    noon: [
        'طاب يومك', 'طاب يومك 🌤️', 'نهارك سعيد', 'طاب نهارك', 'يومك سعيد',
        'أسعد الله نهارك', 'طاب وقتك', 'يوم سعيد', 'أهلاً بك، طاب يومك',
        'نهارك جميل', 'ظهيرة سعيدة', 'يوم موفق'
    ],
    evening: [
        'مساء الخير', 'مساء الخير 🌇', 'مساء النور', 'مساء الورد', 'مساء الفل',
        'طاب مساؤك', 'طاب يومك', 'مساؤك سعيد', 'أسعد الله مساءك',
        'مساء الياسمين', 'أمسية سعيدة', 'طاب مساؤك 🌇'
    ],
    night: [
        'مساء الخير', 'مساء الخير 🌙', 'مساء النور', 'مساء الورد', 'طاب مساؤك',
        'طاب يومك', 'ليلة سعيدة', 'أسعد الله مساءك', 'مساؤك سعيد',
        'تصبح على خير', 'طابت ليلتك', 'طاب مساؤك 🌙'
    ]
};

const ADHKAR = [
    'سبحان الله وبحمده، سبحان الله العظيم',
    'لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير',
    'لا حول ولا قوة إلا بالله',
    'أستغفر الله العظيم وأتوب إليه',
    'اللهم صلِّ وسلِّم على نبينا محمد',
    'الحمد لله حمدًا كثيرًا طيبًا مباركًا فيه',
    'حسبي الله لا إله إلا هو عليه توكلت وهو رب العرش العظيم',
    'سبحان الله، والحمد لله، ولا إله إلا الله، والله أكبر',
    'رب اغفر لي وتب علي إنك أنت التواب الرحيم',
    'اللهم إني أسألك علمًا نافعًا ورزقًا طيبًا وعملًا متقبلًا',
    'يا حي يا قيوم برحمتك أستغيث',
    'اللهم أعني على ذكرك وشكرك وحسن عبادتك',
    'سبحان الله',
    'الحمد لله',
    'الله أكبر',
    'لا إله إلا الله',
    'سبحان الله وبحمده عدد خلقه ورضا نفسه وزنة عرشه ومداد كلماته',
    'اللهم إنك عفوٌّ تحب العفو فاعفُ عني',
    'ربنا آتنا في الدنيا حسنة وفي الآخرة حسنة وقنا عذاب النار',
    'اللهم اجعل لي في كل خير نصيبًا',
    'توكلت على الله ولا حول ولا قوة إلا بالله',
    'اللهم بارك لنا فيما رزقتنا وقنا عذاب النار',
    'رضيت بالله ربًّا وبالإسلام دينًا وبمحمد ﷺ نبيًّا',
    'اللهم يسِّر لي أمري واشرح لي صدري',
    'يا رب لك الحمد كما ينبغي لجلال وجهك وعظيم سلطانك',
    'اللهم ثبِّت قلبي على دينك',
    'اللهم اكفني بحلالك عن حرامك وأغنني بفضلك عمن سواك',
    'لا إله إلا أنت سبحانك إني كنت من الظالمين'
];

const DHIKR_INTERVAL_MS = 15000;

export async function initDashboard() {
    startLiveClock();
    updateWelcomeGreeting();
    startAdhkar();
}

function startAdhkar() {
    const el = document.getElementById('dash-dhikr-text');
    if (!el) return;
    if (dhikrInterval) clearInterval(dhikrInterval);
    let idx = Math.floor(Math.random() * ADHKAR.length);
    el.textContent = ADHKAR[idx];
    dhikrInterval = setInterval(() => {
        idx = (idx + 1) % ADHKAR.length;
        el.style.opacity = '0';
        el.style.transform = 'translateY(6px)';
        setTimeout(() => {
            el.textContent = ADHKAR[idx];
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, 500);
    }, DHIKR_INTERVAL_MS);
}

export function fetchDashboardData() {
    updateWelcomeGreeting();
}

function updateWelcomeGreeting() {
    const { session } = getCurrentSession();
    const userName = session?.user?.full_name || session?.user?.email || 'المسؤول';
    
    const greetingEl = document.getElementById('dash-welcome-user');
    if (greetingEl) {
        greetingEl.textContent = userName;
    }

    const timeGreetingEl = document.getElementById('dash-time-greeting');
    if (timeGreetingEl) {
        if (!chosenGreeting) {
            const hour = new Date().getHours();
            let list;
            if (hour >= 4 && hour < 12) list = GREETINGS.morning;
            else if (hour >= 12 && hour < 17) list = GREETINGS.noon;
            else if (hour >= 17 && hour < 21) list = GREETINGS.evening;
            else list = GREETINGS.night;
            chosenGreeting = list[Math.floor(Math.random() * list.length)];
        }
        timeGreetingEl.textContent = chosenGreeting;
    }
}

function startLiveClock() {
    if (clockInterval) {
        clearInterval(clockInterval);
    }

    updateClock();
    clockInterval = setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();

    // 1. حساب الوقت بالساعات والدقائق والثواني
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'م' : 'ص';

    hours = hours % 12;
    hours = hours ? hours : 12; // الساعة 0 تصبح 12
    const formattedHours = String(hours).padStart(2, '0');

    // 2. تحديث عناصر الساعة بالـ DOM
    const hoursEl = document.getElementById('dash-clock-hours');
    const minutesEl = document.getElementById('dash-clock-minutes');
    const secondsEl = document.getElementById('dash-clock-seconds');
    const ampmEl = document.getElementById('dash-clock-ampm');

    if (hoursEl) hoursEl.textContent = formattedHours;
    if (minutesEl) minutesEl.textContent = minutes;
    if (secondsEl) secondsEl.textContent = seconds;
    if (ampmEl) ampmEl.textContent = ampm;

    // 3. التاريخ الميلادي بالعربية الكاملة
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const months = [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];

    const dayName = days[now.getDay()];
    const dayNum = now.getDate();
    const monthName = months[now.getMonth()];
    const year = now.getFullYear();

    const fullDateStr = `${dayName}، ${dayNum} ${monthName} ${year}`;
    const dateEl = document.getElementById('dash-full-date');
    if (dateEl) dateEl.textContent = fullDateStr;

    // 4. التاريخ الهجري التقريبي
    try {
        const hijriFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        const hijriStr = hijriFormatter.format(now);
        const hijriEl = document.getElementById('dash-hijri-date');
        if (hijriEl) hijriEl.textContent = hijriStr;
    } catch (e) {
        // Fallback إذا لم يكن التقويم الهجري مدعوماً
    }
}