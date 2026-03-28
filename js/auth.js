// ── MORNING TW — Auth (Supabase Google OAuth) ──
import { supabase } from './supabase.js';

let currentUser = null;
const listeners = [];

export function onAuthChange(cb) {
  listeners.push(cb);
}

function notify(user) {
  currentUser = user;
  listeners.forEach(cb => cb(user));
}

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  notify(session?.user ?? null);
  supabase.auth.onAuthStateChange((_event, session) => {
    notify(session?.user ?? null);
  });
}

export async function loginWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function logout() {
  await supabase.auth.signOut();
}

export function getUser() { return currentUser; }
