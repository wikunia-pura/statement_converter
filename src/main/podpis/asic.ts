import AdmZip from 'adm-zip';
import zlib from 'zlib';

/*
 * ASiC-S (ETSI EN 319 162-1, the baseline profile TS 103 174 ZUS names): a ZIP
 * holding one signed file at its root and its detached signature under
 * META-INF/. The first entry must be "mimetype", stored (not compressed) and
 * without an extra field, so the container can be told by its first bytes —
 * which is why the ZIP is written here rather than by adm-zip, whose entry
 * order and methods are its own business.
 */

export const ASIC_S_MIME = 'application/vnd.etsi.asic-s+zip';

interface Wpis {
  nazwa: string;
  dane: Buffer;
  kompresja: boolean;
}

/** MS-DOS date and time of a ZIP header, local time as ZIP tools read it. */
function dosCzas(d: Date): { czas: number; data: number } {
  return {
    czas: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    data: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** A plain ZIP of the entries, in the order given: no data descriptors, no extra fields, UTF-8 names. */
function zip(wpisy: Wpis[], kiedy: Date): Buffer {
  const { czas, data } = dosCzas(kiedy);
  const lokalne: Buffer[] = [];
  const centralne: Buffer[] = [];
  let offset = 0;
  for (const w of wpisy) {
    const nazwa = Buffer.from(w.nazwa, 'utf8');
    const tresc = w.kompresja ? zlib.deflateRawSync(w.dane) : w.dane;
    const crc = zlib.crc32(w.dane) >>> 0;
    const metoda = w.kompresja ? 8 : 0;
    const flagi = 0x0800; // names in UTF-8

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed: 2.0
    lh.writeUInt16LE(flagi, 6);
    lh.writeUInt16LE(metoda, 8);
    lh.writeUInt16LE(czas, 10);
    lh.writeUInt16LE(data, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(tresc.length, 18);
    lh.writeUInt32LE(w.dane.length, 22);
    lh.writeUInt16LE(nazwa.length, 26);
    lh.writeUInt16LE(0, 28); // no extra field
    lokalne.push(lh, nazwa, tresc);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // made by: 2.0, MS-DOS attributes
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flagi, 8);
    ch.writeUInt16LE(metoda, 10);
    ch.writeUInt16LE(czas, 12);
    ch.writeUInt16LE(data, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(tresc.length, 20);
    ch.writeUInt32LE(w.dane.length, 24);
    ch.writeUInt16LE(nazwa.length, 28);
    // extra length, comment length, disk number, internal and external attributes: all zero
    ch.writeUInt32LE(offset, 42);
    centralne.push(ch, nazwa);

    offset += lh.length + nazwa.length + tresc.length;
  }
  const katalog = Buffer.concat(centralne);
  const koniec = Buffer.alloc(22);
  koniec.writeUInt32LE(0x06054b50, 0);
  koniec.writeUInt16LE(wpisy.length, 8);
  koniec.writeUInt16LE(wpisy.length, 10);
  koniec.writeUInt32LE(katalog.length, 12);
  koniec.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokalne, katalog, koniec]);
}

/** The container of one file and its detached CAdES signature (`META-INF/signature.p7s`). */
export function asicSCades(nazwa: string, dane: Buffer, podpis: Buffer, kiedy = new Date()): Buffer {
  return zip(
    [
      { nazwa: 'mimetype', dane: Buffer.from(ASIC_S_MIME, 'latin1'), kompresja: false },
      { nazwa, dane, kompresja: true },
      { nazwa: 'META-INF/signature.p7s', dane: podpis, kompresja: true },
    ],
    kiedy,
  );
}

export interface ZawartoscAsic {
  /** The signed file: its name in the container and its bytes. */
  nazwa: string;
  dane: Buffer;
  /** Everything under META-INF/, by name — the signature(s). */
  meta: Map<string, Buffer>;
}

/**
 * Opens an ASiC-S container (what ZUS answers with): the one file at its root besides "mimetype", and what is
 * under META-INF/. Throws when it is not a ZIP or holds no such file.
 */
export function otworzAsicS(bytes: Buffer): ZawartoscAsic {
  const zipFile = new AdmZip(bytes);
  const meta = new Map<string, Buffer>();
  let plik: { nazwa: string; dane: Buffer } | null = null;
  for (const e of zipFile.getEntries()) {
    if (e.isDirectory) continue;
    const nazwa = e.entryName;
    if (nazwa === 'mimetype') continue;
    if (nazwa.startsWith('META-INF/')) meta.set(nazwa, e.getData());
    else if (!plik) plik = { nazwa, dane: e.getData() };
  }
  if (!plik) throw new Error('ASiC: the container holds no signed file');
  return { ...plik, meta };
}
