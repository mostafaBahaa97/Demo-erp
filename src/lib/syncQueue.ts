"use client";

// ═════════════════════════════════════════════════════════════════════════
//  طابور المزامنة (Sync Queue)
//  ────────────────────────────────────────────────────────────────────
//  المشكلة اللي بيحلّها الملف ده: لو النت ضعيف ولحظة إرسال تعريف (منتج/عميل/
//  مورد) أو فاتورة، الطلب ممكن يتقطع قبل ما نعرف هل السيرفر استلمه ولا لأ.
//  بدل ما نضيع البيانات اللي المستخدم دخّلها أو نخليه يحاول تاني يدويًا
//  (وممكن يعمل تكرار)، بنحفظ الطلب على الجهاز نفسه (localStorage) ونحاول
//  نبعته تاني تلقائيًا أول ما النت يرجع، أو كل شوية وهو شغال.
//
//  الحماية من التكرار مش هنا — هي أصلًا في السيرفر (clientRequestId فريد لكل
//  عملية بيتبعت مع كل محاولة، والسيرفر بيتذكره لمدة ساعة)، فحتى لو نفس
//  الطلب اتبعت 5 مرات بسبب إعادة المحاولة، هيتنفذ مرة واحدة بس.
// ═════════════════════════════════════════════════════════════════════════

export interface QueuedWrite {
  clientRequestId: string;
  sheetName: string;
  body: Record<string, unknown>;
  label: string;       // وصف قصير يتعرض للمستخدم لو عايز يشوف إيه اللي لسه معلّق
  createdAt: number;
  attempts: number;
}

const STORAGE_KEY = "erp_pending_writes_v1";
const MAX_ATTEMPTS = 30;

type Listener = (items: QueuedWrite[]) => void;
const listeners = new Set<Listener>();

function readQueue(): QueuedWrite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedWrite[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(q)); } catch { /* تجاهل */ }
  listeners.forEach(fn => fn(q));
}

export function getPendingWrites(): QueuedWrite[] { return readQueue(); }
export function getPendingCount(): number { return readQueue().length; }

export function subscribePendingWrites(fn: Listener): () => void {
  listeners.add(fn);
  fn(readQueue());
  return () => { listeners.delete(fn); };
}

export function enqueueWrite(item: Omit<QueuedWrite, "createdAt" | "attempts">) {
  const q = readQueue();
  q.push({ ...item, createdAt: Date.now(), attempts: 0 });
  writeQueue(q);
}

// نوع الدالة الفعلية اللي بترسل الطلب — بنمررها من api.ts عشان نتفادى
// أي استيراد دائري (circular import) بين الملفين.
type RawSender = (sheetName: string, body: Record<string, unknown>) => Promise<unknown>;

let flushing = false;

export async function flushPendingWrites(sender: RawSender): Promise<void> {
  if (flushing) return;
  if (typeof window === "undefined") return;
  if (!window.navigator.onLine) return;
  flushing = true;
  try {
    const queue = readQueue();
    if (!queue.length) return;
    const remaining: QueuedWrite[] = [];
    for (const item of queue) {
      try {
        await sender(item.sheetName, item.body);
        // نجح: منسيبوش في القايمة
      } catch (err) {
        // لو السيرفر رفض الطلب لسبب حقيقي دائم (زي تكرار اسم منتج ظهر لحد
        // تاني في الوقت اللي كنا مقطوعين فيه)، إعادة المحاولة مش هتغيّر
        // حاجة — منشيله من الطابور بدل ما نفضل نحاول عليه للأبد.
        const isPermanentRejection = (err as { name?: string })?.name === "ServerRejection";
        if (!isPermanentRejection) {
          item.attempts += 1;
          if (item.attempts < MAX_ATTEMPTS) remaining.push(item);
        }
      }
    }
    writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

let initialized = false;
export function initSyncQueue(sender: RawSender) {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  window.addEventListener("online", () => { flushPendingWrites(sender); });
  setInterval(() => { flushPendingWrites(sender); }, 20_000);
  // محاولة أولى فور تشغيل التطبيق (في حال كان فيه طلبات معلّقة من جلسة سابقة)
  flushPendingWrites(sender);
}
