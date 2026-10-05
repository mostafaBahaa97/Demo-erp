"use client";
import React, { useMemo, useState } from "react";
import { AlertTriangle, FileText, Printer, Search, Trash2 } from "lucide-react";
import { useSheet } from "@/hooks/useSheet";
import {
  CustomerInvoice, CustomerTransaction,
  SupplierInvoice, SupplierTransaction,
  cascadeDelete, CascadeDeleteTarget,
  fmtCurrency, fmtDate,
} from "@/lib/api";
import { Badge, EmptyState, ErrorState, LoadingState, Modal, SectionHeader, TabBar } from "@/components/ui";
import { InvoicePrintModal, PrintInvoiceData } from "@/components/InvoicePrint";

const statusMeta: Record<CustomerInvoice["Payment_Status"], { label: string; variant: "green" | "yellow" | "red" }> = {
  paid:    { label: "مدفوعة بالكامل", variant: "green" },
  partial: { label: "دفعة جزئية",     variant: "yellow" },
  unpaid:  { label: "غير مدفوعة",     variant: "red" },
};

// شكل موحّد لأي فاتورة (بيع أو شراء) عشان نعرضهم في نفس القائمة
interface UnifiedInvoice {
  id: string | number;
  invoiceId: string;
  type: "sale" | "purchase";
  partyName: string;
  date: string;
  total: number;
  paidAmount: number;
  remaining: number;
  status: CustomerInvoice["Payment_Status"];
}

function ConfirmDeleteInvoice({ invoice, onConfirm, onCancel, loading }: {
  invoice: UnifiedInvoice; onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  return (
    <Modal title="تأكيد حذف الفاتورة" onClose={onCancel} footer={
      <>
        <button onClick={onCancel} disabled={loading}
          className="erp-btn border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
          إلغاء
        </button>
        <button onClick={onConfirm} disabled={loading}
          className="erp-btn bg-red-500 hover:bg-red-600 text-white disabled:opacity-50">
          {loading ? "جارٍ الحذف..." : "🗑️ تأكيد حذف الفاتورة"}
        </button>
      </>
    } maxWidth="max-w-[440px]">
      <div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
        <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          هل أنت متأكد من حذف فاتورة <strong>{invoice.invoiceId}</strong> الخاصة بـ «{invoice.partyName}»؟
          <br />
        </p>
      </div>
    </Modal>
  );
}

export default function InvoicesModule({ showToast }: { showToast: (m: string, t: "success" | "error") => void }) {
  const { data: cInvoices, isLoading: lCI, isError: eCI, refetch: rCI } = useSheet<CustomerInvoice>("Customer_Invoices");
  const { data: cTxns,     isLoading: lCT, isError: eCT, refetch: rCT } = useSheet<CustomerTransaction>("Customer_Transactions");
  const { data: sInvoices, isLoading: lSI, isError: eSI, refetch: rSI } = useSheet<SupplierInvoice>("Supplier_Invoices");
  const { data: sTxns,     isLoading: lST, isError: eST, refetch: rST } = useSheet<SupplierTransaction>("Supplier_Transactions");

  const [query, setQuery]     = useState("");
  const [type,  setType]      = useState<"all" | "sale" | "purchase">("all");
  const [printData, setPrintData] = useState<PrintInvoiceData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedInvoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isLoading = lCI || lCT || lSI || lST;
  const isError   = eCI || eCT || eSI || eST;

  const unified: UnifiedInvoice[] = useMemo(() => {
    const sales = cInvoices.map(iv => ({
      id: `s-${iv.ID}`, invoiceId: iv.Invoice_ID, type: "sale" as const,
      partyName: iv.Customer_Name, date: iv.Date, total: Number(iv.Total),
      paidAmount: Number(iv.Paid_Amount), remaining: Number(iv.Remaining), status: iv.Payment_Status,
    }));
    const purchases = sInvoices.map(iv => ({
      id: `p-${iv.ID}`, invoiceId: iv.Invoice_ID, type: "purchase" as const,
      partyName: iv.Supplier_Name, date: iv.Date, total: Number(iv.Total),
      paidAmount: Number(iv.Paid_Amount), remaining: Number(iv.Remaining), status: iv.Payment_Status,
    }));
    return [...sales, ...purchases].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [cInvoices, sInvoices]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return unified.filter(iv => {
      if (type !== "all" && iv.type !== type) return false;
      if (q && !iv.partyName?.includes(q) && !String(iv.invoiceId).includes(q)) return false;
      return true;
    });
  }, [unified, query, type]);

  const openPrint = (iv: UnifiedInvoice) => {
    const source = iv.type === "sale" ? cTxns : sTxns;
    const lines = source
      .filter(t => t.Invoice_ID === iv.invoiceId)
      .map(t => ({ productName: t.Product_Name, qty: Number(t.Quantity), unitPrice: Number(t.Unit_Price), total: Number(t.Total_Price) }));
    setPrintData({
      invoiceId: iv.invoiceId,
      customerName: iv.partyName,
      date: iv.date,
      lines,
      total: iv.total,
      paidAmount: iv.paidAmount,
      remaining: iv.remaining,
      status: iv.status,
    });
  };

  // حذف الفاتورة بكل أجزائها: سطور الأصناف + الهيدر + أي دفعة اتسجلت وقت
  // إنشائها — كل ده بيتنفذ كعملية واحدة في السيرفر عشان محدش يشوف فاتورة
  // "ناقصة". المخزون بيترجع صح لوحده لأنه بيتحسب من سطور الأصناف نفسها.
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const isSale = deleteTarget.type === "sale";
      const targets: CascadeDeleteTarget[] = [
        { sheet: isSale ? "Customer_Transactions" : "Supplier_Transactions", field: "Invoice_ID", value: deleteTarget.invoiceId },
        { sheet: isSale ? "Customer_Invoices"      : "Supplier_Invoices",    field: "Invoice_ID", value: deleteTarget.invoiceId },
        { sheet: isSale ? "Customer_Payments"      : "Supplier_Payments",    field: "Invoice_ID", value: deleteTarget.invoiceId },
      ];
      const result = await cascadeDelete(targets, `حذف فاتورة ${deleteTarget.invoiceId}`);
      showToast(
        result.queued
          ? "النت ضعيف — الحذف هيتم تلقائيًا أول ما النت يرجع 🔄"
          : "تم حذف الفاتورة وكل أصنافها بنجاح ✓",
        "success"
      );
      setDeleteTarget(null);
      setTimeout(() => { rCI(); rSI(); rCT(); rST(); }, 1200);
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "فشل في حذف الفاتورة، أعد المحاولة", "error");
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) return <LoadingState />;
  if (isError)   return <ErrorState onRetry={() => { rCI(); rSI(); }} />;

  return (
    <div className="animate-fade-in space-y-4">
      <SectionHeader title="الفواتير" count={unified.length} />

      <TabBar
        tabs={[
          { id: "all",      label: "الكل" },
          { id: "sale",     label: "فواتير بيع" },
          { id: "purchase", label: "فواتير شراء" },
        ]}
        active={type}
        onChange={v => setType(v as typeof type)}
      />

      <div className="relative">
        <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="erp-input pr-9"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو رقم الفاتورة..."
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState label="لا توجد فواتير مطابقة" />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((iv, idx) => {
            const meta = statusMeta[iv.status] ?? statusMeta.unpaid;
            const isSale = iv.type === "sale";
            return (
              <div key={iv.id} className="erp-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap animate-slide-up" style={{ animationDelay: `${idx * 0.03}s` }}>
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isSale ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                    <FileText size={15} className={isSale ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-700 text-slate-800 dark:text-slate-100 text-sm truncate">{iv.partyName}</p>
                    <p className="text-xs text-slate-400">{fmtDate(iv.date)} · فاتورة {iv.invoiceId}</p>
                  </div>
                  <Badge variant={isSale ? "green" : "red"}>{isSale ? "بيع" : "شراء"}</Badge>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-800 num text-sm ${isSale ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{fmtCurrency(iv.total)} ج</span>
                  <button onClick={() => openPrint(iv)} title="طباعة"
                    className={`erp-btn px-2.5 py-1.5 border ${isSale ? "border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" : "border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"}`}>
                    <Printer size={13} /> طباعة
                  </button>
                  <button onClick={() => setDeleteTarget(iv)} title="حذف الفاتورة"
                    className="erp-btn px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-900/20 dark:hover:text-red-400 dark:hover:border-red-800">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {printData && <InvoicePrintModal data={printData} onClose={() => setPrintData(null)} />}
      {deleteTarget && (
        <ConfirmDeleteInvoice
          invoice={deleteTarget}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}