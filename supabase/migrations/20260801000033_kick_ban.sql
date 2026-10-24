-- Guard OS / Horguard — Migration 33: ดีดออกจากระบบ (Kick) + แบนชั่วคราว (Ban)
-- (24 ต.ค. 2569 · ตามคำขอคุณเต๋) · รันหลัง migration 32 · รันซ้ำได้
-- · Kick: ตัด session ทุกเครื่องทันที (บัญชียังใช้ได้) → ผู้ใช้ต้องกดเข้าสู่ระบบด้วย LINE ใหม่
-- · Ban : ห้ามเข้าระบบถึงเวลาที่กำหนด (หรือจนกว่าจะปลด) + ตัด session + แจ้งผู้ถูกแบนทาง LINE OA
-- · สิทธิ์: Super Admin · เจ้าของ · แอดมิน ของ Tenant นั้น (แอดมินดีด/แบนเจ้าของไม่ได้) · ทำกับตัวเองไม่ได้

alter table users add column if not exists banned_until timestamptz;   -- 'infinity' = จนกว่าจะปลดแบน
alter table users add column if not exists ban_reason   text;
alter table users add column if not exists banned_by    uuid references users(id);
alter table users add column if not exists banned_at    timestamptz;

-- ทุก request: ปิดใช้ / ถูกแบน / ถูกดีดออก → 401 พร้อมรหัสที่แอปใช้แสดงหน้าจอให้ถูก
create or replace function check_request() returns void
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid; u record; v_iat bigint; v_code text;
begin
  begin
    v_uid := auth_user_id();
  exception when others then return;
  end;
  if v_uid is null then return; end if;
  select is_active, tokens_valid_after, banned_until into u from users where id = v_uid;
  v_iat := coalesce((auth.jwt() ->> 'iat')::bigint, 0);
  if not found or not u.is_active then v_code := 'account_disabled';
  elsif u.banned_until is not null and u.banned_until > now() then v_code := 'account_banned';
  elsif u.tokens_valid_after is not null and v_iat <= floor(extract(epoch from u.tokens_valid_after))::bigint then v_code := 'session_revoked';
  end if;
  if v_code is not null then
    raise sqlstate 'PGRST' using
      message = format('{"code":"%s","message":"%s","details":null,"hint":null}', v_code, v_code),
      detail = '{"status":401,"headers":{}}';
  end if;
end $$;
grant execute on function check_request() to anon, authenticated;

-- ใครจัดการผู้ใช้คนนี้ได้ (ดีด/แบน)
create or replace function can_moderate_user(p_target users) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if p_target.id is null then return 'not_found'; end if;
  if not can_manage_tenant(p_target.tenant_id) then return 'forbidden'; end if;
  if p_target.id = auth_user_id() then return 'cannot_moderate_self'; end if;
  if p_target.role = 'owner' and not (auth_user_role() = 'owner' or is_platform_admin()) then return 'owner_requires_owner'; end if;
  if exists (select 1 from platform_admins where user_id = p_target.id) and not is_platform_admin() then return 'forbidden'; end if;
  return null;
end $$;
revoke execute on function can_moderate_user(users) from public, anon, authenticated;

create or replace function kick_user(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t users%rowtype; v_err text;
begin
  select * into t from users where id = p_id;
  v_err := can_moderate_user(t);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  update users set tokens_valid_after = now() where id = p_id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (t.tenant_id, auth_user_id(), 'kick_user', 'users', p_id::text, jsonb_build_object('employee_code', t.employee_code));
  return jsonb_build_object('ok', true);
end $$;

-- p_until = null → จนกว่าจะปลดแบน
create or replace function ban_user(p_id uuid, p_until timestamptz default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t users%rowtype; v_err text; v_until timestamptz; v_nid uuid; v_by text; v_tname text;
begin
  select * into t from users where id = p_id;
  v_err := can_moderate_user(t);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  v_until := coalesce(p_until, 'infinity'::timestamptz);
  if v_until <= now() then return jsonb_build_object('ok', false, 'error', 'invalid_ban_until'); end if;
  update users set banned_until = v_until, ban_reason = nullif(trim(coalesce(p_reason, '')), ''),
         banned_by = auth_user_id(), banned_at = now(), tokens_valid_after = now()
   where id = p_id;
  select full_name into v_by from users where id = auth_user_id();
  select name into v_tname from tenants where id = t.tenant_id;
  if t.line_user_id is not null then
    insert into line_notifications (tenant_id, user_id, kind, payload)
    values (t.tenant_id, p_id, 'ban', jsonb_build_object(
      'to_user_ids', jsonb_build_array(p_id), 'to_name', t.full_name, 'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'until', case when v_until = 'infinity' then null else v_until end, 'by_name', v_by, 'company', v_tname, 'at', now()))
    returning id into v_nid;
  end if;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (t.tenant_id, auth_user_id(), 'ban_user', 'users', p_id::text,
          jsonb_build_object('employee_code', t.employee_code, 'until', v_until, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'notification_id', v_nid);
end $$;

create or replace function unban_user(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t users%rowtype; v_err text; v_nid uuid; v_by text;
begin
  select * into t from users where id = p_id;
  v_err := can_moderate_user(t);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  update users set banned_until = null, ban_reason = null, banned_by = null, banned_at = null where id = p_id;
  select full_name into v_by from users where id = auth_user_id();
  if t.line_user_id is not null and t.banned_until is not null and t.banned_until > now() then
    insert into line_notifications (tenant_id, user_id, kind, payload)
    values (t.tenant_id, p_id, 'unban', jsonb_build_object('to_user_ids', jsonb_build_array(p_id), 'to_name', t.full_name, 'by_name', v_by, 'at', now()))
    returning id into v_nid;
  end if;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (t.tenant_id, auth_user_id(), 'unban_user', 'users', p_id::text, jsonb_build_object('employee_code', t.employee_code));
  return jsonb_build_object('ok', true, 'notification_id', v_nid);
end $$;

revoke execute on function kick_user(uuid), ban_user(uuid, timestamptz, text), unban_user(uuid) from public, anon;
grant execute on function kick_user(uuid), ban_user(uuid, timestamptz, text), unban_user(uuid) to authenticated;
