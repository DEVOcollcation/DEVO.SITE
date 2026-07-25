-- =========================================================================
-- 🌟 MIGRATION: MIGRATE TO SUPABASE AUTH & IMPLEMENT ROW LEVEL SECURITY (RLS) 🌟
-- =========================================================================

-- 1. تمكين إضافة التشفير pgcrypto لاستخدامها في تشفير كلمات المرور
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. ترحيل المستخدمين الحاليين من جدول system_users إلى auth.users و auth.identities
-- السكريبت يحافظ على المعرفات الفريدة (UUIDs) الحالية لتجنب كسر أي علاقات سابقة
DO $$
DECLARE
    r RECORD;
    v_email TEXT;
    v_hashed_password TEXT;
BEGIN
    FOR r IN SELECT * FROM public.system_users LOOP
        v_email := r.username || '@staff.devo.internal';
        
        -- التحقق من عدم وجود المستخدم مسبقاً في auth.users لتجنب التكرار
        IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = r.id OR email = v_email) THEN
            -- تشفير كلمة المرور الحالية (التي كانت مخزنة بنص واضح) باستخدام خوارزمية bcrypt
            v_hashed_password := crypt(r.password, gen_salt('bf'));
            
            -- إدخال المستخدم في جدول auth.users مع الحفاظ على الـ UUID القديم نفسه
            -- تم الاحتفاظ فقط بالأعمدة الأساسية المشتركة في جميع إصدارات Supabase لتجنب تعارض الأعمدة الاختيارية
            INSERT INTO auth.users (
                instance_id, id, aud, role, email, encrypted_password,
                email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', v_email,
                v_hashed_password, now(), '{"provider":"email","providers":["email"]}', '{}', 
                r.created_at, now()
            );

            -- ربط الحساب بجدول الهويات لتمكين تسجيل الدخول بالبريد والباسورد
            -- تمت إضافة العمود provider_id للتوافق الكامل مع إصدارات Supabase الحديثة
            INSERT INTO auth.identities (
                id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
            ) VALUES (
                r.id, r.id::text, r.id, jsonb_build_object('sub', r.id::text, 'email', v_email), 'email', NULL, r.created_at, now()
            );
        END IF;
    END LOOP;

    -- تصحيح القيم الفارغة (NULL) في أعمدة التوكن والتغيير لـ GoTrue Auth لتفادي خطأ الـ 500 عند تسجيل الدخول
    FOR r IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'auth' 
          AND table_name = 'users' 
          AND data_type IN ('character varying', 'text', 'character')
          AND is_nullable = 'YES'
          AND column_name NOT IN ('email', 'encrypted_password', 'phone', 'role', 'aud')
    LOOP
        EXECUTE format('UPDATE auth.users SET %I = COALESCE(%I, '''')', r.column_name, r.column_name);
    END LOOP;
END $$;

-- 3. تعديل جدول system_users ليتناسب مع هيكلية Supabase Auth
-- إضافة مفتاح خارجي يربط الجدول بـ auth.users وحذف عمود كلمة المرور بنص واضح
ALTER TABLE public.system_users 
ADD CONSTRAINT system_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.system_users 
DROP COLUMN IF EXISTS password;

-- 3.5. ربط جدول حركات المخزون (stock_movements) بجداول الطلبات وفواتير الوارد لتمكين العلاقات والاستعلامات
-- أولاً: إضافة الأعمدة في حال لم تكن موجودة
ALTER TABLE public.stock_movements 
ADD COLUMN IF NOT EXISTS order_id uuid;

ALTER TABLE public.stock_movements 
ADD COLUMN IF NOT EXISTS inbound_id uuid;

-- ثانياً: ربط الأعمدة بمفاتيح خارجية
ALTER TABLE public.stock_movements 
DROP CONSTRAINT IF EXISTS stock_movements_order_id_fkey;

ALTER TABLE public.stock_movements 
ADD CONSTRAINT stock_movements_order_id_fkey 
FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

ALTER TABLE public.stock_movements 
DROP CONSTRAINT IF EXISTS stock_movements_inbound_id_fkey;

ALTER TABLE public.stock_movements 
ADD CONSTRAINT stock_movements_inbound_id_fkey 
FOREIGN KEY (inbound_id) REFERENCES public.inbound_invoices(id) ON DELETE CASCADE;

-- 4. إنشاء دالة مساعدة لجلب دور المستخدم الحالي بصلاحيات الأمن (SECURITY DEFINER)
-- تم تعديل الدالة للتحقق من نشاط الحساب (is_active = true) لحظر الجلسة والوصول لقاعدة البيانات فوراً عند الإيقاف دون انتظار انتهاء توكن JWT
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text AS $$
DECLARE
    v_role text;
BEGIN
    SELECT role INTO v_role FROM public.system_users WHERE id = auth.uid() AND is_active = true;
    RETURN COALESCE(v_role, 'visitor');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. إنشاء الدوال الإدارية للتحكم بالحسابات بصلاحيات المشرف الكاملة (SECURITY DEFINER)
-- ملاحظة للبزنس: إذا رغبت بالسماح للمشرفين (admins) بإدارة الحسابات أيضاً،
-- يمكنك تغيير الشرط الداخلي في الدوال الثلاثة من role = 'owner' إلى role IN ('owner', 'admin')

-- الدالة الأولى: إنشاء عامل/موظف جديد
CREATE OR REPLACE FUNCTION public.admin_create_worker(
    p_full_name text,
    p_username text,
    p_password text,
    p_role text,
    p_worker_job text
)
RETURNS uuid AS $$
DECLARE
    v_user_id uuid;
    v_email text;
    v_hashed_password text;
BEGIN
    -- التحقق من صلاحية المنفذ (يجب أن يكون المنفذ مالكاً نشطاً)
    IF NOT EXISTS (
        SELECT 1 FROM public.system_users
        WHERE id = auth.uid() AND role = 'owner' AND is_active = true
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بإجراء هذه العملية. هذه الصلاحية للمالك فقط.';
    END IF;

    v_user_id := gen_random_uuid();
    v_email := lower(trim(p_username)) || '@staff.devo.internal';
    v_hashed_password := crypt(p_password, gen_salt('bf'));

    -- إنشاء الحساب في جدول auth.users الخاص بـ Supabase Auth
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
        created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', v_email,
        v_hashed_password, now(), '{"provider":"email","providers":["email"]}', '{}', 
        now(), now()
    );

    -- إنشاء الهوية مع إضافة provider_id للتوافق مع الإصدارات الحديثة
    INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_user_id, v_user_id::text, v_user_id, jsonb_build_object('sub', v_user_id::text, 'email', v_email), 'email', NULL, now(), now()
    );

    -- إنشاء الملف الشخصي للموظف في public.system_users
    INSERT INTO public.system_users (
        id, full_name, username, role, worker_job, is_active
    ) VALUES (
        v_user_id, p_full_name, lower(trim(p_username)), p_role, p_worker_job, true
    );

    -- تصحيح القيم الفارغة (NULL) في أعمدة التوكن لـ GoTrue Auth لتفادي خطأ الـ 500 للمستخدمين الجدد
    DECLARE
        r_col record;
    BEGIN
        FOR r_col IN 
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'auth' 
              AND table_name = 'users' 
              AND data_type IN ('character varying', 'text', 'character')
              AND is_nullable = 'YES'
              AND column_name NOT IN ('email', 'encrypted_password', 'phone', 'role', 'aud')
        LOOP
            EXECUTE format('UPDATE auth.users SET %I = '''' WHERE id = $1', r_col.column_name) USING v_user_id;
        END LOOP;
    END;

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- الدالة الثانية: تعديل بيانات موظف موجود
CREATE OR REPLACE FUNCTION public.admin_update_worker(
    p_user_id uuid,
    p_full_name text,
    p_username text,
    p_password text,
    p_role text,
    p_worker_job text,
    p_is_active boolean
)
RETURNS boolean AS $$
DECLARE
    v_email text;
    v_hashed_password text;
BEGIN
    -- التحقق من صلاحية المنفذ
    IF NOT EXISTS (
        SELECT 1 FROM public.system_users
        WHERE id = auth.uid() AND role = 'owner' AND is_active = true
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بإجراء هذه العملية. هذه الصلاحية للمالك فقط.';
    END IF;

    -- منع المالك من تعطيل نفسه أو تخفيض صلاحياته
    IF p_user_id = auth.uid() AND (p_role <> 'owner' OR NOT p_is_active) THEN
        RAISE EXCEPTION 'لا يمكنك تغيير صلاحيتك أو تعطيل حسابك الشخصي.';
    END IF;

    v_email := lower(trim(p_username)) || '@staff.devo.internal';

    -- تحديث جدول system_users
    UPDATE public.system_users SET
        full_name = p_full_name,
        username = lower(trim(p_username)),
        role = p_role,
        worker_job = p_worker_job,
        is_active = p_is_active
    WHERE id = p_user_id;

    -- تحديث جدول auth.users (وتعطيل الجلسة في حال الحظر عن طريق banned_until)
    UPDATE auth.users SET
        email = v_email,
        encrypted_password = COALESCE(CASE WHEN p_password IS NOT NULL AND p_password <> '' THEN crypt(p_password, gen_salt('bf')) ELSE encrypted_password END, encrypted_password),
        banned_until = CASE WHEN p_is_active THEN NULL ELSE '3000-01-01 00:00:00+00'::timestamptz END,
        updated_at = now()
    WHERE id = p_user_id;

    -- تحديث الهويات
    UPDATE auth.identities SET
        identity_data = jsonb_build_object('sub', p_user_id::text, 'email', v_email),
        updated_at = now()
    WHERE user_id = p_user_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- الدالة الثالثة: حذف حساب موظف نهائياً
CREATE OR REPLACE FUNCTION public.admin_delete_worker(
    p_user_id uuid
)
RETURNS boolean AS $$
BEGIN
    -- التحقق من صلاحية المنفذ
    IF NOT EXISTS (
        SELECT 1 FROM public.system_users
        WHERE id = auth.uid() AND role = 'owner' AND is_active = true
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بإجراء هذه العملية. هذه الصلاحية للمالك فقط.';
    END IF;

    -- منع المالك من حذف حسابه الشخصي
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'لا يمكنك حذف حسابك الشخصي.';
    END IF;

    -- منع حذف حسابات المالكين الآخرين من قبل أي مشرف
    IF EXISTS (SELECT 1 FROM public.system_users WHERE id = p_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'غير مسموح بحذف حساب مالك آخر.';
    END IF;

    -- الحذف من الجداول (سيقوم مفتاح الربط الخارجي بالحذف المتتالي CASCADE)
    DELETE FROM public.system_users WHERE id = p_user_id;
    DELETE FROM auth.users WHERE id = p_user_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.5. دالة تحرير قفل الأوردر (release_order_lock) وتوحيد صلاحيات عمال المعرض والمخزن
CREATE OR REPLACE FUNCTION public.release_order_lock(
    p_order_id uuid
)
RETURNS boolean AS $$
BEGIN
    -- مسموح بالأونر/الأدمن، أو صانع الأوردر/المُسند إليه، أو عمال المخزن (warehouse / both)
    IF NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND (
            public.get_my_role() IN ('owner', 'admin')
            OR o.assigned_worker_id = auth.uid()
            OR o.worker_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.system_users u
                WHERE u.id = auth.uid()
                AND u.is_active = true
                AND u.role = 'worker'
                AND u.worker_job IN ('warehouse', 'both')
            )
        )
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بتحرير قفل هذا الأوردر.';
    END IF;

    UPDATE public.orders
    SET is_locked = false,
        assigned_worker_id = NULL,
        assigned_admin_name = NULL,
        status = 'created'
    WHERE id = p_order_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- قيد حماية المخزون لمنع القيمة السالبة (حل خطأ 4)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_positive_available_series'
    ) THEN
        ALTER TABLE public.model_inventory 
        ADD CONSTRAINT chk_positive_available_series CHECK (available_series >= 0);
    END IF;
END $$;

-- 6. تفعيل صلاحيات SECURITY DEFINER لدوال التحضير والمبيعات وفواتير الوارد لتمكين الموظفين من إجراء الحركات المالية والمخزنية تحت مظلة RLS بشكل آمن
-- أولاً نقوم بحذف أي نسخ زائدة أو قديمة من الدوال لتفادي تعارض التحميل الزائد (Function Overloading Conflict)
DROP FUNCTION IF EXISTS public.process_order_transaction(jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS public.process_inbound_transaction(jsonb, jsonb, uuid);

ALTER FUNCTION public.init_order_preparation(uuid, uuid) SECURITY DEFINER;
ALTER FUNCTION public.finalize_order_preparation(uuid, uuid, text, text) SECURITY DEFINER;
ALTER FUNCTION public.delete_order_safely(uuid) SECURITY DEFINER;
ALTER FUNCTION public.process_order_transaction(uuid, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.process_inbound_transaction(uuid, jsonb, jsonb) SECURITY DEFINER;

-- 7. تفعيل نظام حماية صفوف قاعدة البيانات (RLS) وتطبيق السياسات على كافة جداول النظام بلا استثناء

-- ==========================================
-- أ) جدول الموظفين (system_users)
-- ==========================================
ALTER TABLE public.system_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_users_select" ON public.system_users
    FOR SELECT TO authenticated
    USING (
        id = auth.uid() 
        OR public.get_my_role() IN ('owner', 'admin')
    );

-- ==========================================
-- ب) جدول الطلبات وتفاصيلها (orders & order_items)
-- ==========================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select" ON public.orders
    FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND (worker_id = auth.uid() OR assigned_worker_id = auth.uid()))
    );

CREATE POLICY "orders_all_for_owner_admin" ON public.orders
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_items_select" ON public.order_items
    FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_items.order_id
            AND (orders.worker_id = auth.uid() OR orders.assigned_worker_id = auth.uid())
        )
    );

CREATE POLICY "order_items_all_for_owner_admin" ON public.order_items
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- ==========================================
-- ج) جدول فواتير الوارد وتفاصيلها (inbound_invoices & inbound_invoice_items)
-- ==========================================
ALTER TABLE public.inbound_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inbound_invoices_select" ON public.inbound_invoices
    FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        ))
    );

CREATE POLICY "inbound_invoice_items_select" ON public.inbound_invoice_items
    FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        ))
    );

CREATE POLICY "inbound_invoices_write_admin" ON public.inbound_invoices
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

CREATE POLICY "inbound_invoice_items_write_admin" ON public.inbound_invoice_items
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- ==========================================
-- د) جداول كتالوج الموديلات (models, colors, sizes, classes, class_sizes, categories, model_sizes, model_images)
-- مسموح بالقراءة العامة والزوار لعرض الكتالوج بالصفحة الرئيسية وتعديلها للإدارة فقط
-- ==========================================
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "models_select_public" ON public.models FOR SELECT USING (true);
CREATE POLICY "colors_select_public" ON public.colors FOR SELECT USING (true);
CREATE POLICY "sizes_select_public" ON public.sizes FOR SELECT USING (true);
CREATE POLICY "classes_select_public" ON public.classes FOR SELECT USING (true);
CREATE POLICY "class_sizes_select_public" ON public.class_sizes FOR SELECT USING (true);
CREATE POLICY "categories_select_public" ON public.categories FOR SELECT USING (true);
CREATE POLICY "model_sizes_select_public" ON public.model_sizes FOR SELECT USING (true);
CREATE POLICY "model_images_select_public" ON public.model_images FOR SELECT USING (true);

CREATE POLICY "models_write_admin" ON public.models FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
CREATE POLICY "colors_write_admin" ON public.colors FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
CREATE POLICY "sizes_write_admin" ON public.sizes FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
CREATE POLICY "classes_write_admin" ON public.classes FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
CREATE POLICY "class_sizes_write_admin" ON public.class_sizes FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
CREATE POLICY "categories_write_admin" ON public.categories FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
CREATE POLICY "model_sizes_write_admin" ON public.model_sizes FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
CREATE POLICY "model_images_write_admin" ON public.model_images FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- ==========================================
-- هـ) جدول المخزون وحركات المستودع (model_inventory & stock_movements)
-- ==========================================
ALTER TABLE public.model_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- مسموح لجميع الزوار والموظفين بقراءة بيانات ألوان المخزون لعرض الكتالوج والألوان بشكل سليم
CREATE POLICY "model_inventory_select" ON public.model_inventory
    FOR SELECT USING (true);

-- السماح للإدارة والمالك بتحديث وإضافة المخزون يدوياً أو عند التوريد
CREATE POLICY "model_inventory_write_admin" ON public.model_inventory
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

CREATE POLICY "stock_movements_select" ON public.stock_movements
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin', 'worker'));

-- السماح للإدارة والمالك بتسجيل حركات الجرد يدوياً أو عند توريد الرسائل
CREATE POLICY "stock_movements_write_admin" ON public.stock_movements
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- ==========================================
-- و) جدول تحضير الطلبات في المستودع (order_item_preparation)
-- ==========================================
ALTER TABLE public.order_item_preparation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_item_preparation_select" ON public.order_item_preparation
    FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        ))
    );

CREATE POLICY "order_item_preparation_write" ON public.order_item_preparation
    FOR ALL TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        ))
    )
    WITH CHECK (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        ))
    );

-- ==========================================
-- ز) سجلات الأوردرات والتنبيهات والإعدادات (order_logs, system_notifications, home_settings)
-- ==========================================
ALTER TABLE public.order_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_logs_select" ON public.order_logs
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'));

CREATE POLICY "order_logs_write" ON public.order_logs
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- السماح للموظفين بإدراج سجلات الحركات الخاصة بهم عند إنشاء أو تعديل الطلبات من السلة
CREATE POLICY "order_logs_insert_worker" ON public.order_logs
    FOR INSERT TO authenticated
    WITH CHECK (
        public.get_my_role() = 'worker' 
        AND user_id = auth.uid()
    );

CREATE POLICY "home_settings_all" ON public.home_settings
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- السماح للجميع (زوار وموظفين) بقراءة إعدادات الواجهة والمظهر
CREATE POLICY "home_settings_select_public" ON public.home_settings
    FOR SELECT USING (true);

CREATE POLICY "system_notifications_select" ON public.system_notifications
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR user_id IS NULL
        OR public.get_my_role() IN ('owner', 'admin')
    );

CREATE POLICY "system_notifications_write" ON public.system_notifications
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- ==========================================
-- ح) جدول الكروت الترويجية وقوائم الجرد (promo_cards, inventory_audits, inventory_audit_items)
-- ==========================================
ALTER TABLE public.promo_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_audit_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promo_cards_select_public" ON public.promo_cards FOR SELECT USING (true);
CREATE POLICY "promo_cards_write_admin" ON public.promo_cards FOR ALL TO authenticated USING (public.get_my_role() IN ('owner', 'admin')) WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

CREATE POLICY "inventory_audits_select" ON public.inventory_audits
    FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        ))
    );

CREATE POLICY "inventory_audit_items_select" ON public.inventory_audit_items
    FOR SELECT TO authenticated
    USING (
        public.get_my_role() IN ('owner', 'admin')
        OR (public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        ))
    );

CREATE POLICY "inventory_audits_write_admin" ON public.inventory_audits
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- السماح لعمال المخزن بتحديث حالة جلسة الجرد وتقديمها
CREATE POLICY "inventory_audits_update_worker" ON public.inventory_audits
    FOR UPDATE TO authenticated
    USING (
        public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        )
    )
    WITH CHECK (
        public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        )
    );

CREATE POLICY "inventory_audit_items_write_admin" ON public.inventory_audit_items
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

-- السماح لعمال المخزن بتعديل وحفظ الكميات الفعلية لقطع الجرد
CREATE POLICY "inventory_audit_items_update_worker" ON public.inventory_audit_items
    FOR UPDATE TO authenticated
    USING (
        public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        )
    )
    WITH CHECK (
        public.get_my_role() = 'worker' AND EXISTS (
            SELECT 1 FROM public.system_users 
            WHERE id = auth.uid() AND worker_job IN ('warehouse', 'both')
        )
    );

-- ==========================================
-- ط) جدول المظاهر والثيمات (themes)
-- ==========================================
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "themes_select_public" ON public.themes 
    FOR SELECT USING (true);

CREATE POLICY "themes_write_owner" ON public.themes 
    FOR ALL TO authenticated 
    USING (public.get_my_role() = 'owner') 
    WITH CHECK (public.get_my_role() = 'owner');
