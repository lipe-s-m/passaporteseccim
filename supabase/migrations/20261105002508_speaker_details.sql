-- Conteúdo editorial público das palestras; preenchimento pelo futuro painel administrativo.
-- A foto aceita apenas URLs https do Cloudinary. Nenhuma imagem ou texto é enviado nesta migração.
begin;

alter table public.activities
  add column short_description text not null default '',
  add column speaker_name text not null default '',
  add column speaker_photo_url text,
  add column speaker_bio text not null default '',
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column speaker_socials jsonb not null default '{}'::jsonb,
  add column slides_url text;

alter table public.activities
  add constraint activities_short_description_length check (length(short_description) <= 800),
  add constraint activities_speaker_name_length check (length(speaker_name) <= 160),
  add constraint activities_speaker_bio_length check (length(speaker_bio) <= 4000),
  add constraint activities_speaker_photo_cloudinary check (
    speaker_photo_url is null or (length(speaker_photo_url) <= 2048 and speaker_photo_url ~ '^https://res[.]cloudinary[.]com/[[:graph:]]+$')
  ),
  add constraint activities_speaker_socials_shape check (
    jsonb_typeof(speaker_socials) = 'object' and length(speaker_socials::text) <= 2000
  ),
  add constraint activities_slides_https check (
    slides_url is null or (length(slides_url) <= 2048 and slides_url ~ '^https://[^[:space:]]+$')
  ),
  add constraint activities_end_after_start check (starts_at is null or ends_at is null or ends_at > starts_at);

comment on column public.activities.short_description is 'Resumo curto para o topo da página de detalhes.';
comment on column public.activities.speaker_photo_url is 'URL pública de imagem hospedada em res.cloudinary.com.';
comment on column public.activities.speaker_bio is 'Mini bio pública do palestrante.';
comment on column public.activities.speaker_socials is 'Links https públicos; chaves previstas: instagram, linkedin, youtube e website.';
comment on column public.activities.starts_at is 'Data e hora local da palestra armazenadas com fuso, para exibição em America/Sao_Paulo.';
comment on column public.activities.ends_at is 'Horário de término opcional.';
comment on column public.activities.slides_url is 'Link público https para slides ou materiais da palestra.';

commit;
