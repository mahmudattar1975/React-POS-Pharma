# التعديلات الخاصة بالفروع (Multi-branch)

آخر تحديث: 2026-11-26  
المشروع: `F:\SOURCE\React\Pharmacy-App`  
الفرع: `main` — آخر commit: انظر `git log -1` (`feat: import Excel item masters for all branches`) — **لم يتم push**.

---

## 1. الفكرة العامة

- قاعدة بيانات واحدة مشتركة بين كل الصيدليات. فعلياً على هذا الجهاز هي `dotnet_pos` على `Mahmoud-PC` (وثيقة `docs/multi-branch-setup.md` تسمّيها `PharmaDB` كاسم منطقي).
- جدول `branches` هو الـ master المشترك، يُدار من **Settings → Branches**.
- **كل PC يثبّت فرعه** في ملف `server/config/branch.json` (gitignored). لا توجد قائمة منسدلة في شاشة البيع، حتى لا يحوّل الكاشير مبيعاته لفرع آخر بالخطأ.
- الكتالوج مشترك، لكن **المخزون مملوك لكل فرع** (`batches.branchId`). نفس الصنف/رقم الدفعة يمكن أن exists في أكثر من فرع بكميات مختلفة.
- المبيعات والمرتجعات موسومة بالفرع (`sales.branchId`, `return_records.branchId`)؛ كل فرع يرى مستنداته فقط.
- أرقام المستندات تُسبق بكود الفرع: `PH001-SIM-000001`, `RIY-PUR-000001` إلخ.
- البيع يستمر بدون إنترنت: المتصفح يسجّل البيع أولاً، والنسخ الاحتياطي لـ SQL يُصفّف لإعادة الإرسال. فحص مخزون الفروع الأخرى هو الشيء الوحيد الذي يحتاج السيرفر، ويتحول لتحذير عند تعذّره.

---

## 2. الفروع المعرّفة حالياً

| Branch ID | Code | الاسم | الحالة |
|---|---|---|---|
| `cc-br-001` | `RIY` | Riyadh Branch - Pharmacy Operations | مُضاف بالـ migration |
| `cc-br-002` | `JED` | Jeddah Branch - Pharmacy Operations | مُضاف بالـ migration |
| `cc-br-003` | `DAM` | Dammam Branch - Pharmacy Operations | مُضاف بالـ migration |
| `cc-br-004` | `MKK` | Makkah Branch - Pharmacy Operations | مُضاف بالـ migration |
| `br-ph001` | `PH001` | Al Shifa Modern Pharmacy | أُضيف من الواجهة |

> عند إضافة فرع جديد من الواجهة، الـ ID يُولّد تلقائياً بالشكل `br-<code صغير>`. لذلك فرع `PH001` له المعرّف `br-ph001` وليس `PH001`.

---

## 3. الملفات المضافة / المعدّلة

### السيرفر (`server/`)

| الملف | الغرض |
|---|---|
| `prisma/schema.prisma` | نموذج `Branch` + حقل `branchId` على `Sale` / `ReturnRecord` / `Batch` + فهارس. |
| `prisma/migrations/20261125120000_add_branches_and_branch_scope/migration.sql` | إنشاء جدول `branches` وإدراج الفروع الأربعة + إضافة أعمدة `branchId` وفهارسها. |
| `prisma/seed.ts` | إدراج الفروع الافتراضية عند `prisma db seed`. |
| `src/branches.ts` | نسخة fallback للفروع تعمل بدون قاعدة بيانات + `normalizeBranchCode`. |
| `src/branch.ts` | قراءة `config/branch.json` لكل جهاز، مع تحذير والعودة لـ `cc-br-001` عند الغياب. |
| `src/routes/branches.ts` | `GET/POST/PATCH /api/branches` — لا يوجد DELETE؛ منع تغيير الكود بعد وجود مستندات. |
| `src/routes/context.ts` | `GET /api/context` — فرع هذا الجهاز + قائمة الفروع + مصدر البيانات. |
| `src/routes/stock.ts` | `GET /api/stock/other-branches?itemId=` من PharmaDB/قاعدة التطبيق لا من ERP. |
| `src/routes/sales.ts` | ختم `branchId` عند البيع/المرتجع، وخصم/إرجاع المخزون داخل الفرع فقط. |
| `src/routes/receiving.ts` | تحديد دفعة الاستلام داخل الفرع، وتفادي تضارب معرّفات الدفعات بين الفروع. |
| `src/index.ts` | تسجيل المسارات الجديدة + طباعة الفرع عند الإقلاع. |
| `config/branch.example.json`, `config/README.md` | قالب وشرح اختيار فرع الجهاز. |
| `.env` (gitignored) | بيانات الاتصال — انظر القسم 4. |

### الواجهة (`src/`)

| الملف | الغرض |
|---|---|
| `types/branch.ts`, `api/branchApi.ts` | الأنواع وواجهات الفروع/السياق/المخزون. |
| `components/Settings/BranchesPanel.tsx` | شاشة إضافة/تعديل الفروع بكل الحقول. |
| `components/Settings/SettingsPage.tsx` | إدراج لوحة الفروع داخل الإعدادات. |
| `components/POS/OtherBranchStockDialog.tsx` | نافذة "فحص الفروع الأخرى". |
| `components/POS/POSPage.tsx` | إظهار زر الفحص عند نفاد الكمية أو نقصها (للأصناف المحلية أيضاً). |
| `App.tsx` | قراءة `/api/context` عند الإقلاع وتخزين فرع الجهاز في `settingsStore`. |
| `store/salesStore.ts`, `store/purchasingStore.ts`, `types/settings.ts` | حقول الفرع + بادئة رقم المستند. |
| `utils/invoiceNumber.ts` + اختباره | `branchNumberPrefix()` — يُبقي التنسيق القديم إذا لم يُضبط فرع. |
| `components/Layout/AppLayout.tsx` | عرض كود الفرع بجانب "Pharmacy POS". |
| `docs/multi-branch-setup.md` | دليل الإعداد. |

---

## 4. ما نُفّذ فعلياً على قاعدة البيانات

### أ) تشخيص خطأ الاتصال
الرسالة التي ظهرت عند إضافة `PH001`:

```text
Authentication failed ... credentials for `` are not valid
```

الأسباب المتتالية:

1. `DATABASE_URL` كان `sqlserver://Mahmoud-PC;database=dotnet_pos;` **بدون user/password**.
2. المحاولة بـ `Mahmoud-PC\MSQL` فشلت: `SQL browser timeout during resolving instance MSQL`. الجهاز نفسه `Mahmoud-PC` وSQL Server يعمل كـ **Default Instance** على المنفذ `1433`؛ لا يوجد Instance اسمه `MSQL`.
3. كلمة `sa` القديمة لم تعد صالحة.
4. قاعدة `PharmaDB` غير موجودة على الخادم. حسب توجيهك استخدمنا `dotnet_pos`.

### ب) الإعداد النهائي في `server/.env`

```text
DATABASE_URL="sqlserver://Mahmoud-PC;database=dotnet_pos;user=SUPERADMIN;password=***;encrypt=true;trustServerCertificate=true"
DOTNET_POS_DATABASE_URL="sqlserver://localhost:1433;database=dotnet_pos;integratedSecurity=true;trustServerCertificate=true"
```

> كلمة المرور مخفية هنا وهي محفوظة داخل `.env` فقط (الملف gitignored).

### ج) تطبيق الـ migrations

- `npx prisma migrate deploy` فشل بخطأ `P3005: The database schema is not empty` لأن `dotnet_pos` تحتوي جداول `.NET`.
- `npx prisma db push` **لم يُنفّذ** لأنه كان سيحذف `pos`, `cashier`, `shift`, `commission_item`, `item`, ... (جداول `.NET` المهمة).
- بدلاً من ذلك نُفّذت ملفات SQL يدوياً بالترتيب، باستخدام `SUPERADMIN`:

```powershell
sqlcmd -S Mahmoud-PC -U SUPERADMIN -P <password> -d dotnet_pos -b `
  -i server\prisma\migrations\20261002015001_init\migration.sql
sqlcmd -S Mahmoud-PC -U SUPERADMIN -P <password> -d dotnet_pos -b `
  -i server\prisma\migrations\20261002025309_add_catalog\migration.sql
sqlcmd -S Mahmoud-PC -U SUPERADMIN -P <password> -d dotnet_pos -b `
  -i server\prisma\migrations\20261125120000_add_branches_and_branch_scope\migration.sql
```

- تحذيرات `maximum key length` متوقعة من تصميم الأعمدة `NVARCHAR(1000)` ولا تمنع الإدراج.
- سُجّلت الـ migrations كتطبيقية:

```powershell
cd server
npx prisma migrate resolve --applied 20261002015001_init
npx prisma migrate resolve --applied 20261002025309_add_catalog
npx prisma migrate resolve --applied 20261125120000_add_branches_and_branch_scope
npx prisma migrate status   # Database schema is up to date!
```

### د) ترميز الأسماء العربية
أول إدراج للفروع عبر `sqlcmd -i` حفظ الأسماء العربية مشوّشة لأن الملف قُرئ بترميز ANSI. صُحّحت بملف UTF-8 وتشغيل:

```powershell
sqlcmd -S Mahmoud-PC -U SUPERADMIN -P <password> -d dotnet_pos -f 65001 -i fix-branch-arabic.sql
```

الآن `RIY` = `فرع الرياض - عمليات الصيدلية` إلخ.

### هـ) سلامة بيانات `.NET`
لم يُحذف أي جدول. جدول `pos` ما زال يحتوي 32 صفاً، و`cashier` / `shift` / `commission_item` سليمة.

---

## 5. إضافة فرع جديد من الواجهة

**Settings → Branches → Add Branch**

الحقول:

| الحقل | القاعدة |
|---|---|
| Code | 1–8 أحرف/أرقام إنجليزية كبيرة، بدون مسافات. يصبح بادئة رقم الفاتورة. |
| Name (English) | مطلوب |
| Name (Arabic) | مطلوب، حقل RTL |
| Address / Phone | اختياري |
| VAT number | اختياري، 15 رقماً عند وجوده |
| CR number | اختياري |
| GLN | اختياري، 13 رقماً عند وجوده |
| Branch cost center | يربط الفرع بمركز التكلفة لتقارير المصروفات/المبيعات |
| Active | يُوقف الفرع بدلاً من حذفه |

قواعد مهمة:
- **لا يوجد زر حذف**: المستندات تشير إلى الكود للأبد، لذلك يُوقف الفرع (`isActive = false`).
- لا يمكن تغيير الكود بعد وجود مستندات للفرع (الـ API يرفض بـ 409).
- تعديل القائمة من الإعدادات **لا يغيّر فرع هذا الجهاز**.

---

## 6. فتح فرع والبيع عليه

لا توجد شاشة "تبديل الفرع" عند الكاشير. الفرع يأتي من ملف السيرفر:

### مثال: الجهاز الحالي يعمل على `PH001`

1. أنشئ/عدّل `server/config/branch.json`:

```json
{
  "branchId": "br-ph001"
}
```

2. أعد تشغيل السيرفر من `server`:

```powershell
npm run dev
```

يظهر عند الإقلاع:

```text
Terminal branch: br-ph001 (from config/branch.json)
```

3. اعمل **Ctrl+F5** في المتصفح ليقرأ التطبيق `/api/context` مجدداً.

النتيجة:

- الشريط الجانبي يعرض `PH001`.
- **Settings → Branches** يظهر Chip `This terminal` على `PH001`.
- `/api/context` يعيد:
  ```text
  BranchId = br-ph001, Code = PH001, Configured = True, Source = database
  ```
- أرقام جديدة: `PH001-SIM-000001`, `PH001-PUR-000001`.
- المبيعات تُوسم بـ `br-ph001` ولا تظهر في الفروع الأخرى.

### للعودة إلى الرياض

```json
{ "branchId": "cc-br-001" }
```

ثم إعادة تشغيل السيرفر وتحديث المتصفح.

> كل جهاز صيدلية له `branch.json` خاص به. الملف gitignored ولن يُرفع في Git.

---

## 7. واجهات API الجديدة

| Endpoint | الغرض |
|---|---|
| `GET /api/branches` | قائمة الفروع + `source: database \| fallback` |
| `POST /api/branches` | إضافة فرع (مع تحقق من التكرار) |
| `PATCH /api/branches/:id` | تعديل فرع / إيقافه |
| `GET /api/context` | فرع هذا الجهاز + القائمة + حالة الضبط |
| `GET /api/stock/other-branches?itemId=` | كميات نفس الصنف في الفروع الأخرى |
| `GET /api/items` | نسخة الكتالوج المشتركة (أصناف فقط، بلا دفعات/مخزون) |
| `POST /api/items/import` | استيراد أصناف Excel إلى `dbo.items` و`dbo.item` معاً |

---

## 8. التحقق

```powershell
# من جذر المشروع
npx tsc -b
npm test -- --run          # 552 / 552 بعد قالب Excel وتوسيع الباركود العلمي
npm run build
npm run lint               # تحذيرات فقط
npm run test:e2e           # 46 / 46 (بعد stub الكتالوج المشترك + اختباري القالب والباركود العلمي)

# من server
npm run build
npx prisma migrate status  # up to date
```

فحوصات يدوية بعد الإصلاح:

```text
GET /api/branches  → source: database, الفروع: DAM,JED,MKK,PH001,RIY
GET /api/context   → br-ph001 / PH001 / Configured: True
POST فرع تجريبي ZZTEST → 201، ثم حُذف (CREATE OK)
GET /api/items → صنف الـ seed فقط (بلا دفعات)
POST /api/items/import بصف TMP-IMPORT-CHECK-001 → created 1 في dbo.items وcreated 1 في dbo.item، ثم حُذف الصف من الجدولين (SMOKE OK)
GET /api/rsd/status → mode=mock, environment=test (بإعدادات process-local، ملف .env لم يُلمس)
```

---

## 9. قيود ومتابعة

- `docs/multi-branch-setup.md` ما زال يذكر اسم `PharmaDB`؛ التنفيذ الفعلي على هذا الجهاز داخل `dotnet_pos`.
- بيانات ZATCA / RSD / Wasfaty ما زالت عامة (ليست لكل فرع). حقول VAT/CR/GLN محفوطة في `branches` للاستخدام المستقبلي.
- فواتير الشراء تبقى في `localStorage` لكل جهاز؛ المبيعات/المرتجعات/المخزون فقط تُنسخ إلى SQL.
- `server/config/branch.json` و`server/.env` gitignored — لا يظهران في `git status`.
- يوجد تعديل i18n واحد غير مُ-commit في `src/components/Layout/AppLayout.tsx` (زر اللغة يعرض اللغة الهدف بدل الحالية). ليس part من عمل الفروع ولا من استيراد Excel، ويُترك خارج ال commit.
- استيراد Excel يضيف master مشتركاً فقط؛ لا ينقل مخزوناً ولا يغيّر عدّادات المستندات أو بيانات الفروع الأخرى.

---

## 10. إصلاح ملاحظة "رقم الفاتورة SIM-000016 والبيانات القديمة موجودة"

السبب لم يكن في `branch.json` ولا في قاعدة البيانات، بل في الواجهة:

1. كود الفرع كان يُقرأ مرة واحدة عند إقلاع React ويُحفظ في `localStorage`. أي تغيير في `branch.json` دون **Ctrl+F5** كان يترك المتصفح على الكود القديم، فتصدر الفاتورة بلا بادئة.
2. كل المستندات (المبيعات/المرتجعات/المشتريات/الدفعات/سجل الاستلام) كانت مخزّنة في مفاتيح `localStorage` واحدة. تغيير الفرع غيّر الاسم المعروض فقط، ولم يخفِ مستندات الفرع السابق.
3. العدّاد `simplifiedCounter` كان واحداً لكل الفروع، فحتى مع البادئة كانت ستظهر `PH001-SIM-000016`.

### ما تغيّر

| الملف | الإصلاح |
|---|---|
| `src/utils/branchScope.ts` (جديد) | يوفّر `currentBranchId()`, `branchIdOf()`, `rowsForBranch()`, `applyBranchContext()`. الصفوف القديمة بلا `branchId` تُعتبر فرع RIY الأصلي `cc-br-001` (وهو الـ fallback على السيرفر). دفعات البداية التجريبية تحمل `shared-seed` وتبقى مرئية على أي جهاز. |
| `src/store/branchSelectors.ts` (جديد) | `useBranchSales`, `useBranchSalesReturns`, `useBranchPurchases`, `useBranchBatches`, `useBranchReceivingLog` — كل شاشة تقرأ نسخة الفرع الحالي فقط. |
| `src/api/branchApi.ts` | `GET /api/context` يستخدم `cache: 'no-store'` ويطبّق السياق على `settingsStore` فوراً، مع مهلة اختيارية (`timeoutMs`) لإلغاء الطلب عند انقطاع السيرفر. |
| `src/components/POS/POSPage.tsx` | `completeSale()` يعيد جلب السياق (بحد أقصى 1.5 ثانية) قبل إصدار الرقم; عند انقطاع السيرفر يُستخدم الكود المخزّن، فالبيع لا يتوقف ولا يعلق. |
| `src/store/salesStore.ts` | `branchId` على `SaleHeader` و`ReturnHeader`، عدّادات لكل فرع (`branchCounters`)، ختم تلقائي عند `recordSale`/`recordReturn`، و`invoiceByNo` يرفض فواتير الفروع الأخرى. رفع إصدار persist إلى `v4` مع ترحيل الصفوف القديمة إلى `cc-br-001`. |
| `src/store/purchasingStore.ts` | `branchId` على `PurchaseInvoice`، عدّادات PUR/RET لكل فرع، وختم تلقائي عند الاستلام/المرتجع. |
| `src/store/catalogStore.ts` | `branchId` على `Batch` و`ReceivingEvent`; `batchesForItem`/`batchById` وFEFO والاستلام والإرجاع تعمل داخل الفرع فقط. إعادة مسح ERP لا تحذف دفعات فرع آخر. |
| `src/store/controlledRegisterStore.ts` | رصيد الافتتاح يُحسب من دفعات الفرع الحالي لا من كل الدفعات. |
| 10 مكوّنات (Dashboard, Reports, Returns, Inventory, Item Master, ZATCA, Expenses, Cost-center map, Wasfaty, Purchasing) | تقرأ عبر `branchSelectors` بدلاً من مصفوفات stores الخام. الكتالوج والبائعون ومراكز التكلفة تبقى مشتركة. |
| `src/store/branchScope.test.ts` (جديد) | يختبر ترحيل الصفوف القديمة، تطبيق السياق، بدء PH001 من `000001`، وختم المبيعات الجديدة. |

### النتيجة المتوقعة الآن

- أول فاتورة على `PH001` هي **`PH001-SIM-000001`** (وليست `SIM-000016`)، لأن العدّاد الخاص بالفرع يبدأ من صفر ولا يرث عدّاد RIY.
- فواتير RIY القديمة تُنقل عند الترحيل إلى `branchId = cc-br-001` وتختفي من قوائم `PH001`، لكنها تبقى محفوظة في `localStorage` ولا تُحذف; العودة إلى RIY تُظهرها مجدداً.
- المخزون المستلم فعلياً والدفعات وأرقام الاستلام/المرتجع تصبح خاصة بالفرع أيضاً. دفعات العيّنة التي تُشحن مع التطبيق (`seedBatches`) تبقى `shared-seed` لأي جهاز جديد يبدأ البيع مباشرة؛ أي مخزون استُلم لاحقاً يُوسم بالفرع ولا يظهر في غيره.
- لا حاجة إلى **Ctrl+F5** بعد تغيير `branch.json` عند البيع (زر الدفع يعيد جلب السياق)، لكن تحديث الصفحة مفيد لتحديث الشريط الجانبي فوراً.

> تنبيه: بيانات المتصفح التي أنشأتَ فيها `SIM-000016` محفوظة في ذلك المتصفح تحديداً. عند فتحه بعد التحديث سيُطبّق الترحيل تلقائياً: تظهر الفاتورة القديمة تحت RIY، وتبدأ PH001 من رقم 1. لا حاجة لمسح `localStorage` يدوياً.

### ملاحظة على اختبارات E2E

بما أن جهاز التطوير مضبوط على `PH001`، أرقام المستندات في الاختبارات أصبحت مسبوقة بالكود (`PH001-SIM-000001`, `PH001-PUR-000001`). خمسة ملفات اختبار (`controlled-register`, `prescription`, `purchase-returns`, `purchasing`, `returns`) عُدّلت لتتجاهل البادئة وتتحقق من اللاحقة الثابتة فقط —سلوك التطبيق نفسه لم يُخفَّف.

التحقق النهائي: `npx tsc -b` ناجح، `npm test -- --run` = 535/535، `npm run build` ناجح، `npm run lint` تحذيرات فقط، `npm run test:e2e` = 44/44.

### النقطة الأساسية

> `br-ph001 / PH001` لم يعد مجرد اسم في الشريط الجانبي: أصبح حدّاً فعلياً للبيانات. أول فاتورة على الجهاز **`PH001-SIM-000001`**، وبيانات RIY القديمة (فواتير/مشتريات/مخزون مستلم) مخفية على هذا الجهاز ومحفوظة تحت `cc-br-001` دون حذف. الفرع يحدد الرقم والبيانات معاً، لا العرض فقط.

---

## 11. استيراد الأصناف من Excel

المطلوب كان شاشة تستورد ملف الإكسل الخاص بصاحب الصيدلية وتكتب **صفّ master فقط** في جدولين:

| الجدول | الاستخدام |
|---|---|
| `dotnet_pos.dbo.items` | كتالوج التطبيق الذي يستخدمه الـ POS والمخزون |
| `dotnet_pos.dbo.item` | master القديم الخاص بتطبيق .NET وحساب العمولات |

### الشاشة

- `Inventory → Items → Import Excel` تفتح `src/components/Inventory/ItemImportDialog.tsx`.
- الملف يُقرأ في المتصفح (`xlsx` يُحمّل ديناميكياً فقط عند الاختيار، فلا يدخل الحزمة الأولى). تُكتشف أعمدة الملف تلقائياً بأسماء إنجليزية أو عربية (`Barcode/الباركود`, `Item Name/اسم الصنف`, `Sale Price/سعر البيع`, `VAT %/ضريبة القيمة المضافة` إلخ)، وكل عمود قابل للتعديل يدوياً قبل التطبيق.
- زر **Excel sample** بجانب "Choose Excel / CSV file" ينزّل قالب `item-import-sample.xlsx`: ورقة `Items` بالأعمدة المتوقعة وصف مثال واحد، وورقة `How to fill` تشرح كل عمود والقيم المقبولة. importer يقرأ الورقة الأولى فقط، ويجب حذف صف المثال قبل استيراد أصناف حقيقية.
- إذا ظهر الباركود في إكسل كـ `6.9442E+12` (لأن العمود `General`)، المعاينة توسّعه تلقائياً إلى `6944200000000`، وتتعامل أيضاً مع `6281007320014.0`. الأفضل في إكسل: تحديد عمود Barcode → Format Cells → Text قبل لصق الأكواد، أو كتابة `'` قبل الرقم. إذا كان الرقم أصلاً أطول من 15 رقماً فقد يكون إكسل قد قرّب آخر الأرقام؛ حينها يجب إعادة إدخال الكود من المصدر. القيم الكسرية مثل `1.23E-2` تُرفض في المعاينة مع توضيح بدل استيراد رقم خاطئ.
- معاينة إلزامية: كل صف يظهر كـ **New** أو **Update** أو **Error** مع رقم الصف الأصلي. أي خطأ (باركود مكرر داخل الملف، رقم ضريبة خارج 0–100%، اسم مفقود...) يمنع تطبيق الملف كله.
- الضريبة تقبل `0.15` أو `15` أو `15%` والسعر الفارغ يُستورد صفراً مع تنبيه في المعاينة. الحد الأقصى 1000 صف لكل ملف.

### الكتابة في SQL

- `POST /api/items/import` يعيد التحقق من كل الصفوف قبل أي كتابة، ثم يعمل upsert بالباركود في الجدولين. إعادة استيراد نفس الملف تعدّل الصفوف نفسها ولا تنشئ نسخاً.
- الصف الموجود يحتفظ بـ `id`/`itemNo` المحلي، فتبقى الدفعات والعروض والمستندات المرتبطة به سليمة. الصنف الجديد يحصل على معرّف SQL ثابت.
- `dbo.item.Id` عمود `IDENTITY`، لذلك الإدراج يتم بـ `INSERT ... OUTPUT INSERTED.Id` عبر SQL خام؛ توليد Prisma القديم فشل بسبب `EPERM` عند استبدال ملف محرك الاستعلام، وهذا لا يؤثر على الاستيراد.
- الجدولان ليسا في معاملة واحدة؛ تُنشأ لقطة لكل صف قبل تعديله، وإذا فشل أي طرف تُعاد كل التعديلات بترتيب عكسي ويُعرض صراحةً أي فشل في الاسترجاع.

### هل الصنف يظهر في كل الفروع؟

**نعم كـ master، ولا كـ مخزون.** الاستيراد لا ينشئ دفعات ولا أرصدة؛ المخزون يبقى مملوكاً للفرع عبر `batches.branchId`. الصنف المستورد يُكتب مرة واحدة في `dotnet_pos.dbo.items` فيُعتبر متاحاً لكل الفروع.

بما أن المتصفح offline-first ويحتفظ بنسخة `localStorage` خاصة به، أُضيفت مزامنة خفيفة:

- `GET /api/items` يقرأ أصناف `dbo.items` فقط ولا يُرجع أي دفعة أو رصيد أو مستند. في اختبارات E2E يُStub هذا المسار بـ `items: []` في `e2e/fixtures.ts` حتى تبقى أسعار أصناف الـ seed ثابتة ولا تعتمد على بيانات الجهاز المحلي.
- عند إقلاع التطبيق يجلب `src/App.tsx` هذه القائمة (مهلة 3 ثوانٍ،failure صامت) ويمرّرها إلى `upsertImportedItems` في `catalogStore`.
- الدمج يحفظ الحقول المحلية التي لا مصدر لها في SQL (سلم العبوات، ربط الجرعات، mapping الخاص بـ Wasfaty، الأكواد البديلة)، ويحفظ حالة `isActive` الخاصة بكل جهاز (SQL لا يرسلها أصلاً). الأصناف الجديدة تبدأ نشطة وتأخذ رقماً محلياً.
- لذلك يظهر الصنف المستورد على الأجهزة الأخرى بعد إقلاع التطبيق أو تحديث الصفحة؛ إذا كان الجهاز بدون إنترنت يظهر في أول إقلاع ناجح لاحقاً. البيع لا يتوقف عند فشل المزامنة.

### الملفات

`server/src/items/import.ts`, `server/src/routes/items.ts`, `server/src/index.ts`, `src/utils/itemImport.ts`, `src/utils/itemImportSample.ts`, `src/api/itemImportApi.ts`, `src/api/catalogApi.ts`, `src/components/Inventory/ItemImportDialog.tsx`, `src/components/Inventory/ItemMasterPage.tsx`, `src/store/catalogStore.ts`, `src/App.tsx`, `server/prisma/dotnet-pos-schema.prisma`، مع اختبارات في `src/utils/itemImport.test.ts`, `server/tests/items/import.test.ts`, `src/store/itemMasterStore.test.ts`, `e2e/item-import-sample.spec.ts`.
