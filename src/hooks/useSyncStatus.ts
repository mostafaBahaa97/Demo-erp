"use client";
import { useEffect, useState } from "react";
import { subscribeLastSync } from "@/lib/dataCache";
import { subscribePendingWrites } from "@/lib/api";
import { triggerRefreshAll } from "@/lib/refreshBus";

export interface SyncStatus {
  online: boolean;
  lastSync: number | null;
  pendingCount: number;
  syncing: boolean;
  syncNow: () => void;
  timeAgo: string;
}

function formatTimeAgo(ts: number | null): string {
  if (!ts) return "لسه ما اتزامنش";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 10) return "الآن";
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `منذ ${min} دقيقة`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `منذ ${hr} ساعة`;
  const day = Math.floor(hr / 24);
  return `منذ ${day} يوم`;
}

/** حالة الاتصال + آخر مزامنة + عدد العمليات المعلّقة، بشكل حي (بيتحدث لوحده). */
export function useSyncStatus(): SyncStatus {
  const [online,   setOnline]   = useState(true);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [pending,  setPending]  = useState(0);
  const [syncing,  setSyncing]  = useState(false);
  const [, forceTick] = useState(0); // بس عشان نص "منذ كذا دقيقة" يتحدث لوحده كل شوية

  useEffect(() => {
    setOnline(window.navigator.onLine);
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => subscribeLastSync(setLastSync), []);
  useEffect(() => subscribePendingWrites(items => setPending(items.length)), []);
  useEffect(() => { const id = setInterval(() => forceTick(t => t + 1), 15_000); return () => clearInterval(id); }, []);

  const syncNow = () => {
    setSyncing(true);
    triggerRefreshAll();
    setTimeout(() => setSyncing(false), 1200);
  };

  return { online, lastSync, pendingCount: pending, syncing, syncNow, timeAgo: formatTimeAgo(lastSync) };
}
