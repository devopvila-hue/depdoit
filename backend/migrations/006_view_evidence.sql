-- ============================================================================
-- 006 · La vista del tablero incluye los campos de evidencia
-- ============================================================================
-- La vista de 003 se creó antes de que existieran kind/severity/expected/
-- actual/verified_by. Sin esto, el frontend no puede pintar la evidencia:
-- PostgREST solo devuelve columnas que la vista expone.
--
-- Se recrea completa (no se puede "alter view" añadiendo columnas al final de
-- forma fiable en todas las versiones). security_invoker se mantiene: la vista
-- nunca es una puerta trasera a las RLS.
-- ============================================================================

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
  c.kind,
  c.severity,
  c.expected,
  c.actual,
  c.verified_by,
  c.verified_at,
  public.task_card_assignees_json(c.id) as assignees
from public.task_boards b
join public.task_lists l on l.board_id = b.id and l.archived_at is null
left join public.task_cards c on c.list_id = l.id and c.archived_at is null
where b.archived_at is null;

grant select on public.task_board_view to authenticated, service_role;
