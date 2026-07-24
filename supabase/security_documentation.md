# توثيق نظام الأمان وصلاحيات قاعدة البيانات (Supabase Auth & RLS)

تم تحديث وتأمين نظام المبيعات والمخازن (DEVO Collection) بالكامل عن طريق الانتقال إلى نظام **Supabase Auth (GoTrue)** وتفعيل **أمان صفوف الجداول (Row Level Security - RLS)**. 

يوضح هذا الملف البنية التحتية البرمجية الجديدة، السياسات المطبقة، والميزات الأمنية.

---

## 🏗️ 1. البنية الهيكلية الجديدة للمستخدمين

تم تقسيم نظام الحسابات إلى مستويين لضمان عدم إمكانية قراءة أو تعديل كلمات المرور نهائياً وتأمين الجلسات:

1. **نظام الهوية الداخلي (`auth.users` & `auth.identities`):**
   * يديره Supabase بالكامل بشكل معزول ومحمي.
   * يُخزن البريد الإلكتروني (المنشأ من اسم المستخدم متبوعاً بـ `@staff.devo.internal`).
   * يُخزن كلمة المرور مشفرة بخوارزمية `Bcrypt`.
2. **الملف الوظيفي للموظف (`public.system_users`):**
   * يحتوي على الاسم، الصلاحية (`role`: `owner`, `admin`, `worker`).
   * يحتوي على نوع وظيفة العامل (`worker_job`: `showroom`, `warehouse`, `both`).
   * يرتبط بجدول الهوية الداخلي عبر المعرف الفريد `UUID`.
   * **خالٍ تماماً من حقول كلمات المرور لزيادة الأمان.**

---

## 🛡️ 2. مصفوفة الصلاحيات وسياسات RLS المطبقة

تم تفعيل الـ RLS على كافة جداول النظام لضمان عدم إمكانية تعديل أو قراءة أي بيانات إلا من قبل الفئات المصرح لها من خلال توكن الـ JWT الموقع رقمياً.

### أ) جداول كتالوج الموديلات والصور والأقسام
* **الجداول:** `models`, `colors`, `sizes`, `classes`, `class_sizes`, `categories`, `model_sizes`, `model_images`, `themes`, `promo_cards`
* **القراءة (`SELECT`):** مسموح بها **للجميع** (الزوار العامين والعملاء غير المسجلين والموظفين) لعرض الموديلات والألوان والمظاهر بشكل سليم.
* **الكتابة والتعديل (`ALL`):** مقتصرة حصرياً على الإدارة (`owner` و `admin`).

```sql
-- مثال لسياسة القراءة العامة
CREATE POLICY "models_select_public" ON public.models FOR SELECT USING (true);

-- مثال لسياسة تعديل الإدارة
CREATE POLICY "models_write_admin" ON public.models FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('owner', 'admin')) 
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
```

### ب) جداول الطلبات وتفاصيلها وسجلات الحركات
* **الجداول:** `orders`, `order_items`, `order_logs`
* **القراءة (`SELECT`):**
  * الإدارة (`owner`, `admin`) يمكنهم قراءة **كافة الطلبات**.
  * الموظف (`worker`) يمكنه فقط قراءة الطلبات **الخاصة به أو المسندة إليه**.
* **الكتابة والتعديل (`INSERT/UPDATE`):**
  * الموظف يمتلك صلاحية كتابة حركات السلة وحذف أقفال الأوردرات الخاصة به عند إتمام الشراء.

```sql
-- سياسة قراءة الطلبات للموظفين والإدارة
CREATE POLICY "orders_select" ON public.orders FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin') 
        OR (public.get_my_role() = 'worker' AND (worker_id = auth.uid() OR assigned_worker_id = auth.uid()))
    );
```

### ج) جدول المخزون وحركات المستودع
* **الجداول:** `model_inventory`, `stock_movements`
* **القراءة (`SELECT`):**
  * `model_inventory`: عام للجميع لعرض حالات التوفر والألوان بالمعرض.
  * `stock_movements`: مقتصر على الموظفين المسجلين فقط (`owner`, `admin`, `worker`).
* **الكتابة والتعديل (`ALL`):** مقتصر على الإدارة (`owner`, `admin`) لتعديل المخزون يدوياً أو عند التوريد.

### د) جداول جرد المستودع وتحضير الطلبات
* **الجداول:** `inventory_audits`, `inventory_audit_items`, `order_item_preparation`
* **القراءة والكتابة:**
  * الإدارة لها صلاحية كاملة.
  * عمال المخازن فقط (`worker_job IN ('warehouse', 'both')`) لهم صلاحية القراءة والتحديث لتسجيل كميات الجرد الفعلي وتقديم التقارير.

---

## ⚙️ 3. الدوال المساعدة والـ RPCs المؤمنة

تم بناء وتحديث الدوال التالية لتنفيذ العمليات الحساسة بـ (SECURITY DEFINER) لتخطي حظر الـ RLS عند الحاجة مع فرض قيود صارمة على منفذ العملية:

### 1. دالة جلب دور المستخدم الحقيقي (`get_my_role`):
تتحقق من دور المستخدم ونشاط حسابه فورياً لحظر الحسابات الموقوفة في التو.
```sql
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text AS $$
DECLARE
    v_role text;
BEGIN
    SELECT role INTO v_role FROM public.system_users WHERE id = auth.uid() AND is_active = true;
    RETURN COALESCE(v_role, 'visitor');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2. دالة إنشاء الموظفين من لوحة التحكم (`admin_create_worker`):
تسمح فقط لـ `owner` بإنشاء مستخدم جديد وتشفير كلمته وتهيئتها لـ GoTrue Auth لمنع أخطاء الـ 500.
```sql
CREATE OR REPLACE FUNCTION public.admin_create_worker(
    p_full_name text, p_username text, p_password text, p_role text, p_worker_job text
) RETURNS uuid AS $$
-- تتحقق من المالك وتنشئ السجل في auth.users و public.system_users بالتفصيل
```

### 3. دالة تعديل وحظر الموظفين (`admin_update_worker`):
تسمح بتحديث البيانات، تغيير كلمة المرور للموظفين، وتفعيل أو إيقاف الحساب فورياً.

### 4. دالة حذف الموظف آمنًا (`admin_delete_worker`):
تقوم بحذف الحساب من `auth.users` والملف الوظيفي معاً بحركة واحدة برمجية آمنة.

---

## 🛠️ 4. المشاكل التي تم علاجها أثناء الترحيل

خلال عملية الترحيل، تم التعامل مع وتصحيح العيوب التالية لضمان استقرار النظام بنسبة 100%:

1. **حل مشكلة تعارض أعمدة Supabase Auth:**
   * تم حذف الأعمدة الاختيارية مثل `phone_change_token_or_otp` وعمود `confirmed_at` المولد تلقائياً لتفادي أخطاء توافق الإصدارات.
2. **حل مشكلة خطأ 500 عند تسجيل الدخول (Internal Server Error):**
   * يرجع السبب إلى أن معالج GoTrue بلغة Go يتطلب تهيئة الحقول الاختيارية بـ نصوص فارغة (`''`) وليس بقيمة `NULL`. تم كتابة كود تحديث تلقائي يعالج كافة الحقول النصية لجميع الحسابات الحالية والجديدة فوراً.
3. **حل خطأ 400 في استعلام حركات المخزون (`stock_movements`):**
   * تبين عدم وجود العمودين `order_id` و `inbound_id` كأعمدة أو كمفاتيح خارجية (Foreign Keys) في جدول حركات المخزون. تم إضافة الأعمدة وربطها برمجياً لتمكين جلب اسم العميل ورقم الفاتورة بنجاح.
4. **حل تعارض الدوال المكررة (Function Overloading PGRST203):**
   * تم تنظيف الدوال وتطهير النسخ القديمة لـ `process_order_transaction` التي كانت تختلف في ترتيب المعاملات لمنع حدوث التباس لدى خوادم PostgREST.

---

## 🔒 5. سكريبت التهيئة الشامل (SQL Code)
مرفق سكريبت التحديثات الفعلي المطبق في ملف الميجريشن:
[migration.sql](file:///g:/work/DEVO.SITE/supabase/migration.sql)
