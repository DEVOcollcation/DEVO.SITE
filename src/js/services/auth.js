import { supabase } from '../config/supabase.js';

/**
 * تسجيل الدخول باستخدام اسم المستخدم وكلمة المرور عبر Supabase Auth
 * يتم تحويل اسم المستخدم داخلياً إلى بريد إلكتروني وهمي
 */
export async function loginUser(username, password) {
    try {
        const email = username.trim().toLowerCase() + '@staff.devo.internal';

        // تسجيل الدخول باستخدام Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (authError) {
            throw new Error(authError.message === 'Invalid login credentials' 
                ? 'اسم المستخدم أو كلمة المرور غير صحيحة' 
                : authError.message);
        }

        const authUser = authData.user;

        // جلب بيانات الموظف والصلاحيات من جدول system_users
        const { data: user, error: profileError } = await supabase
            .from('system_users')
            .select('*')
            .eq('id', authUser.id)
            .single();

        if (profileError || !user) {
            await supabase.auth.signOut();
            throw new Error('فشل جلب بيانات صلاحيات المستخدم من النظام.');
        }

        if (!user.is_active) {
            await supabase.auth.signOut();
            throw new Error('هذا الحساب معطل، يرجى مراجعة الإدارة.');
        }

        // زيادة عداد تسجيل الدخول بمقدار 1
        await supabase
            .from('system_users')
            .update({ login_count: (user.login_count || 0) + 1 })
            .eq('id', user.id);

        // حفظ بيانات الجلسة الأساسية في LocalStorage للحفاظ على التوافق مع باقي الكود
        const sessionData = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            worker_job: user.worker_job
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
export async function logoutUser() {
    try {
        localStorage.removeItem('devo_session');
        await supabase.auth.signOut();
    } catch (e) {
        console.error('Signout error:', e);
    } finally {
        window.location.href = 'auth.html';
    }
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