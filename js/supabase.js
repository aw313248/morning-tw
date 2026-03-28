// ── MORNING TW — Supabase Client ──
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://erkqeylsmixcapanodxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4m1gDaPjewS38iVG2nrVGQ__cWauz81';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── 讀取某店家的留言 ──
export async function fetchComments(shopId) {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { console.error('fetchComments:', error); return []; }
  return data;
}

// ── 新增留言 ──
export async function addComment({ shopId, nickname, content, rating }) {
  const { data, error } = await supabase
    .from('comments')
    .insert([{ shop_id: shopId, nickname, content, rating }])
    .select()
    .single();
  if (error) throw error;
  return data;
}
