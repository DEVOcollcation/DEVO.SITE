import { supabase } from '../config/supabase.js';

let userRealtimeChannel = null;

// تنظيف فوري وشامل لأي كاش قديم كان يعترض استعلامات Supabase
if (typeof window !== 'undefined' && 'caches' in window) {
    caches.keys().then(keys => {
        keys.forEach(key => {
            if (key.includes('devo-images-v1') || key.includes('devo-images-v2') || key.includes('devo-static-v8') || key.includes('devo-static-v9') || key.includes('devo-static-v10')) {
                console.log('[Cache Cleanup] Purging poisoned cache:', key);
                caches.delete(key);
            }
        });
    });
}

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

        // جلب بيانات الموظف والصلاحيات المحدثة من جدول system_users
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

        // حفظ بيانات الجلسة الأساسية في LocalStorage
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
export async function logoutUser(redirectUrl = 'auth.html') {
    try {
        if (userRealtimeChannel) {
            supabase.removeChannel(userRealtimeChannel);
            userRealtimeChannel = null;
        }
        localStorage.removeItem('devo_session');
        await supabase.auth.signOut();
    } catch (e) {
        console.error('Signout error:', e);
    } finally {
        window.location.href = redirectUrl;
    }
}

/**
 * جلب بيانات المستخدم الحالي من المتصفح (قراءة فورية وسريعة)
 */
export function getCurrentSession() {
    const sessionStr = localStorage.getItem('devo_session');
    if (!sessionStr) return { session: null };
    
    try {
        let session = JSON.parse(sessionStr);
        if (session && session.user) session = session.user;
        return { session: { user: session } }; 
    } catch (e) {
        return { session: null };
    }
}

/**
 * حماية الصفحات وتأكيد الصلاحية (فحص سريع ومتزامن)
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

/**
 * 🌟 التحقق الحي والمباشر من الصلاحيات وتحديث الجلسة من قاعدة البيانات مباشرة 🌟
 * يتم استدعاؤها في الخلفية عند فتح أي صفحة للتأكد من أن الرتبة لم تتغير ولم يتم تعطيل الحساب
 */
export async function validateAndSyncSession(allowedRoles = []) {
    const { session } = getCurrentSession();
    if (!session || !session.user) {
        if (allowedRoles.length > 0) window.location.href = 'auth.html';
        return null;
    }

    const cachedUser = session.user;

    try {
        const { data: dbUser, error } = await supabase
            .from('system_users')
            .select('id, username, full_name, role, worker_job, is_active')
            .eq('id', cachedUser.id)
            .single();

        if (error || !dbUser) {
            console.warn('[Auth] User record not found in system_users, signing out.');
            await logoutUser();
            return null;
        }

        // إذا تم تعطيل الحساب من قبل الإدارة
        if (!dbUser.is_active) {
            console.warn('[Auth] User account is deactivated by admin.');
            alert('تم تعطيل هذا الحساب من قبل إدارة النظام.');
            await logoutUser();
            return null;
        }

        // تحديث بيانات الجلسة إذا حدث أي تغيير في الدور أو الاسم أو الوظيفة
        const isChanged = cachedUser.role !== dbUser.role || 
                          cachedUser.worker_job !== dbUser.worker_job || 
                          cachedUser.full_name !== dbUser.full_name || 
                          cachedUser.username !== dbUser.username;

        const updatedSession = {
            id: dbUser.id,
            username: dbUser.username,
            full_name: dbUser.full_name,
            role: dbUser.role,
            worker_job: dbUser.worker_job
        };

        if (isChanged) {
            console.log('[Auth] Detected role/profile update from DB, syncing local session:', updatedSession);
            localStorage.setItem('devo_session', JSON.stringify(updatedSession));
        }

        // فحص الصلاحيات بعد التحديث الحي من الداتابيز
        if (allowedRoles.length > 0 && !allowedRoles.includes(dbUser.role)) {
            console.warn(`[Auth] Role ${dbUser.role} is not permitted for this page (${allowedRoles.join(',')}), redirecting...`);
            if (dbUser.role === 'worker') {
                window.location.href = 'index.html';
            } else {
                window.location.href = 'admin.html';
            }
            return null;
        }

        return updatedSession;
    } catch (e) {
        console.error('[Auth] Error syncing live session with DB:', e);
        return cachedUser;
    }
}

/**
 * 🌟 الرادار اللحظي للصلاحيات (Realtime Role & Status Radar) 🌟
 * يراقب أي تعديل يقوم به المالك/الأدمن على صلاحية أو حالة هذا المستخدم، ويطبقها فوراً
 */
export function setupUserRealtimeSync(onUpdateCallback = null) {
    const { session } = getCurrentSession();
    if (!session || !session.user) return;

    const currentUserId = session.user.id;

    if (userRealtimeChannel) {
        supabase.removeChannel(userRealtimeChannel);
    }

    userRealtimeChannel = supabase.channel(`user_live_role_${currentUserId}`)
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'system_users',
            filter: `id=eq.${currentUserId}`
        }, async (payload) => {
            const updated = payload.new;
            console.log('[Auth Realtime] Received live update for current user:', updated);

            // 1. إذا تم تعطيل الحساب
            if (!updated.is_active) {
                alert('تم تعطيل حسابك بواسطة إدارة النظام.');
                await logoutUser();
                return;
            }

            // 2. تحديث التخزين المحلي فوراً
            const newSessionData = {
                id: updated.id,
                username: updated.username,
                full_name: updated.full_name,
                role: updated.role,
                worker_job: updated.worker_job
            };
            localStorage.setItem('devo_session', JSON.stringify(newSessionData));

            // 3. إذا كان المستخدم في صفحة الأدمن وتم تحويله إلى عامل
            const isInsideAdminPage = window.location.pathname.includes('admin.html');
            if (isInsideAdminPage && updated.role === 'worker') {
                alert('تم تغيير صلاحيات حسابك إلى عامل من قبل إدارة النظام، جاري تحويلك للصفحة الرئيسية...');
                window.location.href = 'index.html';
                return;
            }

            // 4. استدعاء الـ Callback لتحديث الواجهة ديناميكياً
            if (typeof onUpdateCallback === 'function') {
                onUpdateCallback(newSessionData);
            }
        })
        .subscribe();
}