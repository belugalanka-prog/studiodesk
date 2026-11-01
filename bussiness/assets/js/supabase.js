import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT') || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith('YOUR_')) throw new Error('Set your Supabase URL and anon key in assets/js/config.js.');
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
