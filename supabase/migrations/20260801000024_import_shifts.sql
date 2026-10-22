-- Horguard — Migration 24: นำเข้าตารางกะจากไฟล์ Excel (หน้า "ตารางกะ")
-- รันหลัง migration 23 · รันซ้ำได้
--
-- import_shifts(p_data, p_commit)
--   p_data = { templates:   [{row, property_code, name, start, end, headcount, days:[0..6]}],
--              assignments: [{row, employee_code, property_code, template_name, date_from, date_to}] }
--   p_commit = false → ตรวจทุกแถวอย่างเดียว ไม่บันทึก (ใช้แสดงสรุปก่อนกดนำเข้า)
--   p_commit = true  → ตรวจซ้ำ แล้วบันทึกเฉพาะแถวที่ไม่มี error
-- ผลลัพธ์รายแถว: status ok | warn | error · errors[] · warnings[] · จำนวนกะที่จะสร้าง/ซ้อน/วันหยุด
-- สิทธิ์: เจ้าของ/แอดมินของ Vendor (เหมือน generate_assignments)

create or replace function import_shifts(p_data jsonb, p_commit boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tid   uuid := auth_tenant_id();
  v_pa    boolean := is_platform_admin();
  r       jsonb;
  v_out_t jsonb := '[]'::jsonb;
  v_out_a jsonb := '[]'::jsonb;
  v_err   text[]; v_warn text[];
  v_prop  properties%rowtype;
  v_user  users%rowtype;
  v_tpl   shift_templates%rowtype;
  v_start time; v_end time; v_cross boolean; v_head integer; v_days integer[];
  v_from  date; v_to date; v_day date;
  v_s timestamptz; v_e timestamptz;
  v_n int; v_olap int; v_hol int; v_hday boolean;
  v_tpl_created int := 0; v_tpl_reused int := 0; v_shift_created int := 0; v_shift_skipped int := 0;
  v_rows_ok int := 0; v_rows_err int := 0; v_total_shifts int := 0;
  v_tpl_id uuid; v_cnt int;
begin
  if not is_tenant_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- แม่แบบในไฟล์ (ทั้งที่ผ่านและไม่ผ่าน) — ให้แถวจ่ายกะอ้างถึงได้
  create temp table if not exists _imp_tpl (row_no int, property_id uuid, name text, start_time time, end_time time,
    crosses boolean, headcount int, days integer[], ok boolean, template_id uuid) on commit drop;
  create temp table if not exists _imp_iv (user_id uuid, r tstzrange) on commit drop;
  truncate _imp_tpl; truncate _imp_iv;

  -- ============ 1) แม่แบบกะ ============
  for r in select * from jsonb_array_elements(coalesce(p_data->'templates', '[]'::jsonb)) loop
    v_err := '{}'; v_warn := '{}'; v_prop := null; v_tpl_id := null;
    select * into v_prop from properties where tenant_id = v_tid and code = nullif(trim(r->>'property_code'), '') and is_active;
    if r->>'property_code' is null or trim(r->>'property_code') = '' then v_err := v_err || ('ไม่ได้ใส่รหัสโครงการ')::text;
    elsif v_prop.id is null then v_err := v_err || (format('ไม่พบโครงการรหัส "%s"', r->>'property_code'))::text;
    elsif v_prop.is_test and not v_pa then v_err := v_err || ('โครงการทดสอบ แก้ได้เฉพาะ Super Admin')::text;
    end if;
    if coalesce(trim(r->>'name'), '') = '' then v_err := v_err || ('ไม่ได้ใส่ชื่อกะ')::text; end if;
    begin v_start := (r->>'start')::time; exception when others then v_start := null; end;
    begin v_end := (r->>'end')::time; exception when others then v_end := null; end;
    if v_start is null then v_err := v_err || ('เวลาเริ่มไม่ถูกต้อง (ใช้รูปแบบ 07:00)')::text; end if;
    if v_end is null then v_err := v_err || ('เวลาเลิกไม่ถูกต้อง (ใช้รูปแบบ 19:00)')::text; end if;
    if v_start is not null and v_end is not null and v_start = v_end then v_err := v_err || ('เวลาเริ่มกับเวลาเลิกเท่ากัน')::text; end if;
    v_cross := v_start is not null and v_end is not null and v_end <= v_start;
    begin v_head := coalesce(nullif(r->>'headcount', '')::int, 1); exception when others then v_head := null; end;
    if v_head is null or v_head < 1 or v_head > 50 then v_err := v_err || ('จำนวนคนต้องเป็นตัวเลข 1–50')::text; v_head := 1; end if;
    select array_agg(distinct d::int order by d::int) into v_days from jsonb_array_elements_text(coalesce(r->'days', '[]'::jsonb)) d;
    if v_days is null or cardinality(v_days) = 0 then v_err := v_err || ('วันที่มีกะไม่ถูกต้อง (เช่น ทุกวัน หรือ จ,อ,พ,พฤ,ศ)')::text;
    elsif exists (select 1 from unnest(v_days) x where x < 0 or x > 6) then v_err := v_err || ('วันที่มีกะไม่ถูกต้อง')::text;
    end if;
    if exists (select 1 from _imp_tpl t where t.property_id = v_prop.id and t.name = trim(r->>'name')
               and t.start_time = v_start and t.end_time = v_end) then
      v_err := v_err || ('แถวซ้ำกับแถวก่อนหน้าในไฟล์')::text;
    end if;

    if cardinality(v_err) = 0 then
      select id into v_tpl_id from shift_templates
      where tenant_id = v_tid and property_id = v_prop.id and is_active and name = trim(r->>'name')
        and start_time = v_start and end_time = v_end limit 1;
      if v_tpl_id is not null then v_warn := v_warn || ('มีแม่แบบนี้อยู่แล้ว — ใช้ของเดิม ไม่สร้างซ้ำ')::text; end if;
      if v_prop.shift_mode = 'open' then v_warn := v_warn || ('โครงการไม่จัดกะ: แม่แบบนี้เป็นช่วงกะให้ยามกดเข้างานเอง')::text; end if;
      if p_commit then
        if v_tpl_id is null then
          insert into shift_templates (tenant_id, property_id, name, start_time, end_time, crosses_midnight, days_of_week, headcount)
          values (v_tid, v_prop.id, trim(r->>'name'), v_start, v_end, v_cross, v_days, v_head) returning id into v_tpl_id;
          v_tpl_created := v_tpl_created + 1;
        else v_tpl_reused := v_tpl_reused + 1;
        end if;
      end if;
    end if;

    insert into _imp_tpl values ((r->>'row')::int, v_prop.id, trim(r->>'name'), v_start, v_end, v_cross, v_head, v_days,
                                 cardinality(v_err) = 0, v_tpl_id);
    if cardinality(v_err) = 0 then v_rows_ok := v_rows_ok + 1; else v_rows_err := v_rows_err + 1; end if;
    v_out_t := v_out_t || jsonb_build_object('row', r->'row',
      'status', case when cardinality(v_err) > 0 then 'error' when cardinality(v_warn) > 0 then 'warn' else 'ok' end,
      'errors', to_jsonb(v_err), 'warnings', to_jsonb(v_warn),
      'action', case when cardinality(v_err) > 0 then null when v_tpl_id is not null and not p_commit then 'exists' else 'create' end,
      'property_name', v_prop.name, 'crosses_midnight', v_cross);
  end loop;

  -- ============ 2) จ่ายกะ ============
  for r in select * from jsonb_array_elements(coalesce(p_data->'assignments', '[]'::jsonb)) loop
    v_err := '{}'; v_warn := '{}'; v_prop := null; v_user := null; v_tpl := null;
    v_n := 0; v_olap := 0; v_hol := 0;
    select * into v_user from users where tenant_id = v_tid and employee_code = nullif(trim(r->>'employee_code'), '');
    select * into v_prop from properties where tenant_id = v_tid and code = nullif(trim(r->>'property_code'), '') and is_active;
    if coalesce(trim(r->>'employee_code'), '') = '' then v_err := v_err || ('ไม่ได้ใส่รหัสพนักงาน')::text;
    elsif v_user.id is null then v_err := v_err || (format('ไม่พบพนักงานรหัส "%s"', r->>'employee_code'))::text;
    elsif not v_user.is_active then v_err := v_err || ('พนักงานคนนี้ถูกปิดใช้งาน')::text;
    elsif v_user.role in ('owner', 'admin', 'client') then v_err := v_err || ('บทบาทนี้จ่ายกะไม่ได้ (เจ้าของ/แอดมิน/ลูกค้า)')::text;
    end if;
    if coalesce(trim(r->>'property_code'), '') = '' then v_err := v_err || ('ไม่ได้ใส่รหัสโครงการ')::text;
    elsif v_prop.id is null then v_err := v_err || (format('ไม่พบโครงการรหัส "%s"', r->>'property_code'))::text;
    elsif v_prop.shift_mode = 'open' then v_err := v_err || ('โครงการไม่จัดกะ — ยามกดเข้างานเองตามช่วงกะ ไม่ต้องจ่ายกะ')::text;
    end if;
    if v_prop.id is not null and v_user.id is not null then
      if v_prop.is_test and not exists (select 1 from platform_admins where user_id = v_user.id) then
        v_err := v_err || ('โครงการทดสอบจ่ายกะได้เฉพาะ Super Admin')::text;
      elsif not v_prop.is_test and exists (select 1 from platform_admins where user_id = v_user.id) then
        v_err := v_err || ('Super Admin เป็นยามได้เฉพาะในโครงการทดสอบ')::text;
      end if;
    end if;

    -- แม่แบบ: ของเดิมในระบบ หรือแถวใหม่ในชีต "แม่แบบกะ"
    if coalesce(trim(r->>'template_name'), '') = '' then v_err := v_err || ('ไม่ได้ใส่ชื่อกะ')::text;
    elsif v_prop.id is not null then
      select (select count(*) from shift_templates where tenant_id = v_tid and property_id = v_prop.id and is_active and name = trim(r->>'template_name'))
           + (select count(*) from _imp_tpl t where t.property_id = v_prop.id and t.name = trim(r->>'template_name') and t.template_id is null)
        into v_cnt;
      if v_cnt = 0 then v_err := v_err || (format('ไม่พบกะชื่อ "%s" ในโครงการนี้', r->>'template_name'))::text;
      elsif v_cnt > 1 then v_err := v_err || (format('มีกะชื่อ "%s" หลายเวลาในโครงการนี้ — ตั้งชื่อกะให้ไม่ซ้ำ', r->>'template_name'))::text;
      else
        select * into v_tpl from shift_templates where tenant_id = v_tid and property_id = v_prop.id and is_active and name = trim(r->>'template_name') limit 1;
        if v_tpl.id is null then
          select t.template_id, t.start_time, t.end_time, t.crosses, t.days, t.ok into v_tpl.id, v_tpl.start_time, v_tpl.end_time, v_tpl.crosses_midnight, v_tpl.days_of_week, v_hday
          from _imp_tpl t where t.property_id = v_prop.id and t.name = trim(r->>'template_name') limit 1;
          if not v_hday then v_err := v_err || ('แม่แบบกะนี้ในชีต "แม่แบบกะ" มี error')::text; end if;
        end if;
      end if;
    end if;

    begin v_from := (r->>'date_from')::date; exception when others then v_from := null; end;
    begin v_to := coalesce(nullif(r->>'date_to', ''), r->>'date_from')::date; exception when others then v_to := null; end;
    if v_from is null then v_err := v_err || ('วันที่เริ่มไม่ถูกต้อง (ใช้รูปแบบ 2026-11-01 หรือ 01/11/2026)')::text; end if;
    if v_to is null then v_err := v_err || ('วันที่สิ้นสุดไม่ถูกต้อง')::text; end if;
    if v_from is not null and v_to is not null then
      if v_to < v_from then v_err := v_err || ('วันที่สิ้นสุดก่อนวันที่เริ่ม')::text;
      elsif v_to - v_from > 92 then v_err := v_err || ('ช่วงวันที่ยาวเกิน 93 วันต่อแถว')::text;
      elsif v_to < (now() at time zone 'Asia/Bangkok')::date then v_err := v_err || ('ช่วงวันที่อยู่ในอดีตทั้งหมด')::text;
      elsif v_from < (now() at time zone 'Asia/Bangkok')::date then v_warn := v_warn || ('มีวันที่ผ่านไปแล้ว — ข้ามวันที่ผ่านไป')::text;
      end if;
    end if;

    -- นับกะ / กะซ้อน / วันหยุด
    if cardinality(v_err) = 0 then
      if v_user.role not in ('guard', 'shift_leader') then v_warn := v_warn || ('บทบาทไม่ใช่ รปภ./หัวหน้ากะ — ตรวจว่าตั้งใจจ่ายกะให้คนนี้')::text; end if;
      if not v_prop.is_test and not exists (select 1 from property_managers where user_id = v_user.id and property_id = v_prop.id) then
        v_warn := v_warn || ('พนักงานยังไม่ได้ผูกกับโครงการนี้ (เห็นกะในแอปได้ แต่ส่งไปแทน/ประกาศไม่ถึง)')::text;
      end if;
      v_day := greatest(v_from, (now() at time zone 'Asia/Bangkok')::date);
      while v_day <= v_to loop
        if extract(dow from v_day)::int = any(v_tpl.days_of_week) then
          v_s := (v_day || ' ' || v_tpl.start_time)::timestamp at time zone 'Asia/Bangkok';
          v_e := (case when v_tpl.crosses_midnight then v_day + 1 else v_day end || ' ' || v_tpl.end_time)::timestamp at time zone 'Asia/Bangkok';
          if exists (select 1 from shift_assignments sa where sa.user_id = v_user.id and sa.status <> 'cancelled'
                     and tstzrange(sa.starts_at, sa.ends_at) && tstzrange(v_s, v_e))
             or exists (select 1 from _imp_iv i where i.user_id = v_user.id and i.r && tstzrange(v_s, v_e)) then
            v_olap := v_olap + 1;
          else
            v_hday := exists (select 1 from tenant_holidays where tenant_id = v_tid and holiday_date = v_day)
                      or extract(dow from v_day)::int = any(coalesce(v_user.weekly_days_off, '{}'));
            if v_hday then v_hol := v_hol + 1; end if;
            v_n := v_n + 1;
            insert into _imp_iv values (v_user.id, tstzrange(v_s, v_e));
            if p_commit then
              begin
                insert into shift_assignments (tenant_id, property_id, user_id, template_id, starts_at, ends_at, is_holiday_work, created_by)
                values (v_tid, v_prop.id, v_user.id, v_tpl.id, v_s, v_e, v_hday, auth_user_id());
                v_shift_created := v_shift_created + 1;
              exception when exclusion_violation then v_shift_skipped := v_shift_skipped + 1;
              end;
            end if;
          end if;
        end if;
        v_day := v_day + 1;
      end loop;
      if v_n = 0 then v_err := v_err || ('ไม่มีวันไหนตรงกับวันที่มีกะของแม่แบบนี้ (หรือซ้อนกับกะเดิมทั้งหมด)')::text; end if;
      if v_olap > 0 then v_warn := v_warn || (format('ซ้อนกับกะเดิมของคนนี้ %s กะ — ข้ามกะที่ซ้อน', v_olap))::text; end if;
    end if;

    if cardinality(v_err) = 0 then v_rows_ok := v_rows_ok + 1; v_total_shifts := v_total_shifts + v_n;
    else v_rows_err := v_rows_err + 1; end if;
    v_out_a := v_out_a || jsonb_build_object('row', r->'row',
      'status', case when cardinality(v_err) > 0 then 'error' when cardinality(v_warn) > 0 then 'warn' else 'ok' end,
      'errors', to_jsonb(v_err), 'warnings', to_jsonb(v_warn),
      'user_name', v_user.full_name, 'property_name', v_prop.name,
      'shifts', case when cardinality(v_err) > 0 then 0 else v_n end, 'overlap', v_olap, 'holiday', v_hol,
      'time', case when v_tpl.start_time is null then null else to_char(v_tpl.start_time, 'HH24:MI') || '–' || to_char(v_tpl.end_time, 'HH24:MI') end);
  end loop;

  if p_commit then
    insert into audit_logs (tenant_id, actor_user_id, action, target_table, after)
    values (v_tid, auth_user_id(), 'import_shifts', 'shift_assignments',
            jsonb_build_object('templates_created', v_tpl_created, 'templates_reused', v_tpl_reused,
                               'shifts_created', v_shift_created, 'shifts_skipped', v_shift_skipped,
                               'rows_ok', v_rows_ok, 'rows_error', v_rows_err));
  end if;

  return jsonb_build_object('ok', true, 'committed', p_commit,
    'templates', v_out_t, 'assignments', v_out_a,
    'summary', jsonb_build_object('rows_ok', v_rows_ok, 'rows_error', v_rows_err,
      'shifts', v_total_shifts, 'templates_new', (select count(*) from _imp_tpl where ok and template_id is null),
      'templates_created', v_tpl_created, 'templates_reused', v_tpl_reused,
      'shifts_created', v_shift_created, 'shifts_skipped', v_shift_skipped));
end $$;

revoke execute on function import_shifts(jsonb, boolean) from anon, public;
grant execute on function import_shifts(jsonb, boolean) to authenticated;
