# معايير التطوير المعتمدة — Pharmacy-App

هذه المعايير ملزمة في **جميع مراحل تطوير النظام**: التحليل، التصميم، التنفيذ، الاختبار، والمراجعة.
لا تُضحّى بصحة العمل التجاري في ERP من أجل الأداء.

أولوية الترجمة عند التزاحم:

**Data Integrity → Business Logic Correctness → Performance → Security → Scalability → Maintainability → User Experience**

---

## أهم 5 توصيات — التركيز الدائم

1. **لا تعدّل Business Logic دون فهمه.**
   حلّل التنفيذ الحالي وقواعد الحساب والتحويل قبل أي تغيير؛ أضف regression test قبل تعديل وظيفة موجودة.
2. **الأداء يبدأ من SQL Server وتصميم Indexes.**
   استعلامات محددة الأعمدة، Index Seek بدل Table Scan، composites عند الحاجة، وقياس Logical Reads/Execution Plan قبل وبدل أي تحسين.
3. **لا تحمل بيانات أكثر مما تحتاجه الشاشة.**
   Projection صريح، server-side search، pagination/virtualization، ولا تحميل كل الأصناف عند فتح الشاشة.
4. **اختبر كل تعديل قبل دمجه في النظام.**
   Build + Lint + Unit + E2E حسب التأثير، مع verification فعلي لا افتراض.
5. **لا تعتبر المهمة مكتملة دون قياس الأداء والاختبارات.**
   قياس الزمن/Logical Reads/Latency قبل وبعد + إرفاق نتائج الاختبارات بتقرير التنفيذ.

---

## 1. Database Performance — SQL Server

- تصميم قاعدة البيانات بما يتناسب مع طبيعة أنظمة ERP.
- إنشاء Indexes مدروسة بناءً على الاستعلامات الفعلية، ودعم Composite Indexes عند الحاجة.
- استخدام Index Seek بدلاً من Table Scan عند البحث عن البيانات.
- تجنّب `SELECT *` واختيار الأعمدة المطلوبة فقط.
- استخدام Stored Procedures عند وجود مبرر أدائي أو وظيفي واضح.
- الحفاظ على سلامة البيانات باستخدام Primary Keys وForeign Keys وUnique Constraints.
- تجنّب الاستعلامات المتكررة وغير الضرورية.
- استخدام Transactions في العمليات المالية والمخزنية.
- تحليل Execution Plans وLogical Reads قبل اعتماد تحسينات الأداء.
- عدم تخزين الباركود كنوع رقمي، بل كنص للحفاظ على الأصفار في بدايته.

## 2. Barcode Lookup Performance

- إنشاء آلية بحث مستقلة وسريعة للباركود.
- دعم 100,000 سجل باركود على الأقل.
- دعم تعدد الباركود للصنف الواحد حسب الوحدة: Piece / Box / Carton.
- استخدام Exact Match وليس `LIKE`.
- إنشاء Index مناسب للبحث المباشر.
- إعادة بيانات الصنف والوحدة ومعامل التحويل بأقل عدد ممكن من الاستعلامات.
- منع تكرار الطلبات المتزامنة غير المقصودة (debounce / de-dupe / cancellation).
- دعم القراءة المتتالية دون تأخير غير ضروري.
- الحفاظ على Focus في حقل Scanner.

## 3. ASP.NET Core Backend

- الالتزام بفصل المسؤوليات (Separation of Concerns).
- استخدام Services وDTOs وRepository Pattern وفق البنية الحالية للمشروع.
- استخدام `async/await` في عمليات قواعد البيانات.
- استخدام `AsNoTracking` للاستعلامات غير المعدّلة، وProjection بدلاً من تحميل Entity كاملة.
- استخدام `CancellationToken`.
- تطبيق Global Exception Handling وValidation على جميع المدخلات.
- استخدام Dependency Injection وAuthentication/Authorization.
- منع الوصول إلى بيانات الشركات أو الفروع غير المصرح بها.
- عدم كشف تفاصيل SQL أو بيانات حساسة في رسائل الأخطاء.

> حيثما وُجد خادم Express/Prisma في هذا المستودع، تُطبّق النظائر العملية لهذه القواعد:
> Prisma `select`, explicit DTO mapping, async handlers, abort/cancellation, centralized error middleware,
> tenant/branch scoping, and non-leaky error responses.

## 4. React Frontend Performance

- تجنّب إعادة Render غير الضرورية.
- استخدام `React.memo` و`useMemo` و`useCallback` عند الحاجة الفعلية فقط.
- استخدام Pagination أو Virtualization للقوائم الكبيرة.
- عدم تحميل جميع الأصناف عند فتح الشاشة.
- استخدام Server-side Search.
- تحسين إدارة State والحفاظ على استجابة الواجهة أثناء عمليات API.
- منع إرسال الطلبات المكررة.
- دعم Keyboard Scanner دون التأثير على تجربة المستخدم.
- الحفاظ على Focus في حقول الإدخال المناسبة.

## 5. ERP Business Logic Integrity — أهم الأولويات

- عدم تغيير منطق العمل الموجود دون تحليل وموافقة.
- المحافظة على قواعد حساب الأسعار والخصومات والضرائب.
- المحافظة على معاملات تحويل الوحدات.
- المحافظة على أرصدة المخزون.
- المحافظة على قواعد البيع والشراء والمردودات.
- منع الحركات المخزنية غير المتوازنة وضمان دقة الحسابات المالية.
- استخدام `Decimal` بدلاً من Floating Point في الحسابات المالية.
- تنفيذ العمليات المالية والمخزنية الحساسة داخل Transactions مناسبة.
- إنشاء اختبارات Regression قبل تعديل أي وظيفة موجودة.

## 6. Caching Strategy

- عدم استخدام Redis لمجرد تحسين الأداء النظري.
- البدء بتحسين SQL Indexes والاستعلامات.
- استخدام MemoryCache للبيانات المرجعية المستقرة عند الحاجة.
- سياسة واضحة لانتهاء الصلاحية، وإبطال Cache عند تعديل الأسعار أو الوحدات أو بيانات الأصناف.
- عدم الاعتماد على بيانات مخزون قديمة عند تنفيذ عمليات البيع.

## 7. Security & Data Integrity

- صلاحيات حسب المستخدم والدور والشركة والفرع.
- عدم الوثوق بأي `CompanyId` أو `BranchId` قادم من Frontend.
- استخدام Parameterized Queries وحماية API من الطلبات غير المصرح بها.
- Audit Logging للعمليات المهمة.
- Soft Delete حيث يناسب طبيعة بيانات ERP.
- منع حذف البيانات المرجعية المرتبطة بحركات سابقة.
- حماية بيانات العملاء والموردين والمعاملات المالية.

## 8. Performance Monitoring

قياس مستمر وليس بالانطباع. مراقبة:

- SQL Execution Time وDatabase Logical Reads.
- API Response Time وP50 / P95 / P99 Latency.
- CPU وMemory Usage وConcurrent Requests.
- Frontend Rendering Time وError Rate.

تُوضع أهداف أداء مبدئية قابلة للقياس، ثم تُعدّل وفق نتائج الاختبارات وبيئة التشغيل الفعلية.

## 9. Development Standards

- Clean Code، وأسماء واضحة للمتغيرات والدوال والجداول.
- تجنّب تكرار الكود وإنشاء Reusable Components.
- الالتزام بالأنماط المعمارية الموجودة وتوثيق الوظائف المعقدة.
- Unit Tests وIntegration Tests ومراجعة الكود قبل الاعتماد.
- عدم إضافة Dependencies دون ضرورة، وعدم Refactoring واسع دون تحديد نطاقه.

## 10. Mandatory Workflow for Claude Code

قبل تنفيذ أي مهمة:

1. Analyze existing implementation.
2. Understand the existing business logic.
3. Identify performance bottlenecks.
4. Propose the technical solution.
5. Identify affected files and database objects.
6. Explain potential risks.
7. Implement changes incrementally.
8. Run relevant tests.
9. Compare performance before and after.
10. Provide a detailed implementation report.

## Final Instruction

Always prioritize:

1. Data Integrity
2. Business Logic Correctness
3. Performance
4. Security
5. Scalability
6. Maintainability
7. User Experience

**Do not sacrifice ERP business correctness for performance improvements.**
**Do not make assumptions about existing database schemas or business rules.**
**Analyze first, propose second, implement third, and test before considering any task complete.**
