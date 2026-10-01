import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import log from 'electron-log';
import { getSupabase } from './supabaseClient';
import { ZadanieZalacznik } from '../shared/types';
import { ZADANIE_ATTACHMENT_MAX_BYTES, ZADANIE_STORAGE_KEY } from '../shared/zadania';

/** Private bucket created by supabase/zadania-termin-zalaczniki.sql. */
export const ZADANIA_BUCKET = 'zadania-zalaczniki';

/** Why a file was refused, as a code the renderer words in the user's language. */
export type AttachmentRefusal = 'too_large' | 'not_a_file' | 'unreadable';

/** Size and kind check, shared by the picker (cheap, before any read) and the upload. */
export async function checkAttachmentFile(
  filePath: string,
): Promise<{ ok: true; size: number } | { ok: false; error: AttachmentRefusal }> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return { ok: false, error: 'not_a_file' };
    if (stat.size > ZADANIE_ATTACHMENT_MAX_BYTES) return { ok: false, error: 'too_large' };
    return { ok: true, size: stat.size };
  } catch {
    return { ok: false, error: 'unreadable' };
  }
}

/**
 * Put a file in the bucket and describe it.
 *
 * The object key is a fresh uuid plus the file's extension, never its name: a
 * name can carry characters storage rejects (Polish letters, brackets), and two
 * people attaching "scan.pdf" must not overwrite each other. The real name rides
 * along in the description and is what the user sees and saves under.
 */
export async function uploadAttachment(filePath: string, who: string): Promise<ZadanieZalacznik> {
  const checked = await checkAttachmentFile(filePath);
  if (!checked.ok) throw new Error(checked.error);

  const buffer = await fs.promises.readFile(filePath);
  // Re-checked on the bytes actually read: the file could have grown since the stat.
  if (buffer.length > ZADANIE_ATTACHMENT_MAX_BYTES) throw new Error('too_large');

  const nazwa = path.basename(filePath);
  const ext = path.extname(nazwa).toLowerCase();
  const id = randomUUID();
  const sciezka = /^\.[a-z0-9]{1,16}$/.test(ext) ? `${id}${ext}` : id;

  const { error } = await getSupabase()
    .storage.from(ZADANIA_BUCKET)
    .upload(sciezka, buffer, { contentType: 'application/octet-stream', upsert: false });
  if (error) throw new Error(`uploadAttachment: ${error.message}`);

  return {
    id,
    nazwa,
    rozmiar: buffer.length,
    sciezka,
    dodanyBy: who,
    dodanyAt: new Date().toISOString(),
  };
}

export async function downloadAttachment(sciezka: string): Promise<Buffer> {
  if (!ZADANIE_STORAGE_KEY.test(sciezka)) throw new Error('Nieprawidłowy załącznik.');
  const { data, error } = await getSupabase().storage.from(ZADANIA_BUCKET).download(sciezka);
  if (error || !data) throw new Error(`downloadAttachment: ${error?.message ?? 'brak danych'}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Delete objects. Never throws: by the time this runs the row already says the
 * file is gone, and an object that could not be deleted is an orphan costing a
 * few kilobytes — not a reason to fail the user's save.
 */
export async function removeAttachments(paths: string[]): Promise<void> {
  const keys = paths.filter((p) => ZADANIE_STORAGE_KEY.test(p));
  if (keys.length === 0) return;
  const { error } = await getSupabase().storage.from(ZADANIA_BUCKET).remove(keys);
  if (error) log.warn(`[ZADANIA] could not remove ${keys.length} attachment(s): ${error.message}`);
}
