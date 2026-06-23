import { createClient } from "@supabase/supabase-js";

// These are PUBLIC keys (safe in the browser). The anon key only allows what
// your Row Level Security policies permit — see README for the SQL setup.
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anon, {
  auth: {
    // Keep users signed in across visits until they explicitly sign out.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "predictorpro-auth",
  },
});
