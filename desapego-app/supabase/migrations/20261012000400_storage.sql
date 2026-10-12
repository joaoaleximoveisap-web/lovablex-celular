-- Desapego da Família — arquivos
-- media: fotos de anúncios e avatares. Leitura pública por link (caminhos aleatórios),
--        envio só na própria pasta (<id do usuário>/...), até 3 MB, somente imagem.
-- receipts: comprovantes de Pix. Privado: só o dono e o administrador abrem (link temporário).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media', 'media', true, 3145728, array['image/jpeg', 'image/webp', 'image/png']),
  ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/webp', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy media_select_own on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_member());
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy receipts_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_member());
create policy receipts_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
