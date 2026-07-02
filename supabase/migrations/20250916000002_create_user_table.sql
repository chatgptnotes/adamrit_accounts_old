-- Create User table
create table public."User" (
  id uuid not null default extensions.uuid_generate_v4 (),
  email text not null,
  password text not null,
  role text not null default 'user'::text,
  created_at timestamp with time zone null default timezone ('utc'::text, now()),
  hospital_type character varying null,
  constraint User_pkey primary key (id),
  constraint User_email_key unique (email)
) TABLESPACE pg_default;