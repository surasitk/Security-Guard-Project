-- Guard OS / Horguard — Migration 34: SOS เป็น Ticket ใน Force (สถานะ + บันทึกว่าใครทำอะไร)
-- (24 ต.ค. 2569 · ตามคำขอคุณเต๋) · รันซ้ำได้
-- สถานะ: open รอรับเรื่อง → ack รับเรื่องแล้ว → on_site ถึงที่เกิดเหตุ → closed ปิดเรื่อง · false_alarm แจ้งผิด/ทดสอบ
-- ทุกการเปลี่ยนสถานะ/หมายเหตุ เก็บใน incident_events (ใคร · เมื่อไหร่ · จากอะไรเป็นอะไร · หมายเหตุ)

alter table incidents drop constraint if exists incidents_status_check;
alter table incidents add constraint incidents_status_check check (status in ('open','ack','on_site','closed','false_alarm'));
alter table incidents add column if not exists closed_by  uuid references users(id);
alter table incidents add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_incidents_tenant_time on incidents(tenant_id, created_at desc);

create table if not exists incident_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  incident_id   uuid not null references incidents(id) on delete cascade,
  actor_user_id uuid references users(id),
  action        text not null check (action in ('created','status','note')),
  from_status   text,
  to_status     text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_incident_events_inc on incident_events(incident_id, created_at);
alter table incident_events enable row level security;
drop policy if exists incident_events_select on incident_events;
create policy incident_events_select on incident_events for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff()
         and exists (select 1 from incidents i where i.id = incident_id
                     and (can_see_property(i.property_id) or (i.property_id is null and is_tenant_admin()))));

-- แจ้งเหตุใหม่ → เหตุการณ์ "created" อัตโนมัติ (ทั้งจาก LINE และที่อื่น)
create or replace function trg_incident_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into incident_events (tenant_id, incident_id, actor_user_id, action, to_status, note, created_at)
  values (new.tenant_id, new.id, new.user_id, 'created', new.status, new.note, new.created_at);
  return new;
end $$;
drop trigger if exists incident_created on incidents;
create trigger incident_created after insert on incidents for each row execute function trg_incident_created();

-- ของเดิม: สร้างประวัติย้อนหลังจากข้อมูลที่มี
insert into incident_events (tenant_id, incident_id, actor_user_id, action, to_status, note, created_at)
select i.tenant_id, i.id, i.user_id, 'created', 'open', i.note, i.created_at from incidents i
 where not exists (select 1 from incident_events e where e.incident_id = i.id and e.action = 'created');
insert into incident_events (tenant_id, incident_id, actor_user_id, action, from_status, to_status, created_at)
select i.tenant_id, i.id, i.ack_by, 'status', 'open', 'ack', i.ack_at from incidents i
 where i.ack_at is not null and not exists (select 1 from incident_events e where e.incident_id = i.id and e.to_status = 'ack');
insert into incident_events (tenant_id, incident_id, action, from_status, to_status, created_at)
select i.tenant_id, i.id, 'status', case when i.ack_at is not null then 'ack' else 'open' end, 'closed', i.closed_at from incidents i
 where i.closed_at is not null and not exists (select 1 from incident_events e where e.incident_id = i.id and e.to_status = 'closed');

-- อัปเดต Ticket: เปลี่ยนสถานะ และ/หรือ เพิ่มหมายเหตุ (ผจก.โซนดูได้อย่างเดียว)
create or replace function update_incident(p_id uuid, p_status text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inc incidents%rowtype; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_inc from incidents where id = p_id and tenant_id = auth_tenant_id();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (is_tenant_staff() and not is_zone_manager()
          and (can_see_property(v_inc.property_id) or (v_inc.property_id is null and is_tenant_admin()))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_status is not null and p_status not in ('open','ack','on_site','closed','false_alarm') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;
  if (p_status is null or p_status = v_inc.status) and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'nothing_to_update');
  end if;

  if p_status is not null and p_status <> v_inc.status then
    update incidents set status = p_status, updated_at = now(),
      ack_by = case when p_status = 'ack' and ack_by is null then auth_user_id() else ack_by end,
      ack_at = case when p_status in ('ack','on_site','closed','false_alarm') and ack_at is null then now() else ack_at end,
      closed_at = case when p_status in ('closed','false_alarm') then now() when p_status in ('open','ack','on_site') then null else closed_at end,
      closed_by = case when p_status in ('closed','false_alarm') then auth_user_id() when p_status in ('open','ack','on_site') then null else closed_by end
    where id = p_id;
    insert into incident_events (tenant_id, incident_id, actor_user_id, action, from_status, to_status, note)
    values (v_inc.tenant_id, p_id, auth_user_id(), 'status', v_inc.status, p_status, v_note);
  else
    update incidents set updated_at = now() where id = p_id;
    insert into incident_events (tenant_id, incident_id, actor_user_id, action, note)
    values (v_inc.tenant_id, p_id, auth_user_id(), 'note', v_note);
  end if;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (v_inc.tenant_id, auth_user_id(), 'incident_update', 'incidents', p_id::text,
          jsonb_build_object('from', v_inc.status, 'to', coalesce(p_status, v_inc.status), 'note', v_note));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function update_incident(uuid, text, text) from public, anon;
grant execute on function update_incident(uuid, text, text) to authenticated;

-- ปุ่มเดิมในแผนที่กำลังพล (รับเรื่อง/ปิดเรื่อง) → ใช้ตัวใหม่ เพื่อให้มีประวัติเหมือนกัน
create or replace function set_incident_status(p_id uuid, p_status text) returns jsonb
language sql security definer set search_path = public as $$ select update_incident(p_id, p_status, null) $$;

-- รายการสำหรับหน้า Ticket + รายงาน (เวลารับเรื่อง/ปิดเรื่อง เป็นนาที)
drop view if exists v_incidents;
create view v_incidents with (security_invoker = on) as
select i.id, i.tenant_id, i.property_id, p.name as property_name, p.province, i.user_id, u.full_name, u.employee_code, u.phone,
       i.kind, i.category, i.note, i.photo_url, i.audio_url, i.status, i.ack_at, i.closed_at, i.created_at, i.updated_at,
       st_y(i.location::geometry) as lat, st_x(i.location::geometry) as lng,
       coalesce(u.line_picture_url, u.photo_url) as user_photo,
       ab.full_name as ack_by_name, cb.full_name as closed_by_name,
       case when i.ack_at is not null then round(extract(epoch from (i.ack_at - i.created_at)) / 60)::int end as ack_minutes,
       case when i.closed_at is not null then round(extract(epoch from (i.closed_at - i.created_at)) / 60)::int end as close_minutes,
       case when i.location is not null and p.center is not null then round(st_distance(i.location, p.center))::int end as distance_m,
       st_y(p.center::geometry) as site_lat, st_x(p.center::geometry) as site_lng
from incidents i
join users u on u.id = i.user_id
left join properties p on p.id = i.property_id
left join users ab on ab.id = i.ack_by
left join users cb on cb.id = i.closed_by;
grant select on v_incidents to authenticated;

create or replace view v_incident_events with (security_invoker = on) as
select e.id, e.incident_id, e.tenant_id, e.action, e.from_status, e.to_status, e.note, e.created_at,
       e.actor_user_id, a.full_name as actor_name, a.role as actor_role, coalesce(a.line_picture_url, a.photo_url) as actor_photo
from incident_events e left join users a on a.id = e.actor_user_id;
grant select on v_incident_events to authenticated;
