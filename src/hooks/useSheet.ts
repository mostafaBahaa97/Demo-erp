"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchSheet } from "@/lib/api";
import { readCache, writeCache } from "@/lib/dataCache";
import { subscribeRefreshAll } from "@/lib/refreshBus";

export type FetchState = "idle" | "loading" | "success" | "error";
export interface UseSheetResult<T> {
  data: T[];
  state: FetchState;
  isLoading: boolean;
  isError: boolean;
  /** آخر مرة اتجابت فيها البيانات دي فعليًا من السيرفر بنجاح (null لو لسه ما حصلش) */
  lastUpdated: number | null;
  /** true لو البيانات المعروضة أقدم من دقيقتين — يعني ممكن مش أحدث حاجة */
  isStale: boolean;
  refetch: () => void;
}

// كاش في الذاكرة (أسرع من قراءة localStorage في كل رندر)، متزامن مع النسخة
// الدائمة على القرص عشان الأول ما التطبيق يفتح — حتى offline تمامًا — يلاقي
// آخر بيانات معروفة على طول من غير ما يستنى أو يشوف شاشة فاضية.
const _mem: Map<string, { data: unknown[]; ts: number }> = new Map();

const SOFT_TTL   = 30_000;  // بعدها نحاول نجيب نسخة أحدث في الخلفية
const STALE_AFTER = 120_000; // بعدها نعتبر المعروض "ممكن يكون قديم" ونبلغ عنه

function getKnown<T>(sheetName: string): { data: T[]; ts: number } | null {
  const mem = _mem.get(sheetName);
  if (mem) return mem as { data: T[]; ts: number };
  const persisted = readCache<T>(sheetName);
  if (persisted) { _mem.set(sheetName, persisted); return persisted; }
  return null;
}

export function useSheet<T>(sheetName: string, enabled = true): UseSheetResult<T> {
  const initial = getKnown<T>(sheetName);
  const [data,        setData]        = useState<T[]>(initial?.data ?? []);
  const [state,       setState]       = useState<FetchState>(initial ? "success" : "idle");
  const [lastUpdated, setLastUpdated] = useState<number | null>(initial?.ts ?? null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetch_ = useCallback(async (bust = false) => {
    if (!sheetName) return;
    const known = getKnown<T>(sheetName);

    if (!bust && known && Date.now() - known.ts < SOFT_TTL) {
      if (mountedRef.current) { setData(known.data); setState("success"); setLastUpdated(known.ts); }
      return;
    }

    // لو عندنا بيانات قديمة، منوريش شاشة تحميل ولا نمسحها — نسيبها ظاهرة
    // ونحاول نجيبلها نسخة أحدث بهدوء في الخلفية (Stale-While-Revalidate).
    // بس لو دي أول مرة خالص (مفيش أي بيانات معروفة أصلًا)، وقتها لازم نوري
    // مؤشر تحميل عادي.
    if (mountedRef.current && !known) setState("loading");

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await Promise.race<T[]>([
          fetchSheet<T>(sheetName),
          new Promise<T[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12_000)),
        ]);
        const arr = Array.isArray(result) ? result : [];
        const ts = writeCache(sheetName, arr);
        _mem.set(sheetName, { data: arr, ts });
        if (mountedRef.current) { setData(arr); setState("success"); setLastUpdated(ts); }
        return;
      } catch {
        if (attempt < 2) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      }
    }

    // فشلت كل المحاولات (غالبًا مفيش نت). لو عندنا بيانات قديمة، تفضل هي
    // الظاهرة على الشاشة (المستخدم لسه شغال بيها)، ومؤشر "آخر تحديث" هو
    // اللي هيوضحله إنها ممكن مش أحدث حاجة — مش هنوقفه بشاشة خطأ من غير داعي.
    if (mountedRef.current) {
      const fallback = getKnown<T>(sheetName);
      if (fallback) { setData(fallback.data); setState("success"); setLastUpdated(fallback.ts); }
      else setState("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetName]);

  const refetch = useCallback(() => { fetch_(true); }, [fetch_]);

  useEffect(() => { if (enabled) fetch_(); }, [fetch_, enabled]);

  // أي مكان في التطبيق يضغط "مزامنة الآن" (أو النت يرجع بعد انقطاع) بيبعت
  // نداء يوصل هنا فيحدّث الجدول ده تلقائيًا لو هو ظاهر على الشاشة حاليًا.
  useEffect(() => {
    if (!enabled) return;
    return subscribeRefreshAll(() => fetch_(true));
  }, [enabled, fetch_]);

  const isStale = lastUpdated !== null && Date.now() - lastUpdated > STALE_AFTER;

  return {
    data,
    state,
    isLoading: (state === "loading" || state === "idle") && data.length === 0,
    isError:   state === "error" && data.length === 0,
    lastUpdated,
    isStale,
    refetch,
  };
}
