-- ============================================================================
-- 004 · Administración: invitar, cambiar rol, dar de baja
-- ============================================================================
-- Restricción de diseño: crear usuarios en Supabase Auth requiere la clave
-- service_role, que NUNCA puede viajar al navegador. Por eso el alta no se
-- hace desde el admin: se genera una INVITACIÓN con token de un solo uso, y
-- es la propia persona quien se registra y canjea el token.
--
-- Ventaja de este modelo frente a "el admin crea la cuenta":
--   * El admin nunca elige ni conoce la contraseña de nadie.
--   * El token caduca (7 días) y es de un solo uso.
--   * El token solo vale para el email invitado: reenviarlo a un tercero no
--     sirve, porque al canjearlo se compara con el email de la sesión.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Crear invitación (solo owner)
-- ---------------------------------------------------------------------------
-- Devuelve el token en claro UNA vez. En la tabla solo queda su hash: quien
-- lea la tabla no puede reconstruir el enlace.
create or replace function public.task_create_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text default 'member'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_email text;
begin
  if not public.task_is_org_owner(p_organization_id) then
    raise exception 'only the organization owner can invite' using errcode = 'insufficient_privilege';
  end if;

  v_email := lower(btrim(p_email));
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'a valid email is required' using errcode = 'invalid_parameter_value';
  end if;

  if p_role not in ('owner', 'member') then
    raise exception 'invalid role' using errcode = 'invalid_parameter_value';
  end if;

  -- Ya es miembro: no tiene sentido invitarla otra vez.
  if exists (
    select 1
    from public.organization_memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
      and lower(u.email) = v_email
  ) then
    raise exception 'that person is already a member' using errcode = 'unique_violation';
  end if;

  -- 64 caracteres hex de entropía (dos UUID concatenados).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.task_invitations
    (organization_id, email, role, token_hash, invited_by, expires_at, accepted_at)
  values
    (p_organization_id, v_email, p_role,
     encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
     auth.uid(), now() + interval '7 days', null)
  on conflict (organization_id, email) do update
    set token_hash = excluded.token_hash,
        role       = excluded.role,
        invited_by = excluded.invited_by,
        expires_at = excluded.expires_at,
        accepted_at = null,
        created_at = now();

  insert into public.task_activity (organization_id, actor_id, action, payload)
  values (p_organization_id, auth.uid(), 'member.invited', jsonb_build_object('email', v_email));

  return v_token;
end;
$$;

revoke all on function public.task_create_invitation(uuid, text, text) from public, anon;
grant execute on function public.task_create_invitation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Canjear invitación
-- ---------------------------------------------------------------------------
-- La llama la persona invitada, ya autenticada. No requiere ser miembro
-- todavía (es justo el paso que la convierte en miembro).
create or replace function public.task_redeem_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_inv public.task_invitations%rowtype;
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_token), '') = '' then
    raise exception 'missing invitation token' using errcode = 'invalid_parameter_value';
  end if;

  v_hash := encode(sha256(convert_to(btrim(p_token), 'UTF8')), 'hex');

  select * into v_inv
  from public.task_invitations
  where token_hash = v_hash
  for update;

  if not found then
    raise exception 'invalid invitation' using errcode = 'invalid_parameter_value';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'invitation already used' using errcode = 'invalid_parameter_value';
  end if;

  if v_inv.expires_at < now() then
    raise exception 'invitation expired' using errcode = 'invalid_parameter_value';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  -- El token solo vale para el email invitado: reenviarlo no sirve.
  if v_email is distinct from v_inv.email then
    raise exception 'this invitation is for a different email address'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_inv.organization_id, v_uid, v_inv.role)
  on conflict (organization_id, user_id) do update set role = excluded.role;

  update public.task_invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  insert into public.task_activity (organization_id, actor_id, action, payload)
  values (v_inv.organization_id, v_uid, 'member.joined', jsonb_build_object('email', v_email));

  return v_inv.organization_id;
end;
$$;

revoke all on function public.task_redeem_invitation(text) from public, anon;
grant execute on function public.task_redeem_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Listar invitaciones pendientes (solo owner)
-- ---------------------------------------------------------------------------
create or replace function public.task_list_invitations(p_organization_id uuid)
returns table (id uuid, email text, role text, expires_at timestamptz, expired boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.role, i.expires_at, (i.expires_at < now() or i.accepted_at is not null)
  from public.task_invitations i
  where i.organization_id = p_organization_id
    and public.task_is_org_owner(p_organization_id)
    and i.accepted_at is null
  order by i.created_at desc;
$$;

revoke all on function public.task_list_invitations(uuid) from public, anon;
grant execute on function public.task_list_invitations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cambiar rol / dar de baja (solo owner)
-- ---------------------------------------------------------------------------
create or replace function public.task_set_member_role(
  p_organization_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.task_is_org_owner(p_organization_id) then
    raise exception 'only the organization owner can change roles' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'invalid role' using errcode = 'invalid_parameter_value';
  end if;

  -- No dejar la empresa sin dueño: es un candado, no una precaución.
  if p_role = 'member' and (
    select count(*) from public.organization_memberships
    where organization_id = p_organization_id and role = 'owner'
  ) <= 1 and exists (
    select 1 from public.organization_memberships
    where organization_id = p_organization_id and user_id = p_user_id and role = 'owner'
  ) then
    raise exception 'the organization must keep at least one owner' using errcode = 'check_violation';
  end if;

  update public.organization_memberships
     set role = p_role
   where organization_id = p_organization_id and user_id = p_user_id;

  insert into public.task_activity (organization_id, actor_id, action, payload)
  values (p_organization_id, auth.uid(), 'member.role_changed',
          jsonb_build_object('user_id', p_user_id, 'role', p_role));
end;
$$;

create or replace function public.task_remove_member(
  p_organization_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.task_is_org_owner(p_organization_id) then
    raise exception 'only the organization owner can remove members' using errcode = 'insufficient_privilege';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'you cannot remove yourself' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.organization_memberships
    where organization_id = p_organization_id and user_id = p_user_id and role = 'owner'
  ) then
    raise exception 'cannot remove an owner; change the role first' using errcode = 'check_violation';
  end if;

  -- El trigger task_membership_removal_cleanup limpia sus asignaciones.
  delete from public.organization_memberships
   where organization_id = p_organization_id and user_id = p_user_id;

  insert into public.task_activity (organization_id, actor_id, action, payload)
  values (p_organization_id, auth.uid(), 'member.removed', jsonb_build_object('user_id', p_user_id));
end;
$$;

revoke all on function public.task_set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.task_remove_member(uuid, uuid) from public, anon;
grant execute on function public.task_set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.task_remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Invitaciones: lectura directa solo por owner (política ya existente en 001)
-- se mantiene. Aquí se refuerza que nadie más las vea.
-- ---------------------------------------------------------------------------
drop policy if exists task_invitations_owner on public.task_invitations;
create policy task_invitations_owner on public.task_invitations
  for all to authenticated
  using (public.task_is_org_owner(organization_id))
  with check (public.task_is_org_owner(organization_id));
