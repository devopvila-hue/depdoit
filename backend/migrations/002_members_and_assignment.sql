-- ============================================================================
-- 002 · Miembros visibles para asignar + API de asignación
-- ============================================================================
-- Para asignar una tarea hace falta poder LISTAR a quién se la asignas.
-- La política base de organization_memberships solo deja ver tu propia fila,
-- así que el desplegable de asignados estaría siempre vacío.
--
-- Aquí se abre exactamente lo necesario: un miembro ve a los demás miembros de
-- las organizaciones a las que pertenece. Nada más. No se expone la
-- pertenencia de otras empresas, ni emails de fuera de tu instancia.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Listar miembros de una organización a la que pertenezco
-- ---------------------------------------------------------------------------
-- Devuelve id y email. La comprobación de pertenencia va dentro de la función
-- (security definer), pero solo responde si quien llama es miembro.
create or replace function public.task_list_members(p_organization_id uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.organization_memberships m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id
    and public.task_is_org_member(p_organization_id)
  order by
    case m.role when 'owner' then 0 else 1 end,
    m.created_at;
$$;

revoke all on function public.task_list_members(uuid) from public, anon;
grant execute on function public.task_list_members(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Asignar / desasignar desde la app (una sola llamada, idempotente)
-- ---------------------------------------------------------------------------
create or replace function public.task_assign_card(
  p_card_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select b.organization_id into v_org
  from public.task_cards c
  join public.task_lists l on l.id = c.list_id
  join public.task_boards b on b.id = l.board_id
  where c.id = p_card_id;

  if v_org is null then
    raise exception 'card % not found', p_card_id;
  end if;

  if not public.task_is_org_member(v_org) then
    raise exception 'not a member of this organization' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = v_org and m.user_id = p_user_id
  ) then
    raise exception 'user is not a member of this organization' using errcode = 'check_violation';
  end if;

  insert into public.task_card_assignees (card_id, user_id, assigned_by)
  values (p_card_id, p_user_id, auth.uid())
  on conflict (card_id, user_id) do nothing;

  insert into public.task_activity (organization_id, card_id, actor_id, action, payload)
  values (v_org, p_card_id, auth.uid(), 'card.assigned', jsonb_build_object('user_id', p_user_id));
end;
$$;

create or replace function public.task_unassign_card(
  p_card_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select b.organization_id into v_org
  from public.task_cards c
  join public.task_lists l on l.id = c.list_id
  join public.task_boards b on b.id = l.board_id
  where c.id = p_card_id;

  if v_org is null then
    raise exception 'card % not found', p_card_id;
  end if;

  if not public.task_is_org_member(v_org) then
    raise exception 'not a member of this organization' using errcode = 'insufficient_privilege';
  end if;

  delete from public.task_card_assignees
   where card_id = p_card_id and user_id = p_user_id;

  insert into public.task_activity (organization_id, card_id, actor_id, action, payload)
  values (v_org, p_card_id, auth.uid(), 'card.unassigned', jsonb_build_object('user_id', p_user_id));
end;
$$;

revoke all on function public.task_assign_card(uuid, uuid) from public, anon;
revoke all on function public.task_unassign_card(uuid, uuid) from public, anon;
grant execute on function public.task_assign_card(uuid, uuid) to authenticated, service_role;
grant execute on function public.task_unassign_card(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vista del tablero en una sola llamada
-- ---------------------------------------------------------------------------
-- El frontend necesita tablero + listas + tarjetas + asignados de golpe.
-- Sin esto serían 4 viajes por carga. security_invoker respeta las RLS de
-- cada tabla, así que la vista no es una puerta trasera.
create or replace view public.task_board_view
with (security_invoker = true)
as
select
  b.id            as board_id,
  b.organization_id,
  b.name          as board_name,
  l.id            as list_id,
  l.name          as list_name,
  l.position      as list_position,
  l.wip_limit,
  c.id            as card_id,
  c.title,
  c.description,
  c.position      as card_position,
  c.start_date,
  c.due_date,
  c.priority,
  c.completed_at,
  c.archived_at,
  coalesce(
    (select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', u.email) order by a.assigned_at)
       from public.task_card_assignees a
       join auth.users u on u.id = a.user_id
      where a.card_id = c.id),
    '[]'::jsonb
  ) as assignees
from public.task_boards b
join public.task_lists l on l.board_id = b.id and l.archived_at is null
left join public.task_cards c on c.list_id = l.id and c.archived_at is null
where b.archived_at is null;

grant select on public.task_board_view to authenticated, service_role;
