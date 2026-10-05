// ═════════════════════════════════════════════════════════════════════════
//  ملحوظة مهمة (اقرأها لو هتعدل الكود ده):
//  الشيت (Google Sheet) هنا بيشتغل كقاعدة بيانات، ومن الطبيعي إن أكتر من جهاز
//  يبعتوا طلبات في نفس اللحظة (خصوصًا مع نت ضعيف بيعمل ريتراي). عشان كده
//  ضروري إن كل عملية كتابة (Create/Update/Delete) تتنفذ *واحدة ورا التانية*
//  مش في نفس اللحظة، وإن السيرفر هو اللي يحدد الـ ID الصح مش الجهاز — عشان
//  محدش يتصادم مع حد تاني.
// ═════════════════════════════════════════════════════════════════════════

function doGet(e) {
  var sheetName = e.parameter.sheetName;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return jsonOut({ error: "Sheet not found" });

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonOut([]);

  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    result.push(obj);
  }
  return jsonOut(result);
}

function doPost(e) {
  // ── 1) قفل عالمي على كل عمليات الكتابة ──────────────────────────────────
  // أي جهاز/تاب بيحاول يكتب في نفس اللحظة هيستنى دوره هنا تلقائيًا (لحد 25 ثانية)
  // بدل ما يحصل تصادم/تكرار في التعريفات. العملية بتاخد أجزاء من الثانية عادةً،
  // فاليوزر عمليًا مش هيحس بفرق غير في حالات الزحمة الشديدة جدًا.
  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(25000);
  if (!gotLock) {
    return jsonOut({
      success: false,
      code: "BUSY",
      error: "في عملية تانية بتتحفظ دلوقتي على نفس البيانات، حاول تاني بعد لحظات."
    });
  }

  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || "create";
    var itemData = payload.data || payload;
    var targetId = payload.id || itemData.ID;
    var clientRequestId = payload.clientRequestId || null;
    var cache = CacheService.getScriptCache();

    // ── حذف فاتورة كاملة دفعة واحدة (هيدر + كل الأصناف + أي دفعة مرتبطة) ──
    // ده بيتنفذ قبل أي حاجة تانية لأنه مش مرتبط بشيت واحد بس زي باقي
    // العمليات (targets فيها أكتر من شيت)، وبيتم كله جوه نفس الـ lock عشان
    // محدش يشوف الفاتورة "نص محذوفة" (الأصناف اتمسحت والهيدر لسه موجود مثلاً).
    if (action === "cascade_delete") {
      if (clientRequestId) {
        var cachedCascade = cache.get("req_" + clientRequestId);
        if (cachedCascade) return jsonOut(JSON.parse(cachedCascade));
      }
      var targets = payload.targets || [];
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var totalDeleted = 0;
      for (var t = 0; t < targets.length; t++) {
        var target = targets[t];
        var tSheet = ss.getSheetByName(target.sheet);
        if (!tSheet) continue; // شيت مش موجود (مثلاً عمود/شيت اختياري) — تجاهل بأمان
        totalDeleted += deleteByField(tSheet, target.field, target.value);
      }
      var cascadeResult = { success: true, message: "Cascade deleted", count: totalDeleted };
      cacheResult(cache, clientRequestId, cascadeResult);
      return jsonOut(cascadeResult);
    }

    var sheetName = e.parameter.sheetName;
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error("Sheet not found");

    // ── حماية من تكرار نفس الطلب (Idempotency) ─────────────────────────
    // لو الجهاز بعت نفس العملية قبل كده (مثلاً النت اتقطع بعد ما السيرفر
    // نفّذها فعلًا بس الرد ماوصلش، فاليوزر أو التطبيق حاول تاني تلقائيًا)،
    // بنرجّع نفس النتيجة القديمة من الكاش من غير ما نكرر التعريف تاني.
    if (clientRequestId && (action === "create" || action === "create_multi")) {
      var cachedRaw = cache.get("req_" + clientRequestId);
      if (cachedRaw) return jsonOut(JSON.parse(cachedRaw));
    }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    // 1. حالة الإضافة (Create)
    if (action === "create") {
      // مهم: الـ ID دايمًا بيتحدد من هنا (من السيرفر) مش من اللي الجهاز بعته،
      // عشان نضمن إنه رقم صحيح وموجود لأول مرة، حتى لو جهازين بعتوا في نفس اللحظة.
      var newId = nextIdFor(data);
      itemData.ID = newId;

      // حماية إضافية خاصة بشيت "Products": لو حد بعت نفس اسم المنتج مرتين
      // (غالبًا بسبب ضغط مزدوج وقت نت ضعيف) منرفضش نكرره.
      if (sheetName === "Products" && isDuplicateName(sheet, headers, itemData)) {
        var dupResult = {
          success: false,
          code: "DUPLICATE_NAME",
          error: "فيه منتج بنفس الاسم مسجل بالفعل — راجع قائمة المنتجات الأول."
        };
        cacheResult(cache, clientRequestId, dupResult);
        return jsonOut(dupResult);
      }

      var newRow = [];
      for (var i = 0; i < headers.length; i++) {
        newRow.push(itemData[headers[i]] !== undefined ? itemData[headers[i]] : "");
      }
      sheet.appendRow(newRow);
      var createResult = { success: true, message: "Created", ID: newId };
      cacheResult(cache, clientRequestId, createResult);
      return jsonOut(createResult);
    }

    // 2. إضافة عدة صفوف مرة واحدة (فاتورة متعددة الأصناف)
    else if (action === "create_multi") {
      var rows = payload.rows || [];
      var nextId = nextIdFor(data);
      var assignedIds = [];
      for (var r = 0; r < rows.length; r++) {
        var rowData = rows[r];
        rowData.ID = nextId++; // نفس فكرة الترقيم من السيرفر، صف بصف
        var newRow2 = [];
        for (var c = 0; c < headers.length; c++) {
          newRow2.push(rowData[headers[c]] !== undefined ? rowData[headers[c]] : "");
        }
        sheet.appendRow(newRow2);
        assignedIds.push(rowData.ID);
      }
      var multiResult = { success: true, message: "Created multi", IDs: assignedIds };
      cacheResult(cache, clientRequestId, multiResult);
      return jsonOut(multiResult);
    }

    // 3. حالة التعديل (Update)
    else if (action === "update") {
      for (var i2 = 1; i2 < data.length; i2++) {
        if (String(data[i2][0]) === String(targetId)) { // يبحث عن الـ ID في العمود الأول
          for (var j2 = 0; j2 < headers.length; j2++) {
            if (itemData[headers[j2]] !== undefined) {
              sheet.getRange(i2 + 1, j2 + 1).setValue(itemData[headers[j2]]);
            }
          }
          return jsonOut({ success: true, message: "Updated" });
        }
      }
      throw new Error("ID not found for update");
    }

    // 4. حالة الحذف (Delete)
    else if (action === "delete") {
      for (var i3 = 1; i3 < data.length; i3++) {
        if (String(data[i3][0]) === String(targetId)) {
          sheet.deleteRow(i3 + 1); // يمسح السطر بالكامل
          return jsonOut({ success: true, message: "Deleted" });
        }
      }
      throw new Error("ID not found for delete");
    }

    // 5. إعادة ترقيم الـ IDs بعد الحذف + تحديث المفاتيح المرتبطة في شيتات تانية
    //    (بيتنادى من الفرونت إند بعد كل عملية حذف مورد/عميل/منتج)
    else if (action === "renumber") {
      var foreignKey = payload.foreignKey;
      var relatedSheets = payload.relatedSheets || [];
      var ss = SpreadsheetApp.getActiveSpreadsheet();

      var curData = sheet.getDataRange().getValues();
      var idMap = {}; // oldId -> newId (sequential 1..n)

      for (var r2 = 1; r2 < curData.length; r2++) {
        var oldId = curData[r2][0];
        var newId2 = r2; // ترقيم تسلسلي بيبدأ من 1
        if (String(oldId) !== String(newId2)) {
          idMap[String(oldId)] = newId2;
          sheet.getRange(r2 + 1, 1).setValue(newId2);
        }
      }

      for (var s = 0; s < relatedSheets.length; s++) {
        var relSheet = ss.getSheetByName(relatedSheets[s]);
        if (!relSheet) continue;
        var relData = relSheet.getDataRange().getValues();
        var relHeaders = relData[0];
        var fkCol = relHeaders.indexOf(foreignKey);
        if (fkCol === -1) continue;
        for (var rr = 1; rr < relData.length; rr++) {
          var val = String(relData[rr][fkCol]);
          if (idMap.hasOwnProperty(val)) {
            relSheet.getRange(rr + 1, fkCol + 1).setValue(idMap[val]);
          }
        }
      }

      return jsonOut({ success: true, message: "Renumbered" });
    }

    throw new Error("Unknown action: " + action);

  } catch (error) {
    return jsonOut({ success: false, error: error.message });
  } finally {
    lock.releaseLock();
  }
}

// ── أدوات مساعدة ──────────────────────────────────────────────────────────

// أعلى ID موجود فعليًا في الشيت + 1. بيتحسب دايمًا من أحدث نسخة من البيانات
// (اللي اتقرت جوه الـ lock)، عشان يضمن رقم فريد حتى لو حصل زحمة طلبات.
function nextIdFor(data) {
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    var v = Number(data[i][0]);
    if (!isNaN(v) && v > max) max = v;
  }
  return max + 1;
}

// فحص وجود نفس الاسم قبل الإضافة (يتجاهل المسافات الزيادة وحالة الحروف)
function isDuplicateName(sheet, headers, itemData) {
  var nameCol = headers.indexOf("Name");
  if (nameCol === -1 || !itemData.Name) return false;
  var newName = String(itemData.Name).trim().toLowerCase();
  if (!newName) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var values = sheet.getRange(2, nameCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === newName) return true;
  }
  return false;
}

// بيمسح كل الصفوف اللي عمود "field" فيها بيساوي "value" من شيت معين.
// بيرجع عدد الصفوف اللي اتمسحت (0 لو الشيت فاضي أو العمود مش موجود أصلًا —
// وده آمن ومقصود، عشان مثلاً لو Customer_Payments لسه معندهاش عمود
// Invoice_ID، العملية تتجاهل بهدوء من غير أي خطأ).
function deleteByField(sheet, field, value) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0;
  var headers = data[0];
  var col = headers.indexOf(field);
  if (col === -1) return 0;

  var rowsToDelete = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(value)) rowsToDelete.push(i + 1); // رقم صف حقيقي في الشيت (1-based)
  }
  // لازم نمسح من الصف الأسفل للأعلى، عشان لو مسحنا صف فوق الأول هيزحلق
  // ترقيم باقي الصفوف وهنمسح الغلط.
  rowsToDelete.sort(function (a, b) { return b - a; });
  for (var j = 0; j < rowsToDelete.length; j++) {
    sheet.deleteRow(rowsToDelete[j]);
  }
  return rowsToDelete.length;
}

// بيسجل نتيجة العملية في كاش مؤقت (ساعة) عشان لو نفس الـ clientRequestId
// اتبعت تاني (ريتراي بعد انقطاع نت) نرجّع نفس النتيجة من غير تكرار.
function cacheResult(cache, clientRequestId, result) {
  if (!clientRequestId) return;
  try { cache.put("req_" + clientRequestId, JSON.stringify(result), 3600); }
  catch (e) { /* لو الكاش فشل مش قضية كبيرة — مجرد تحسين إضافي */ }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
