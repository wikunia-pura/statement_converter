import fs from 'fs';
import os from 'os';
import path from 'path';
import type * as Pkcs11Js from 'pkcs11js';
import type { PodpisCzytnik, PodpisKartaStan, PodpisWybor } from '../../shared/types';
import { ecdsaDer, sha256 } from './cades';
import { czytajCertyfikat, type Certyfikat } from './certyfikat';

/*
 * The signing card through PKCS#11 — the library Szafir installs for KIR cards
 * (CryptoTech "CCGraphite"). The app never sees the private key: it hands the
 * card the bytes and gets the signature back, after the PIN.
 *
 * Every operation initializes the library, works, and finalizes it again, one
 * at a time: a reader plugged in after the app started shows up on the next
 * look, and nothing is left logged in between signatures.
 */

type Pkcs11 = typeof Pkcs11Js;

let modul: Pkcs11 | null = null;

/** pkcs11js on first use, so a broken native build only disables signing, never the app. */
function pkcs11js(): Pkcs11 {
  if (!modul) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      modul = require('pkcs11js') as Pkcs11;
    } catch (error: unknown) {
      throw new Error(
        `Moduł obsługi kart (pkcs11js) nie wczytał się: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return modul;
}

// ------------------------------------------------------------------ library

/**
 * The library's file names, as Szafir 2 itself looks them up: Graphite (KIR's
 * cards today) first, then Carbon (older cards). 64-bit only — so is the app.
 */
const NAZWY_WIN = ['CCGraphiteP11p.x64.dll', 'CCP1164.dll'];

function kandydaci(): string[] {
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.LOCALAPPDATA].filter(
      (r): r is string => !!r,
    );
    const dirs: string[] = [];
    const subdirs = (dir: string): string[] => {
      try {
        return fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => path.join(dir, d.name));
      } catch {
        return [];
      }
    };
    // Szafir installs as "<Program Files>\Szafir2\app"; the driver package
    // under a vendor folder. Look one level into anything that sounds like them.
    for (const root of roots) {
      for (const dir of subdirs(root).filter((d) => /szafir|kir|crypto/i.test(path.basename(d)))) {
        dirs.push(dir, path.join(dir, 'app'));
        for (const sub of subdirs(dir)) dirs.push(sub, path.join(sub, 'app'));
      }
    }
    dirs.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'));
    return NAZWY_WIN.flatMap((name) => dirs.map((dir) => path.join(dir, name)));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Szafir2.app/Contents/app/libPKCS11Graphite.dylib',
      path.join(os.homedir(), 'Applications/Szafir2.app/Contents/app/libPKCS11Graphite.dylib'),
      '/usr/local/lib/libCCGraphiteP11.dylib',
    ];
  }
  return ['/usr/lib/libCCGraphiteP11.so', '/usr/local/lib/libCCGraphiteP11.so'];
}

/** The library to use: the one picked in Settings if it still exists, else the first one next to Szafir. */
function biblioteka(wskazana: string): { sciezka: string; wskazana: boolean } | null {
  if (wskazana && fs.existsSync(wskazana)) return { sciezka: wskazana, wskazana: true };
  const found = kandydaci().find((p) => fs.existsSync(p));
  return found ? { sciezka: found, wskazana: false } : null;
}

let zaladowana: { sciezka: string; p11: Pkcs11Js.PKCS11 } | null = null;

function zaladuj(sciezka: string): Pkcs11Js.PKCS11 {
  if (zaladowana?.sciezka === sciezka) return zaladowana.p11;
  if (zaladowana) {
    try {
      zaladowana.p11.close();
    } catch {
      // Unloading the old library is best effort.
    }
    zaladowana = null;
  }
  if (process.platform === 'win32') {
    // LoadLibrary by full path does not look next to the DLL for its own
    // dependencies; PATH is searched, so put its folder there.
    const dir = path.dirname(sciezka);
    const parts = (process.env.PATH ?? '').split(path.delimiter);
    if (!parts.some((p) => p.toLowerCase() === dir.toLowerCase())) process.env.PATH = [dir, ...parts].join(path.delimiter);
  }
  const p11 = new (pkcs11js().PKCS11)();
  p11.load(sciezka);
  zaladowana = { sciezka, p11 };
  return p11;
}

let kolejka: Promise<unknown> = Promise.resolve();

/** One card operation at a time, the library initialized only for its length. */
function zBiblioteka<T>(sciezka: string, praca: (p11: Pkcs11Js.PKCS11, k: Pkcs11) => Promise<T>): Promise<T> {
  const run = kolejka.then(async () => {
    const k = pkcs11js();
    const p11 = zaladuj(sciezka);
    try {
      p11.C_Initialize({ flags: k.CKF_OS_LOCKING_OK });
    } catch (error: unknown) {
      if (kod(error) !== k.CKR_CRYPTOKI_ALREADY_INITIALIZED) throw error;
    }
    try {
      return await praca(p11, k);
    } finally {
      try {
        p11.C_Finalize();
      } catch {
        // Already finalized — nothing to release.
      }
    }
  });
  kolejka = run.catch(() => undefined);
  return run;
}

/** Unload on quit. */
export function zamknijKarte(): void {
  try {
    zaladowana?.p11.close();
  } catch {
    // Quitting anyway.
  }
  zaladowana = null;
}

// ------------------------------------------------------------------ errors

const kod = (error: unknown): number | undefined =>
  error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'number'
    ? (error as { code: number }).code
    : undefined;

/** The card's error in words; the PKCS#11 name stays in the log, not on screen. */
function komunikat(error: unknown, k: Pkcs11): string {
  switch (kod(error)) {
    case k.CKR_PIN_INCORRECT:
      return 'Błędny PIN.';
    case k.CKR_PIN_LEN_RANGE:
      return 'PIN ma niewłaściwą długość.';
    case k.CKR_PIN_LOCKED:
      return 'PIN jest zablokowany. Odblokuj go kodem PUK w programie do zarządzania kartą.';
    case k.CKR_PIN_EXPIRED:
      return 'PIN wygasł. Ustaw nowy w programie do zarządzania kartą.';
    case k.CKR_TOKEN_NOT_PRESENT:
    case k.CKR_DEVICE_REMOVED:
      return 'Karta została wyjęta z czytnika.';
    case k.CKR_FUNCTION_CANCELED:
      return 'Wpisywanie PIN-u na czytniku zostało przerwane.';
    case k.CKR_DEVICE_ERROR:
      return 'Błąd czytnika albo karty. Wyjmij kartę i włóż ją ponownie.';
    default:
      return `Błąd karty: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ------------------------------------------------------------------ reading the card

/** Every certificate on the token, with its CKA_ID; unreadable ones are skipped. */
function certyfikaty(p11: Pkcs11Js.PKCS11, k: Pkcs11, session: Buffer): { id: string; cert: Certyfikat }[] {
  p11.C_FindObjectsInit(session, [{ type: k.CKA_CLASS, value: k.CKO_CERTIFICATE }]);
  const handles: Buffer[] = [];
  try {
    for (let h = p11.C_FindObjects(session); h; h = p11.C_FindObjects(session)) handles.push(h);
  } finally {
    p11.C_FindObjectsFinal(session);
  }
  return handles.flatMap((h) => {
    let cert: Certyfikat;
    try {
      const [value] = p11.C_GetAttributeValue(session, h, [{ type: k.CKA_VALUE }]);
      cert = czytajCertyfikat(value.value as Buffer);
    } catch {
      return [];
    }
    // Asked apart: a certificate without CKA_ID is still listed, it just cannot sign.
    let id = '';
    try {
      const [attr] = p11.C_GetAttributeValue(session, h, [{ type: k.CKA_ID }]);
      id = (attr.value as Buffer).toString('hex');
    } catch {
      // No CKA_ID on this object.
    }
    return [{ id, cert }];
  });
}

/** The mechanisms that sign, by name — enough to see why a card cannot sign. */
function mechanizmy(p11: Pkcs11Js.PKCS11, k: Pkcs11, slot: Buffer): string[] {
  const names = new Map<number, string>();
  for (const [key, value] of Object.entries(k)) {
    if (key.startsWith('CKM_') && typeof value === 'number' && !names.has(value)) names.set(value, key.slice(4));
  }
  return p11
    .C_GetMechanismList(slot)
    .map((m) => names.get(m) ?? `0x${m.toString(16)}`)
    .filter((n) => /RSA|ECDSA/.test(n) && !/KEY_PAIR_GEN|OAEP|X_509|WRAP/.test(n));
}

function czytnik(p11: Pkcs11Js.PKCS11, k: Pkcs11, slot: Buffer, zKarta: boolean): PodpisCzytnik {
  const info = p11.C_GetSlotInfo(slot);
  const base: PodpisCzytnik = {
    slot: slot.toString('hex'),
    nazwa: info.slotDescription.trim(),
    karta: null,
    certyfikaty: [],
    mechanizmy: [],
  };
  if (!zKarta) return base;
  try {
    const t = p11.C_GetTokenInfo(slot);
    const session = p11.C_OpenSession(slot, k.CKF_SERIAL_SESSION);
    let certs: { id: string; cert: Certyfikat }[];
    try {
      certs = certyfikaty(p11, k, session);
    } finally {
      p11.C_CloseSession(session);
    }
    return {
      ...base,
      karta: {
        etykieta: t.label.trim(),
        producent: t.manufacturerID.trim(),
        model: t.model.trim(),
        numer: t.serialNumber.trim(),
        pinNaCzytniku: (t.flags & k.CKF_PROTECTED_AUTHENTICATION_PATH) !== 0,
        pinMaloProb: (t.flags & k.CKF_USER_PIN_COUNT_LOW) !== 0,
        pinOstatniaProba: (t.flags & k.CKF_USER_PIN_FINAL_TRY) !== 0,
        pinZablokowany: (t.flags & k.CKF_USER_PIN_LOCKED) !== 0,
      },
      certyfikaty: certs
        .filter((c) => !c.cert.ca)
        .map(({ id, cert }) => ({
          id,
          podmiot: cert.podmiot,
          wystawca: cert.wystawca,
          numerSeryjny: cert.numerSeryjny,
          waznyOd: cert.waznyOd,
          waznyDo: cert.waznyDo,
          kwalifikowany: cert.kwalifikowany,
          doPodpisu: cert.doPodpisu,
          klucz: cert.klucz,
        })),
      mechanizmy: mechanizmy(p11, k, slot),
    };
  } catch (error: unknown) {
    return { ...base, blad: komunikat(error, k) };
  }
}

/** The library in use and every reader, read fresh. Never throws — a failure is in `blad`. */
export async function stanKarty(wskazana: string): Promise<PodpisKartaStan> {
  const lib = biblioteka(wskazana);
  if (!lib) {
    return {
      reczna: wskazana,
      biblioteka: null,
      blad: 'Nie znaleziono biblioteki karty. Zainstaluj Szafir 2 albo wskaż plik biblioteki w Ustawieniach.',
      czytniki: [],
    };
  }
  try {
    return await zBiblioteka(lib.sciezka, async (p11, k) => {
      const info = p11.C_GetInfo();
      const zKarta = new Set(p11.C_GetSlotList(true).map((s) => s.toString('hex')));
      return {
        reczna: wskazana,
        biblioteka: {
          ...lib,
          producent: info.manufacturerID.trim(),
          opis: info.libraryDescription.trim(),
          wersja: `${info.libraryVersion.major}.${info.libraryVersion.minor}`,
        },
        czytniki: p11.C_GetSlotList(false).map((s) => czytnik(p11, k, s, zKarta.has(s.toString('hex')))),
      };
    });
  } catch (error: unknown) {
    return {
      reczna: wskazana,
      biblioteka: null,
      blad: `Nie udało się wczytać biblioteki karty ${lib.sciezka}: ${error instanceof Error ? error.message : String(error)}`,
      czytniki: [],
    };
  }
}

// ------------------------------------------------------------------ signing

/** DER DigestInfo prefix for SHA-256 — what CKM_RSA_PKCS needs in front of a bare hash. */
const DIGEST_INFO_SHA256 = Buffer.from('3031300d060960864801650304020105000420', 'hex');

/**
 * A failure of the card itself — wrong PIN, card pulled out, key or mechanism
 * missing. A run of signatures stops on it; a failure of one document does not.
 */
export class BladKarty extends Error {}

export interface SesjaPodpisu {
  cert: Certyfikat;
  /** CA certificates the card holds, for the chain in the signature. */
  lancuch: Buffer[];
  /**
   * Signs the signed attributes; the SignerInfo signature value. The first call
   * logs in with the PIN, the rest reuse the login — one PIN for a whole run.
   * Rejects with `BladKarty`.
   */
  podpisz: (atrybuty: Buffer) => Promise<Buffer>;
}

/**
 * Opens the chosen card, finds the chosen certificate and runs `praca` with it.
 * The PIN is tried once — a wrong one is reported, never retried, because every
 * wrong try brings the card closer to blocking.
 */
export function zKartaDoPodpisu<T>(
  wskazana: string,
  wybor: PodpisWybor,
  praca: (sesja: SesjaPodpisu) => Promise<T>,
): Promise<T> {
  const lib = biblioteka(wskazana);
  if (!lib) return Promise.reject(new Error('Nie znaleziono biblioteki karty. Zainstaluj Szafir 2 albo wskaż plik biblioteki w Ustawieniach.'));

  return zBiblioteka(lib.sciezka, async (p11, k) => {
    const slot = Buffer.from(wybor.slot, 'hex');
    if (!p11.C_GetSlotList(true).some((s) => s.equals(slot))) throw new Error('W czytniku nie ma karty. Włóż kartę i spróbuj ponownie.');

    let session: Buffer;
    try {
      session = p11.C_OpenSession(slot, k.CKF_SERIAL_SESSION);
    } catch (error: unknown) {
      throw new Error(komunikat(error, k));
    }
    let zalogowany = false;
    try {
      const certs = certyfikaty(p11, k, session);
      const wybrany = certs.find((c) => c.id === wybor.certId && !c.cert.ca);
      if (!wybrany) throw new Error('Tego certyfikatu nie ma już na karcie. Sprawdź kartę ponownie.');
      const { cert } = wybrany;
      const teraz = Date.now();
      if (teraz < Date.parse(cert.waznyOd) || teraz > Date.parse(cert.waznyDo)) {
        throw new Error(`Certyfikat jest nieważny (ważny do ${cert.waznyDo.slice(0, 10)}).`);
      }
      if (cert.klucz === 'inny') throw new Error('Klucz tego certyfikatu nie jest ani RSA, ani EC — nie umiem nim podpisać.');

      /** A card call, its failure as `BladKarty` in words. */
      const naKarcie = <R>(call: () => R): R => {
        try {
          return call();
        } catch (error: unknown) {
          throw error instanceof BladKarty ? error : new BladKarty(komunikat(error, k));
        }
      };

      let pin: string | undefined;
      const zaloguj = (userType: number) => {
        try {
          // A reader with a keypad takes the PIN itself; this call then waits for it.
          p11.C_Login(session, userType, pin);
        } catch (error: unknown) {
          if (kod(error) === k.CKR_USER_ALREADY_LOGGED_IN) return;
          let msg = komunikat(error, k);
          if (kod(error) === k.CKR_PIN_INCORRECT) {
            const flags = p11.C_GetTokenInfo(slot).flags;
            if (flags & k.CKF_USER_PIN_LOCKED) msg = komunikat({ code: k.CKR_PIN_LOCKED }, k);
            else if (flags & k.CKF_USER_PIN_FINAL_TRY) msg += ' Została ostatnia próba — kolejny błędny PIN zablokuje kartę.';
            else if (flags & k.CKF_USER_PIN_COUNT_LOW) msg += ' Uważaj: karta liczy błędne próby i po kilku się zablokuje.';
          }
          throw new BladKarty(msg);
        }
      };

      /** The private key and how to sign with it — found once, after the login. */
      let gotowy: { klucz: Buffer; mechanism: number; zawszePin: boolean } | null = null;

      const przygotuj = (): { klucz: Buffer; mechanism: number; zawszePin: boolean } => {
        const token = naKarcie(() => p11.C_GetTokenInfo(slot));
        if (token.flags & k.CKF_USER_PIN_LOCKED) throw new BladKarty(komunikat({ code: k.CKR_PIN_LOCKED }, k));
        const naCzytniku = (token.flags & k.CKF_PROTECTED_AUTHENTICATION_PATH) !== 0;
        pin = naCzytniku ? undefined : wybor.pin ?? '';
        if (!naCzytniku && !pin) throw new BladKarty('Wpisz PIN.');

        zaloguj(k.CKU_USER);
        zalogowany = true;

        const klucz = naKarcie(() => {
          p11.C_FindObjectsInit(session, [
            { type: k.CKA_CLASS, value: k.CKO_PRIVATE_KEY },
            { type: k.CKA_ID, value: Buffer.from(wybor.certId, 'hex') },
          ]);
          try {
            return p11.C_FindObjects(session);
          } finally {
            p11.C_FindObjectsFinal(session);
          }
        });
        if (!klucz) throw new BladKarty('Na karcie nie ma klucza prywatnego do tego certyfikatu.');

        // A qualified key often wants the PIN again right before each signature;
        // the PIN given for this run is presented again, one signature at a time.
        let zawszePin = false;
        try {
          const [attr] = p11.C_GetAttributeValue(session, klucz, [{ type: k.CKA_ALWAYS_AUTHENTICATE }]);
          zawszePin = (attr.value as Buffer)[0] === 1;
        } catch {
          // Attribute unknown to the card — no per-signature PIN.
        }

        const mechs = naKarcie(() => p11.C_GetMechanismList(slot));
        if (cert.klucz === 'rsa') {
          if (mechs.includes(k.CKM_SHA256_RSA_PKCS)) return { klucz, mechanism: k.CKM_SHA256_RSA_PKCS, zawszePin };
          if (mechs.includes(k.CKM_RSA_PKCS)) return { klucz, mechanism: k.CKM_RSA_PKCS, zawszePin };
          throw new BladKarty('Karta nie obsługuje podpisu RSA PKCS#1 v1.5.');
        }
        if (!mechs.includes(k.CKM_ECDSA)) throw new BladKarty('Karta nie obsługuje podpisu ECDSA.');
        return { klucz, mechanism: k.CKM_ECDSA, zawszePin };
      };

      const podpisz = async (atrybuty: Buffer): Promise<Buffer> => {
        gotowy ??= przygotuj();
        const { klucz, mechanism, zawszePin } = gotowy;
        const dane =
          mechanism === k.CKM_SHA256_RSA_PKCS
            ? atrybuty
            : mechanism === k.CKM_RSA_PKCS
              ? Buffer.concat([DIGEST_INFO_SHA256, sha256(atrybuty)])
              : sha256(atrybuty); // CKM_ECDSA signs a bare hash

        naKarcie(() => p11.C_SignInit(session, { mechanism }, klucz));
        if (zawszePin) zaloguj(k.CKU_CONTEXT_SPECIFIC);
        let podpis: Buffer;
        try {
          podpis = await p11.C_SignAsync(session, dane, Buffer.alloc(Math.max(1024, cert.rozmiarKlucza * 2 + 16)));
        } catch (error: unknown) {
          throw new BladKarty(komunikat(error, k));
        }
        return cert.klucz === 'ec' ? ecdsaDer(podpis) : podpis;
      };

      return await praca({ cert, lancuch: certs.filter((c) => c.cert.ca).map((c) => c.cert.der), podpisz });
    } finally {
      if (zalogowany) {
        try {
          p11.C_Logout(session);
        } catch {
          // The session closes next anyway.
        }
      }
      try {
        p11.C_CloseSession(session);
      } catch {
        // Card already gone.
      }
    }
  });
}
