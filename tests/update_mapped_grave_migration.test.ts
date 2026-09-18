import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260917120000_update_mapped_grave.sql'),
  'utf8'
);

const SIGNATURE = 'text, text, text, text, text, text, date, date';

describe('Update Mapped Grave Migration Tests', () => {
  it('runs as a locked-down security definer that checks the caller', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.update_mapped_grave\(\s+p_grave_id text,/);
    expect(MIGRATION).toMatch(/security definer\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/v_caller uuid := \(select auth\.uid\(\)\);/);
    expect(MIGRATION).toMatch(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/);
    expect(MIGRATION).toContain(`revoke execute on function public.update_mapped_grave(${SIGNATURE}) from public, anon;`);
    expect(MIGRATION).toContain(`grant execute on function public.update_mapped_grave(${SIGNATURE}) to authenticated;`);
  });

  it('takes exactly the details the capture form collects, by the names the app sends', () => {
    for (const param of ['p_first_name text', 'p_middle_names text', 'p_surname text', 'p_nickname text', 'p_grave_number text', 'p_birth_date date', 'p_death_date date']) {
      expect(MIGRATION).toContain(param);
    }
    expect(MIGRATION).not.toMatch(/p_latitude|p_longitude|p_cemetery_id/);
  });

  it('only lets the person who mapped the grave edit it, and says when the grave is gone', () => {
    expect(MIGRATION).toMatch(/select \* into v_grave from public\.graves where id = p_grave_id for update;/);
    expect(MIGRATION).toMatch(/raise exception 'This grave no longer exists\.' using errcode = 'P0002';/);
    expect(MIGRATION).toMatch(/if v_grave\.created_by is distinct from v_caller then\s+raise exception 'Only the person who mapped this grave can edit it\.';/);
  });

  it('stays allowed after other people have added photos or saved the grave', () => {
    expect(MIGRATION).not.toMatch(/from public\.grave_photos/);
    expect(MIGRATION).not.toMatch(/from public\.saved_graves/);
  });

  it('requires a name and refuses a death before the birth', () => {
    expect(MIGRATION).toMatch(/if v_first_name = '' or v_surname = '' then\s+raise exception '[^']+' using errcode = '22023';/);
    expect(MIGRATION).toMatch(/p_death_date < p_birth_date then\s+raise exception '[^']+' using errcode = '22023';/);
  });

  it("will not rewrite a person record that is someone else's or shared with another grave", () => {
    expect(MIGRATION).toMatch(/from public\.persons where id = v_person_id and created_by is distinct from v_caller/);
    expect(MIGRATION).toMatch(/from public\.graves where person_id = v_person_id and id <> p_grave_id/);
    expect(MIGRATION).toMatch(/errcode = '55000'/);
  });

  it('updates the person with the full name kept in step, and the grave with a fresh updated_at', () => {
    expect(MIGRATION).toMatch(/v_full_name := concat_ws\(' ', v_first_name, v_middle_names, v_surname\);/);
    expect(MIGRATION).toMatch(/update public\.persons\s+set first_name = v_first_name,[\s\S]+full_name = v_full_name,[\s\S]+death_date = p_death_date\s+where id = v_person_id;/);
    expect(MIGRATION).toMatch(/update public\.graves\s+set person_id = v_person_id,\s+grave_number = v_grave_number,\s+updated_at = now\(\)\s+where id = p_grave_id;/);
  });

  it('never touches the position, the photos or who mapped the grave', () => {
    const graveUpdate = /update public\.graves[\s\S]+?where id = p_grave_id;/.exec(MIGRATION)?.[0] ?? '';
    expect(graveUpdate).not.toMatch(/latitude|longitude|created_by|primary_photo_url|cemetery_id|status/);
  });

  it('writes the edit to the provenance log', () => {
    expect(MIGRATION).toMatch(/insert into public\.provenance_logs \(id, grave_id, contributor, action, source, details\)/);
    expect(MIGRATION).toMatch(/'MANUAL'/);
  });

  it('keeps direct writes to graves and persons closed so the function is the only way in', () => {
    expect(MIGRATION).not.toMatch(/create policy/i);
  });

  it('calls auth.uid() once, wrapped in a select', () => {
    expect(MIGRATION.replace(/\(select auth\.uid\(\)\)/g, '')).not.toMatch(/auth\.uid\(\)/);
  });
});
