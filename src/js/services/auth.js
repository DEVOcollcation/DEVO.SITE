import { supabase } from '../config/supabase.js';

/**
 * Logs in a user (staff or admin) with email and password.
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<{user: object|null, error: object|null}>}
 */
export async function loginUser(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;
        if (data.user) {
            supabase.rpc('increment_login_count', { user_id: data.user.id });
        }
        return { user: data.user, error: null };
    } catch (error) {
        console.error('Login error:', error.message);
        return { user: null, error };
    }
}

/**
 * Logs out the current user and clears the session.
 * @returns {Promise<{error: object|null}>}
 */
export async function logoutUser() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        // Optional: Redirect to login page after successful logout
        window.location.href = '/index.html'; 
        
        return { error: null };
    } catch (error) {
        console.error('Logout error:', error.message);
        return { error };
    }
}

/**
 * Retrieves the currently logged-in user's session data.
 * @returns {Promise<{session: object|null, error: object|null}>}
 */
export async function getCurrentSession() {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        return { session, error: null };
    } catch (error) {
        console.error('Get session error:', error.message);
        return { session: null, error };
    }
}

/**
 * Fetches the custom profile data (role, full_name) for the logged-in user.
 * @param {string} userId 
 * @returns {Promise<{profile: object|null, error: object|null}>}
 */
export async function getUserProfile(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('full_name, role, is_active, email, login_count, invoice_count') // أضفنا الحقول الجديدة هنا
            .eq('id', userId)
            .single();

        if (error) throw error;
        return { profile: data, error: null };
    } catch (error) {
        console.error('Fetch profile error:', error.message);
        return { profile: null, error };
    }
}