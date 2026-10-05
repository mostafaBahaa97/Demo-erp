import { enqueueWrite, initSyncQueue, getPendingCount, subscribePendingWrites, getPendingWrites } from "./syncQueue";

// ─── API ───────────────────────────────────────────────────────────────────────
export const API_BASE =
  "https://script.google.com/macros/s/AKfycbyUh_2SLan2FXCuBeh4HOf3JN3s4rkhHWmF9v3VZ3bfMCyH1xzE-TAy9OK_hA0WPA_e/exec";

export { getPendingCount, subscribePendingWrites, getPendingWrites };

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface Supplier  { ID: number; Name: string; Phone?: string; Address?: string; }
export interface Customer  { ID: number; Name: string; Phone?: string; Address?: string; }

/**
 * Product: defined once in the Products sheet.
 * Quantity     = opening/initial stock when the product was first entered.
 * Purchase_Price = optional cost per unit at the time of definition.
 *                  (New purchases use Supplier_Transactions.Unit_Price)
 * No selling price — selling price is set per invoice.
 *
 * Google Sheets columns required:
 *   ID | Name | Quantity | Purchase_Price
 */
export interface Product {
  ID: number;
  Name: string;
  Quantity: number;        // initial/opening stock (can be 0 or empty)
  Purchase_Price: number;  // optional opening cost per unit
}

export interface InventoryAdjustment {
  ID: number;
  Product_ID: number;
  Product_Name: string;
  Quantity: number;
  Unit_Cost: number;
  Date: string;
  Note: string;
}

export interface SupplierTransaction {
  ID: number;
  Invoice_ID: string;
  Supplier_ID: number;
  Supplier_Name: string;
  Product_ID: number;
  Product_Name: string;
  Quantity: number;
  Unit_Price: number;
  Total_Price: number;
  Date: string;
  Note: string;  // optional expiry / other note — stored in the 'Note' column
}

export interface CustomerTransaction {
  ID: number;
  Invoice_ID: string;
  Customer_ID: number;
  Customer_Name: string;
  Product_ID: number;
  Product_Name: string;
  Quantity: number;
  Unit_Price: number;
  Total_Price: number;
  Date: string;
}

export interface SupplierPayment { ID: number; Supplier_ID: number; Supplier_Name: string; Amount: number; Date: string; }
export interface CustomerPayment { ID: number; Customer_ID: number; Customer_Name: string; Amount: number; Date: string; }

/**
 * مديونية قديمة على عميل — مبلغ معروف إنه على العميل من قبل بدون فاتورة
 * مسجّلة في السيستم. بتتضاف لرصيد العميل في كشف الحساب زي أي فاتورة تمامًا.
 *
 * Google Sheets columns required (new sheet — create it once):
 *   ID | Customer_ID | Customer_Name | Amount | Date | Note
 */
export interface CustomerDebt {
  ID: number;
  Customer_ID: number;
  Customer_Name: string;
  Amount: number;
  Date: string;
  Note: string;
}

/**
 * One record per sales (customer) invoice — the payment/print summary.
 * Line items themselves stay in Customer_Transactions (same Invoice_ID).
 * Payment_Status: "paid" | "partial" | "unpaid"
 *
 * Google Sheets columns required (new sheet — create it once):
 *   ID | Invoice_ID | Customer_ID | Customer_Name | Date | Total | Paid_Amount | Remaining | Payment_Status
 */
export interface CustomerInvoice {
  ID: number;
  Invoice_ID: string;
  Customer_ID: number;
  Customer_Name: string;
  Date: string;
  Total: number;
  Paid_Amount: number;
  Remaining: number;
  Payment_Status: "paid" | "partial" | "unpaid";
}

/**
 * One record per purchase (supplier) invoice — same idea as CustomerInvoice,
 * so it can be archived/reprinted from "الفواتير". No payment-split UI exists
 * yet at purchase time, so new rows are written as Paid_Amount:0 / Payment_Status:"unpaid"
 * (the print view then just shows the total, same as an unpaid sales invoice).
 *
 * Google Sheets columns required (new sheet — create it once):
 *   ID | Invoice_ID | Supplier_ID | Supplier_Name | Date | Total | Paid_Amount | Remaining | Payment_Status
 */
export interface SupplierInvoice {
  ID: number;
  Invoice_ID: string;
  Supplier_ID: number;
  Supplier_Name: string;
  Date: string;
  Total: number;
  Paid_Amount: number;
  Remaining: number;
  Payment_Status: "paid" | "partial" | "unpaid";
}

// شكل مشترك يكفي لعرض/طباعة أي فاتورة أرشيفية (بيع أو شراء) من غير ما نهتم بنوعها بالظبط
export type InvoiceRecord = { Invoice_ID: string; Paid_Amount: number; Remaining: number; Payment_Status: "paid" | "partial" | "unpaid"; };

// ─── Fetch ─────────────────────────────────────────────────────────────────────
export async function fetchSheet<T>(sheetName: string): Promise<T[]> {
  const res = await fetch(`${API_BASE}?sheetName=${encodeURIComponent(sheetName)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? (json as T[]) : [];
}

// ─── Write ─────────────────────────────────────────────────────────────────────
// ملاحظة مهمة: قديمًا كانت الطلبات بتتبعت بـ mode: "no-cors"، وده معناه إن
// التطبيق ما كانش يقدر يقرأ رد السيرفر خالص (opaque response) — فحتى لو
// السيرفر رفض الطلب أو حصل خطأ، الواجهة كانت دايمًا بتعتبره "نجح". ده كان
// سبب رئيسي في اختفاء أخطاء حقيقية (زي تصادم الـ ID) عن المستخدم.
// دلوقتي بنستخدم Content-Type: text/plain عشان نتفادى CORS preflight
// (اللي Google Apps Script مش بيدعمه أصلًا)، وده بيسيبنا نقرأ رد السيرفر
// الحقيقي (success/error/ID) بشكل طبيعي.

function genRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// خطأ منطقي رجعه السيرفر عن قصد (زي "فيه منتج بنفس الاسم")، مش مشكلة شبكة —
// معناه إعادة المحاولة مش هتحل حاجة، فلازم يوصل للمستخدم فورًا.
export class ServerRejection extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    this.name = "ServerRejection";
  }
}

interface WriteResult { success: boolean; ID?: number; IDs?: number[]; count?: number; code?: string; error?: string; message?: string; }

// الاتصال الفعلي بالسيرفر من غير أي طابور — بيترمي خطأ فيه isNetworkError=true
// لو المشكلة شبكة/تايم آوت/انشغال مؤقت (BUSY)، عشان الطابور يقدر يعيد المحاولة
// تلقائيًا، أو يترمي ServerRejection لو السيرفر رفض الطلب لسبب حقيقي.
export async function rawSend(sheetName: string, body: Record<string, unknown>): Promise<WriteResult> {
  let res: Response;
  try {
    res = await Promise.race<Response>([
      fetch(`${API_BASE}?sheetName=${encodeURIComponent(sheetName)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      }),
      new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15_000)),
    ]);
  } catch {
    const netErr = new Error("تعذّر الوصول للسيرفر (مشكلة شبكة)");
    (netErr as Error & { isNetworkError?: boolean }).isNetworkError = true;
    throw netErr;
  }

  let json: WriteResult | null = null;
  try { json = (await res.json()) as WriteResult; } catch { json = null; }

  if (!json) {
    const netErr = new Error("رد غير متوقع من السيرفر");
    (netErr as Error & { isNetworkError?: boolean }).isNetworkError = true;
    throw netErr;
  }

  if (json.success === false) {
    if (json.code === "BUSY") {
      // انشغال مؤقت بسبب عملية تانية بتتنفذ في نفس اللحظة — نتعامل معاه
      // زي مشكلة شبكة عادية: نأجله ونعيد المحاولة تلقائيًا بعد شوية.
      const busyErr = new Error(json.error || "الخادم مشغول، سيُعاد المحاولة تلقائيًا");
      (busyErr as Error & { isNetworkError?: boolean }).isNetworkError = true;
      throw busyErr;
    }
    // رفض حقيقي (زي تكرار الاسم) — لازم يوصل للمستخدم فورًا من غير طابور
    throw new ServerRejection(json.error || "فشلت العملية", json.code);
  }

  return json;
}

export interface WriteOutcome { queued: boolean; id?: number; ids?: number[]; count?: number; }

async function send(sheetName: string, body: Record<string, unknown>, label: string): Promise<WriteOutcome> {
  const clientRequestId = genRequestId();
  const fullBody = { ...body, clientRequestId };
  try {
    const result = await rawSend(sheetName, fullBody);
    return { queued: false, id: result.ID, ids: result.IDs, count: result.count };
  } catch (err) {
    if ((err as Error & { isNetworkError?: boolean })?.isNetworkError) {
      // مش عارفين هل السيرفر استلم الطلب فعلاً ولا لأ — نحفظه على الجهاز
      // ونحاول تاني تلقائيًا (نفس الـ clientRequestId يمنع أي تكرار حتى لو
      // السيرفر يكون كان استلمه فعلًا قبل ما ينقطع النت).
      enqueueWrite({ clientRequestId, sheetName, body: fullBody, label });
      return { queued: true };
    }
    throw err; // ServerRejection أو أي خطأ حقيقي تاني — يوصل للمتصل فورًا
  }
}

/** إضافة صف جديد. الـ ID اللي بيتبعت هنا مجرد اقتراح — السيرفر هو اللي بيحدد
 *  الرقم الفعلي النهائي (عشان يضمن عدم التصادم لو أكتر من جهاز بيكتب في نفس اللحظة). */
export async function postSheet(sheetName: string, data: Record<string, unknown>, label = "عنصر جديد"): Promise<WriteOutcome> {
  return send(sheetName, { action: "create", ...data }, label);
}

/**
 * Multi-row insert for multi-product invoices.
 * Apps Script: else if (action==="create_multi") { for(row of payload.rows) sheet.appendRow(...) }
 */
export async function postMultiSheet(sheetName: string, rows: Record<string, unknown>[], label = "فاتورة"): Promise<WriteOutcome> {
  return send(sheetName, { action: "create_multi", rows }, label);
}

export async function updateSheet(sheetName: string, data: Record<string, unknown>, label = "تعديل"): Promise<WriteOutcome> {
  return send(sheetName, { action: "update", ...data }, label);
}

export async function deleteSheet(sheetName: string, id: number | string, label = "حذف"): Promise<WriteOutcome> {
  return send(sheetName, { action: "delete", ID: id }, label);
}

export async function renumberSheet(sheetName: string, foreignKey: string, relatedSheets: string[]): Promise<WriteOutcome> {
  return send(sheetName, { action: "renumber", foreignKey, relatedSheets }, "إعادة ترقيم");
}

/** وصف صف/صفوف مطلوب مسحها: كل الصفوف اللي عمود "field" فيها = "value" داخل شيت "sheet". */
export interface CascadeDeleteTarget { sheet: string; field: string; value: string | number; }

/**
 * حذف فاتورة كاملة (بيع أو شراء) بكل أجزائها دفعة واحدة: الهيدر + كل سطور
 * الأصناف + أي دفعة كانت اتسجلت وقت إنشاء الفاتورة — كل ده بيتنفذ كعملية
 * واحدة جوه نفس القفل في السيرفر عشان محدش يشوف فاتورة "نص محذوفة".
 * المخزون بيتصحح لوحده تلقائيًا لأنه بيتحسب من سطور الأصناف نفسها.
 */
export async function cascadeDelete(targets: CascadeDeleteTarget[], label = "حذف فاتورة"): Promise<WriteOutcome> {
  const primarySheet = targets[0]?.sheet ?? "Customer_Invoices"; // مجرد اسم للرابط، مش مستخدم فعليًا في هذا الأكشن
  return send(primarySheet, { action: "cascade_delete", targets }, label);
}

/** يشغّل محاولات إعادة الإرسال التلقائية لأي عمليات معلّقة بسبب ضعف الشبكة.
 *  استدعِها مرة واحدة عند تشغيل التطبيق (مثلاً في المكوّن الجذري). */
export function initApiSync() {
  initSyncQueue(rawSend);
}

// ─── Stock helpers ─────────────────────────────────────────────────────────────
/**
 * Current stock for a product:
 *   Product.Quantity (initial/opening)
 * + Inventory_Adjustments.Quantity (optional extra adjustments)
 * + Supplier_Transactions.Quantity  (purchases)
 * - Customer_Transactions.Quantity  (sales)
 */
export function calcProductStock(
  productId: string | number,
  products: Product[],
  adjustments: InventoryAdjustment[],
  supTxns: SupplierTransaction[],
  cusTxns: CustomerTransaction[],
): number {
  const pid     = String(productId);
  const product = products.find(p => String(p.ID) === pid);
  const initial = Number(product?.Quantity || 0);
  const fromAdj = adjustments.filter(a => String(a.Product_ID) === pid).reduce((s, a) => s + Number(a.Quantity || 0), 0);
  const bought  = supTxns.filter(t => String(t.Product_ID) === pid).reduce((s, t) => s + Number(t.Quantity || 0), 0);
  const sold    = cusTxns.filter(t => String(t.Product_ID) === pid).reduce((s, t) => s + Number(t.Quantity || 0), 0);
  return initial + fromAdj + bought - sold;
}

/**
 * Weighted average purchase cost:
 *   base = Product.Purchase_Price × Product.Quantity  (if both > 0)
 *   + Inventory_Adjustments مع كمية موجبة (إضافة) و Unit_Cost > 0
 *   + Supplier_Transactions Unit_Price
 *
 * ملحوظة: تعديلات المخزون بكمية سالبة (تصحيح غلط / إهلاك) بتقلل الكمية فقط
 * (في calcProductStock) ومش بتأثر على متوسط التكلفة — لأنها مش عملية شراء
 * جديدة بسعر جديد، هي مجرد إنقاص من نفس البضاعة الموجودة بمتوسط تكلفتها الحالي.
 */
export function calcAvgCost(
  productId: string | number,
  products: Product[],
  adjustments: InventoryAdjustment[],
  supTxns: SupplierTransaction[],
): number {
  const pid     = String(productId);
  const product = products.find(p => String(p.ID) === pid);
  const initQty  = Number(product?.Quantity || 0);
  const initCost = Number(product?.Purchase_Price || 0);

  const rows: { qty: number; cost: number }[] = [];
  if (initQty > 0 && initCost > 0) rows.push({ qty: initQty, cost: initCost });

  adjustments
    .filter(a => String(a.Product_ID) === pid && Number(a.Quantity) > 0 && Number(a.Unit_Cost) > 0)
    .forEach(a => rows.push({ qty: Number(a.Quantity), cost: Number(a.Unit_Cost) }));

  supTxns
    .filter(t => String(t.Product_ID) === pid && Number(t.Unit_Price) > 0)
    .forEach(t => rows.push({ qty: Number(t.Quantity), cost: Number(t.Unit_Price) }));

  const totalQty  = rows.reduce((s, r) => s + r.qty, 0);
  const totalCost = rows.reduce((s, r) => s + r.qty * r.cost, 0);
  return totalQty > 0 ? totalCost / totalQty : 0;
}

// ─── Phone validation ──────────────────────────────────────────────────────────
const EG_PHONE = /^01[0125]\d{8}$/;
export function validateEgPhone(phone: unknown): string | null {
  const s = phone == null ? "" : String(phone);
  if (!s.trim()) return null;
  if (!EG_PHONE.test(s.replace(/[\s\-()]/g, "")))
    return "رقم غير صحيح — الصيغة: 01XXXXXXXXX (11 رقم، يبدأ بـ 010 / 011 / 012 / 015)";
  return null;
}

// ─── Utils ─────────────────────────────────────────────────────────────────────
export function maxId(arr: { ID: number | string }[]): number {
  if (!arr.length) return 1;
  return Math.max(...arr.map(r => Number(r.ID ?? 0))) + 1;
}
export function todayStr(): string { return new Date().toISOString().split("T")[0]; }
export function fmtCurrency(n: number | string | undefined): string {
  return Number(n ?? 0).toLocaleString("ar-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function fmtDate(d: string | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
}