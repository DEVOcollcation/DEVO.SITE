-- ==============================================================================
-- Migration v14: عزل وتخصيص معرّف جروب النسخ الاحتياطي في تيليجرام
-- ==============================================================================

-- إدراج أو تحديث مفتاح telegram_backup_chat_id في جدول home_settings
INSERT INTO public.home_settings (setting_key, setting_value)
VALUES ('telegram_backup_chat_id', '-5367921849')
ON CONFLICT (setting_key) 
DO UPDATE SET setting_value = EXCLUDED.setting_value
WHERE public.home_settings.setting_value IS NULL OR public.home_settings.setting_value = '';
