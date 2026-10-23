/**
 * Errors the main process raises for the person to read, as codes with a Polish
 * and an English text — so a refusal reads in the app's language, and the
 * renderer can tell a conflict from any other failure without matching text.
 *
 * Electron hands the renderer only the `message` of a rejected `ipcMain.handle`,
 * so the code rides inside it: the Polish text (what the log shows), then a
 * marker `[[app-error:<code>:<params>]]`. `ipcErrorMessage` in the renderer
 * finds the marker anywhere in the message — a caller that prefixed it
 * (`${op}: ${message}`) still works — and shows the text in the app's language.
 *
 * Technical failures (`${op}: ${error.message}` from Supabase, a file system
 * error) stay plain `Error`s: they have no text worth translating, and the
 * renderer shows them after its own sentence ("Nie udało się zapisać: …").
 *
 * A refusal main hands over as data instead (`{ error }` in a result, a reason
 * in a history row) carries the same marker in its text; whoever shows it words
 * it with `ipcErrorMessage` / `localizeErrorMessage`, and a stored one reads in
 * the language of whoever opens it later.
 *
 * A text's `{name}` placeholders are filled from the params given at the throw.
 */

type ErrorText = { pl: string; en: string };

export const APP_ERRORS = {
  // ---------------- Concurrent edits ----------------
  concurrentEdit: {
    pl: 'Te dane zmieniły się w międzyczasie (ktoś inny je zapisał). Odśwież widok i wprowadź zmiany ponownie.',
    en: 'This data changed in the meantime (somebody else saved it). Refresh the view and make your changes again.',
  },
  concurrentRetriesExhausted: {
    pl: 'Zapis się nie udał — te dane zmieniały się w tym czasie kilka razy z rzędu. Spróbuj ponownie.',
    en: 'The save did not go through — this data changed several times in a row meanwhile. Try again.',
  },
  zadanieConflict: {
    pl: 'To zadanie zmieniło się w międzyczasie (ktoś inny je zapisał). Otwórz je ponownie, żeby zobaczyć aktualną wersję.',
    en: 'This task changed in the meantime (somebody else saved it). Open it again to see the current version.',
  },

  // ---------------- Session and sign-in ----------------
  sessionExpired: {
    pl: 'Sesja wygasła — zaloguj się ponownie. Wspólne dane (banki, adresy, kontrahenci, historia) są widoczne tylko dla zalogowanego użytkownika.',
    en: 'Your session has expired — sign in again. Shared data (banks, addresses, contractors, history) is visible only to a signed-in user.',
  },
  cloudUnreachable: {
    pl: 'Brak połączenia z serwerem — sprawdź internet i spróbuj ponownie. Nadal jesteś zalogowany.',
    en: 'Cannot reach the server — check the internet connection and try again. You are still signed in.',
  },
  signInNoUser: {
    pl: 'Nie zwrócono użytkownika.',
    en: 'No user came back from the sign-in.',
  },
  notSignedIn: {
    pl: 'Brak zalogowanego użytkownika.',
    en: 'No user is signed in.',
  },

  // ---------------- Banks, communities, files ----------------
  bankTaken: {
    pl: 'Bank o tej nazwie już istnieje.',
    en: 'A bank with this name already exists.',
  },
  adresTaken: {
    pl: 'Wspólnota o tej nazwie już istnieje.',
    en: 'A community with this name already exists.',
  },
  adresGone: {
    pl: 'Adres nie istnieje — mógł zostać usunięty.',
    en: 'The address no longer exists — it may have been deleted.',
  },
  accountNumberInvalid: {
    pl: 'Nieprawidłowy numer konta: "{value}" (oczekiwano 26 cyfr).',
    en: 'Invalid account number: "{value}" (26 digits expected).',
  },
  accountNumberTaken: {
    pl: 'Numer konta {account} jest już przypisany do adresu „{adres}". Jedno konto może należeć tylko do jednego adresu.',
    en: 'Account number {account} is already assigned to the address “{adres}”. One account can belong to one address only.',
  },
  pelnomocnikNameRequired: {
    pl: 'Pełnomocnik musi mieć imię i nazwisko.',
    en: 'The proxy needs a first name and a surname.',
  },
  fileGone: {
    pl: 'Plik nie istnieje lub został usunięty',
    en: 'The file does not exist or has been deleted',
  },
  pdfFileGone: {
    pl: 'Plik PDF nie istnieje lub został usunięty',
    en: 'The PDF file does not exist or has been deleted',
  },
  fileFormatInvalid: {
    pl: 'Nieprawidłowy format pliku',
    en: 'Invalid file format',
  },
  fileEmpty: {
    pl: 'Plik jest pusty.',
    en: 'The file is empty.',
  },
  outputDirNotPicked: {
    pl: 'Folder docelowy nie został wybrany w oknie wyboru — wybierz go ponownie.',
    en: 'The destination folder was not chosen in the folder dialog — choose it again.',
  },
  outputDirMissing: {
    pl: 'Folder docelowy nie istnieje',
    en: 'The destination folder does not exist',
  },
  outputFolderNotSet: {
    pl: 'Folder wyjściowy nie jest ustawiony (Ustawienia → Folder wyjściowy).',
    en: 'The output folder is not set (Settings → Output folder).',
  },
  xlsxInvalid: {
    pl: 'Nie udało się otworzyć pliku — to nie jest prawidłowy skoroszyt Excela (.xlsx).',
    en: 'The file could not be opened — it is not a valid Excel workbook (.xlsx).',
  },
  xlsxNoSheet: {
    pl: 'Plik nie ma arkusza z danymi.',
    en: 'The file has no sheet with data.',
  },

  // ---------------- Converter ----------------
  converterNotFound: {
    pl: "Konwerter '{converter}' nie został znaleziony. Bank: '{bank}'. Dostępne konwertery: {available}",
    en: "Converter '{converter}' was not found. Bank: '{bank}'. Available converters: {available}",
  },
  aiNotConfiguredShort: {
    pl: 'AI nie jest skonfigurowane — brak klucza API.',
    en: 'AI is not configured — the API key is missing.',
  },
  noKontrahenci: {
    pl: 'Brak kontrahentów w bazie — nie ma z czego wybierać.',
    en: 'There are no contractors in the database — nothing to choose from.',
  },
  noFilesToMerge: {
    pl: 'Brak plików do scalenia',
    en: 'No files to merge',
  },
  noFilesToConvert: {
    pl: 'Brak plików do konwersji',
    en: 'No files to convert',
  },
  scanFileChanged: {
    pl: 'Plik zmienił się od skanowania — uruchom skan ponownie.',
    en: 'The file has changed since the scan — run the scan again.',
  },
  scanReplaceNarrower: {
    pl: 'Znaleziony plik obejmuje tylko część okresu obecnego — zamiana zgubiłaby pozostałe dni.',
    en: 'The found file covers only part of the current one’s period — replacing it would lose the other days.',
  },

  // ---------------- Meter readings (Odczyty) ----------------
  impexFolderNotSet: {
    pl: 'Folder IMPEX nie jest skonfigurowany (Ustawienia → Folder IMPEX).',
    en: 'The IMPEX folder is not configured (Settings → IMPEX folder).',
  },
  odczytyNoneInFiles: {
    pl: 'Żaden z plików nie zawiera odczytów.',
    en: 'None of the files contains readings.',
  },
  odczytyNothingToWrite: {
    pl: 'Plik nie zawiera żadnych odczytów do zapisania.',
    en: 'The file contains no readings to save.',
  },
  odczytyFormatUnknown: {
    pl: 'Nie rozpoznano formatu pliku. Obsługiwane są odczyty od: PIASKAN, TECHEM, METRONA, ISTA.',
    en: 'The file format was not recognised. Readings from PIASKAN, TECHEM, METRONA and ISTA are supported.',
  },

  // ---------------- Fee summary (Zaliczki) ----------------
  aiKeyMissing: {
    pl: 'Brak klucza Anthropic API — dodaj wpis anthropic_api_key w tabeli app_config (Supabase) lub lokalnie w config/ai-config.yml.',
    en: 'The Anthropic API key is missing — add an anthropic_api_key entry to the app_config table (Supabase) or locally to config/ai-config.yml.',
  },
  zaliczkiNoPageRead: {
    pl: 'Nie odczytano żadnej strony ({failed} z {pages} zakończyło się błędem). Zobacz logi.',
    en: 'No page was read ({failed} of {pages} ended in an error). See the logs.',
  },
  zaliczkiNoProperty: {
    pl: 'Model nie zwrócił żadnej wspólnoty.',
    en: 'The model returned no community.',
  },
  zaliczkiNoJson: {
    pl: 'Model nie zwrócił JSON. Początek odpowiedzi: {start}',
    en: 'The model did not return JSON. Start of the answer: {start}',
  },
  zaliczkiJsonEmpty: {
    pl: 'Model zwrócił JSON, ale bez żadnej wspólnoty (pusta lista properties).',
    en: 'The model returned JSON, but without any community (an empty properties list).',
  },

  // ---------------- Backups ----------------
  backupNotFileFunky: {
    pl: 'To nie jest plik kopii zapasowej FileFunky.',
    en: 'This is not a FileFunky backup file.',
  },
  backupVersionUnsupported: {
    pl: 'Nieobsługiwana wersja kopii zapasowej ({version}).',
    en: 'Unsupported backup version ({version}).',
  },
  backupSectionMissing: {
    pl: 'Uszkodzona kopia zapasowa: brak sekcji "{section}".',
    en: 'Damaged backup: the "{section}" section is missing.',
  },
  backupSafetyCopyIncomplete: {
    pl: 'kopia bezpieczeństwa byłaby niepełna (brak tabel: {tables})',
    en: 'the safety copy would be incomplete (missing tables: {tables})',
  },
  restoreMigrationMissing: {
    pl: 'Baza nie ma jeszcze funkcji przywracania kopii — uruchom w Supabase supabase/restore-transakcja.sql i spróbuj ponownie. Nic nie zostało zmienione.',
    en: 'The database does not have the backup-restore function yet — run supabase/restore-transakcja.sql in Supabase and try again. Nothing was changed.',
  },

  // ---------------- Updates ----------------
  updateCheckTimeout: {
    pl: 'Timeout - brak odpowiedzi z serwera',
    en: 'Timed out — no answer from the server',
  },

  // ---------------- Mailing ----------------
  smtpHostMissing: {
    pl: 'Brak serwera SMTP (Ustawienia → Skrzynka do wysyłki).',
    en: 'The SMTP server is missing (Settings → Sending mailbox).',
  },
  smtpUserMissing: {
    pl: 'Brak adresu e-mail nadawcy (Ustawienia → Skrzynka do wysyłki).',
    en: 'The sender’s e-mail address is missing (Settings → Sending mailbox).',
  },
  smtpPasswordMissing: {
    pl: 'Brak hasła do skrzynki (Ustawienia → Skrzynka do wysyłki).',
    en: 'The mailbox password is missing (Settings → Sending mailbox).',
  },
  smtpPortInvalid: {
    pl: 'Nieprawidłowy port SMTP.',
    en: 'Invalid SMTP port.',
  },
  mailingNoAdres: {
    pl: 'Nie wybrano żadnej wspólnoty.',
    en: 'No community was selected.',
  },
  mailingTemplateGone: {
    pl: 'Wybrany szablon nie istnieje — odśwież listę szablonów.',
    en: 'The selected template no longer exists — refresh the template list.',
  },
  mailingAttachmentNotPicked: {
    pl: 'Załącznik spoza wybranych plików: {files} — dodaj go ponownie przyciskiem „Dodaj załącznik”.',
    en: 'An attachment that was not picked in the app: {files} — add it again with the “Add attachment” button.',
  },
  mailingFormatRequired: {
    pl: 'Wybierz, w jakiej postaci pobrać wiadomość.',
    en: 'Choose the form in which to download the message.',
  },
  mailingTypNameRequired: {
    pl: 'Typ mailingu musi mieć nazwę.',
    en: 'The mailing type needs a name.',
  },
  mailingTypBuiltIn: {
    pl: 'Typ „{name}” jest wbudowany i nie może zostać usunięty.',
    en: 'The type “{name}” is built in and cannot be deleted.',
  },
  mailingTypHasTemplates: {
    pl: 'Typ „{name}” ma przypisane szablony ({count}). Przenieś je do innego typu albo usuń, zanim usuniesz typ.',
    en: 'The type “{name}” has templates assigned ({count}). Move them to another type or delete them before you delete the type.',
  },

  // ---------------- Tasks (Zadania) ----------------
  zadanieGone: {
    pl: 'Tego zadania już nie ma — mogło zostać usunięte.',
    en: 'This task no longer exists — it may have been deleted.',
  },
  zadanieTitleRequired: {
    pl: 'Zadanie musi mieć tytuł.',
    en: 'The task needs a title.',
  },
  zadanieStatusUnknown: {
    pl: 'Nieznany status zadania: {status}',
    en: 'Unknown task status: {status}',
  },
  zadaniePriorytetUnknown: {
    pl: 'Nieznany priorytet zadania: {value}',
    en: 'Unknown task priority: {value}',
  },
  zadanieTerminInvalid: {
    pl: 'Nieprawidłowy termin zadania: {termin}',
    en: 'Invalid task due date: {termin}',
  },
  zadanieZalacznikiInvalid: {
    pl: 'Nieprawidłowe załączniki zadania.',
    en: 'Invalid task attachments.',
  },
  zadanieZalacznikInvalid: {
    pl: 'Nieprawidłowy załącznik zadania.',
    en: 'Invalid task attachment.',
  },
  zadanieSpotkanieInvalid: {
    pl: 'Nieprawidłowe spotkanie zadania: {value}',
    en: 'Invalid task meeting: {value}',
  },
  zadanieMoveNotInOrder: {
    pl: 'Przenoszona karta musi być w nowej kolejności.',
    en: 'The card being moved must be in the new order.',
  },
  zalacznikInvalid: {
    pl: 'Nieprawidłowy załącznik.',
    en: 'Invalid attachment.',
  },
  commentEmpty: {
    pl: 'Komentarz nie może być pusty.',
    en: 'The comment cannot be empty.',
  },
  commentTooLong: {
    pl: 'Komentarz jest za długi.',
    en: 'The comment is too long.',
  },
  commentNotDeletable: {
    pl: 'Tego komentarza nie można usunąć — już go nie ma albo nie jest Twój.',
    en: 'This comment cannot be deleted — it no longer exists or it is not yours.',
  },
  noteEmpty: {
    pl: 'Notatka nie może być pusta.',
    en: 'The note cannot be empty.',
  },
  noteTooLong: {
    pl: 'Notatka jest za długa.',
    en: 'The note is too long.',
  },
  noteNotEditable: {
    pl: 'Tej notatki nie można zmienić — już jej nie ma albo nie jest Twoja.',
    en: 'This note cannot be changed — it no longer exists or it is not yours.',
  },
  noteNotDeletable: {
    pl: 'Tej notatki nie można usunąć — już jej nie ma albo nie jest Twoja.',
    en: 'This note cannot be deleted — it no longer exists or it is not yours.',
  },

  // ---------------- Calendar (Kalendarz) ----------------
  spotkanieNameRequired: {
    pl: 'Spotkanie musi mieć nazwę.',
    en: 'The meeting needs a name.',
  },
  spotkanieStartRequired: {
    pl: 'Spotkanie musi mieć datę i godzinę.',
    en: 'The meeting needs a date and a time.',
  },
  spotkanieEndBeforeStart: {
    pl: 'Godzina zakończenia musi być późniejsza niż godzina rozpoczęcia.',
    en: 'The end time must be later than the start time.',
  },
  spotkanieGone: {
    pl: 'Tego spotkania już nie ma — mogło zostać usunięte.',
    en: 'This meeting no longer exists — it may have been deleted.',
  },
  spotkanieMissing: {
    pl: 'Spotkanie nie istnieje — mogło zostać usunięte.',
    en: 'The meeting does not exist — it may have been deleted.',
  },
  materialyStatusUnknown: {
    pl: 'Nieznany status materiałów: {status}',
    en: 'Unknown materials status: {status}',
  },
  kalendarzPeriodInvalid: {
    pl: 'Nieprawidłowy okres.',
    en: 'Invalid period.',
  },
  kalendarzPeriodReversed: {
    pl: 'Data końca okresu jest wcześniejsza niż data początku.',
    en: 'The end date of the period is earlier than its start date.',
  },
  kalendarzPeriodTooLong: {
    pl: 'Okres może obejmować najwyżej {max} miesiące.',
    en: 'The period can cover at most {max} months.',
  },

  // ---------------- Assemblies (Zebrania) ----------------
  zebranieNameRequired: {
    pl: 'Zebranie musi mieć nazwę.',
    en: 'The meeting needs a name.',
  },
  zebranieMissing: {
    pl: 'Zebranie nie istnieje — mogło zostać usunięte.',
    en: 'The meeting does not exist — it may have been deleted.',
  },
  zebranieGone: {
    pl: 'Tego zebrania już nie ma — mogło zostać usunięte.',
    en: 'This meeting no longer exists — it may have been deleted.',
  },
  zebranieLinkedToSpotkanie: {
    pl: 'To zebranie jest powiązane ze spotkaniem — termin i miejsce zmienia się w Kalendarzu.',
    en: 'This meeting is linked to a Calendar meeting — its date and place are changed in the Calendar.',
  },
  zebranieOnlyWersja: {
    pl: 'To jedyna wersja tego zebrania — usuń całe zebranie zamiast niej.',
    en: 'This is the only version of the meeting — delete the whole meeting instead.',
  },
  zebranieNoAdres: {
    pl: 'Zebranie nie ma wybranej wspólnoty.',
    en: 'The meeting has no community selected.',
  },
  zebranieDokumentUnknown: {
    pl: 'Nieznany dokument zebrania: {dokument}',
    en: 'Unknown meeting document: {dokument}',
  },
  wersjaGone: {
    pl: 'Tej wersji już nie ma — mogła zostać usunięta.',
    en: 'This version no longer exists — it may have been deleted.',
  },
  wersjaMissing: {
    pl: 'Wersja nie istnieje — mogła zostać usunięta.',
    en: 'The version does not exist — it may have been deleted.',
  },
  wersjaNumberFailed: {
    pl: 'Nie udało się nadać numeru nowej wersji — ktoś w tym samym czasie dodawał wersję tego zebrania. Spróbuj ponownie.',
    en: 'A number for the new version could not be assigned — somebody was adding a version of this meeting at the same time. Try again.',
  },
  wersjaNoSprawozdanie: {
    pl: 'Ta wersja nie ma jeszcze sprawozdania.',
    en: 'This version has no financial statement yet.',
  },
  wersjaSprawozdanieGone: {
    pl: 'Ta wersja nie ma już sprawozdania.',
    en: 'This version no longer has a financial statement.',
  },
  wersjaNoPlan: {
    pl: 'Ta wersja nie ma jeszcze planu gospodarczego.',
    en: 'This version has no budget plan yet.',
  },
  pakietNoZawiadomienie: {
    pl: 'Ta wersja nie ma jeszcze zawiadomienia — przygotuj je w zakładce „Zawiadomienie o zebraniu”.',
    en: 'This version has no notice yet — prepare it on the “Meeting notice” tab.',
  },
  pakietNoSprawozdanie: {
    pl: 'Ta wersja nie ma jeszcze sprawozdania — dołącz je w zakładce „Sprawozdania finansowe”.',
    en: 'This version has no financial statement yet — attach it on the “Financial statements” tab.',
  },
  pakietNoPlan: {
    pl: 'Ta wersja nie ma jeszcze planu gospodarczego — utwórz go w zakładce „Plan gospodarczy”.',
    en: 'This version has no budget plan yet — create it on the “Budget plan” tab.',
  },
  pakietNoUchwaly: {
    pl: 'Ta wersja nie ma wybranych uchwał — dodaj je albo zaznacz w zakładce „Uchwały”.',
    en: 'This version has no resolutions selected — add or tick them on the “Resolutions” tab.',
  },
  pakietNothingChosen: {
    pl: 'Wybierz co najmniej jedną część materiałów.',
    en: 'Choose at least one part of the materials.',
  },
  pakietZawiadomienieIncomplete: {
    pl: 'W zawiadomieniu nie wypełniono: {fields}. Uzupełnij je w zakładce „Zawiadomienie o zebraniu” albo pobierz pakiet bez zawiadomienia.',
    en: 'Not filled in on the notice: {fields}. Complete them on the “Meeting notice” tab or download the package without the notice.',
  },
  pakietUchwalyIncomplete: {
    pl: 'W uchwałach nie wypełniono pól: {fields}. Uzupełnij je w zakładce „Uchwały” albo pobierz pakiet bez uchwał.',
    en: 'Fields not filled in on the resolutions: {fields}. Complete them on the “Resolutions” tab or download the package without the resolutions.',
  },

  // ---------------- Financial statements (Sprawozdania) ----------------
  sprawozdaniaPdfEmpty: {
    pl: 'W tym pliku nie ma sprawozdań z vDom. Wybierz wydruk „RozliczenieWsp” zapisany jako PDF z tekstem (nie skan).',
    en: 'This file has no vDom statements. Choose the “RozliczenieWsp” printout saved as a PDF with text (not a scan).',
  },
  sprawozdanieGone: {
    pl: 'Tego sprawozdania już nie ma — mogło zostać usunięte.',
    en: 'This financial statement no longer exists — it may have been deleted.',
  },
  sprawozdanieGoneFromModule: {
    pl: 'Tego sprawozdania nie ma już w module Sprawozdania — mogło zostać usunięte.',
    en: 'This financial statement is no longer in the Statements module — it may have been deleted.',
  },
  sprawozdanieGoneFromLibrary: {
    pl: 'Tego sprawozdania nie ma już w bibliotece — mogło zostać usunięte.',
    en: 'This financial statement is no longer in the library — it may have been deleted.',
  },
  sprawozdanieLinked: {
    pl: 'To sprawozdanie jest powiązane z zebraniem — odłącz je najpierw w Zebraniach.',
    en: 'This financial statement is linked to a meeting — unlink it in Assemblies first.',
  },

  // ---------------- Budget plans (Plany gospodarcze) ----------------
  planGone: {
    pl: 'Tego planu już nie ma — mógł zostać usunięty.',
    en: 'This plan no longer exists — it may have been deleted.',
  },
  planTaken: {
    pl: 'Plan tej wspólnoty na ten rok już jest w Planach gospodarczych — otwórz go zamiast tworzyć drugi.',
    en: 'A plan of this community for this year is already in Budget plans — open it instead of creating a second one.',
  },
  planEmpty: {
    pl: 'Nie ma czego zapisać — plan jest pusty.',
    en: 'There is nothing to save — the plan is empty.',
  },
  planUnreadable: {
    pl: 'Plan został zapisany, ale nie da się go odczytać. Odśwież widok i sprawdź go na liście.',
    en: 'The plan was saved but cannot be read back. Refresh the view and check it on the list.',
  },
  planSprawozdanieColumnMissing: {
    pl: 'Baza nie ma jeszcze miejsca na sprawozdanie planu — uruchom w Supabase plik plany-gospodarcze-sprawozdanie.sql.',
    en: 'The database has no room for the plan’s statement yet — run plany-gospodarcze-sprawozdanie.sql in Supabase.',
  },
  planSprawozdanieMissing: {
    pl: 'Sprawozdania, z którego powstał ten plan, nie ma w module Sprawozdania.',
    en: 'The financial statement this plan was made from is not in the Statements module.',
  },
  planInZebrania: {
    pl: 'Zebrania mają już plan gospodarczy tej wspólnoty na {rok} rok („{zebranie}”, wersja {wersja}) — to on obowiązuje.',
    en: 'Assemblies already have a budget plan of this community for {rok} (“{zebranie}”, version {wersja}) — that one applies.',
  },
  planMissingForRate: {
    pl: 'Brak planu do policzenia stawki.',
    en: 'There is no plan to calculate the rate from.',
  },

  // ---------------- AI ----------------
  aiNotConfigured: {
    pl: 'AI nie jest skonfigurowane — brak klucza API Anthropic.',
    en: 'AI is not configured — the Anthropic API key is missing.',
  },
  aiBadFormat: {
    pl: 'AI nie zwróciło odpowiedzi w oczekiwanym formacie.',
    en: 'The AI did not answer in the expected format.',
  },
  aiZaliczkaInvalid: {
    pl: 'AI zaproponowało stawkę, która nie obejmuje pełnego roku albo ma niepoprawne kwoty.',
    en: 'The AI proposed a rate that does not cover the full year or has invalid amounts.',
  },
  aiZaliczkaNoReason: {
    pl: 'AI nie podało uzasadnienia stawki.',
    en: 'The AI gave no reasoning for the rate.',
  },
  aiWstepEmpty: {
    pl: 'AI nie zwróciło tekstu wstępu.',
    en: 'The AI returned no introduction text.',
  },

  // ---------------- Postings (Księgowania) ----------------
  ksDiscardColumnMissing: {
    pl: 'Brak kolumny odrzucone_at — uruchom supabase/ksiegowania-odrzucone.sql',
    en: 'The odrzucone_at column is missing — run supabase/ksiegowania-odrzucone.sql',
  },
  monthInvalid: {
    pl: 'Nieprawidłowy miesiąc.',
    en: 'Invalid month.',
  },
  ksAssignmentNeedsAdres: {
    pl: 'Przypisanie musi dotyczyć wspólnoty.',
    en: 'An assignment must concern a community.',
  },
  ksPriorytetNeedsAdres: {
    pl: 'Priorytet musi dotyczyć wspólnoty.',
    en: 'A priority must concern a community.',
  },
  ksUwagaNeedsAdres: {
    pl: 'Uwaga musi dotyczyć wspólnoty.',
    en: 'A note must concern a community.',
  },
  ksUwagaEmpty: {
    pl: 'Uwaga nie może być pusta.',
    en: 'The note cannot be empty.',
  },

  // ---------------- Taxes: shared form filling ----------------
  podatkiFolderMissing: {
    pl: 'Folder na deklaracje ustawiony w Ustawieniach nie istnieje: {folder}. Podłącz dysk albo zmień folder w Ustawieniach.',
    en: 'The declarations folder set in Settings does not exist: {folder}. Connect the drive or change the folder in Settings.',
  },
  fieldCharMissing: {
    pl: 'Pole „{field}” zawiera znak „{char}” (U+{code}), którego czcionka formularza nie ma — usuń go albo wpisz wartość literami alfabetu łacińskiego.',
    en: 'The field “{field}” contains the character “{char}” (U+{code}), which the form’s font lacks — remove it or type the value in Latin letters.',
  },
  fieldTooLong: {
    pl: 'Pole „{field}” jest za długie, żeby zmieścić się w formularzu — skróć je.',
    en: 'The field “{field}” is too long to fit on the form — shorten it.',
  },
  fieldTooManyChars: {
    pl: 'Pole „{field}” ma więcej znaków niż kratek w formularzu.',
    en: 'The field “{field}” has more characters than the form has boxes.',
  },
  fieldNegative: {
    pl: 'Pole „{field}” ma wartość ujemną — formularz tego nie przewiduje.',
    en: 'The field “{field}” is negative — the form does not allow that.',
  },
  fieldWholeZloty: {
    pl: 'Pole „{field}” musi być w pełnych złotych.',
    en: 'The field “{field}” must be in whole złoty.',
  },
  fieldWholeNumber: {
    pl: 'Pole „{field}” musi być nieujemną liczbą całkowitą.',
    en: 'The field “{field}” must be a non-negative whole number.',
  },
  eDeklaracjeNegativeAmount: {
    pl: 'Kwota {amount} zł jest ujemna, a pola kwot e-Deklaracji przyjmują tylko kwoty nieujemne.',
    en: 'The amount {amount} zł is negative, and e-Deklaracje amount fields take non-negative amounts only.',
  },

  // ---------------- Taxes: DN-1 ----------------
  dn1Taken: {
    pl: 'Ta wspólnota (ten NIP) ma już deklarację na ten rok — otwórz ją zamiast dodawać drugą.',
    en: 'This community (this NIP) already has a declaration for this year — open it instead of adding a second one.',
  },
  dn1Gone: {
    pl: 'Tej deklaracji już nie ma — mogła zostać usunięta.',
    en: 'This declaration no longer exists — it may have been deleted.',
  },
  dn1ImportEmpty: {
    pl: 'W tym pliku nie ma żadnej wspólnoty z NIP-em i rokiem — nic nie zaimportowano.',
    en: 'This file has no community with a NIP and a year — nothing was imported.',
  },
  dn1TableNotRecognized: {
    pl: 'To nie wygląda na tabelę do DN-1: w pierwszym wierszu nie ma kolumn „1” (NIP) i „3” (rok).',
    en: 'This does not look like a DN-1 table: the first row has no columns “1” (NIP) and “3” (year).',
  },
  dn1PrintBlocked: {
    pl: 'Deklaracji nie da się jeszcze wydrukować: {problems}.',
    en: 'The declaration cannot be printed yet: {problems}.',
  },

  // ---------------- Taxes: CIT-8 ----------------
  citTaken: {
    pl: 'Ta wspólnota ma już zeznanie CIT-8 na ten rok — otwórz je zamiast dodawać drugie.',
    en: 'This community already has a CIT-8 return for this year — open it instead of adding a second one.',
  },
  citGone: {
    pl: 'Tego zeznania już nie ma — mogło zostać usunięte.',
    en: 'This return no longer exists — it may have been deleted.',
  },
  citChangedMeanwhile: {
    pl: 'Zeznanie zmieniało się w tym samym czasie na innym komputerze — spróbuj ponownie.',
    en: 'The return was being changed on another computer at the same time — try again.',
  },
  citUpoMissing: {
    pl: 'Ta wysyłka nie ma jeszcze UPO.',
    en: 'This submission has no UPO yet.',
  },
  citSettlementUnknown: {
    pl: 'Nieznane rozstrzygnięcie wysyłki.',
    en: 'Unknown settlement of the submission.',
  },
  citWysylkaGone: {
    pl: 'Tej wysyłki już nie ma na liście — odśwież zeznanie.',
    en: 'This submission is no longer on the list — refresh the return.',
  },
  citWysylkaSettled: {
    pl: 'Ta wysyłka ma już odpowiedź bramki albo została rozstrzygnięta — odśwież zeznanie.',
    en: 'This submission already has the gateway’s answer or has been settled — refresh the return.',
  },
  citXmlBlocked: {
    pl: 'XML CIT-8 nie da się jeszcze wygenerować: {problems}.',
    en: 'The CIT-8 XML cannot be generated yet: {problems}.',
  },
  citPrintBlocked: {
    pl: 'Zeznania nie da się jeszcze wydrukować: {problems}.',
    en: 'The return cannot be printed yet: {problems}.',
  },
  citPdfSignFailed: {
    pl: 'Nie udało się podpisać PDF ({detail}) — zeznania nie zapisano ani nie wysłano. Spróbuj ponownie albo bez podpisanego PDF.',
    en: 'The PDF could not be signed ({detail}) — the return was neither saved nor sent. Try again, or without the signed PDF.',
  },
  bramkaRejected: {
    pl: 'Bramka e-Deklaracji odrzuciła żądanie: {detail}',
    en: 'The e-Deklaracje gateway rejected the request: {detail}',
  },
  bramkaUnexpectedAnswer: {
    pl: 'Bramka e-Deklaracji odpowiedziała nieoczekiwanie (HTTP {http}).',
    en: 'The e-Deklaracje gateway gave an unexpected answer (HTTP {http}).',
  },
  bramkaBadStatus: {
    pl: 'Bramka e-Deklaracji nie odpowiedziała poprawnie (HTTP {http}).',
    en: 'The e-Deklaracje gateway did not answer correctly (HTTP {http}).',
  },
  bramkaTimeout: {
    pl: 'Bramka e-Deklaracji nie odpowiedziała w ciągu minuty.',
    en: 'The e-Deklaracje gateway did not answer within a minute.',
  },
  bramkaUnreachable: {
    pl: 'Nie udało się połączyć z bramką e-Deklaracji: {detail}',
    en: 'Could not connect to the e-Deklaracje gateway: {detail}',
  },

  // ---------------- Taxes: PIT ----------------
  pitTaken: {
    pl: 'Ta wspólnota (ten NIP) ma już PIT na ten rok — otwórz go zamiast dodawać drugi.',
    en: 'This community (this NIP) already has a PIT for this year — open it instead of adding a second one.',
  },
  pitGone: {
    pl: 'Tego PIT-u już nie ma — mógł zostać usunięty.',
    en: 'This PIT no longer exists — it may have been deleted.',
  },
  pitDocumentGone: {
    pl: 'Tego dokumentu już nie ma.',
    en: 'This document no longer exists.',
  },
  pitImportEmpty: {
    pl: 'W tym folderze nie ma żadnego PIT-11 ani PIT-4R za {rok} — nic nie zaimportowano.',
    en: 'This folder has no PIT-11 or PIT-4R for {rok} — nothing was imported.',
  },
  pitYearEmpty: {
    pl: 'Rok {rok} nie ma jeszcze żadnej wspólnoty — najpierw przenieś go z poprzedniego roku.',
    en: 'The year {rok} has no community yet — carry it over from the previous year first.',
  },
  pit11XmlBlocked: {
    pl: 'PIT-11 nie da się jeszcze wygenerować ({osoba}): {problems}',
    en: 'The PIT-11 cannot be generated yet ({osoba}): {problems}',
  },
  pit4rXmlBlocked: {
    pl: 'PIT-4R nie da się jeszcze wygenerować: {problems}',
    en: 'The PIT-4R cannot be generated yet: {problems}',
  },
  pit11NoWzor: {
    pl: 'Dla roku {rok} nie ma wzoru PIT-11 w aplikacji.',
    en: 'The app has no PIT-11 form for the year {rok}.',
  },
  pit4rNoWzor: {
    pl: 'Dla roku {rok} nie ma wzoru PIT-4R w aplikacji.',
    en: 'The app has no PIT-4R form for the year {rok}.',
  },
  pit11PrintBlocked: {
    pl: 'Informacji PIT-11 nie da się jeszcze wydrukować: {problems}.',
    en: 'The PIT-11 information cannot be printed yet: {problems}.',
  },
  pit4rPrintBlocked: {
    pl: 'Deklaracji PIT-4R nie da się jeszcze wydrukować: {problems}.',
    en: 'The PIT-4R declaration cannot be printed yet: {problems}.',
  },
  payerNipInvalid: {
    pl: 'NIP płatnika „{nip}” jest nieprawidłowy — formularza nie da się wydrukować.',
    en: 'The payer’s NIP “{nip}” is invalid — the form cannot be printed.',
  },
  payerNameMissing: {
    pl: 'Brak nazwy płatnika — formularza nie da się wydrukować.',
    en: 'The payer’s name is missing — the form cannot be printed.',
  },
  ordZuMissing: {
    pl: 'Korekta wymaga uzasadnienia przyczyn (ORD-ZU) — brak tekstu.',
    en: 'A correction needs a statement of reasons (ORD-ZU) — there is no text.',
  },
  ordZuTooLongShorten: {
    pl: 'Uzasadnienie korekty jest za długie, żeby zmieścić się na jednej stronie — skróć je.',
    en: 'The statement of reasons is too long to fit on one page — shorten it.',
  },
  ordZuTooLong: {
    pl: 'Uzasadnienie korekty jest za długie, żeby zmieścić się na jednej stronie.',
    en: 'The statement of reasons is too long to fit on one page.',
  },
  pitExcelNoSheets: {
    pl: 'W pliku nie ma arkuszy „Kwoty” ani „PIT-4R” — wczytaj szablon wyeksportowany z aplikacji.',
    en: 'The file has neither a “Kwoty” nor a “PIT-4R” sheet — load the template exported from the app.',
  },
  pitExcelNoHeader: {
    pl: 'Arkusz „Kwoty” nie ma wiersza nagłówków szablonu — wczytaj plik wyeksportowany z aplikacji.',
    en: 'The “Kwoty” sheet has no template header row — load the file exported from the app.',
  },
  pitExcelNoNipColumn: {
    pl: 'Arkusz „Kwoty” nie ma kolumny „NIP wspólnoty”.',
    en: 'The “Kwoty” sheet has no “NIP wspólnoty” column.',
  },
  pitExcelNoPersonColumn: {
    pl: 'Arkusz „Kwoty” nie ma kolumny „Identyfikator” ani „Osoba (Nazwisko Imię)”.',
    en: 'The “Kwoty” sheet has neither an “Identyfikator” nor an “Osoba (Nazwisko Imię)” column.',
  },
  pitExcelNoAmountColumns: {
    pl: 'Arkusz „Kwoty” nie ma żadnej kolumny z kwotami.',
    en: 'The “Kwoty” sheet has no amount column.',
  },

  // ---------------- Qualified signature (Podpis) ----------------
  cardModuleNotLoaded: {
    pl: 'Moduł obsługi kart (pkcs11js) nie wczytał się: {detail}',
    en: 'The card module (pkcs11js) did not load: {detail}',
  },
  cardLibraryNotFound: {
    pl: 'Nie znaleziono biblioteki karty. Zainstaluj Szafir 2 albo wskaż plik biblioteki w Ustawieniach → Podpis kwalifikowany.',
    en: 'The card library was not found. Install Szafir 2 or point to the library file in Settings → Qualified signature.',
  },
  cardLibraryNotFoundWindows: {
    pl: 'Nie znaleziono biblioteki karty. Szafir 2 trzyma ją w „{path}”. Zainstaluj Szafir 2 (64-bit) albo wskaż ten plik w Ustawieniach → Podpis kwalifikowany.',
    en: 'The card library was not found. Szafir 2 keeps it in “{path}”. Install Szafir 2 (64-bit) or point to that file in Settings → Qualified signature.',
  },
  cardLibraryLoadFailed: {
    pl: 'Nie udało się wczytać biblioteki karty {path}: {detail}',
    en: 'Could not load the card library {path}: {detail}',
  },
  cardNotInReader: {
    pl: 'W czytniku nie ma karty. Włóż kartę i spróbuj ponownie.',
    en: 'There is no card in the reader. Insert the card and try again.',
  },
  cardRemoved: {
    pl: 'Karta została wyjęta z czytnika.',
    en: 'The card was taken out of the reader.',
  },
  cardDeviceError: {
    pl: 'Błąd czytnika albo karty. Wyjmij kartę i włóż ją ponownie.',
    en: 'A reader or card error. Take the card out and insert it again.',
  },
  cardError: {
    pl: 'Błąd karty: {detail}',
    en: 'Card error: {detail}',
  },
  cardNoPrivateKey: {
    pl: 'Na karcie nie ma klucza prywatnego do tego certyfikatu.',
    en: 'The card has no private key for this certificate.',
  },
  cardNoRsa: {
    pl: 'Karta nie obsługuje podpisu RSA PKCS#1 v1.5.',
    en: 'The card does not support RSA PKCS#1 v1.5 signatures.',
  },
  cardNoEcdsa: {
    pl: 'Karta nie obsługuje podpisu ECDSA.',
    en: 'The card does not support ECDSA signatures.',
  },
  cardSignatureMismatch: {
    pl: 'Karta zwróciła podpis, który nie pasuje do certyfikatu. Sprawdź, czy wybrano właściwy certyfikat.',
    en: 'The card returned a signature that does not match the certificate. Check that the right certificate is selected.',
  },
  certGone: {
    pl: 'Tego certyfikatu nie ma już na karcie. Sprawdź kartę ponownie.',
    en: 'This certificate is no longer on the card. Check the card again.',
  },
  certExpired: {
    pl: 'Certyfikat jest nieważny (ważny do {date}).',
    en: 'The certificate is not valid (valid until {date}).',
  },
  certKeyUnsupported: {
    pl: 'Klucz tego certyfikatu nie jest ani RSA, ani EC — nie umiem nim podpisać.',
    en: 'This certificate’s key is neither RSA nor EC — the app cannot sign with it.',
  },
  pinRequired: {
    pl: 'Wpisz PIN.',
    en: 'Enter the PIN.',
  },
  pinIncorrect: {
    pl: 'Błędny PIN.',
    en: 'Wrong PIN.',
  },
  pinIncorrectFinalTry: {
    pl: 'Błędny PIN. Została ostatnia próba — kolejny błędny PIN zablokuje kartę.',
    en: 'Wrong PIN. One attempt left — another wrong PIN will block the card.',
  },
  pinIncorrectCountLow: {
    pl: 'Błędny PIN. Uważaj: karta liczy błędne próby i po kilku się zablokuje.',
    en: 'Wrong PIN. Careful: the card counts wrong attempts and blocks after a few.',
  },
  pinLength: {
    pl: 'PIN ma niewłaściwą długość.',
    en: 'The PIN has the wrong length.',
  },
  pinLocked: {
    pl: 'PIN jest zablokowany. Odblokuj go kodem PUK w programie do zarządzania kartą.',
    en: 'The PIN is blocked. Unblock it with the PUK in the card management program.',
  },
  pinExpired: {
    pl: 'PIN wygasł. Ustaw nowy w programie do zarządzania kartą.',
    en: 'The PIN has expired. Set a new one in the card management program.',
  },
  pinEntryCancelled: {
    pl: 'Wpisywanie PIN-u na czytniku zostało przerwane.',
    en: 'Entering the PIN on the reader was cancelled.',
  },
  podpisStopped: {
    pl: 'Podpisywanie przerwane na Twoje polecenie.',
    en: 'Signing stopped at your request.',
  },
  podpisFileMissing: {
    pl: 'Nie ma takiego pliku — mógł zostać przeniesiony.',
    en: 'There is no such file — it may have been moved.',
  },
  podpisFileMoved: {
    pl: 'Pliku już nie ma w tym miejscu — mógł zostać przeniesiony.',
    en: 'The file is no longer in this place — it may have been moved.',
  },
  podpisFileUnreadable: {
    pl: 'Nie udało się odczytać pliku: {detail}',
    en: 'Could not read the file: {detail}',
  },
  pdfUnreadable: {
    pl: 'Nie udało się odczytać tego pliku jako PDF ({detail}).',
    en: 'This file could not be read as a PDF ({detail}).',
  },
  pdfEncrypted: {
    pl: 'PDF jest zabezpieczony hasłem — nie da się go podpisać. Zdejmij zabezpieczenie i dodaj plik ponownie.',
    en: 'The PDF is password-protected — it cannot be signed. Remove the protection and add the file again.',
  },
  pdfNoPages: {
    pl: 'PDF nie ma ani jednej strony.',
    en: 'The PDF has no pages.',
  },
  pdfAlreadySigned: {
    pl: 'Ten plik ma już podpis — dołożenie drugiego unieważniłoby poprzedni. Podpisywanie plików już podpisanych nie jest jeszcze obsługiwane.',
    en: 'This file is already signed — adding a second signature would invalidate the first. Signing already signed files is not supported yet.',
  },
  padesNoPlaceholder: {
    pl: 'PDF: nie znaleziono miejsca na podpis.',
    en: 'PDF: no room for the signature was found.',
  },
  padesNoByteRange: {
    pl: 'PDF: nie znaleziono zakresu podpisu.',
    en: 'PDF: the signature byte range was not found.',
  },
  padesTooLarge: {
    pl: 'PDF: plik za duży na podpis.',
    en: 'PDF: the file is too large to sign.',
  },
  padesSignatureTooLarge: {
    pl: 'PDF: podpis nie mieści się w miejscu na niego przeznaczonym.',
    en: 'PDF: the signature does not fit in the room reserved for it.',
  },
  xmlInvalid: {
    pl: 'Niepoprawny XML (znak {at}): {what}.',
    en: 'Invalid XML (character {at}): {what}.',
  },
  xmlAlreadySigned: {
    pl: 'Ten plik XML ma już podpis — dołożenie drugiego nie jest obsługiwane.',
    en: 'This XML file is already signed — adding a second signature is not supported.',
  },
  xmlRootNotClosed: {
    pl: 'Nie da się podpisać tego XML: element główny musi mieć osobny znacznik zamykający.',
    en: 'This XML cannot be signed: the root element needs a separate closing tag.',
  },
  xmlUtf16: {
    pl: 'Plik XML jest zapisany w UTF-16 — podpisuję tylko pliki w UTF-8.',
    en: 'The XML file is saved in UTF-16 — only UTF-8 files are signed.',
  },
  xmlNotUtf8: {
    pl: 'Plik nie jest poprawnym tekstem UTF-8 — podpisuję tylko pliki XML w UTF-8.',
    en: 'The file is not valid UTF-8 text — only UTF-8 XML files are signed.',
  },
  xmlEncoding: {
    pl: 'Plik XML jest w kodowaniu {encoding} — podpisuję tylko pliki w UTF-8.',
    en: 'The XML file is in the {encoding} encoding — only UTF-8 files are signed.',
  },
} satisfies Record<string, ErrorText>;

export type AppErrorCode = keyof typeof APP_ERRORS;

export type AppErrorParams = Record<string, string | number>;

const MARKER = /\[\[app-error:([A-Za-z0-9_]+):([^\]]*)\]\]/;

function fill(text: string, params: AppErrorParams | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}

/** The text of `code` in `language`, its placeholders filled. */
export function appErrorText(code: AppErrorCode, params: AppErrorParams | undefined, language: 'pl' | 'en'): string {
  const entry: ErrorText = APP_ERRORS[code];
  return fill(entry[language] ?? entry.pl, params);
}

/** A refusal the person reads: `message` is the Polish text plus the code marker. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly params: AppErrorParams | undefined;

  constructor(code: AppErrorCode, params?: AppErrorParams) {
    super(`${appErrorText(code, params, 'pl')} [[app-error:${code}:${encodeURIComponent(JSON.stringify(params ?? {}))}]]`);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
  }
}

/** The code and params carried by a message (an IPC rejection, a stored error), if it has them. */
export function parseAppError(message: string): { code: AppErrorCode; params: AppErrorParams } | null {
  const m = MARKER.exec(message);
  if (!m || !(m[1] in APP_ERRORS)) return null;
  let params: AppErrorParams = {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(m[2]));
    if (parsed && typeof parsed === 'object') params = parsed as AppErrorParams;
  } catch {
    // A mangled marker still names its code; the text shows with its placeholders.
  }
  return { code: m[1] as AppErrorCode, params };
}

/** Whether `err` (or a message) carries `code` — for a caller that reacts to one refusal in particular. */
export function hasAppErrorCode(err: unknown, code: AppErrorCode): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return parseAppError(message)?.code === code;
}

/**
 * A message as the person reads it in `language`: a coded refusal in that
 * language, anything else as it is, with any marker left in it removed.
 */
export function localizeErrorMessage(message: string, language: 'pl' | 'en'): string {
  const parsed = parseAppError(message);
  if (!parsed) return message;
  return appErrorText(parsed.code, parsed.params, language);
}

/**
 * Every coded refusal inside a longer text worded in `language`, the text
 * around it kept: "Nie udało się zapisać: <refusal>" stays a sentence. A
 * marker whose Polish text does not stand right before it is replaced alone.
 * The last guard before text reaches the screen — a marker is never shown.
 */
export function localizeEmbeddedErrors(text: string, language: 'pl' | 'en'): string {
  let out = text;
  for (const [marker] of text.matchAll(new RegExp(MARKER.source, 'g'))) {
    const parsed = parseAppError(marker);
    const worded = parsed ? appErrorText(parsed.code, parsed.params, language) : '';
    const withPolish = parsed ? `${appErrorText(parsed.code, parsed.params, 'pl')} ${marker}` : marker;
    out = out.includes(withPolish) ? out.replace(withPolish, () => worded) : out.replace(marker, () => worded);
  }
  return out;
}
