-- Guard OS / Horguard — Migration 36: กล่องข้อความ (Inbox) ของ Tenant ใน Force
-- (24 ต.ค. 2569 · ตามคำขอคุณเต๋) · รันซ้ำได้
-- · Super Admin ส่งข้อความเข้า Inbox ของ Tenant ได้ (ทุก Tenant / ตามแพ็กเกจ / เลือกราย) และเลือกบทบาทผู้รับ
-- · ระบบส่งข้อความอัตโนมัติ: แพ็กเกจใกล้เต็ม (90%) / เต็ม, ผู้ใช้เกินจำนวนที่รวมในแพ็กเกจ, ทดลองใช้ใกล้หมด
--   กันส่งซ้ำด้วย dedupe_key ต่อ Tenant
-- · สถานะอ่าน/เก็บเข้าคลัง แยกรายคน

create table if not exists inbox_campaigns (
  id             uuid primary key default gen_random_uuid(),
  sender_user_id uuid references users(id),
  category       text not null default 'announcement',
  priority       text not null default 'normal',
  title          text not null,
  body           text not null,
  cta_label      text,
  cta_url        text,
  target         jsonb not null default '{}',     -- {"all":true} | {"plan_ids":[...]} | {"tenant_ids":[...]}
  roles          text[] not null default '{owner,admin}',
  tenant_count   integer not null default 0,
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);
alter table inbox_campaigns enable row level security;
drop policy if exists inbox_campaigns_select on inbox_campaigns;
create policy inbox_campaigns_select on inbox_campaigns for select using (is_platform_admin());

create table if not exists inbox_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  campaign_id uuid references inbox_campaigns(id) on delete cascade,
  source      text not null default 'system' check (source in ('system','super_admin')),
  category    text not null default 'system' check (category in ('announcement','alert','billing','system','maintenance','plan')),
  priority    text not null default 'normal' check (priority in ('normal','high')),
  title       text not null,
  body        text not null,
  cta_label   text,
  cta_url     text,
  roles       text[] not null default '{owner,admin}',
  dedupe_key  text,
  meta        jsonb not null default '{}',
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_inbox_dedupe on inbox_messages(tenant_id, dedupe_key) where dedupe_key is not null;
create index if not exists idx_inbox_tenant_time on inbox_messages(tenant_id, created_at desc);
alter table inbox_messages enable row level security;
drop policy if exists inbox_messages_select on inbox_messages;
create policy inbox_messages_select on inbox_messages for select
  using (is_platform_admin() or (tenant_id = auth_tenant_id() and auth_user_role() = any(roles)));

create table if not exists inbox_reads (
  message_id  uuid not null references inbox_messages(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  read_at     timestamptz,
  archived_at timestamptz,
  primary key (message_id, user_id)
);
alter table inbox_reads enable row level security;
drop policy if exists inbox_reads_select on inbox_reads;
create policy inbox_reads_select on inbox_reads for select using (user_id = auth_user_id() or is_platform_admin());

-- ============================================================
-- 1) ผู้ใช้: อ่านกล่องข้อความของตัวเอง
-- ============================================================
create or replace function inbox_visible(m inbox_messages) returns boolean
language sql stable security definer set search_path = public as $$
  select m.tenant_id = auth_tenant_id() and auth_user_role() = any(m.roles)
         and (m.expires_at is null or m.expires_at > now())
$$;
revoke execute on function inbox_visible(inbox_messages) from public, anon, authenticated;

-- p_box: 'inbox' (ยังไม่เก็บ) | 'unread' | 'archived' | 'all'
create or replace function inbox_list(p_box text default 'inbox', p_limit int default 200) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]') from (
    select jsonb_build_object(
      'id', m.id, 'source', m.source, 'category', m.category, 'priority', m.priority, 'title', m.title, 'body', m.body,
      'cta_label', m.cta_label, 'cta_url', m.cta_url, 'meta', m.meta, 'created_at', m.created_at,
      'read_at', r.read_at, 'archived_at', r.archived_at,
      'sender', case when m.source = 'super_admin' then 'ทีม Horguard' else 'ระบบ Horguard' end) as x
    from inbox_messages m
    left join inbox_reads r on r.message_id = m.id and r.user_id = auth_user_id()
    where inbox_visible(m)
      and case p_box when 'archived' then r.archived_at is not null
                     when 'unread' then r.read_at is null and r.archived_at is null
                     when 'all' then true
                     else r.archived_at is null end
    order by m.created_at desc
    limit greatest(1, least(p_limit, 500))
  ) q
$$;

create or replace function inbox_unread_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from inbox_messages m
   where inbox_visible(m)
     and not exists (select 1 from inbox_reads r where r.message_id = m.id and r.user_id = auth_user_id()
                      and (r.read_at is not null or r.archived_at is not null))
$$;

-- p_read: true=อ่านแล้ว false=ยังไม่อ่าน null=ไม่เปลี่ยน · p_archive: true=เก็บ false=ย้ายกลับ null=ไม่เปลี่ยน
create or replace function inbox_mark(p_ids uuid[], p_read boolean default true, p_archive boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into inbox_reads (message_id, user_id, read_at, archived_at)
  select m.id, auth_user_id(),
         case when p_read then now() end,
         case when p_archive then now() end
    from inbox_messages m where m.id = any(p_ids) and inbox_visible(m)
  on conflict (message_id, user_id) do update set
    read_at = case when p_read is null then inbox_reads.read_at when p_read then coalesce(inbox_reads.read_at, now()) else null end,
    archived_at = case when p_archive is null then inbox_reads.archived_at when p_archive then coalesce(inbox_reads.archived_at, now()) else null end;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end $$;

create or replace function inbox_mark_all_read() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into inbox_reads (message_id, user_id, read_at)
  select m.id, auth_user_id(), now() from inbox_messages m where inbox_visible(m)
  on conflict (message_id, user_id) do update set read_at = coalesce(inbox_reads.read_at, now());
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n);
end $$;

revoke execute on function inbox_list(text, int), inbox_unread_count(), inbox_mark(uuid[], boolean, boolean), inbox_mark_all_read() from public, anon;
grant execute on function inbox_list(text, int), inbox_unread_count(), inbox_mark(uuid[], boolean, boolean), inbox_mark_all_read() to authenticated;

-- ============================================================
-- 2) Super Admin: ส่งข้อความ + ดูสถิติการอ่าน
-- ============================================================
create or replace function admin_inbox_send(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid; v_n int; v_roles text[]; v_title text := trim(coalesce(p->>'title','')); v_body text := trim(coalesce(p->>'body',''));
  v_cat text := coalesce(nullif(p->>'category',''), 'announcement'); v_pri text := coalesce(nullif(p->>'priority',''), 'normal');
  v_target jsonb := coalesce(p->'target', '{}'); v_exp timestamptz := nullif(p->>'expires_at','')::timestamptz;
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_title = '' or v_body = '' then return jsonb_build_object('ok', false, 'error', 'title_body_required'); end if;
  if v_cat not in ('announcement','alert','billing','system','maintenance','plan') or v_pri not in ('normal','high') then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  select coalesce(array_agg(x), '{owner,admin}') into v_roles
    from jsonb_array_elements_text(case jsonb_typeof(p->'roles') when 'array' then p->'roles'
                                         when 'string' then coalesce((p->>'roles')::jsonb, '[]') else '["owner","admin"]' end) x
   where x in ('owner','admin','zone_manager','shift_leader','supervisor');
  if cardinality(v_roles) = 0 then v_roles := '{owner,admin}'; end if;

  create temp table if not exists _inbox_targets (tid uuid) on commit drop;
  truncate _inbox_targets;
  insert into _inbox_targets
  select t.id from tenants t
   where t.is_active and (
         coalesce((v_target->>'all')::boolean, false)
      or t.id::text in (select jsonb_array_elements_text(coalesce(v_target->'tenant_ids', '[]')))
      or exists (select 1 from tenant_plans tp where tp.tenant_id = t.id
                   and tp.plan_id in (select jsonb_array_elements_text(coalesce(v_target->'plan_ids', '[]')))));
  select count(*) into v_n from _inbox_targets;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'no_target'); end if;

  insert into inbox_campaigns (sender_user_id, category, priority, title, body, cta_label, cta_url, target, roles, tenant_count, expires_at)
  values (auth_user_id(), v_cat, v_pri, v_title, v_body, nullif(p->>'cta_label',''), nullif(p->>'cta_url',''), v_target, v_roles, v_n, v_exp)
  returning id into v_cid;
  insert into inbox_messages (tenant_id, campaign_id, source, category, priority, title, body, cta_label, cta_url, roles, expires_at)
  select tid, v_cid, 'super_admin', v_cat, v_pri, v_title, v_body, nullif(p->>'cta_label',''), nullif(p->>'cta_url',''), v_roles, v_exp
    from _inbox_targets;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (auth_tenant_id(), auth_user_id(), 'inbox_send', 'inbox_campaigns', v_cid::text,
          jsonb_build_object('title', v_title, 'target', v_target, 'roles', v_roles, 'tenants', v_n));
  return jsonb_build_object('ok', true, 'campaign_id', v_cid, 'tenants', v_n);
end $$;

create or replace function admin_inbox_campaigns(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'campaigns', coalesce((
    select jsonb_agg(row order by row->>'created_at' desc) from (
      select to_jsonb(c) || jsonb_build_object(
        'sender_name', (select full_name from users where id = c.sender_user_id),
        'recipients', (select count(*) from inbox_messages m join users u on u.tenant_id = m.tenant_id and u.is_active and u.role = any(m.roles)
                        where m.campaign_id = c.id),
        'read', (select count(*) from inbox_messages m join inbox_reads r on r.message_id = m.id and r.read_at is not null
                  where m.campaign_id = c.id),
        'tenants', (select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'name', t.name,
                       'read', (select count(*) from inbox_reads r where r.message_id = m.id and r.read_at is not null)))
                      from inbox_messages m join tenants t on t.id = m.tenant_id where m.campaign_id = c.id)) as row
        from inbox_campaigns c order by c.created_at desc limit greatest(1, least(p_limit, 500))) q), '[]'),
    'system_recent', coalesce((select jsonb_agg(jsonb_build_object('tenant', t.name, 'title', m.title, 'category', m.category, 'created_at', m.created_at) order by m.created_at desc)
        from (select * from inbox_messages where source = 'system' order by created_at desc limit 50) m join tenants t on t.id = m.tenant_id), '[]'));
end $$;

-- ลบ/ถอนข้อความที่ส่งไปแล้ว (หายจาก Inbox ทุก Tenant)
create or replace function admin_inbox_retract(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  delete from inbox_campaigns where id = p_campaign;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id)
  values (auth_tenant_id(), auth_user_id(), 'inbox_retract', 'inbox_campaigns', p_campaign::text);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function admin_inbox_send(jsonb), admin_inbox_campaigns(int), admin_inbox_retract(uuid) from public, anon;
grant execute on function admin_inbox_send(jsonb), admin_inbox_campaigns(int), admin_inbox_retract(uuid) to authenticated;

-- ============================================================
-- 3) ข้อความจากระบบ (กันซ้ำด้วย dedupe_key)
-- ============================================================
create or replace function system_inbox_notify(
  p_tenant uuid, p_category text, p_priority text, p_title text, p_body text, p_dedupe_key text,
  p_roles text[] default '{owner,admin}', p_cta_label text default null, p_cta_url text default null, p_meta jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into inbox_messages (tenant_id, source, category, priority, title, body, cta_label, cta_url, roles, dedupe_key, meta)
  values (p_tenant, 'system', p_category, p_priority, p_title, p_body, p_cta_label, p_cta_url, p_roles, p_dedupe_key, coalesce(p_meta, '{}'))
  on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function system_inbox_notify(uuid, text, text, text, text, text, text[], text, text, jsonb) from public, anon, authenticated;

create or replace function limit_label(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value->'limit_labels'->>p_key from site_content where key = 'pricing'), p_key)
$$;

-- เช็กเพดานหลังเพิ่มข้อมูลสำเร็จ: ถึง 90% = ใกล้เต็ม · ถึง 100% = เต็ม (แจ้งครั้งเดียวต่อเดือนต่อระดับ)
create or replace function plan_usage_alert(p_tenant uuid, p_key text, p_count int, p_scope text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_max numeric; v_label text; v_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM'); v_plan text;
begin
  v_max := tenant_limit(p_tenant, p_key);
  if v_max is null or v_max <= 0 then return; end if;
  v_label := limit_label(p_key);
  select p.name into v_plan from tenant_plans tp join plans p on p.id = tp.plan_id where tp.tenant_id = p_tenant;
  if p_count >= v_max then
    perform system_inbox_notify(p_tenant, 'plan', 'high',
      'แพ็กเกจเต็ม: ' || v_label || coalesce(' (' || p_scope || ')', ''),
      format('ตอนนี้ใช้ %s จาก %s ตามแพ็กเกจ %s แล้ว เพิ่มรายการใหม่ไม่ได้จนกว่าจะอัปเกรดแพ็กเกจหรือซื้อเพิ่ม (ปิดใช้รายการเดิมเพื่อคืนโควตาได้)',
             p_count, v_max::int, coalesce(v_plan, '-')),
      'limit:' || p_key || coalesce(':' || p_scope, '') || ':full:' || v_month,
      '{owner,admin}', 'ดูแพ็กเกจของฉัน', 'force:myplan',
      jsonb_build_object('limit_key', p_key, 'count', p_count, 'limit', v_max));
  elsif p_count >= ceil(v_max * 0.9) and v_max >= 5 then
    perform system_inbox_notify(p_tenant, 'plan', 'normal',
      'แพ็กเกจใกล้เต็ม: ' || v_label || coalesce(' (' || p_scope || ')', ''),
      format('ตอนนี้ใช้ %s จาก %s ตามแพ็กเกจ %s (เกิน 90%%) ถ้าจะเพิ่มอีก ควรอัปเกรดหรือซื้อเพิ่มล่วงหน้า', p_count, v_max::int, coalesce(v_plan, '-')),
      'limit:' || p_key || coalesce(':' || p_scope, '') || ':90:' || v_month,
      '{owner,admin}', 'ดูแพ็กเกจของฉัน', 'force:myplan',
      jsonb_build_object('limit_key', p_key, 'count', p_count, 'limit', v_max));
  end if;
end $$;
revoke execute on function plan_usage_alert(uuid, text, int, text) from public, anon, authenticated;

create or replace function trg_alert_properties() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_active and not new.is_test then
    perform plan_usage_alert(new.tenant_id, 'max_properties',
      (select count(*)::int from properties where tenant_id = new.tenant_id and is_active and not is_test));
  end if;
  return null;
end $$;
drop trigger if exists alert_properties on properties;
create trigger alert_properties after insert or update of is_active, is_test on properties
  for each row execute function trg_alert_properties();

create or replace function trg_alert_checkpoints() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_active then
    perform plan_usage_alert(new.tenant_id, 'max_checkpoints_per_property',
      (select count(*)::int from checkpoints where property_id = new.property_id and is_active),
      (select name from properties where id = new.property_id));
  end if;
  return null;
end $$;
drop trigger if exists alert_checkpoints on checkpoints;
create trigger alert_checkpoints after insert or update of is_active, property_id on checkpoints
  for each row execute function trg_alert_checkpoints();

create or replace function trg_alert_users() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  if not new.is_active then return null; end if;
  v_key := case when new.role in ('admin','zone_manager') then 'max_staff_accounts'
                when new.role = 'client' then 'max_client_accounts'
                when is_field_role(new.role) then 'max_field_users' end;
  if v_key is null then return null; end if;
  perform plan_usage_alert(new.tenant_id, v_key,
    (select count(*)::int from users u where u.tenant_id = new.tenant_id and u.is_active
       and case v_key when 'max_staff_accounts' then u.role in ('admin','zone_manager')
                      when 'max_client_accounts' then u.role = 'client'
                      else is_field_role(u.role) end));
  return null;
end $$;
drop trigger if exists alert_users on users;
create trigger alert_users after insert or update of is_active, role on users
  for each row execute function trg_alert_users();

create or replace function trg_alert_broadcasts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform plan_usage_alert(new.tenant_id, 'broadcasts_per_month',
    (select count(*)::int from broadcasts where tenant_id = new.tenant_id
       and created_at >= date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'));
  return null;
end $$;
drop trigger if exists alert_broadcasts on broadcasts;
create trigger alert_broadcasts after insert on broadcasts for each row execute function trg_alert_broadcasts();

-- ============================================================
-- 4) ตรวจรายวัน 09:00 น.: ผู้ใช้หน้างานเกินที่รวม, ทดลองใช้ใกล้หมด, แพ็กเกจที่ถูกกว่า
-- ============================================================
create or replace function plan_daily_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare
  t record; v_n int := 0; v_active int; v_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  v_days int; v_next record; v_cur numeric; v_alt numeric;
begin
  for t in select tp.*, p.name as plan_name, p.included_users, p.overage_per_user, p.price_monthly, p.sort_order
             from tenant_plans tp join plans p on p.id = tp.plan_id join tenants x on x.id = tp.tenant_id
            where x.is_active and tp.status <> 'suspended' loop
    select count(distinct a.user_id) into v_active
      from attendance a join users u on u.id = a.user_id
     where a.tenant_id = t.tenant_id and a.check_in_at >= v_month_start and is_field_role(u.role);

    -- ผู้ใช้หน้างานเกินจำนวนที่รวมในราคา
    if t.included_users is not null and v_active > t.included_users then
      if system_inbox_notify(t.tenant_id, 'billing', 'normal',
           format('ผู้ใช้หน้างานเดือนนี้เกินแพ็กเกจ (%s จาก %s คน)', v_active, t.included_users),
           format('แพ็กเกจ %s รวมผู้ใช้หน้างาน %s คน เดือนนี้มีคนเข้างานแล้ว %s คน ส่วนเกินคิดเพิ่มคนละ %s฿',
                  t.plan_name, t.included_users, v_active, to_char(t.overage_per_user, 'FM999,990')),
           'billing:overage:' || v_month, '{owner,admin}', 'ดูแพ็กเกจของฉัน', 'force:myplan',
           jsonb_build_object('active', v_active, 'included', t.included_users)) is not null then v_n := v_n + 1; end if;
    end if;
    -- เพดานผู้ใช้หน้างาน (บัญชีที่เปิดใช้)
    perform plan_usage_alert(t.tenant_id, 'max_field_users',
      (select count(*)::int from users u where u.tenant_id = t.tenant_id and u.is_active and is_field_role(u.role)));

    -- อัปเกรดแล้วถูกกว่า
    select * into v_next from plans n where n.is_active and n.sort_order > t.sort_order and n.price_monthly is not null order by n.sort_order limit 1;
    if v_next.id is not null and t.price_monthly is not null then
      v_cur := t.price_monthly + greatest(0, v_active - coalesce(t.included_users, v_active)) * coalesce(t.overage_per_user, 0);
      v_alt := v_next.price_monthly + greatest(0, v_active - coalesce(v_next.included_users, v_active)) * coalesce(v_next.overage_per_user, 0);
      if v_alt < v_cur then
        perform system_inbox_notify(t.tenant_id, 'billing', 'normal', 'อัปเกรดเป็น ' || v_next.name || ' แล้วถูกกว่า',
          format('ด้วยผู้ใช้หน้างาน %s คนในเดือนนี้ แพ็กเกจ %s ประมาณ %s฿ ส่วน %s ประมาณ %s฿ ต่อเดือน (ไม่รวม VAT)',
                 v_active, t.plan_name, to_char(v_cur, 'FM999,999,990'), v_next.name, to_char(v_alt, 'FM999,999,990')),
          'billing:cheaper:' || v_month, '{owner}', 'ติดต่ออัปเกรด', 'https://lin.ee/5e7WMZj');
      end if;
    end if;

    -- ทดลองใช้ใกล้หมด (7 วัน / 1 วัน)
    if t.status = 'trial' and t.trial_ends_at is not null then
      v_days := ceil(extract(epoch from (t.trial_ends_at - now())) / 86400);
      if v_days between 0 and 7 then
        perform system_inbox_notify(t.tenant_id, 'billing', case when v_days <= 1 then 'high' else 'normal' end,
          format('ทดลองใช้เหลืออีก %s วัน', greatest(v_days, 0)),
          format('ช่วงทดลองใช้แพ็กเกจ %s จะสิ้นสุดวันที่ %s ติดต่อทีม Horguard เพื่อเลือกแพ็กเกจและใช้งานต่อได้ทันที',
                 t.plan_name, to_char(t.trial_ends_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY')),
          'trial:ends:' || case when v_days <= 1 then '1' else '7' end, '{owner,admin}', 'ติดต่อทีม Horguard', 'https://lin.ee/5e7WMZj');
      end if;
    end if;
  end loop;
  return v_n;
end $$;
revoke execute on function plan_daily_sweep() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'plan-daily-sweep') then perform cron.unschedule('plan-daily-sweep'); end if;
end $$;
select cron.schedule('plan-daily-sweep', '0 2 * * *', $job$ select plan_daily_sweep(); $job$);  -- 09:00 น. เวลาไทย

-- ข้อความต้อนรับสำหรับ Tenant ที่มีอยู่
insert into inbox_messages (tenant_id, source, category, priority, title, body, roles, dedupe_key)
select t.id, 'system', 'announcement', 'normal', 'ยินดีต้อนรับสู่กล่องข้อความ Horguard',
       'ประกาศจากทีม Horguard และการแจ้งเตือนสำคัญของบริษัท เช่น แพ็กเกจใกล้เต็ม หรือช่วงทดลองใช้ใกล้หมด จะมาที่นี่ ดูแพ็กเกจและการใช้งานได้ที่เมนู "แพ็กเกจของฉัน"',
       '{owner,admin}', 'welcome:inbox'
  from tenants t where t.is_active
on conflict do nothing;
