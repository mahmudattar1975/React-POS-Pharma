# تقرير تدقيق وتحسين مشروع Pharmacy-App باستخدام الـ Skills

**التاريخ:** 2026-11-25  
**النطاق:** كل الواجهة الأمامية (كل المسارات والصفحات)، وإعدادات البناء والاختبار، واكتشاف/إنشاء skills خاصة بالمشروع.  
**الحالة:** اكتمل التدقيق والإصلاح؛ كل الفحوص النهائية ناجحة. التغييرات ملتزمة محلياً على `main` ولم يتم دفعها.

---

## 1. الـ Skills المستخدمة وما الذي قدمته

| Skill | التطبيق الفعلي |
| --- | --- |
| `frontend-design` | مراجعة نظام الألوان والطباعة والتخطيط؛ الحفاظ على الهوية البصرية الموجودة وتحسين التباين والدلالات بدلاً من إعادة تصميم الواجهة. |
| `web-design-guidelines` | قراءة المرجع المرفق ثم مراجعة الدلالات، الأزرار، الحقول، العناوين، التركيز، والـ landmarks عبر الكود وعبر axe. |
| `vercel-react-best-practices` | تقسيم الحزم (code-splitting)، تحميل المكتبات الثقيلة عند الطلب، وفصل vendor chunks لتقليل حجم التحميل الأولي. |
| `agent-browser` | تثبيت CLI وChrome for Testing، فتح التطبيق فعلياً، فحص axe على 15 مساراً، مراقبة الـ console والشبكة، والتحقق من أن `xlsx` لا يُحمّل في الصفحة الأولى. |
| `find-skills` | البحث في سوق Skills (`npx skills find pharmacy`). النتائج كانت إما أدوية/صيدلة عامة أو منخفضة التثبيت ولا تغطي integrations الخاصة بهذا المشروع (Wasfaty/NUPCO، ZATCA، RSD، dotnet-pos)، لذا تم إنشاء skill محلي. |
| `skill-creator` | كتابة skill خاص بالمشروع يلخّص الاتفاقيات وأوامر التحقق وأنماط الوصولية؛ انظر `.agents/skills/pharmacy-app-workflows/SKILL.md`. |

جميع الـ skills المطلوبة موجودة وفعّالة في `.agents/skills/`، إضافة إلى `web-design-guidelines` و`pdf` و`agent-tools`.

---

## 2. خط الأساس (قبل الإصلاح)

- `npm run build`: ناجح، لكن مع حزمة واحدة بحجم ≈ 1,736 kB وتحذير تجاوز 500 kB.
- `npm run lint`: ناجح مع تحذيرات (React purity / set-state-in-effect / unused imports).
- `npm test`: 42 ملفاً، 529 اختباراً، كلها ناجحة.
- `npm run test:e2e`: 44 مواصفة؛ التشغيل الأول تعطل بسبب توقف سيرفر Vite أثناء الجلسة (`ERR_CONNECTION_REFUSED`)، ثم ظهرت فشلات أخرى مرتبطة بالبيئة/توقعات قديمة (تفاصيلها في القسم 5).
- فحص axe عبر agent-browser على 12+ مساراً كشف المشاكل التالية:

| المشكلة | أمثلة المسارات |
| --- | --- |
| تباين ألوان غير كافٍ (< 4.5:1) | `/`, `/inventory`, `/purchases`, `/cost-centers`, `/settings` |
| غياب `main` و`h1` وskip link | كل المسارات |
| روابط تنقّل Outside list / `region` | كل المسارات |
| أزرار أيقونية بلا اسم (`button-name`) | `/offers` وغيرها |
| حقول `Select` بلا اسم (`aria-input-field-name`) | `/purchases`, `/inventory` |
| رؤوس جداول فارغة (`empty-table-header`) | `/`, `/offers`, `/items`, `/vendors` |
| ترتيب عناوين غير صالح (`heading-order`) | معظم الصفحات |

---

## 3. الإصلاحات المطبقة

### 3.1 الوصولية والدلالات
- `src/components/Layout/AppLayout.tsx`: skip link، `<nav aria-label="Main navigation">`، `<main id="main-content">`، عنوان `h1`، و`<ListItem>` حول كل رابط تنقّل.
- `src/theme.ts`: تعتيم ألوان `warning` / `success` / `secondary` وإضافة `info.main` بحيث تحقق 4.5:1 على خلفية الصفحة والتبويبات المحددة؛ جعل مساعدة الحقول المعطّلة (`MuiFormHelperText.Mui-disabled`) قابلة للقراءة.
- توحيد ألوان تبويبات الـ hubs مع الرموز الجديدة في `SalesHubPage`, `InventoryHubPage`, `PurchasingHubPage`.
- أسماء accessible للأزرار الأيقونية في `OffersPage`, `IncentiveItemsPage`, وسلة `POSPage`، و للـ `Select`s في المخزون، المشتريات، مراكز التكلفة، RSD، وZATCA.
- رؤوس «Actions» مرئية بدل الخلايا الفارغة في جداول POS والعروض وعند الأصناف والبائعين.
- `CardNetworkPicker`: تحويل `div[role=button]` إلى `ButtonBase مع aria-pressed` وحلقة تركيز واضحة.
- `MuiTypography.defaultProps.variantMapping`: `h4/h5 → h2`، `h6 → h3`، والعناوين الفرعية إلى `p`؛ تحويل إجمالي POS إلى `span`، وعنوان RSD إلى `h2` صريح.
- إضافة `aria-label` كاملة لتابّي «ZATCA Sales Invoices» و«RSD Reporting» مع إبقاء النص المرئي المختصر.

### 3.2 الأداء وتقسيم الحزم
- `src/App.tsx`: تحميل Offers وCost Centers وInsights وWasfaty Claims وSettings وIncentive Report وZATCA Setup عبر `React.lazy` داخل `Suspense`؛ ترك POS والمخزون والمشتريات محمّلة مباشرة لأنها مسار الكاشير الساخن.
- `vite.config.ts`: `manualChunks` لفصل React وMUI وRouter وxlsx وqrcode وبقية المكتبات.
- تحويل استيراد `xlsx` الثابت إلى `await import('xlsx')` داخل ثلاث وحدات فقط هي التي تحتاجه فعلياً.
- `playwright.config.ts`: تحديد `workers: 2` لأن العدد الافتراضي كان يربك سيرفر التطوير وينتج timeouts كاذبة.

### 3.3 إصلاح اختبارات E2E قديمة/غير مستقرة
- `e2e/rsd-reporting.spec.ts`: جعل اختبار «السيرفر غير متاح» صريحاً عبر اعتراض `/api/rsd/**` بدل الاعتماد على حالة سيرفر محلي، وتحديث نص حركة «Sale».
- `e2e/purchase-returns.spec.ts`: التحقق من قيمة حقل Autocomplete عبر `toHaveValue` بدل `toContainText` على `<input>`.

---

## 4. النتائج النهائية

| الفحص | النتيجة |
| --- | --- |
| `npm run build` | ناجح، بدون تحذير حجم الحزمة. أكبر ملفات JS الابتدائية: `index` 441 kB، `mui` 409 kB، `react` 207 kB، `router` 38 kB؛ `xlsx` 492 kB في chunk منفصل يُحمّل عند الطلب فقط. |
| `npm test` | 42 ملفاً / 529 اختباراً ناجحاً. |
| `npm run test:e2e` | **44/44 ناجحاً** (بعد ضبط workers وإصلاح التوقعات القديمة). |
| `npm run lint` | ناجح مع تحذيرات فقط (لم تُصلح في هذه الجولة، انظر القسم 6). |
| axe (agent-browser) | **0 violations** على 15 مساراً: `/`, `/inventory`, `/purchases`, `/items`, `/vendors`, `/offers`, `/cost-centers`, `/dashboard`, `/settings`, `/prescriptions`, `/reports`, `/sales-invoices`, `/zatca-setup`, `/wasfaty-claims`, `/rsd-reporting`. |
| الشبكة | جلسة متصفح جديدة على `/` لا تُصدر أي طلب `xlsx`. |
| الـ console | لا أخطاء تطبيق؛ تحذيرات متوقعة من محاولة backup إلى قاعدة بيانات غير متوفرة أثناء بعض اختبارات E2E. |
| الخدمات المحلية | Vite على :5173 وdotnet-pos على :5000 يعملان؛ الـ backend على :4300 أُعيد تشغيله بنفس الحالة السابقة (`RSD_MODE=mock`, `RSD_ENV=test`, `ZATCA_MODE=mock`, `WASFATY_PROVIDER=mock`, `WASFATY_ENV=sandbox`). |

---

## 5. ملاحظات حول فشلات E2E أثناء التشغيل
- موجة أولى من `ERR_CONNECTION_REFUSED` حدثت لأن سيرفر Vite توقف أثناء الجلسة؛ حُلّت بإعادة تشغيله.
- موجة ثانية من timeouts حدثت مع العدد الافتراضي للـ workers؛ حُلّت بتحديد `workers: 2` (تم التحقق: 44/44).
- اختبار RSD كان يفترض أن الـ backend متوقف، لكن جلسة اختبار RSD السابقة تركته يعمل في وضع mock؛ جعلنا الاختبار مستقلاً عن ذلك.
- توقعان كانا أقدم من الواجهة الحالية: اسم التاب الكامل ونص «Pharmacy Sale»، وتم تحديثهما/إضافة `aria-label` مناسبة.

---

## 6. المخاطر المتبقية والتوصيات
1. **تحذيرات lint:** استخدام `new Date()` أثناء الـ render، و`setState` داخل effects، ومستوردات غير مستخدمة. هي تحذيرات سلوكية/تنظيفية تحتاج refactor مع اختبارات، ولا علاقة لها بإصلاحات الوصولية؛ لم تُغيّر هنا لتجنب تغيير السلوك.
2. **الاعتماد على الخدمات المحلية:** `npm run test:e2e` يفترض Vite على :5173؛ سيرفر :4300 لم يعد مطلوباً لاختبار RSD بعد تعديل الاختبار، لكن باقي الاختبارات تختبر مسارات fallback عند غيابه.
3. **الحمل الأولي لا يزال كبيراً (~1.1 MB من JS قبل gzip):** الخطوة التالية الممكنة هي إزالة استيراد أيقونات MUI غير المستخدمة/تقليل الاعتماد على MUI في الصفحات البسيطة، وقياس ذلك بـ Lighthouse بعد النشر.
4. **الـ i18n/RTL:** الواجهة الإنجليزية أساساً مع نصوص عربية في سياقات Wasfaty/ZATCA فقط؛ لا يوجد إعداد RTL مركزي. لم يدخل ضمن نطاق هذه الجولة.
5. **الـ skills:** الـ skill الجديد محلي للمشروع وغير مثبت globally؛ يمكن تثبيته لاحقاً عبر `npx skills add` أو نسخه إلى مجلد skills المستخدم.

---

## 7. الملفات المعدّلة (25 ملفاً)
`src/App.tsx`, `src/theme.ts`, `vite.config.ts`, `playwright.config.ts`, `src/components/Layout/AppLayout.tsx`, `src/components/POS/{POSPage,CardNetworkPicker}.tsx`, `src/components/Inventory/{InventoryHubPage,InventoryPage,ItemMasterPage,ManufacturersPage,DosagesPage,WasfatyImportDialog}.tsx`, `src/components/Purchasing/{PurchasingHubPage,PurchaseInvoicePage,VendorsPage}.tsx`, `src/components/{Offers/OffersPage,Incentives/IncentiveItemsPage,CostCenters/CategoryMapPage,Rsd/RsdMonitorPage,Zatca/ZatcaInvoicesPanel,Sales/SalesHubPage,Receiving/HeadOfficeReceivingPage,Reports/WasfatyClaimsPage}.tsx`, `e2e/{rsd-reporting,purchase-returns}.spec.ts`.

**ملاحظة:** كل التغييرات غير ملتزمة؛ راجعها عبر `git diff` قبل الدمج.
