create table projects(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users,
  name text not null, created_at timestamptz default now());
create table phone_links(
  phone text primary key, -- formato WhatsApp sin '+', ej: 51987654321
  project_id uuid not null references projects on delete cascade, person_name text);
create table messages(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  wa_id text unique, kind text, body text, media_path text, created_at timestamptz default now());
create table events(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  message_id uuid references messages on delete set null,
  type text not null check (type in ('avance','bloqueo','logistica','incidencia','personal')),
  front text, summary text not null, detail jsonb default '{}',
  severity text not null default 'baja' check (severity in ('baja','media','alta')),
  status text not null default 'abierto' check (status in ('abierto','resuelto')),
  media_path text, created_at timestamptz default now());
create table daily_reports(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  report_date date not null, html text not null, unique(project_id, report_date));
create index on events(project_id, created_at desc);

alter table projects enable row level security;
create policy own on projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
do $$ declare t text; begin
  foreach t in array array['phone_links','messages','events','daily_reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy own on %I for all using (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()))', t);
  end loop; end $$;

insert into storage.buckets(id, name, public) values ('obra','obra',false);
create policy obra_read on storage.objects for select using (
  bucket_id = 'obra' and exists (select 1 from projects p
    where p.id::text = (storage.foldername(name))[1] and p.owner_id = auth.uid()));
