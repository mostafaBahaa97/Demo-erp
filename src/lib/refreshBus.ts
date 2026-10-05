"use client";

// ═════════════════════════════════════════════════════════════════════════
//  ناقل "حدّث دلوقتي" (Refresh Bus)
//  ────────────────────────────────────────────────────────────────────
//  كل useSheet() شغّال في أي شاشة مفتوحة بيسجل نفسه هنا. لما اليوزر يضغط
//  "مزامنة الآن"، أو النت يرجع بعد انقطاع، أو يعدي وقت معين من غير تحديث،
//  بنبعت نداء واحد يوصل لكل الشاشات المفتوحة فيحدّثوا بياناتهم كلهم مرة واحدة.
// ═════════════════════════════════════════════════════════════════════════

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeRefreshAll(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function triggerRefreshAll() {
  listeners.forEach(fn => fn());
}

let initialized = false;
/** يشغّل تحديث تلقائي للبيانات: أول ما النت يرجع بعد انقطاع، وكل دقيقة
 *  طول ما التطبيق شغال ومتصل، عشان الشاشة تفضل قريبة من الواقع من غير
 *  ما المستخدم يحتاج يعمل حاجة بنفسه. */
export function initReadSync() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  window.addEventListener("online", () => triggerRefreshAll());
  setInterval(() => { if (window.navigator.onLine) triggerRefreshAll(); }, 60_000);
}
