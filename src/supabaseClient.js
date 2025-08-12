// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

if (!url || !anon) {
  // Sichtbar in der Browser-Konsole – hilft sofort bei der Ursache
  console.error("Missing Supabase ENV", {
    hasUrl: !!url,
    hasAnonKey: !!anon,
    viteEnvSample: Object.keys(import.meta.env).filter(k => k.startsWith("VITE_"))
  });
  throw new Error("Supabase ENV not loaded. Define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in a .env at project root and restart Vite.");
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
