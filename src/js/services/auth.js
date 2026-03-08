import { supabase } from '../config/supabase.js';

/**
 * تسجيل الدخول باستخدام اسم المستخدم وكلمة المرور من جدول system_users
 */
export async function loginUser(username, password) {
    try {
        // البحث عن المستخدم
        const { data: user, error } = await supabase
            .from('system_users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();

        if (error || !user) {
            throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
        }

        if (!user.is_active) {
            throw new Error('هذا الحساب معطل، يرجى مراجعة الإدارة.');
        }

        // زيادة عداد تسجيل الدخول بمقدار 1
        await supabase
            .from('system_users')
            .update({ login_count: (user.login_count || 0) + 1 })
            .eq('id', user.id);

        // حفظ بيانات الجلسة الأساسية في LocalStorage
        const sessionData = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role
        };
        localStorage.setItem('devo_session', JSON.stringify(sessionData));

        return { user: sessionData, error: null };
    } catch (error) {
        console.error('Login error:', error.message);
        return { user: null, error };
    }
}

/**
 * تسجيل الخروج ومسح الجلسة
 */
export function logoutUser() {
    localStorage.removeItem('devo_session');
    window.location.href = 'auth.html';
}

/**
 * جلب بيانات المستخدم الحالي من المتصفح
 */
export function getCurrentSession() {
    const sessionStr = localStorage.getItem('devo_session');
    if (!sessionStr) return { session: null };
    
    try {
        const session = JSON.parse(sessionStr);
        // نعيدها بنفس الهيكل القديم حتى لا تتعطل باقي ملفاتك
        return { session: { user: session } }; 
    } catch (e) {
        return { session: null };
    }
}

/**
 * حماية الصفحات وتأكيد الصلاحية (بديل لـ getUserProfile)
 */
export function requireAuth(allowedRoles = []) {
    const { session } = getCurrentSession();
    
    if (!session) {
        window.location.href = 'auth.html';
        return null;
    }

    const user = session.user;

    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        if (user.role === 'worker') window.location.href = 'index.html';
        else window.location.href = 'admin.html';
        return null;
    }

    return user;
}