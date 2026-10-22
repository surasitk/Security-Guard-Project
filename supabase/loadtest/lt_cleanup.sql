-- LOADTEST 600 — ลบข้อมูลทดสอบทั้งหมด (เฉพาะบริษัท LOADTEST-600)
set statement_timeout = '10min';  -- ลบ ~170k แถวใช้เวลาเกิน 2 นาที (patrol_scans ไม่มี index ที่ assignment_id/user_id)
do $$
declare v_t uuid := (select id from tenants where name = 'LOADTEST-600 (ลบได้)');
begin
  if v_t is not null then
    delete from broadcasts where tenant_id = v_t;
    delete from line_notifications where tenant_id = v_t;
    delete from incidents where tenant_id = v_t;
    delete from patrol_scans where tenant_id = v_t;
    delete from attendance where tenant_id = v_t;
    delete from devices where tenant_id = v_t;
    delete from shift_assignments where tenant_id = v_t;
    delete from shift_templates where tenant_id = v_t;
    delete from units where tenant_id = v_t;
    delete from checkpoints where tenant_id = v_t;
    delete from property_managers where tenant_id = v_t;
    delete from tenant_holidays where tenant_id = v_t;
    delete from audit_logs where tenant_id = v_t;
    update properties set client_user_id = null where tenant_id = v_t;
    delete from properties where tenant_id = v_t;
    delete from users where tenant_id = v_t;
    delete from tenants where id = v_t;
  end if;
end $$;
drop view if exists public.lt_summary;
drop function if exists public.lt_guard_day(int, int);
drop function if exists public.lt_admin_day(int);
drop function if exists public.lt_calendar(text);
drop table if exists public.lt_results;
select count(*) as loadtest_tenants_left from tenants where name = 'LOADTEST-600 (ลบได้)';
