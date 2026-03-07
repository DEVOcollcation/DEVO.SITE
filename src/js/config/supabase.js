import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// DEVO Factory Supabase Credentials
const SUPABASE_URL = 'https://abxbhtysmqzrswzsdrzi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_so6KzXru538HEc5dFORaIA_4dB_SWzo';

// Initialize and export the Supabase client for global use across services
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);