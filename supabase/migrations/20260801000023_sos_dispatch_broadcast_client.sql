-- Guard OS — Migration 23: SOS · แผนที่กำลังพล + dispatch · ประกาศกลุ่มผ่าน LINE OA · แดชบอร์ดลูกค้า
-- รันหลัง migration 22 · รันซ้ำได้
-- ข้อความ LINE ทั้งหมดเข้าคิว line_notifications แล้ว edge function notify-line เป็นคนส่ง
--   payload.to_user_ids = ส่งถึงรายชื่อนี้ · kind 'sos' = เจ้าของ/แอดมิน + สายตรวจ/ผู้ช่วยของโครงการ · อื่นๆ = เจ้าของ/แอดมิน

-- ============================================================
-- 1) เหตุแจ้ง (SOS)
-- ============================================================
create table if not exists incidents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  property_id uuid references properties(id),
  user_id     uuid not null references users(id),
  kind        text not null default 'sos',
  category    text,
  note        text,
  location    geography(point, 4326),
  photo_url   text,
  audio_url   text,
  status      text not null default 'open' check (status in ('open','ack','closed')),
  ack_by      uuid references users(id),
  ack_at      timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_incidents_tenant_time on incidents(tenant_id, created_at desc);
create index if not exists idx_incidents_property_time on incidents(property_id, created_at desc);
alter table incidents enable row level security;
drop policy if exists incidents_select on incidents;
create policy incidents_select on incidents for select
  using (tenant_id = auth_tenant_id()
         and (user_id = auth_user_id() or (is_tenant_staff() and can_see_property(property_id))
              or (property_id is null and is_tenant_admin())));

create or replace view v_incidents with (security_invoker = on) as
select i.id, i.tenant_id, i.property_id, p.name as property_name, i.user_id, u.full_name, u.employee_code, u.phone,
       i.kind, i.category, i.note, i.photo_url, i.audio_url, i.status, i.ack_at, i.closed_at, i.created_at,
       st_y(i.location::geometry) as lat, st_x(i.location::geometry) as lng
from incidents i
join users u on u.id = i.user_id
left join properties p on p.id = i.property_id;

create or replace function report_sos(
  p_property_id uuid, p_lat double precision, p_lng double precision,
  p_photo_url text default null, p_audio_url text default null,
  p_category text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prop uuid := p_property_id;
  v_point geography := case when p_lat is not null and p_lng is not null
                            then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_id uuid; v_notif uuid;
begin
  if auth_user_id() is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if exists (select 1 from incidents where user_id = auth_user_id() and created_at > now() - interval '20 seconds') then
    return jsonb_build_object('ok', false, 'error', 'too_frequent');
  end if;
  -- ไม่ระบุโครงการ → ใช้โครงการที่กำลังเข้างานอยู่
  if v_prop is null then
    select property_id into v_prop from shift_assignments
    where user_id = auth_user_id() and status = 'checked_in' order by starts_at desc limit 1;
  end if;
  if v_prop is not null and not exists (select 1 from properties where id = v_prop and tenant_id = auth_tenant_id()) then
    v_prop := null;
  end if;

  insert into incidents (tenant_id, property_id, user_id, category, note, location, photo_url, audio_url)
  values (auth_tenant_id(), v_prop, auth_user_id(), nullif(trim(coalesce(p_category, '')), ''),
          nullif(trim(coalesce(p_note, '')), ''), v_point, p_photo_url, p_audio_url)
  returning id into v_id;

  insert into line_notifications (tenant_id, property_id, user_id, kind, payload)
  select auth_tenant_id(), v_prop, auth_user_id(), 'sos',
         jsonb_build_object('incident_id', v_id, 'user_name', u.full_name, 'employee_code', u.employee_code,
                            'phone', u.phone, 'property_name', p.name, 'lat', p_lat, 'lng', p_lng,
                            'category', p_category, 'note', p_note, 'photo_path', p_photo_url,
                            'audio_path', p_audio_url, 'at', now())
  from users u left join properties p on p.id = v_prop
  where u.id = auth_user_id()
  returning id into v_notif;

  return jsonb_build_object('ok', true, 'incident_id', v_id, 'notification_id', v_notif);
end $$;

create or replace function set_incident_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inc incidents%rowtype;
begin
  if p_status not in ('ack','closed','open') then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;
  select * into v_inc from incidents where id = p_id and tenant_id = auth_tenant_id();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (is_tenant_staff() and (can_see_property(v_inc.property_id) or (v_inc.property_id is null and is_tenant_admin()))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update incidents set status = p_status,
    ack_by = case when p_status = 'ack' then auth_user_id() else ack_by end,
    ack_at = case when p_status = 'ack' then now() else ack_at end,
    closed_at = case when p_status = 'closed' then now() else closed_at end
  where id = p_id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (auth_tenant_id(), auth_user_id(), 'incident_' || p_status, 'incidents', p_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- 2) แผนที่กำลังพลสด
-- ============================================================
create or replace function force_map(p_property_id uuid default null)
returns table (property_id uuid, property_name text, province text, lat double precision, lng double precision,
               shift_mode text, on_duty integer, expected integer, missing integer, open_sos integer, people jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.province, st_y(p.center::geometry), st_x(p.center::geometry), p.shift_mode,
         od.n,
         case when p.shift_mode = 'open' then coalesce(oc.need, 0) else coalesce(sc.expected, 0) end,
         case when p.shift_mode = 'open' then greatest(0, coalesce(oc.need_late, 0) - od.n) else coalesce(sc.missing, 0) end,
         (select count(*)::int from incidents i where i.property_id = p.id and i.status <> 'closed'
            and i.created_at > now() - interval '24 hours'),
         coalesce(od.people, '[]'::jsonb)
  from properties p
  cross join lateral (
    select count(*)::int as n,
           jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.full_name, 'role', u.role, 'kind', sa.kind,
                                        'since', a.check_in_at, 'phone', u.phone) order by a.check_in_at) as people
    from shift_assignments sa join users u on u.id = sa.user_id
    left join attendance a on a.assignment_id = sa.id
    where sa.property_id = p.id and sa.status = 'checked_in'
  ) od
  left join lateral (
    select count(*)::int as expected,
           count(*) filter (where sa.status = 'scheduled' and sa.starts_at < now() - interval '15 minutes')::int as missing
    from shift_assignments sa
    where sa.property_id = p.id and sa.kind = 'scheduled' and sa.status in ('scheduled','checked_in')
      and sa.starts_at <= now() and sa.ends_at > now()
  ) sc on true
  left join lateral (
    select sum(s.headcount)::int as need,
           sum(s.headcount) filter (where now() > s.slot_start + interval '15 minutes')::int as need_late
    from slot_instances(p.id, now()) s where now() >= s.slot_start and now() < s.slot_end
  ) oc on true
  where p.tenant_id = auth_tenant_id() and p.is_active
    and is_tenant_staff() and can_see_property(p.id)
    and (not p.is_test or is_platform_admin())
    and (p_property_id is null or p.id = p_property_id)
  order by 9 desc, p.name
$$;

-- ผู้ที่ส่งไปแทนได้: ตัวสแปร์ / ครูฝึก / สายตรวจ / ผู้ช่วย / ยาม / หัวหน้ากะ ที่มีสิทธิ์ในโครงการนั้น (ผูกโครงการ)
-- ไม่ได้อยู่เวรตอนนี้ และไม่มีกะของตัวเองในตอนนี้ · ตัวสแปร์ก่อน แล้วเรียงจากใกล้ที่สุด
-- (ตำแหน่งล่าสุดใน 24 ชม. หรือโครงการอื่นที่ผูกไว้ซึ่งใกล้ที่สุด)
create or replace function dispatch_candidates(p_property_id uuid)
returns table (user_id uuid, full_name text, employee_code text, role text, phone text, has_line boolean,
               distance_m numeric, location_source text)
language sql stable security definer set search_path = public as $$
  with target as (
    select p.id, p.center from properties p
    where p.id = p_property_id and p.tenant_id = auth_tenant_id() and is_tenant_staff() and can_see_property(p.id)
  ), cand as (
    select u.* from users u
    join property_managers pm on pm.user_id = u.id and pm.property_id = p_property_id
    where u.tenant_id = auth_tenant_id() and u.is_active
      and u.role in ('spare','trainer','assistant_supervisor','supervisor','guard','shift_leader')
      and not exists (select 1 from shift_assignments sa where sa.user_id = u.id and sa.status = 'checked_in')
      and not exists (select 1 from shift_assignments sa where sa.user_id = u.id and sa.status = 'scheduled'
                      and now() between sa.starts_at - interval '45 minutes' and sa.ends_at)
  )
  select c.id, c.full_name, c.employee_code, c.role, c.phone, c.line_user_id is not null,
         round(st_distance(coalesce(last.loc, home.loc), t.center)::numeric, 0),
         case when last.loc is not null then 'last_seen' when home.loc is not null then 'home_project' else null end
  from cand c cross join target t
  left join lateral (
    select coalesce(a.out_location, a.in_location) as loc from attendance a
    where a.user_id = c.id and coalesce(a.check_out_at, a.check_in_at) > now() - interval '24 hours'
      and coalesce(a.out_location, a.in_location) is not null
    order by coalesce(a.check_out_at, a.check_in_at) desc limit 1
  ) last on true
  left join lateral (
    select p2.center as loc from property_managers pm2 join properties p2 on p2.id = pm2.property_id
    where pm2.user_id = c.id and pm2.property_id <> p_property_id and p2.center is not null and t.center is not null
    order by st_distance(p2.center, t.center) limit 1
  ) home on true
  order by (c.role = 'spare') desc, 7 nulls last, c.full_name
$$;

create or replace function dispatch_person(p_property_id uuid, p_user_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prop properties%rowtype; v_user users%rowtype; v_notif uuid;
begin
  select * into v_prop from properties where id = p_property_id and tenant_id = auth_tenant_id();
  if not found then return jsonb_build_object('ok', false, 'error', 'property_not_found'); end if;
  if not (is_tenant_staff() and can_see_property(p_property_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into v_user from users where id = p_user_id and tenant_id = auth_tenant_id() and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'user_not_found'); end if;
  if v_user.line_user_id is null then return jsonb_build_object('ok', false, 'error', 'user_no_line'); end if;

  insert into line_notifications (tenant_id, property_id, user_id, kind, payload)
  select auth_tenant_id(), p_property_id, auth_user_id(), 'dispatch',
         jsonb_build_object('to_user_ids', jsonb_build_array(p_user_id), 'to_name', v_user.full_name,
                            'property_name', v_prop.name, 'address', concat_ws(' ', v_prop.address, v_prop.subdistrict, v_prop.district, v_prop.province),
                            'lat', st_y(v_prop.center::geometry), 'lng', st_x(v_prop.center::geometry),
                            'note', nullif(trim(coalesce(p_note, '')), ''), 'by_name', me.full_name, 'at', now())
  from users me where me.id = auth_user_id()
  returning id into v_notif;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (auth_tenant_id(), auth_user_id(), 'dispatch', 'users', p_user_id::text,
          jsonb_build_object('property_id', p_property_id, 'note', p_note));
  return jsonb_build_object('ok', true, 'notification_id', v_notif);
end $$;

-- ============================================================
-- 3) ประกาศกลุ่ม (multicast LINE OA) ตามโครงการหรือจังหวัด
-- ============================================================
create table if not exists broadcasts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  created_by      uuid references users(id),
  message         text not null,
  property_ids    uuid[] not null default '{}',
  provinces       text[] not null default '{}',
  recipient_count integer not null default 0,
  notification_id uuid references line_notifications(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_broadcasts_tenant_time on broadcasts(tenant_id, created_at desc);
alter table broadcasts enable row level security;
drop policy if exists broadcasts_select on broadcasts;
create policy broadcasts_select on broadcasts for select using (tenant_id = auth_tenant_id() and is_tenant_staff());

-- ผู้รับ = คนที่ผูกกับโครงการ + คนที่มีกะในโครงการช่วง 30 วันก่อน–หลัง (ที่ผูก LINE แล้ว)
create or replace function broadcast_recipients(p_property_ids uuid[], p_provinces text[])
returns table (user_id uuid, full_name text, role text, has_line boolean)
language sql stable security definer set search_path = public as $$
  with props as (
    select p.id from properties p
    where p.tenant_id = auth_tenant_id() and p.is_active and is_tenant_staff() and can_see_property(p.id)
      and (not p.is_test or is_platform_admin())
      and (p.id = any(coalesce(p_property_ids, '{}')) or p.province = any(coalesce(p_provinces, '{}')))
  )
  select distinct u.id, u.full_name, u.role, u.line_user_id is not null
  from users u
  where u.tenant_id = auth_tenant_id() and u.is_active
    and (exists (select 1 from property_managers pm where pm.user_id = u.id and pm.property_id in (select id from props))
         or exists (select 1 from shift_assignments sa where sa.user_id = u.id and sa.property_id in (select id from props)
                    and sa.status <> 'cancelled' and sa.starts_at between now() - interval '30 days' and now() + interval '30 days'))
$$;

create or replace function send_broadcast(p_property_ids uuid[], p_provinces text[], p_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_notif uuid; v_names text[]; v_msg text := trim(coalesce(p_message, ''));
begin
  if not is_tenant_staff() or auth_user_role() = 'shift_leader' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_msg = '' then return jsonb_build_object('ok', false, 'error', 'empty_message'); end if;
  if length(v_msg) > 1500 then return jsonb_build_object('ok', false, 'error', 'message_too_long'); end if;
  select array_agg(r.user_id) into v_ids from broadcast_recipients(p_property_ids, p_provinces) r where r.has_line;
  if coalesce(cardinality(v_ids), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'no_recipients'); end if;
  select array_agg(p.name order by p.name) into v_names from properties p
  where p.tenant_id = auth_tenant_id() and (p.id = any(coalesce(p_property_ids, '{}')) or p.province = any(coalesce(p_provinces, '{}')))
    and can_see_property(p.id);

  insert into line_notifications (tenant_id, user_id, kind, payload)
  select auth_tenant_id(), auth_user_id(), 'broadcast',
         jsonb_build_object('to_user_ids', to_jsonb(v_ids), 'message', v_msg, 'sender_name', me.full_name,
                            'property_names', to_jsonb(v_names), 'provinces', to_jsonb(coalesce(p_provinces, '{}')))
  from users me where me.id = auth_user_id()
  returning id into v_notif;
  insert into broadcasts (tenant_id, created_by, message, property_ids, provinces, recipient_count, notification_id)
  values (auth_tenant_id(), auth_user_id(), v_msg, coalesce(p_property_ids, '{}'), coalesce(p_provinces, '{}'), cardinality(v_ids), v_notif);
  return jsonb_build_object('ok', true, 'notification_id', v_notif, 'recipients', cardinality(v_ids));
end $$;

-- ============================================================
-- 4) แดชบอร์ดลูกค้า (รายโครงการ) — SLA เข้ากะ · ความครอบคลุมการตรวจ · เหตุ · heat map จุดตรวจ
-- ============================================================
create or replace function can_view_client_dashboard(p_property_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from properties p
    where p.id = p_property_id and p.tenant_id = auth_tenant_id() and p.is_active
      and (not p.is_test or is_platform_admin())
      and ((is_tenant_staff() and can_see_property(p.id))
           or (auth_user_role() = 'client'
               and (p.client_user_id = auth_user_id()
                    or exists (select 1 from property_managers pm where pm.user_id = auth_user_id() and pm.property_id = p.id))))
  )
$$;

create or replace function client_projects()
returns table (property_id uuid, property_name text, province text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.province from properties p
  where p.tenant_id = auth_tenant_id() and can_view_client_dashboard(p.id)
  order by p.name
$$;

create or replace function client_dashboard(p_property_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to   timestamptz := (least(p_to, p_from + 92) + 1)::timestamp at time zone 'Asia/Bangkok';
  v_end  timestamptz := least(v_to, now());
  v_out jsonb;
begin
  if not can_view_client_dashboard(p_property_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  with sh as (
    select sa.id, (sa.starts_at at time zone 'Asia/Bangkok')::date as d, a.id as att_id, coalesce(a.late_minutes, 0) as late
    from shift_assignments sa left join attendance a on a.assignment_id = sa.id
    where sa.property_id = p_property_id and sa.status <> 'cancelled' and sa.kind in ('scheduled','open')
      and sa.starts_at >= v_from and sa.starts_at < v_end and (a.id is not null or sa.ends_at < now())
  ), daily as (
    select d, count(*) as total, count(att_id) as attended, count(*) filter (where att_id is not null and late <= 5) as on_time
    from sh group by d
  ), cps as (
    select id, name from checkpoints where property_id = p_property_id and is_active
  ), scans as (
    select ps.checkpoint_id, ps.scanned_at, (ps.scanned_at at time zone 'Asia/Bangkok') as local_ts
    from patrol_scans ps where ps.property_id = p_property_id and ps.scanned_at >= v_from and ps.scanned_at < v_end
  ), days as (
    select generate_series(p_from, (v_end at time zone 'Asia/Bangkok')::date, interval '1 day')::date as d
  ), cover as (
    select dd.d, (select count(distinct s.checkpoint_id) from scans s join cps c on c.id = s.checkpoint_id
                  where s.local_ts::date = dd.d) as scanned
    from days dd
  )
  select jsonb_build_object(
    'ok', true,
    'property', (select jsonb_build_object('id', p.id, 'name', p.name, 'province', p.province) from properties p where p.id = p_property_id),
    'shifts', jsonb_build_object(
      'total', (select count(*) from sh),
      'attended', (select count(att_id) from sh),
      'on_time', (select count(*) from sh where att_id is not null and late <= 5),
      'late', (select count(*) from sh where att_id is not null and late > 5),
      'absent', (select count(*) from sh where att_id is null)),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', dd.d, 'total', coalesce(dl.total, 0), 'attended', coalesce(dl.attended, 0),
                                                           'on_time', coalesce(dl.on_time, 0), 'cp_scanned', cv.scanned) order by dd.d)
                       from days dd left join daily dl on dl.d = dd.d left join cover cv on cv.d = dd.d), '[]'::jsonb),
    'checkpoints', jsonb_build_object(
      'count', (select count(*) from cps),
      'scans', (select count(*) from scans s where s.checkpoint_id in (select id from cps)),
      'heat', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hours', h.hours, 'total', h.total) order by c.name)
                        from cps c cross join lateral (
                          select jsonb_agg(coalesce(x.n, 0) order by g.hr) as hours, coalesce(sum(x.n), 0) as total
                          from generate_series(0, 23) g(hr)
                          left join (select extract(hour from s.local_ts)::int as hr, count(*) as n from scans s
                                     where s.checkpoint_id = c.id group by 1) x on x.hr = g.hr) h), '[]'::jsonb)),
    'incidents', jsonb_build_object(
      'total', (select count(*) from incidents i where i.property_id = p_property_id and i.created_at >= v_from and i.created_at < v_to),
      'open', (select count(*) from incidents i where i.property_id = p_property_id and i.created_at >= v_from and i.created_at < v_to and i.status <> 'closed'),
      'by_category', coalesce((select jsonb_object_agg(coalesce(category, 'อื่นๆ'), n) from (
                        select category, count(*) n from incidents i where i.property_id = p_property_id
                        and i.created_at >= v_from and i.created_at < v_to group by category) q), '{}'::jsonb),
      'latest', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
                   select jsonb_build_object('at', i.created_at, 'category', i.category, 'note', i.note, 'status', i.status) x
                   from incidents i where i.property_id = p_property_id and i.created_at >= v_from and i.created_at < v_to
                   order by i.created_at desc limit 10) q), '[]'::jsonb))
  ) into v_out;
  return v_out;
end $$;

-- ============================================================
-- สิทธิ์เรียกใช้
-- ============================================================
revoke execute on function report_sos(uuid,double precision,double precision,text,text,text,text),
  set_incident_status(uuid,text), force_map(uuid), dispatch_candidates(uuid), dispatch_person(uuid,uuid,text),
  broadcast_recipients(uuid[],text[]), send_broadcast(uuid[],text[],text),
  can_view_client_dashboard(uuid), client_projects(), client_dashboard(uuid,date,date) from anon, public;
grant execute on function report_sos(uuid,double precision,double precision,text,text,text,text),
  set_incident_status(uuid,text), force_map(uuid), dispatch_candidates(uuid), dispatch_person(uuid,uuid,text),
  broadcast_recipients(uuid[],text[]), send_broadcast(uuid[],text[],text),
  can_view_client_dashboard(uuid), client_projects(), client_dashboard(uuid,date,date) to authenticated;
grant select on incidents, broadcasts, v_incidents to authenticated;
