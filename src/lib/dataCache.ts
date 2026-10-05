"use client";

// ═════════════════════════════════════════════════════════════════════════
//  كاش دائم للبيانات (Offline Data Cache)
//  ────────────────────────────────────────────────────────────────────
//  الهدف: البرنامج يفتح ويعرض آخر بيانات معروفة فورًا (حتى من غير نت خالص)،
//  بدل ما يوقف على شاشة تحميل أو خطأ. البيانات محفوظة على جهاز المستخدم
//  نفسه (localStorage) فبتفضل موجودة حتى بعد قفل المتصفح/التطبيق وفتحه تاني.
//  وبيتسجل معاها "آخر وقت مزامنة ناجحة" عشان يبان للمستخدم بوضوح إمتى آخر
//  مرة اتأكدنا فيها إن البيانات دي فعلاً زي ما هي على السيرفر.
// ═════════════════════════════════════════════════════════════════════════

const PREFIX = "erp_cache_v1:";
const LAST_SYNC_KEY = "erp_last_sync_at_v1";

export interface CacheEntry<T> { data: T[]; ts: number; }

export function readCache<T>(sheetName: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + sheetName);
    return raw ? (JSON.parse(raw) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(sheetName: string, data: T[]): number {
  const ts = Date.now();
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(PREFIX + sheetName, JSON.stringify({ data, ts })); }
    catch { /* لو التخزين امتلأ أو اتمنع، مش قضية كبيرة — الكاش في الذاكرة لسه شغال طول الجلسة */ }
  }
  setLastSyncAt(ts);
  return ts;
}

// ── آخر وقت مزامنة ناجحة عالميًا (مش لكل شيت لوحده) ───────────────────────
// بنحدّثها كل ما أي شيت ينجح يجيب بيانات جديدة، عشان تبقى مؤشر واحد بسيط
// وواضح للمستخدم: "آخر تحديث كان إمتى" بدل ما يشوف رقم مختلف لكل جدول.
type SyncListener = (ts: number | null) => void;
const syncListeners = new Set<SyncListener>();

export function getLastSyncAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function setLastSyncAt(ts: number) {
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(LAST_SYNC_KEY, String(ts)); } catch { /* تجاهل */ }
  }
  syncListeners.forEach(fn => fn(ts));
}

export function subscribeLastSync(fn: SyncListener): () => void {
  syncListeners.add(fn);
  fn(getLastSyncAt());
  return () => { syncListeners.delete(fn); };
}
