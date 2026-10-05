"use client";
import React from "react";
import { Printer } from "lucide-react";
import { fmtCurrency, fmtDate } from "@/lib/api";
import { Modal } from "@/components/ui";

export const COMPANY_NAME = "Prime Med";
// يمكنك تغيير المسار حسب مكان شعار الشركة الرئيسي عندك
export const COMPANY_LOGO_URL = "/logo-prime-med.png"; 

export interface PrintInvoiceLine {
  productName: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface PrintInvoiceData {
  invoiceId: string;
  customerName: string; // المورد أو العميل حسب السجل
  date: string;
  lines: PrintInvoiceLine[];
  total: number;
  paidAmount: number;
  remaining: number;
  status: "paid" | "partial" | "unpaid";
}

// ─── نسخة واحدة من الفاتورة (ممصمة بشكل رأسي مرتّب) ───
function InvoiceCopy({ data }: { data: PrintInvoiceData }) {
  return (
    <div className="invoice-copy p-4 flex flex-col justify-between">
      <div>
        {/* الهيدر: اللوجو واسم الشركة وبيانات الفاتورة */}
        <div className="invoice-avoid-break flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-3">
          <div className="flex items-center gap-3">
            <img 
              src={COMPANY_LOGO_URL} 
              alt={COMPANY_NAME} 
              className="h-10 w-auto object-contain fallback-logo"
              onError={(e) => {
                // إظهار بديل متناسق في حال عدم إيجاد صورة اللوجو
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                {COMPANY_NAME}
              </h1>
              <span className="text-[10px] text-slate-500 block">فاتورة مبيعات</span>
            </div>
          </div>

          <div className="text-left text-xs space-y-0.5">
            <div>فاتورة رقم: <span className="font-semibold num">#{data.invoiceId}</span></div>
            <div>التاريخ: <span className="num">{fmtDate(data.date)}</span></div>
          </div>
        </div>

        {/* بيانات العميل / المورد */}
        <div className="invoice-avoid-break text-xs bg-slate-50 dark:bg-slate-800/50 p-2 rounded mb-3 flex justify-between items-center">
          <span>العميل / المورد: <strong>{data.customerName}</strong></span>
          <span className="text-[10px]">حالة الدفع: {data.status === "paid" ? "مدفوع" : data.status === "partial" ? "جزئي" : "غير مدفوع"}</span>
        </div>

        {/* جدول الأصناف — كل الأصناف اللي في الفاتورة بأسمائها وكمياتها وأسعارها */}
        <table className="invoice-items-table w-full text-xs text-right border-collapse mb-3">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500">
              <th className="py-1">الصنف</th>
              <th className="py-1 text-center">الكمية</th>
              <th className="py-1 text-left">السعر</th>
              <th className="py-1 text-left">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.lines.map((l, i) => (
              <tr key={i} className="invoice-avoid-break">
                <td className="py-1.5 font-medium">{l.productName}</td>
                <td className="py-1.5 text-center num">{l.qty}</td>
                <td className="py-1.5 text-left num">{fmtCurrency(l.unitPrice)}</td>
                <td className="py-1.5 text-left num font-semibold">{fmtCurrency(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* المجاميع */}
      <div className="invoice-avoid-break border-t border-slate-200 dark:border-slate-700 pt-2 text-xs space-y-1">
        <div className="flex justify-between font-bold text-sm text-slate-900 dark:text-white">
          <span>الإجمالي الكلي:</span>
          <span className="num">{fmtCurrency(data.total)} ج.م</span>
        </div>
        {data.status !== "unpaid" && (
          <>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>تم الدفع:</span>
              <span className="num">{fmtCurrency(data.paidAmount)} ج.م</span>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>الباقي:</span>
              <span className="num">{fmtCurrency(data.remaining)} ج.م</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// لو الأصناف كتير، نسختين على نفس ورقة الـ A5 مش هيكفوا مساحة —
// في الحالة دي كل نسخة تاخد ورقة A5 لوحدها (فاصل صفحة صريح) بدل ما نضغطهم
// في نفس الصفحة ويحصل قص أو تراكب في المحتوى.
const MANY_ITEMS_THRESHOLD = 6;

// ─── Modal: المعاينة والطباعة ───
export function InvoicePrintModal({ data, onClose }: { data: PrintInvoiceData; onClose: () => void }) {
  const manyItems = data.lines.length > MANY_ITEMS_THRESHOLD;

  return (
    <Modal
      title="🖨️ معاينة الفاتورة"
      onClose={onClose}
      maxWidth="max-w-[500px]"
      footer={
        <>
          <button 
            onClick={onClose} 
            className="erp-btn border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            إغلاق
          </button>
          <button 
            onClick={() => window.print()} 
            className="erp-btn bg-blue-500 hover:bg-blue-600 text-white"
          >
            <Printer size={15} /> طباعة (نسختين A5)
          </button>
        </>
      }
    >
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
        {manyItems
          ? "عدد الأصناف كبير، فكل نسخة هتطبع في ورقة A5 منفصلة (نسخة للعميل ونسخة ليك) عشان كل التفاصيل تظهر كاملة."
          : "هيتم طباعة نسختين من نفس الفاتورة على ورقة A5 — نسخة للعميل ونسخة ليك، وتقدر تقصهم من خط القص."}
      </p>

      <div className={`print-invoice-area border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900 flex flex-col gap-2 ${manyItems ? "invoice-multi-page" : ""}`}>
        <div className={manyItems ? "invoice-page-break" : ""}>
          <InvoiceCopy data={data} />
        </div>

        {!manyItems && (
          <div className="relative my-2 text-center border-t-2 border-dashed border-slate-300 dark:border-slate-600">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-900 px-2 text-[11px] text-slate-400 flex items-center gap-1">
              ✂ - - - - - - - - خط القص - - - - - - - -
            </span>
          </div>
        )}

        <div>
          <InvoiceCopy data={data} />
        </div>
      </div>
    </Modal>
  );
}
