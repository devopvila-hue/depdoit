-- ============================================================================
-- Departify Tasks — backend de tableros, listas, tarjetas y ASIGNACIÓN
-- ============================================================================
-- Modelo extraído del OpenAPI público de Trello con REA (2026-10-23):
--   191 rutas / 63 schemas. Entidades útiles: Board -> List -> Card.
--   Trello guarda los asignados como array de ids dentro de la tarjeta
--   (Card.idMembers, 33 campos en Card). Aquí se modela como tabla de unión
--   con clave foránea: una asignación a un usuario inexistente o ajeno a la
--   organización es IMPOSIBLE, no un dato huérfano.
--
-- Aislamiento: toda fila cuelga de una organización. RLS por membresía.
--   Regla congelada del Founder Brain: instancia privada por empresa, sin
--   mezclar clientes. Ninguna consulta cruza organizaciones.
--
-- Convenciones alineadas con departify (20260808120000_auth_tenant_access):
--   * public.organizations / public.organization_memberships ya existen.
--   * servicio_role opera desde backend; authenticated solo lee vía RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- ¿El usuario autenticado pertenece a esta organización?
create or replace function public.task_is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
  );
$$;

-- ¿El usuario autenticado es owner de esta organización?
create or replace function public.task_is_org_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.task_boards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  position integer not null default 0,
  archived_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index task_boards_org_idx on public.task_boards (organization_id, position);

create table public.task_lists (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.task_boards (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  position integer not null default 0,
  wip_limit integer check (wip_limit is null or wip_limit > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index task_lists_board_idx on public.task_lists (board_id, position);

create table public.task_cards (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.task_lists (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 500),
  description text not null default '',
  position integer not null default 0,
  start_date date,
  due_date date,
  priority text check (priority is null or priority in ('low', 'normal', 'high', 'urgent')),
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Inicio nunca después del fin. En la app ya se empuja el otro extremo;
  -- aquí se vuelve invariante de base de datos.
  constraint task_cards_date_order check (start_date is null or due_date is null or start_date <= due_date)
);

create index task_cards_list_idx on public.task_cards (list_id, position) where archived_at is null;
create index task_cards_due_idx on public.task_cards (due_date) where archived_at is null;

-- ASIGNACIÓN: el corazón de lo pedido.
create table public.task_card_assignees (
  card_id uuid not null references public.task_cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  assigned_by uuid not null references auth.users (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

create index task_card_assignees_user_idx on public.task_card_assignees (user_id);

create table public.task_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  color text not null default 'lime',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.task_card_labels (
  card_id uuid not null references public.task_cards (id) on delete cascade,
  label_id uuid not null references public.task_labels (id) on delete cascade,
  primary key (card_id, label_id)
);

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.task_cards (id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 500),
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index task_checklist_items_card_idx on public.task_checklist_items (card_id, position);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.task_cards (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index task_comments_card_idx on public.task_comments (card_id, created_at);

-- Feed de actividad. Trello separa Action con solo 8 campos; aquí igual.
create table public.task_activity (
  id bigserial primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  card_id uuid references public.task_cards (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index task_activity_org_idx on public.task_activity (organization_id, created_at desc);

-- Invitaciones: alta de usuarios a la organización.
create table public.task_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create index task_invitations_email_idx on public.task_invitations (lower(email));

-- ---------------------------------------------------------------------------
-- Integridad: no se puede asignar a quien no es miembro de la organización
-- ---------------------------------------------------------------------------
-- Trello no lo impide. Aquí sí: la asignación es un hecho del dominio, no un
-- array de strings. Si el usuario sale de la organización, se limpia.

create or replace function public.task_card_assignees_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
begin
  select b.organization_id
    into v_organization_id
  from public.task_cards c
  join public.task_lists l on l.id = c.list_id
  join public.task_boards b on b.id = l.board_id
  where c.id = new.card_id;

  if v_organization_id is null then
    raise exception 'card % does not exist', new.card_id;
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = v_organization_id
      and m.user_id = new.user_id
  ) then
    raise exception 'user % is not a member of organization %', new.user_id, v_organization_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger task_card_assignees_guard_trg
before insert or update on public.task_card_assignees
for each row execute function public.task_card_assignees_guard();

-- Al revés: si alguien deja la organización, sus asignaciones caen.
create or replace function public.task_membership_removal_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.task_card_assignees a
  using public.task_cards c,
        public.task_lists l,
        public.task_boards b
  where a.card_id = c.id
    and c.list_id = l.id
    and l.board_id = b.id
    and b.organization_id = old.organization_id
    and a.user_id = old.user_id;

  return old;
end;
$$;

create trigger task_membership_removal_cleanup_trg
after delete on public.organization_memberships
for each row execute function public.task_membership_removal_cleanup();

-- ---------------------------------------------------------------------------
-- Operación: mover tarjeta reindexando posiciones (sin decimales)
-- ---------------------------------------------------------------------------
-- El README del proyecto lo dice y tiene razón: el orden fraccional de Trello
-- se degrada con ediciones concurrentes. Aquí se renumera dentro de la misma
-- transacción, con la lista bloqueada.

create or replace function public.task_move_card(
  p_card_id uuid,
  p_target_list_id uuid,
  p_position integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_list uuid;
  v_board uuid;
  v_target_board uuid;
  v_org uuid;
begin
  select c.list_id, l.board_id into v_source_list, v_board
  from public.task_cards c
  join public.task_lists l on l.id = c.list_id
  where c.id = p_card_id;

  if v_board is null then
    raise exception 'card % not found', p_card_id;
  end if;

  select board_id into v_target_board from public.task_lists where id = p_target_list_id;
  if v_target_board is null or v_target_board <> v_board then
    raise exception 'target list % is not on the same board', p_target_list_id;
  end if;

  select organization_id into v_org from public.task_boards where id = v_board;
  if not public.task_is_org_member(v_org) then
    raise exception 'not a member of this organization' using errcode = 'insufficient_privilege';
  end if;

  -- Bloquea la lista destino para que dos movimientos no se pisen.
  perform 1 from public.task_lists where id = p_target_list_id for update;

  update public.task_cards
     set list_id = p_target_list_id,
         position = least(greatest(p_position, 0), 1000000),
         updated_at = now()
   where id = p_card_id;

  -- Renumera la lista destino por orden actual.
  with ordered as (
    select id, row_number() over (order by position, created_at, id) - 1 as new_pos
    from public.task_cards
    where list_id = p_target_list_id and archived_at is null
  )
  update public.task_cards c
     set position = ordered.new_pos
    from ordered
   where c.id = ordered.id;

  -- Cierra el hueco en la lista de origen.
  if v_source_list <> p_target_list_id then
    with ordered as (
      select id, row_number() over (order by position, created_at, id) - 1 as new_pos
      from public.task_cards
      where list_id = v_source_list and archived_at is null
    )
    update public.task_cards c
       set position = ordered.new_pos
      from ordered
     where c.id = ordered.id;
  end if;
end;
$$;

revoke all on function public.task_move_card(uuid, uuid, integer) from public, anon;
grant execute on function public.task_move_card(uuid, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.task_boards            enable row level security;
alter table public.task_lists             enable row level security;
alter table public.task_cards             enable row level security;
alter table public.task_card_assignees    enable row level security;
alter table public.task_labels            enable row level security;
alter table public.task_card_labels       enable row level security;
alter table public.task_checklist_items   enable row level security;
alter table public.task_comments          enable row level security;
alter table public.task_activity          enable row level security;
alter table public.task_invitations       enable row level security;

-- boards
create policy task_boards_select on public.task_boards
  for select to authenticated using (public.task_is_org_member(organization_id));
create policy task_boards_insert on public.task_boards
  for insert to authenticated with check (public.task_is_org_member(organization_id) and created_by = auth.uid());
create policy task_boards_update on public.task_boards
  for update to authenticated using (public.task_is_org_member(organization_id)) with check (public.task_is_org_member(organization_id));
create policy task_boards_delete on public.task_boards
  for delete to authenticated using (public.task_is_org_owner(organization_id));

-- lists (la organización se resuelve por el tablero)
create policy task_lists_select on public.task_lists
  for select to authenticated using (
    exists (select 1 from public.task_boards b where b.id = board_id and public.task_is_org_member(b.organization_id))
  );
create policy task_lists_write on public.task_lists
  for all to authenticated using (
    exists (select 1 from public.task_boards b where b.id = board_id and public.task_is_org_member(b.organization_id))
  ) with check (
    exists (select 1 from public.task_boards b where b.id = board_id and public.task_is_org_member(b.organization_id))
  );

-- cards
create policy task_cards_select on public.task_cards
  for select to authenticated using (
    exists (
      select 1 from public.task_lists l join public.task_boards b on b.id = l.board_id
      where l.id = list_id and public.task_is_org_member(b.organization_id)
    )
  );
create policy task_cards_write on public.task_cards
  for all to authenticated using (
    exists (
      select 1 from public.task_lists l join public.task_boards b on b.id = l.board_id
      where l.id = list_id and public.task_is_org_member(b.organization_id)
    )
  ) with check (
    exists (
      select 1 from public.task_lists l join public.task_boards b on b.id = l.board_id
      where l.id = list_id and public.task_is_org_member(b.organization_id)
    )
  );

-- assignees
create policy task_assignees_select on public.task_card_assignees
  for select to authenticated using (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  );
create policy task_assignees_write on public.task_card_assignees
  for all to authenticated using (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  ) with check (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  );

-- labels
create policy task_labels_select on public.task_labels
  for select to authenticated using (public.task_is_org_member(organization_id));
create policy task_labels_write on public.task_labels
  for all to authenticated using (public.task_is_org_member(organization_id)) with check (public.task_is_org_member(organization_id));

create policy task_card_labels_all on public.task_card_labels
  for all to authenticated using (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  ) with check (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  );

-- checklist
create policy task_checklist_all on public.task_checklist_items
  for all to authenticated using (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  ) with check (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  );

-- comments
create policy task_comments_all on public.task_comments
  for all to authenticated using (
    exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  ) with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.task_cards c
      join public.task_lists l on l.id = c.list_id
      join public.task_boards b on b.id = l.board_id
      where c.id = card_id and public.task_is_org_member(b.organization_id)
    )
  );

-- activity: lectura por miembros, escritura solo backend
create policy task_activity_select on public.task_activity
  for select to authenticated using (public.task_is_org_member(organization_id));

-- invitations: solo owner las ve y las crea
create policy task_invitations_owner on public.task_invitations
  for all to authenticated using (public.task_is_org_owner(organization_id)) with check (public.task_is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.task_boards, public.task_lists, public.task_cards,
  public.task_card_assignees, public.task_labels, public.task_card_labels,
  public.task_checklist_items, public.task_comments, public.task_activity,
  public.task_invitations
  to authenticated;

grant insert, update, delete on public.task_boards, public.task_lists,
  public.task_cards, public.task_card_assignees, public.task_labels,
  public.task_card_labels, public.task_checklist_items, public.task_comments,
  public.task_invitations
  to authenticated;

grant usage, select on sequence public.task_activity_id_seq to authenticated;

grant all on public.task_boards, public.task_lists, public.task_cards,
  public.task_card_assignees, public.task_labels, public.task_card_labels,
  public.task_checklist_items, public.task_comments, public.task_activity,
  public.task_invitations
  to service_role;

-- updated_at
create or replace function public.task_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger task_boards_touch before update on public.task_boards
  for each row execute function public.task_touch_updated_at();
create trigger task_lists_touch before update on public.task_lists
  for each row execute function public.task_touch_updated_at();
create trigger task_cards_touch before update on public.task_cards
  for each row execute function public.task_touch_updated_at();
