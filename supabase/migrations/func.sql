
BEGIN
    -- التحقق من الصلاحيات: مسموح للأونر/الأدمن، أو صانع الأوردر، أو المسند إليه
    IF NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND (
            public.get_my_role() IN ('owner', 'admin')
            OR o.assigned_worker_id = auth.uid()
            OR o.worker_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بتعديل أو قفل هذا الأوردر.';
    END IF;

    -- التحقق مما إذا كان الأوردر مقفولاً بالفعل بواسطة إداري/موظف آخر
    IF EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND o.is_locked = true
        AND o.assigned_admin_name IS DISTINCT FROM p_assigned_admin_name
        AND public.get_my_role() NOT IN ('owner') -- المالك يستطيع كسر القفل
    ) THEN
        RAISE EXCEPTION 'عفواً، هذا الأوردر مقفول حالياً بواسطة مستخدم آخر.';
    END IF;

    -- تحديث حالة وقفل الأوردر
    UPDATE public.orders
    SET is_locked = true,
        assigned_admin_name = p_assigned_admin_name,
        status = 'editing'
    WHERE id = p_order_id;

    RETURN true;
END;

//////////////////

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



///////////////////

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



///////////////

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



//////////////////////

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



//////////////////////






  SELECT
    -- يجب أن تكون كل العناصر محضَّرة
    NOT EXISTS (
      SELECT 1
      FROM public.order_item_preparation
      WHERE order_id  = p_order_id
        AND is_prepared = false
    )
    -- ويجب أن يوجد عناصر أصلاً (لم يُهيَّأ الأوردر بعد = لا يُعتبر جاهزاً)
    AND EXISTS (
      SELECT 1
      FROM public.order_item_preparation
      WHERE order_id = p_order_id
    );







//////////////////////





DECLARE
    v_audit_number text;
    v_status text;
    v_item record;
    v_diff integer;
BEGIN
    SELECT audit_number, status INTO v_audit_number, v_status
    FROM public.inventory_audits WHERE id = p_audit_id;
    
    IF v_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'جلسة الجرد غير موجودة');
    END IF;
    
    IF v_status <> 'submitted' THEN
        RETURN jsonb_build_object('success', false, 'error', 'جلسة الجرد ليست في حالة انتظار المراجعة');
    END IF;
    
    FOR v_item IN SELECT * FROM public.inventory_audit_items WHERE audit_id = p_audit_id
    LOOP
        v_diff := v_item.difference;
        
        IF v_diff <> 0 THEN
            -- تحديث المخزون الفعلي
            UPDATE public.model_inventory
            SET available_series = v_item.counted_qty
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id;
            
            -- تسجيل حركة مخزنية بالفارق
            INSERT INTO public.stock_movements (
                model_id, color_id, movement_type, quantity, reference
            ) VALUES (
                v_item.model_id,
                v_item.color_id,
                CASE WHEN v_diff > 0 THEN 'in' ELSE 'out' END,
                ABS(v_diff),
                'تسوية جرد دوري: ' || v_audit_number
            );
        END IF;
    END LOOP;
    
    -- تحديث حالة الجلسة إلى معتمدة
    UPDATE public.inventory_audits
    SET
        status = 'confirmed',
        reviewed_by = p_admin_id,
        reviewed_at = now(),
        review_notes = p_notes
    WHERE id = p_audit_id;
    
    RETURN jsonb_build_object('success', true);
END;







//////////////////////





DECLARE
    v_audit_id uuid;
    v_audit_number text;
    v_model_id uuid;
    v_inv record;
BEGIN
    v_audit_number := 'AUD-' || nextval('public.audit_number_seq')::text;
    
    INSERT INTO public.inventory_audits (
        audit_number, created_by, status, notes
    ) VALUES (
        v_audit_number, p_admin_id, 'draft', p_notes
    ) RETURNING id INTO v_audit_id;
    
    FOREACH v_model_id IN ARRAY p_model_ids
    LOOP
        FOR v_inv IN SELECT color_id, available_series FROM public.model_inventory WHERE model_id = v_model_id
        LOOP
            INSERT INTO public.inventory_audit_items (
                audit_id, model_id, color_id, system_qty, counted_qty, difference
            ) VALUES (
                v_audit_id,
                v_model_id,
                v_inv.color_id,
                v_inv.available_series,
                0,
                -v_inv.available_series
            );
        END LOOP;
    END LOOP;
    
    RETURN jsonb_build_object('success', true, 'audit_id', v_audit_id, 'audit_number', v_audit_number);
END;








//////////////////////




DECLARE
    v_item record;
    v_invoice_number text;
    v_current_stock int;
    v_model_name text;
    v_color_name text;
BEGIN
    SELECT invoice_number INTO v_invoice_number FROM public.inbound_invoices WHERE id = p_invoice_id;
    IF v_invoice_number IS NULL THEN
        RAISE EXCEPTION 'فاتورة الدخل غير موجودة.';
    END IF;

    -- أ) خصم الكميات من رصيد المخزن مؤقتاً وتسجيل الحركات
    FOR v_item IN SELECT * FROM public.inbound_invoice_items WHERE inbound_invoice_id = p_invoice_id LOOP
        UPDATE public.model_inventory
        SET available_series = available_series - v_item.quantity
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_item.model_id, v_item.color_id, 'out', v_item.quantity, 'حذف فاتورة دخل: ' || v_invoice_number);
    END LOOP;

    -- ب) التحقق من أن الخصم لم يتسبب في رصيد مخزن سالب
    FOR v_item IN SELECT * FROM public.inbound_invoice_items WHERE inbound_invoice_id = p_invoice_id LOOP
        SELECT available_series INTO v_current_stock FROM public.model_inventory
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        IF v_current_stock < 0 THEN
            SELECT name INTO v_model_name FROM public.models WHERE id = v_item.model_id;
            SELECT name INTO v_color_name FROM public.colors WHERE id = v_item.color_id;

            RAISE EXCEPTION 'لا يمكن حذف الفاتورة (%) لأن الموديل (%) لون (%) تم بيع أجزاء منه وسيتسبب الحذف في رصيد سالب للكمية بالمخزن (%).', 
                v_invoice_number,
                COALESCE(v_model_name, 'غير معروف'), 
                COALESCE(v_color_name, 'غير معروف'), 
                v_current_stock;
        END IF;
    END LOOP;

    -- ج) الحذف الفعلي للفاتورة وعناصرها (الاعتماد على cascade delete)
    DELETE FROM public.inbound_invoices WHERE id = p_invoice_id;

    RETURN true;
END;







//////////////////////





DECLARE
    v_item record;
    v_invoice text;
BEGIN
    -- جلب رقم الفاتورة للتوثيق في سجل الحركة
    SELECT invoice_number INTO v_invoice FROM public.orders WHERE id = p_order_id;

    -- 1. إرجاع الكميات للمخزن وتسجيل الحركة
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
        -- التأكد من وجود صف المخزون أولاً
        INSERT INTO public.model_inventory (model_id, color_id, available_series)
        VALUES (v_item.model_id, v_item.color_id, 0)
        ON CONFLICT (model_id, color_id) DO NOTHING;

        -- إعادة الكمية المسحوبة إلى المخزون
        UPDATE public.model_inventory
        SET available_series = available_series + v_item.quantity
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        -- تسجيل الحركة بالسجل
        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_item.model_id, v_item.color_id, 'in', v_item.quantity, 'حذف أوردر من الإدارة: ' || COALESCE(v_invoice, ''));
    END LOOP;

    -- 2. حذف العناصر والأوردر
    DELETE FROM public.order_items WHERE order_id = p_order_id;
    DELETE FROM public.orders WHERE id = p_order_id;

    RETURN true;
END;




//////////////////////








DECLARE
  v_can_complete boolean;
  v_old_status   text;
BEGIN
  SELECT preparation_status INTO v_old_status
  FROM public.orders WHERE id = p_order_id;

  -- إذا كانت الحالة المطلوبة prepared أو shipped,
  -- تحقق أن جميع العناصر محضَّرة
  IF p_new_status IN ('prepared', 'shipped') THEN
    SELECT public.can_mark_order_prepared(p_order_id) INTO v_can_complete;
    IF NOT v_can_complete THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'لا يمكن إتمام الأوردر: يوجد عناصر لم يتم تحضيرها بعد'
      );
    END IF;
  END IF;

  -- تحديث الأوردر
  UPDATE public.orders
  SET
    preparation_status       = p_new_status,
    preparation_notes        = COALESCE(p_note, preparation_notes),
    preparation_completed_at = CASE
                                 WHEN p_new_status IN ('prepared', 'shipped')
                                 THEN now()
                                 ELSE preparation_completed_at
                               END
  WHERE id = p_order_id;

  -- تسجيل في سجل التاريخ
  INSERT INTO public.preparation_status_log
    (order_id, changed_by, old_status, new_status, note)
  VALUES
    (p_order_id, p_worker_id, v_old_status, p_new_status, p_note);

  RETURN jsonb_build_object('success', true, 'new_status', p_new_status);
END;






//////////////////////





  SELECT
    COUNT(*)::integer                                              AS total_items,
    COUNT(*) FILTER (WHERE is_prepared = true)::integer           AS prepared_items,
    COUNT(*) FILTER (WHERE has_issue   = true)::integer           AS issue_items,
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
             COUNT(*) FILTER (WHERE is_prepared = true)::numeric
             / COUNT(*)::numeric * 100,
             1
           )
    END                                                           AS progress_pct
  FROM public.order_item_preparation
  WHERE order_id = p_order_id;






//////////////////////















//////////////////////







//////////////////////
