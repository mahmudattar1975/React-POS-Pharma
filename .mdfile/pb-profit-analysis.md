# تحليل: حساب ربح/عمولة كاشير (Cashier Item List Profit)

**المصدر:** PowerBuilder — `phsalfunc.pbl` → `process_external_sales_invoice` (FUNCTION)
**ملف المصدر (exported):** `%TEMP%\opencode\process_external_sales_invoice.srf`
**السطر المطلوب:**
```powerbuilder
wcout = read_bonuc_disc_rate_sal(WFAPPL_TYPE, WFAPPL_SUB, 0, witem_no, 3, 1, 11, 0)  // PROFIT
```

---

## 1. السياق (Context)

السطر داخل حلقة معالجة **كل صنف (item) في فاتورة البيع (cashier item list)**. بعد حساب Menges/أسعار/خصومات/ضريبة للصنف، وقبل إدراج السطر في جدول `FTRNSALF_PH` (تفاصيل الفاتورة)، يتم حساب **ربح/عمولة** للصنف (إذا كان مفعّلاً).

### شرط التفعيل
```powerbuilder
IF wtrans_type = 3 AND dec(mid(wsystem_parameter,28,1)) = 1 THEN   // Calculate incentive 0=no/1=yes
```
- `wtrans_type = 3` → فاتورة بيع (Sales invoice) (وليس مرتجع/out).
- `mid(wsystem_parameter,28,1) = 1` → bit 28 من parameter النظام يفعّل حساب الربح/العمولة (incentive). إذا 0 → تخطي الحساب.

---

## 2. استدعاء `read_bonuc_disc_rate_sal`

```powerbuilder
wcout = read_bonuc_disc_rate_sal(WFAPPL_TYPE, WFAPPL_SUB, 0, witem_no, 3, 1, 11, 0)  // PROFIT
```

### المعاملات (Parameters)
| # | القيمة | المعنى (مستنتج) |
|---|--------|------------------|
| 1 | `WFAPPL_TYPE` | نوع التطبيق (pharmacy module) |
| 2 | `WFAPPL_SUB` | الفرع/الوحدة (sub) |
| 3 | `0` | مستوى/مجموعة (group/level) — 0 = default |
| 4 | `witem_no` | رقم الصنف (Item No) — الصنف الحالي في الحلقة |
| 5 | `3` | **mode = 3** → حساب PROFIT (ربح) (أوضاع أخرى قد تكون خصم/bonus) |
| 6 | `1` | فلتر/flag (1 = active/valid) |
| 7 | `11` | **11** → نوع الربح (profit type) / فئة الربح |
| 8 | `0` | فلتر إضافي (0 = all/default) |

> `read_bonuc_disc_rate_sal` تقرأ من جدول `FBONUC`/`FDISC_RATE` (أو ما يشابه) سعر/نسبة الربح المحددة للصنف (item) في هذا الفرع/التطبيق.

### القيمة المُرجعة (`wcout`)
سلسلة نصية (string) بتنسيق ثابت:
- **chars 1-2:** نوع الربح (`ldc_profut_type`): `1` = نسبة (percentage)، غير ذلك = مبلغ per وحدة (amount per unit).
- **chars 3-18:** قيمة الربح (`ldc_PROFIT`) — 16 حرف (decimal).
- `-1` في أي منهما → **لا يوجد ربح محدّد** → profit = 0.

---

## 3. تحليل الربح (Profit logic)

```powerbuilder
IF dec(mid(wcout,1,2)) = -1 OR dec(mid(wcout,3,16)) = -1 THEN
    ldc_PROFIT = 0
    ldc_profut_type = 0
    ldc_net_PROFIT = 0
ELSE
    ldc_PROFIT = dec(mid(wcout,3,16))          // قيمة الربح
    ldc_profut_type = dec(mid(wcout,1,2))      // نوع الربح
    IF ldc_PROFIT > 0 THEN
        IF ldc_profut_type = 1 THEN            // نسبة (percentage)
            ldc_net_PROFIT = ldc_PROFIT * wNET_SAL_NVAT_AMOUNT
        ELSE                                   // مبلغ per وحدة (amount per unit)
            ldc_net_PROFIT = ldc_PROFIT * wtotal_qty
        END IF
        wtotal_net_profit_amount = wtotal_net_profit_amount + ldc_net_PROFIT
    END IF
END IF
```

### تفسير
| نوع الربح (`ldc_profut_type`) | الصيغة | المعنى |
|------------------------------|--------|--------|
| `1` (نسبة) | `profit% × wNET_SAL_NVAT_AMOUNT` | ربح = نسبة × صافي المبيعات (بدون VAT) |
| other (مبلغ) | `profit_amount × wtotal_qty` | ربح = مبلغ per وحدة × الكمية |

- `wNET_SAL_NVAT_AMOUNT` = صافي المبيعات (total pur amount − discounts) **بدون VAT** (`wTOTAL_PUR_AMOUNT - wTOTAL_DISCOUNT_AMOUNT`).
- `wtotal_qty` = كمية الصنف المباع.
- `wtotal_net_profit_amount` = **إجمالي ربح الفاتورة** (تراكمي عبر الأصناف).

---

## 4. الحسابات المحيطة (Per-item context)

قبل حساب الربح، للصنف current:

| المتغير | المعنى |
|---------|--------|
| `wTOTAL_PUR_AMOUNT` | كمية × سعر (`wpur_qty * wsprice`) |
| `wTOTAL_DISCOUNT_AMOUNT` | إجمالي خصومات الصنف (DISCOUNT_1/2/3) |
| `wNET_SAL_NVAT_AMOUNT` | صافي المبيعات بدون VAT |
| `wNET_PUR_AMOUNT` | صافي المبيعات مع VAT (`wNET_SAL_NVAT_AMOUNT + VAT`) |
| `wtotal_qty` | كمية الصنف المباع |
| `wPROFIT_SALES` | ربح المبيعات (sales profit) = `(pur_qty × price) − (pur_qty × net_sales_price)` |
| `wPROFIT_PURCH` | ربح الشراء (purchase profit) = `(pur_qty × net_pur_price) − (pur_qty × net_sales_price)` |
| `witem_count` | عداد الأصناف (item counter) — يزداد لكل صنف |

---

## 5. أين يُستخدم `wtotal_net_profit_amount`

- يُراكم (accumulate) عبر حلقة الأصناف.
- يُمرَّر إلى `insert_sal_header(..., WSALESMAN_PROFIT, ...)` و `insert_totout_header(..., WSALESMAN_PROFIT, ...)` كـ **profit/عمولة للبائع (salesman)**.
- يُستخدم لحساب **عمولة البائع (salesman commission)** و **ربح الفاتورة**.

---

## 6. ملاحظات (Notes)

- الحساب **اختياري** (controlled by system parameter bit 28). إذا معطّل → `wtotal_net_profit_amount` يبقى 0.
- `read_bonuc_disc_rate_sal` تُقرأ **per item** (witem_no)، لذا لكل صنف في الفاتورة يُحسب ربحه الخاص.
- الربح يُضاف (accumulate) → `wtotal_net_profit_amount += ldc_net_PROFIT`.
- `-1` handling: إذا الصنف ليس له rate محدّد (no bonus/profit configured) → profit = 0 (لا خطأ).
- `ldc_profut_type` 1 = نسبة على صافي المبيعات (margin %)، else = مبلغ ثابت per وحدة.

---

## 7. ملفات مرجعية

- **Exported source:** `C:\Users\EL-Mostwred\AppData\Local\Temp\opencode\process_external_sales_invoice.srf` (81,336 chars)
- **Function:** `process_external_sales_invoice` in `phsalfunc.pbl`
- **App:** `ph_win` (`PHWIN.PBL`)
- **Tool used:** `PbOrcaTool.exe export ... FUNCTION`

---

*تم إنشاء هذا التحليل بناءً على استخراج مصدر PowerBuilder عبر PbOrcaTool (PBORCA).*
