-- ============================================================================
-- 003 · Arreglo de la vista del tablero
-- ============================================================================
-- La vista 002 hacía `join auth.users` para resolver el email de los asignados.
-- El rol `authenticated` no tiene SELECT sobre auth.users, así que PostgREST
-- devolvía 42501 «permission denied for table users» en CADA lectura.
--
-- No era una fuga de datos: era la vista caída. Pero el fallo se disfrazaba de
-- «lista vacía» en el cliente, lo que es peor — un error silencioso se lee
-- como "no hay datos".
--
-- Arreglo: la resolución de asignados va en una función security definer que
-- comprueba pertenencia y devuelve '[]' si quien llama no es miembro. La vista
-- deja de tocar auth.users directamente.
--
-- Regla que se mantiene: nadie ve datos de otra organización. La función
-- devuelve vacío para extraños, no un error, para no filtrar ni la existencia
-- de la tarjeta.
-- ============================================================================

create or replace function public.task_card_assignees_json(p_card_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('user_id', a.user_id, 'email', u.email)
      order by a.assigned_at
    ),
    '[]'::jsonb
  )
  from public.task_card_assignees a
  join auth.users u on u.id = a.user_id
  where a.card_id = p_card_id
    and exists (
      select 1
      from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = p_card_id
        and public.task_is_org_member(b.organization_id)
    );
$$;

revoke all on function public.task_card_assignees_json(uuid) from public, anon;
grant execute on function public.task_card_assignees_json(uuid) to authenticated, service_role;

-- Recrear la vista sin tocar auth.users.
drop view if exists public.task_board_view;

create view public.task_board_view
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
  public.task_card_assignees_json(c.id) as assignees
from public.task_boards b
join public.task_lists l on l.board_id = b.id and l.archived_at is null
left join public.task_cards c on c.list_id = l.id and c.archived_at is null
where b.archived_at is null;

grant select on public.task_board_view to authenticated, service_role;
