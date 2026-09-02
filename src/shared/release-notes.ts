/**
 * In-app release notes — the content behind the "Co nowego" view and the
 * one-time modal that greets the user after an update.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADDING A RELEASE (do this for EVERY version bump, before packaging)
 * ────────────────────────────────────────────────────────────────────────────
 *  1. Bump `version` in package.json.
 *  2. Prepend a new entry at the TOP of RELEASES with the same version string.
 *     The app matches `getAppVersion()` against these entries, so a missing or
 *     mistyped version means the user simply never sees the notes.
 *  3. Write it for someone who has never opened the feature:
 *       • `where`  — the exact click path (menu item → section → button label),
 *                    using the labels visible in the UI, not internal names.
 *       • `steps`  — what to click, and what happens after each click (`then`).
 *       • `expect` — the result, the caveats, where the output lands.
 *     A highlight with no `where`/`steps` is only acceptable for changes the
 *     user cannot click (performance, cost, background jobs).
 *  4. Keep the newest release first; the rest stays as browsable history.
 *
 * Content is authored in Polish (the app's users are Polish housing-community
 * accountants). LocalizedText accepts an { pl, en } object where a translation
 * is worth the effort; plain strings are shown as-is in both languages.
 */

export type ReleaseNotesLanguage = 'pl' | 'en';

/** Either one string used for every language, or a per-language pair. */
export type LocalizedText = string | { pl: string; en: string };

export function loc(text: LocalizedText, language: ReleaseNotesLanguage): string {
  return typeof text === 'string' ? text : text[language] ?? text.pl;
}

/** Drives the badge colour and label on a highlight card. */
export type HighlightKind = 'new' | 'improved' | 'fixed';

/** One click of a walkthrough: what to do, and what the app does back. */
export interface ReleaseStep {
  /** The action, phrased imperatively: "Kliknij «Dodaj pliki»". */
  do: LocalizedText;
  /** What the user sees afterwards — omit only when nothing visible happens. */
  then?: LocalizedText;
}

export interface ReleaseHighlight {
  /** Stable id (kebab-case), used as the React key and the anchor. */
  id: string;
  kind: HighlightKind;
  /** Icon name from components/Icon.tsx. */
  icon: string;
  title: LocalizedText;
  /** One sentence: what this is. */
  summary: LocalizedText;
  /** Longer "why it matters" paragraphs. */
  details?: LocalizedText[];
  /** Click path, rendered as breadcrumb chips: ['Konwerter', 'Akceptacja']. */
  where?: LocalizedText[];
  /** Numbered walkthrough. */
  steps?: ReleaseStep[];
  /** What to expect afterwards — results, files produced, limits. */
  expect?: LocalizedText[];
  /** A single callout under the card. */
  note?: { type: 'tip' | 'warning'; text: LocalizedText };
}

/** Headline number on the release hero (e.g. "4" / "nowe funkcje"). */
export interface ReleaseStat {
  value: LocalizedText;
  label: LocalizedText;
}

export interface Release {
  /** Must match package.json exactly, e.g. '5.7.0'. */
  version: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: LocalizedText;
  /** One-liner under the title. */
  tagline: LocalizedText;
  stats?: ReleaseStat[];
  highlights: ReleaseHighlight[];
}

export const RELEASES: Release[] = [
  {
    version: '6.8.0',
    date: '2026-09-02',
    title: 'Kalendarz pilnuje terminów, a aplikacja ma wreszcie „wstecz”',
    tagline:
      'Największa tura zmian w Kalendarzu od jego powstania. Spotkanie ma teraz lokalizację wybieraną ze słownika, termin oznaczony jako potwierdzony albo wstępny, i ślad po każdej zmianie daty — z ostrzeżeniem u góry miesiąca, filtrem i przyciskiem „Zapoznałem się”. Do tego przy spotkaniu odnotujesz wysłane dokumenty (albo wyślesz je mailingiem, który sam się przy tym spotkaniu zapisze), panel dnia przewija się osobno od strony, a cała aplikacja zyskała nawigację wstecz i do przodu — przyciskami, skrótem Alt+strzałka i bocznymi guzikami myszy. Typ spotkania może wymagać wysłania dokumentów na X dni przed terminem, a pulpit zebrał cztery stany spotkań w jedną sekcję, z której jednym kliknięciem wchodzisz do Kalendarza z włączonym filtrem.',
    stats: [
      { value: 'wstecz', label: 'nawigacja w całej aplikacji' },
      { value: '2 stany', label: 'terminu: potwierdzony i wstępny' },
      { value: 'słownik', label: 'lokalizacji spotkań' },
      { value: 'mailing', label: 'powiązany ze spotkaniem' },
      { value: '4 stany', label: 'spotkań na pulpicie' },
    ],
    highlights: [
      {
        id: 'nawigacja-wstecz',
        kind: 'new',
        icon: 'arrow-right',
        title: 'Wstecz i do przodu, jak w przeglądarce',
        summary:
          'Nad menu, obok przycisku zwijania, są dwie strzałki: wracają do poprzedniego ekranu i idą z powrotem. Działa też Alt+← / Alt+→ oraz boczne przyciski myszy.',
        details: [
          'Aplikacja nie ma paska adresu, więc do tej pory „wróć tam, gdzie byłam” trzeba było odtworzyć z pamięci — zwłaszcza po wejściu w historię z pulpitu albo w szablony z mailingu.',
          'Historia pamięta nie tylko ekran, ale i zakładkę: cofnięcie z „Konwerter → Historia” wraca na „Konwerter → Konwersja”, a nie tylko do modułu. Zapamiętuje 50 ostatnich miejsc.',
          'Dymek nad strzałką mówi, gdzie ona prowadzi („Wstecz: Kalendarz → Lokalizacje”), bo w aplikacji bez paska adresu to jedyny sposób, żeby wiedzieć to przed kliknięciem.',
          'Skróty klawiszowe są wyłączone w trakcie pisania — Alt+← w polu tekstowym zostaje zwykłym skrótem pola.',
        ],
        where: ['Menu boczne', 'u góry'],
        steps: [
          {
            do: 'Poklikaj po kilku ekranach, np. Pulpit → Kalendarz → Ustawienia.',
            then: 'Strzałka „w lewo” nad menu przestaje być wyszarzona.',
          },
          {
            do: 'Kliknij strzałkę w lewo (albo naciśnij Alt+←).',
            then: 'Wracasz na Kalendarz — dokładnie na tę zakładkę, na której byłaś.',
          },
          {
            do: 'Kliknij strzałkę w prawo (albo Alt+→).',
            then: 'Idziesz z powrotem do Ustawień.',
          },
          {
            do: 'Zwiń menu przyciskiem z trzema kreskami.',
            then: 'Strzałki układają się w słupek pod przyciskiem i działają dalej.',
          },
        ],
        expect: [
          'Kliknięcie pozycji menu, na której już jesteś, nie tworzy nowego wpisu w historii.',
          'Historia żyje tak długo jak uruchomiona aplikacja — po restarcie startuje od pulpitu.',
        ],
      },
      {
        id: 'kalendarz-zmieniony-termin',
        kind: 'new',
        icon: 'alert-triangle',
        title: 'Zmieniony termin jest widoczny, dopóki ktoś go nie potwierdzi',
        summary:
          'Gdy ktoś edytuje datę lub godzinę spotkania, aplikacja to zapamiętuje: spotkanie dostaje ostrzeżenie z poprzednim terminem, u góry miesiąca pojawia się pasek, a przycisk „Zapoznałem się” przywraca zwykły wygląd.',
        details: [
          'Przesunięty termin to jedyna rzecz w tym module, o której ktoś musi zostać POINFORMOWANY — wszyscy zapisali sobie starą datę. Dlatego zmiana nie jest cicho stosowana, tylko odnotowana: kiedy nastąpiła, jaki był termin wcześniej i kto go zmienił.',
          'Znika dopiero po potwierdzeniu, nie po czasie: nieprzeczytana zmiana z zeszłego tygodnia jest nadal głośna, a przeczytana sprzed minuty — już cicha.',
          'Potwierdzenie jest wspólne dla wszystkich (jedna baza), więc pierwsza osoba, która kliknie „Zapoznałem się”, wycisza je też pozostałym. Zapis o zmianie zostaje — w szczegółach spotkania nadal widać, że termin był przesunięty.',
          'Aplikacja porównuje momenty w czasie, nie napisy: Supabase zapisuje strefę jako „+00:00”, a aplikacja jako „Z”, i te dwa zapisy zgadzają się tylko liczbowo.',
        ],
        where: ['Kalendarz'],
        steps: [
          {
            do: 'Otwórz Kalendarz, kliknij dwukrotnie istniejące spotkanie i zmień godzinę. Zapisz.',
            then: 'Karta spotkania dostaje pomarańczową ramkę i napis „Zmieniony termin spotkania — Poprzednio: …”, a u góry miesiąca pojawia się pasek „Zmieniony termin: 1”.',
          },
          {
            do: 'Kliknij ten pasek u góry.',
            then: 'Kwadracik po lewej zaznacza się, pasek dostaje obwódkę — a kalendarz pokazuje tylko spotkania ze zmienionym terminem.',
          },
          {
            do: 'Kliknij ten sam pasek jeszcze raz.',
            then: 'Filtr się wyłącza i wracają wszystkie spotkania.',
          },
          {
            do: 'Na karcie spotkania kliknij „Zapoznałem się”.',
            then: 'Ostrzeżenie znika, pasek u góry przestaje liczyć to spotkanie, a karta wygląda jak każda inna.',
          },
        ],
        expect: [
          'W siatce miesiąca takie spotkanie ma pomarańczowy kafelek z trójkątem — widać je bez wchodzenia w dzień.',
          'Zmiana samej nazwy, opisu, lokalizacji czy uczestników nie oznacza spotkania — liczy się wyłącznie data i godzina.',
          'Filtr jest tylko w tym pasku — jeden przełącznik na jeden stan, obok liczby, która o nim powiedziała.',
        ],
      },
      {
        id: 'kalendarz-termin-wstepny',
        kind: 'new',
        icon: 'clock',
        title: 'Termin potwierdzony albo wstępny',
        summary:
          'W formularzu spotkania wybierasz, czy data jest ustalona. Wstępny termin jest oznaczony przerywaną ramką, ma swój filtr i swój pasek u góry — a jedno kliknięcie na karcie zmienia go w potwierdzony.',
        details: [
          'Nowe spotkanie startuje jako potwierdzone — takich jest większość, a nazywanie każdego wpisu wstępnym odebrałoby oznaczeniu sens do końca pierwszego tygodnia.',
          'Rozwiązane tak samo jak zmieniony termin: oznaczenie na karcie i w siatce, filtr w pasku narzędzi, licznik u góry miesiąca. Różnica jest w tonie — wstępny termin to plan, nie problem, więc jest niebieski, a nie pomarańczowy.',
          'Spotkania zapisane przed tą wersją są potwierdzone: wtedy oznaczało to prawdziwą datę i tak zostaje.',
        ],
        where: ['Kalendarz', 'Nowe spotkanie', 'Termin'],
        steps: [
          {
            do: 'Dodaj spotkanie i w sekcji „Termin” wybierz „Wstępny”.',
            then: 'Po zapisaniu karta ma przerywaną niebieską ramkę i plakietkę „Wstępny”, a u góry miesiąca pojawia się „Termin wstępny: 1”.',
          },
          {
            do: 'Gdy data się potwierdzi, kliknij na karcie „Potwierdź termin”.',
            then: 'Oznaczenie znika bez wchodzenia w formularz.',
          },
          {
            do: 'Chcesz odwrotnie? Na potwierdzonym spotkaniu kliknij „Oznacz jako wstępny”.',
            then: 'Wraca przerywana ramka i licznik u góry.',
          },
        ],
        expect: [
          'Pasek „Termin wstępny” u góry miesiąca działa jak ten przy zmienionym terminie: kwadracik włącza i wyłącza filtr.',
          'Spotkanie może być jednocześnie wstępne i ze zmienionym terminem — wtedy pierwszeństwo w oznaczeniu ma zmieniony termin.',
        ],
      },
      {
        id: 'kalendarz-lokalizacje',
        kind: 'new',
        icon: 'map-pin',
        title: 'Lokalizacje spotkań — słownik jak typy spotkań',
        summary:
          'Nowa zakładka „Lokalizacje” w module Kalendarz: nazwa, adres i notatka. Przy spotkaniu wybierasz lokalizację z listy, a karta pokazuje ją z pinezką.',
        details: [
          'Gdzie odbywają się spotkania, to krótka i stabilna lista: biuro ZGN, budynek wspólnoty, sala. Wpisywanie tego za każdym razem jest sposobem, w jaki jeden adres zyskuje trzy pisownie.',
          'Adres i notatka („wejście od podwórza, II piętro”) są pokazywane pod nazwą przy wyborze, więc nikt nie musi pamiętać, o którą salę chodzi.',
          'Zmiana nazwy w słowniku przechodzi na wszystkie spotkania, które z niej korzystają. Usunięcie lokalizacji nie usuwa spotkań — każde zapamiętało jej nazwę, więc dalej mówi, gdzie się odbyło.',
        ],
        where: ['Kalendarz', 'Lokalizacje'],
        steps: [
          {
            do: 'Wejdź w Kalendarz i wybierz zakładkę „Lokalizacje”, potem „Dodaj lokalizację”.',
            then: 'Podajesz nazwę (np. „Biuro ZGN Mokotów”), opcjonalnie adres i notatkę.',
          },
          {
            do: 'Wróć na zakładkę „Kalendarz” i dodaj albo edytuj spotkanie.',
            then: 'W formularzu jest pole „Lokalizacja” z wyszukiwaniem; pod każdą nazwą widać jej adres.',
          },
          {
            do: 'Zapisz spotkanie i spójrz na jego kartę w panelu dnia.',
            then: 'Obok wspólnoty pojawia się lokalizacja z ikoną pinezki. Widać ją też w dymku nad kafelkiem w siatce.',
          },
        ],
        expect: [
          'Kolumna „Spotkań” w słowniku mówi, ile spotkań korzysta z danej lokalizacji — zanim ją usuniesz.',
          'Lokalizacje wchodzą do kopii zapasowej i są w niej liczone osobno („lokalizacje spotkań”).',
          'Wyszukiwarka w Kalendarzu znajduje spotkania także po nazwie lokalizacji.',
        ],
      },
      {
        id: 'kalendarz-dokumenty',
        kind: 'new',
        icon: 'file-check',
        title: 'Dokumenty na spotkanie — ręcznie albo mailingiem',
        summary:
          'Na karcie spotkania jest sekcja dokumentów: możesz wpisać, co zostało wysłane, albo jednym kliknięciem przejść do mailingu — a wysyłka sama zapisze się przy tym spotkaniu, ze szczegółami.',
        details: [
          'Dwie drogi do tego samego pytania („czy papiery poszły?”), bo obie zdarzają się w praktyce: ktoś wysyła ręcznie ze swojej skrzynki i odnotowuje to tutaj, albo wysyłka idzie przez moduł Mailing.',
          'Ręczny wpis jest opisowy, nie „ptaszkiem”: liczy się to, CO zostało wysłane („sprawozdanie 2025, uchwała nr 3/2026”), razem z datą i osobą, która to odnotowała.',
          'Mailing wywołany ze spotkania startuje z wybraną wspólnotą tego spotkania i pokazuje u góry, przy którym spotkaniu zostanie zapisany. Każdy wysłany mail z tej wysyłki wskazuje na to spotkanie.',
          'Historia mailingu pozostaje źródłem prawdy o wysyłce — karta spotkania pokazuje jej skrót: szablon, do kogo poszło, kiedy i ile załączników.',
        ],
        where: ['Kalendarz', 'karta spotkania', 'Dokumenty'],
        steps: [
          {
            do: 'Zjedź na dół karty spotkania — sekcja dokumentów jest wydzielona pod przyciskami — i kliknij „Oznacz jako wysłane”.',
            then: 'Rozwija się pole na opis. Wpisz, co poszło, i kliknij „Zapisz”.',
          },
          {
            do: 'Spójrz na sekcję dokumentów.',
            then: 'Napis zmienia się na zielone „Dokumenty wysłane”, pod nim Twój opis oraz „Oznaczone <data> przez <osoba>”.',
          },
          {
            do: 'Chcesz wysłać mailingiem? Kliknij „Wyślij mailingiem” na karcie spotkania (dostępne, gdy spotkanie ma przypisaną wspólnotę).',
            then: 'Aplikacja przechodzi do Mailingu z wybraną wspólnotą i niebieskim paskiem „Ten mailing zostanie zapisany przy spotkaniu: …”.',
          },
          {
            do: 'Wyślij mailing normalnie, potem wróć do Kalendarza (np. strzałką wstecz).',
            then: 'W sekcji dokumentów pojawia się wiersz wysyłki: szablon, odbiorca, data i liczba załączników.',
          },
          {
            do: 'Kliknij ten wiersz.',
            then: 'Otwiera się to samo okno szczegółów co w historii mailingu: treść dokładnie taka, jaka poszła, wartości pól i załączniki do otwarcia.',
          },
        ],
        expect: [
          'Pomyłka? „Edytuj wpis” → „Wycofaj” zdejmuje oznaczenie razem z opisem, żeby spotkanie nie twierdziło, że coś się stało.',
          '„Wyślij mailingiem” nie pojawia się przy spotkaniu bez wspólnoty — mailing idzie do jednostki miasta przypisanej do wspólnoty, więc bez niej nie ma adresata.',
          'Pasek w Mailingu można odłączyć („Odłącz od spotkania”), jeśli akurat wysyłasz coś niezwiązanego.',
          'Uwaga do kopii zapasowej: po przywróceniu kopii wysyłki zachowują wszystkie swoje szczegóły w historii mailingu, ale tracą powiązanie ze spotkaniem — spotkania dostają przy przywracaniu nowe numery, a wiersz mailingu nie ma po czym ich odnaleźć.',
        ],
      },
      {
        id: 'kalendarz-termin-wysylki',
        kind: 'new',
        icon: 'alert-circle',
        title: 'Termin na dokumenty — z typu spotkania',
        summary:
          'W typie spotkania podajesz, ile dni przed spotkaniem trzeba wysłać dokumenty. Gdy ten termin minie, a dokumenty nie wyszły, spotkanie dostaje czerwone ostrzeżenie, licznik u góry miesiąca i własny filtr. Typ bez podanej liczby dni nie uruchamia tego wcale.',
        details: [
          'Termin jest właściwością RODZAJU spotkania, nie jednego spotkania: zebranie roczne wspólnoty ma okres zawiadomienia, wewnętrzna narada nie ma żadnego. Puste pole w typie znaczy „ten rodzaj nie ma takiego wymogu” — i wtedy ani ostrzeżenie, ani licznik, ani filtr nie dotyczą jego spotkań.',
          '„Wysłane” liczy się dwiema drogami: ręczny wpis na karcie albo mailing, który rzeczywiście poszedł. Nieudana wysyłka nie jest wysyłką. Pytanie o sam mailing nazwałoby spotkanie niewysłanym tylko dlatego, że księgowa użyła własnej skrzynki.',
          'Ostrzeżenie zapala się, gdy termin minie — a nie gdy minie samo spotkanie. Sens okresu zawiadomienia jest w tym, że kończy się PRZED spotkaniem, więc alarm przychodzi, kiedy jest jeszcze co ratować.',
          'Doszedł też filtr „Dokumenty niewysłane”, niezależny od terminów: pokazuje wszystkie spotkania, dla których papiery nie wyszły żadną drogą.',
        ],
        where: ['Kalendarz', 'Typy spotkań'],
        steps: [
          {
            do: 'Wejdź w Kalendarz → „Typy spotkań”, edytuj typ i wypełnij pole „Dokumenty wysłać X dni przed spotkaniem” (np. 14).',
            then: 'W tabeli typów, w kolumnie „Wysyłka”, pojawia się „14 dni przed”. Typy z pustym polem mają „bez wymogu”.',
          },
          {
            do: 'Wróć na Kalendarz i znajdź spotkanie tego typu, dla którego dokumenty nie wyszły.',
            then: 'W sekcji dokumentów na dole karty widać, ile dni zostało („Dokumenty do wysłania w ciągu 6 dni”).',
          },
          {
            do: 'Gdy termin minie, spójrz na to spotkanie ponownie.',
            then: 'Stopka karty robi się czerwona z napisem „Termin wysyłki minął 4 dni temu”, a u góry miesiąca pojawia się pasek „Wysyłka po terminie”.',
          },
          {
            do: 'Kliknij ten pasek, żeby zostawić na widoku tylko te spotkania. Wyślij dokumenty (ręcznie albo mailingiem).',
            then: 'Ostrzeżenie i licznik znikają dla tego spotkania.',
          },
        ],
        expect: [
          'Dozwolone jest od 1 do 365 dni; puste pole to świadoma odpowiedź „bez wymogu”, nie brak danych.',
          'Termin liczy się od godziny rozpoczęcia spotkania, więc „14 dni przed” zebraniem o 18:00 kończy się o 18:00.',
          'Liczba dni wchodzi do kopii zapasowej razem z typami spotkań.',
        ],
      },
      {
        id: 'pulpit-spotkania-do-zrobienia',
        kind: 'new',
        icon: 'calendar',
        title: 'Pulpit: „Spotkania — do zrobienia”',
        summary:
          'Pulpit dzieli się teraz na dwa obszary, każdy z własnym banerem: „Spotkania — do zrobienia” na górze i księgowania miesiąca pod nimi. W sekcji spotkań są cztery liczby — wysyłka po terminie, zmieniony termin, dokumenty niewysłane, termin wstępny — a kliknięcie otwiera Kalendarz z tym filtrem już włączonym.',
        details: [
          'Dzień zaczyna się na pulpicie, a trzy z tych czterech stanów to rzeczy, które ktoś musi zrobić PRZED spotkaniem — więc ich miejsce jest tutaj, nie o jeden moduł dalej.',
          'Sekcja jest osobnym obszarem z własnym banerem — zbudowanym jak pasek miesiąca: ilustracja, podbarwienie, dwa fakty (ile czeka, co najbliżej) — nad księgowaniami. Wstawiona między kafelki i listę wspólnot czytałaby się jak trzeci rząd tych samych liczb — i sugerowałaby, że dotyczy wyświetlanego miesiąca, a nie dotyczy: liczy od dziś w przód, niezależnie od miesiąca poniżej. Baner mówi to wprost.',
          'Każdy kafelek jest zarazem drogą wejścia: otwiera Kalendarz z odpowiednim filtrem i na bieżącym miesiącu. Kafelek, który tylko by nawigował, zostawiłby użytkownika z szukaniem tych kilkunastu spotkań, które właśnie policzył.',
          'Liczone od dziś w przód. Pulpit jest o tym, co jeszcze da się zrobić — okres zawiadomienia, który minął dla spotkania z marca, jest faktem, nie zadaniem, a zbieranie takich pozycji zamieniłoby kafelek w liczbę, której nikt nigdy nie sprowadzi do zera. Marcowe spotkania nadal widać w Kalendarzu po przejściu do tego miesiąca.',
          'Gdy wszystkie cztery liczby są zerem, kafelki ustępują miejsca jednemu zielonemu zdaniu: „Nic nie czeka…”. Cztery zera kazałyby je przeliczyć, żeby się tego domyślić.',
        ],
        where: ['Pulpit'],
        steps: [
          {
            do: 'Wejdź na „Pulpit”.',
            then: 'Na górze jest baner „Spotkania — do zrobienia” z własną ilustracją: ile rzeczy czeka i jakie jest najbliższe spotkanie. Pod nim cztery kafelki, a niżej — wyraźnie oddzielony — znajomy pasek miesiąca z księgowaniami.',
          },
          {
            do: 'Kliknij „Otwórz Kalendarz” w banerze sekcji.',
            then: 'Przechodzisz do Kalendarza bez żadnego filtra — po prostu do modułu.',
          },
          {
            do: 'Kliknij kafelek z niezerową liczbą, np. „Wysyłka po terminie”.',
            then: 'Otwiera się Kalendarz na bieżącym miesiącu, z włączonym tym filtrem — u góry widać zaznaczony przełącznik.',
          },
          {
            do: 'Wyłącz przełącznik u góry Kalendarza, żeby wrócić do wszystkich spotkań.',
            then: 'Filtr gaśnie; następne wejście z pulpitu włączy go od nowa.',
          },
        ],
        expect: [
          'Kafelek z zerem jest przygaszony i nieklikalny — rząd nie zmienia kształtu, kiedy liczby się zmieniają.',
          'Kolory są te same co w Kalendarzu i każdy stan ma swój: czerwony — wysyłka po terminie, pomarańczowy — zmieniony termin, indygo — dokumenty niewysłane, niebieski — termin wstępny.',
        ],
      },
      {
        id: 'kalendarz-scroll-dnia',
        kind: 'fixed',
        icon: 'calendar',
        title: 'Panel dnia przewija się osobno od strony',
        summary:
          'Dzień z wieloma spotkaniami przewija się teraz we własnym panelu, zamiast przewijać cały ekran razem z siatką miesiąca.',
        details: [
          'Panel dnia miał własny suwak, ale nie miał wysokości, o którą mógłby się oprzeć: strona rosła razem z listą spotkań, więc przewijało się wszystko naraz i siatka miesiąca uciekała w górę.',
          'Teraz widok Kalendarza wypełnia okno dokładnie, a przewijają się dwa panele w środku: siatka miesiąca i lista wybranego dnia. Nagłówek z miesiącem i pasek narzędzi zostają na miejscu.',
          'Na bardzo niskim oknie panele nie ściskają się w nieskończoność — poniżej pewnej wysokości przewija się cała strona, tak jak dawniej.',
        ],
        where: ['Kalendarz'],
        steps: [
          {
            do: 'Wybierz dzień z kilkoma spotkaniami.',
            then: 'Lista po prawej przewija się sama, a nazwa miesiąca i przyciski nawigacji zostają widoczne.',
          },
        ],
        expect: [
          'Siatka miesiąca ma własny suwak, z przyklejonym paskiem dni tygodnia — bez zmian.',
        ],
      },
    ],
  },
  {
    version: '6.7.0',
    date: '2026-09-02',
    title: 'Ludzie z imienia i nazwiska — lista użytkowników i powitanie',
    tagline:
      'Aplikacja przestaje mówić do Ciebie adresem e-mail. W Ustawieniach jest nowa sekcja „Użytkownicy”: lista wszystkich kont, które mają dostęp, a przy każdym dwa pola — imię i nazwisko. Raz wpisane, pojawiają się wszędzie tam, gdzie do tej pory był e-mail: przy wyborze uczestników spotkania w Kalendarzu, na liście uczestników zapisanego spotkania, a także w powitaniu: pod logo FileFunky aplikacja wita Cię imieniem — „SIEMANKO”, pod tym Twoje imię dużą czcionką i krótka kreska. Do tego pasek postępu na pulpicie mierzy się wreszcie do wszystkich wspólnot, a nie do liczby wygenerowanych plików, i dopisuje jedno zdanie o tym, co zostało do zrobienia.',
    stats: [
      { value: '2 pola', label: 'imię i nazwisko na konto' },
      { value: 'Kalendarz', label: 'wybór osoby po nazwisku' },
      { value: 'Siemanko', label: 'powitanie pod logo w menu' },
      { value: 'wspólnoty', label: 'nowa miara paska postępu' },
    ],
    highlights: [
      {
        id: 'uzytkownicy-imie-nazwisko',
        kind: 'new',
        icon: 'users',
        title: 'Ustawienia → Użytkownicy: imię i nazwisko dla każdego konta',
        summary:
          'Nowa sekcja w Ustawieniach z listą wszystkich kont mających dostęp do aplikacji. Przy każdym wpisujesz imię i nazwisko — i od tej chwili aplikacja posługuje się nimi zamiast adresem e-mail.',
        details: [
          'Konta zakłada się w panelu Supabase i aplikacja tylko je odczytuje — dlatego tej listy nie da się tu poszerzyć ani skrócić, a nowa osoba pojawia się na niej sama, gdy dostanie dostęp. Aplikacja dokłada jedyną rzecz, której konto o sobie nie wie: jak ta osoba się nazywa.',
          'Imię i nazwisko są osobnymi polami aplikacji, niezależnymi od nazwy zapisanej w samym koncie Supabase. Dzięki temu zmiana hasła ani żadna operacja na koncie nie wyczyści tego, co tu wpiszesz.',
          'Nadawać imiona może każda zalogowana osoba — to jedno biuro pracujące na jednej bazie, więc osobne role administratorów byłyby rusztowaniem wokół listy kilku osób.',
          'Lista siedzi na samym dole Ustawień, w zwiniętej sekcji „ADMIN”, razem z przełącznikiem „NIE UŻYWAĆ — POMIŃ AKCEPTACJĘ”. Imiona nadaje się raz na osobę, a tego przełącznika nie należy ruszać wcale — żadne z dwojga nie ma czego szukać w toku codziennych ustawień.',
        ],
        where: ['Ustawienia', 'ADMIN', 'Użytkownicy'],
        steps: [
          {
            do: 'Wejdź w „Ustawienia” w menu po lewej i przewiń na sam dół, do zwiniętej sekcji „ADMIN”.',
            then: 'Sekcja jest domyślnie zamknięta — obok napisu „ADMIN” widnieje podpowiedź, co jest w środku.',
          },
          {
            do: 'Kliknij „ADMIN”, żeby ją rozwinąć.',
            then: 'Pierwszą kartą w środku są „Użytkownicy”: lista kont — kółko z inicjałami, nazwa osoby, pod nią adres e-mail, a Twoje własne konto jest podpisane „to Ty”.',
          },
          {
            do: 'W kolumnie „Imię” wpisz imię, w „Nazwisko” — nazwisko.',
            then: 'Przycisk „Zapisz” w tym wierszu przestaje być wyszarzony. Dopóki nic nie zmieniłaś, jest nieaktywny.',
          },
          {
            do: 'Kliknij „Zapisz” w tym wierszu (albo po prostu naciśnij Enter w jednym z dwóch pól).',
            then: 'Na górze pojawi się zielony komunikat „Zapisano: Imię Nazwisko”, a wiersz od razu pokazuje nową nazwę. Pod listą widać licznik „Nazwanych osób: 3 z 5”.',
          },
          {
            do: 'Chcesz usunąć nazwę? Wyczyść oba pola i zapisz.',
            then: 'Osoba wraca do wyświetlania jako adres e-mail.',
          },
        ],
        expect: [
          'Sekcja „ADMIN” wraca do stanu zamkniętego przy każdym wejściu w Ustawienia.',
          'Lista jest wspólna dla wszystkich instalacji — nazwa wpisana u Ciebie jest widoczna dla wszystkich, tak samo jak banki czy adresy.',
          'Kolejność listy idzie po nazwie, nie po adresie e-mail, i uwzględnia polskie znaki.',
          'Imiona i nazwiska wchodzą do kopii zapasowej — po przywróceniu kopii wracają, dopasowane po adresie e-mail. W podsumowaniu kopii pojawia się nowa pozycja „nazwy użytkowników”.',
        ],
        note: {
          type: 'warning',
          text: 'Ta wersja wymaga jednorazowej aktualizacji bazy (supabase/app-users-imie-nazwisko.sql). Bez niej sekcja „Użytkownicy” zgłosi błąd zapisu.',
        },
      },
      {
        id: 'kalendarz-po-nazwisku',
        kind: 'improved',
        icon: 'calendar',
        title: 'W Kalendarzu wybierasz osobę, nie skrzynkę',
        summary:
          'Lista uczestników spotkania pokazuje imiona i nazwiska. Adres e-mail zsuwa się do drugiego planu — zostaje jako podpowiedź pod nazwą i nadal działa w wyszukiwaniu.',
        details: [
          'Nazwisko jest tym, czym ludzie posługują się mówiąc o spotkaniu, a adres e-mail bywa nieoczywisty — dwa konta z podobnym adresem to dokładnie ta sytuacja, w której łatwo dodać nie tę osobę.',
          'E-mail nie znika: pokazuje się pod nazwą i pozostaje w wyszukiwaniu, więc gdy dwie osoby mają to samo imię, nadal masz czym je rozróżnić.',
          'Osoby zapisane na spotkaniu przechowują nazwę z chwili zapisu. Późniejsza zmiana imienia nie przepisuje tego, kto — jak mówi zapis — był na spotkaniu w zeszłym miesiącu.',
        ],
        where: ['Kalendarz', 'Nowe spotkanie', 'Uczestnicy'],
        steps: [
          {
            do: 'Otwórz „Kalendarz” i kliknij dwukrotnie dowolny dzień.',
            then: 'Otworzy się formularz nowego spotkania.',
          },
          {
            do: 'Rozwiń „Dodaj uczestnika…” w sekcji „Uczestnicy”.',
            then: 'Na liście widać imiona i nazwiska, a pod każdym — drobnym drukiem — adres e-mail.',
          },
          {
            do: 'Nie widzisz czyjegoś nazwiska, tylko adres e-mail? Ta osoba nie została jeszcze nazwana.',
            then: 'Wejdź w Ustawienia → Użytkownicy, wpisz jej imię i nazwisko, wróć do Kalendarza — będzie już na liście pod nazwą.',
          },
        ],
        expect: [
          'Wyszukiwanie w rozwijanej liście działa i po nazwisku, i po adresie e-mail.',
          'Spotkania zapisane przed tą wersją pokazują to, co miały zapisane wcześniej — nic nie zostało nadpisane.',
        ],
      },
      {
        id: 'powitanie-siemanko',
        kind: 'new',
        icon: 'sparkles',
        title: 'Powitanie pod logo FileFunky',
        summary:
          'Tuż pod logo, nad wszystkimi modułami, aplikacja wita Cię imieniem: „SIEMANKO” drobnym rozstrzelonym drukiem, pod tym Twoje imię dużą czcionką, a pod nim — od prawej — krótka kreska. Podpis i kreska mają kolor bieżącego miesiąca, ten sam, którym podbarwiony jest pasek miesiąca na pulpicie.',
        details: [
          'To pierwsza rzecz w menu — aplikacja otwiera się i zwraca do człowieka, zamiast od razu do danych. Imię bierze z Ustawień → Użytkownicy; dopóki nikt Cię nie nazwał, używa początku Twojego adresu e-mail.',
          'Powitanie nie ma ramki ani tła: w kolumnie pozycji menu każde pudełko czytałoby się jako kolejny przycisk do klikania. Trzymają je trzy elementy i dużo powietrza — podpis, imię, kreska.',
          'Kolor idzie za porą roku: wrzesień i październik są ciepłe, rdzawe, zima chłodna i błękitna, listopad szary, grudzień świerkowy. To te same dwanaście kolorów, które podbarwiają pasek miesiąca na pulpicie, więc menu i pulpit mówią o tej samej porze roku.',
          'Na dole menu został sam „Wyloguj”. Wcześniej był tam jeden wiersz „Wyloguj (adres@e-mail)” — odczytanie, kim jesteś, i zakończenie sesji dzieliły jeden przycisk.',
        ],
        where: ['Menu boczne'],
        steps: [
          {
            do: 'Spójrz pod logo FileFunky w menu po lewej.',
            then: 'Zobaczysz „SIEMANKO” w kolorze bieżącego miesiąca, pod tym swoje imię, a pod nim — dosuniętą do prawej — krótką kreskę, która przy uruchomieniu rozciąga się do swojej długości.',
          },
          {
            do: 'Nie widzisz swojego imienia, tylko fragment adresu e-mail? Nikt Cię jeszcze nie nazwał.',
            then: 'Wejdź w Ustawienia → Użytkownicy, wpisz swoje imię i nazwisko, zapisz — powitanie zmieni się od razu, bez restartu aplikacji.',
          },
          {
            do: 'Zwiń menu przyciskiem z trzema kreskami u góry.',
            then: 'Powitanie znika: wąski pasek jest z założenia tylko na ikony. Adres e-mail, na który jesteś zalogowana, pokazuje dymek nad „Wyloguj”.',
          },
        ],
        expect: [
          'Logo FileFunky nad powitaniem jest teraz mniejsze, a odstępy w nagłówku ciaśniejsze — menu zaczyna się o ~50 px wyżej, więc mniej pozycji ucieka pod przewijanie.',
          'Powitanie pojawia się dopiero, gdy aplikacja odczyta Twoje imię — dzięki temu nie mruga najpierw adresem e-mail, a potem imieniem.',
          'Bardzo długie imię zostanie przycięte wielokropkiem, żeby nie rozpychało menu.',
          'Kolor zmienia się sam pierwszego dnia nowego miesiąca — także wtedy, gdy aplikacja została włączona przez noc.',
        ],
      },
      {
        id: 'pulpit-postep-i-krok',
        kind: 'fixed',
        icon: 'bar-chart',
        title: 'Pasek postępu liczy wspólnoty, a nie pliki',
        summary:
          'Pasek „Zaksięgowane w DOM” mierzy się teraz do wszystkich wspólnot — pisze „9 z 12 wspólnot”. Do tego pod podsumowaniem doszło jedno zdanie z następnym krokiem.',
        details: [
          'Do tej pory pasek pokazywał pliki: „12 z 37 plików”. To 37 nie brało się z niczego, co dałoby się sprawdzić — była to liczba plików księgowych, jakie akurat udało się wygenerować w tym miesiącu. Mianownik rósł więc w trakcie pracy, a pasek mógł stać na 100% w miesiącu, w którym połowa wspólnot nie miała jeszcze ani jednego pliku.',
          'Teraz mianownikiem są wszystkie wspólnoty, tak samo jak w kafelkach nad listą i na samej liście. Pasek odpowiada na pytanie „ile miesiąca jest za nami” i dochodzi do 100% dopiero wtedy, gdy każda wspólnota jest odklikana w DOM.',
          'Liczby plików nie znikają — są dalej w podsumowaniu nad paskiem („12 plików księgowych · 3 czeka na DOM”), tylko zawsze nazwane jako pliki.',
          'Wspólnota usunięta z książki adresowej, która ma robotę w tym miesiącu, wchodzi do mianownika — jej praca jest prawdziwa i widnieje na liście. Wiersz „Bez przypisanej wspólnoty” nie wchodzi, bo nie jest wspólnotą.',
        ],
        where: ['Pulpit'],
        steps: [
          {
            do: 'Wejdź na „Pulpit” i spójrz na pasek pod nazwą miesiąca.',
            then: 'Po prawej stronie paska przeczytasz „9 z 12 wspólnot” i procent — gdzie 12 to tyle wspólnot, ile masz w „Adresach”.',
          },
          {
            do: 'Pod podsumowaniem przeczytaj zdanie z następnym krokiem.',
            then: 'Mówi, co zrobić dalej: że miesiąc jest jeszcze pusty, ile plików czeka na zaznaczenie w DOM, ile konwersji poprawić, albo — na zielono — że miesiąc jest domknięty.',
          },
          {
            do: 'Zaznacz w DOM wszystkie pliki, jakie są w tym miesiącu.',
            then: 'Jeśli któraś wspólnota nie ma jeszcze pliku, zdanie powie wprost: „Wszystko odklikane, ale bez pliku w tym miesiącu zostają wspólnoty: 2” — a pasek nie pokaże 100%, bo miesiąc nie jest skończony.',
          },
        ],
        expect: [
          'Zdanie i pasek zawsze mówią to samo: „miesiąc domknięty” pojawia się dokładnie wtedy, gdy pasek jest na 100%.',
          'Błędy mają pierwszeństwo — miesiąc z nieudaną konwersją nie jest skończony, nawet jeśli nie ma już czego odklikać.',
          'To samo jest na zakładce „Księgowania” w Konwerterze, bo to ten sam ekran. Liczby idą za wybranym miesiącem, nie za bieżącym.',
        ],
      },
    ],
  },
  {
    version: '6.6.0',
    date: '2026-09-02',
    title: 'Wygasła sesja mówi, że wygasła — i aktualizacje sprawdzane co godzinę',
    tagline:
      'Dwie rzeczy, które do tej pory trzeba było odgadywać. Pierwsza: gdy logowanie do chmury wygaśnie w trakcie pracy, aplikacja nie udaje już, że wszystko jest w porządku — wraca na ekran logowania i pisze wprost, co się stało. Wcześniej wyglądała na zalogowaną, a operacje kończyły się błędami w rodzaju „Bank not found”, które nie miały nic wspólnego z prawdziwą przyczyną, i pomagało dopiero przelogowanie. Druga: nowa wersja jest wyszukiwana nie tylko przy uruchomieniu, ale też raz na godzinę przy włączonej aplikacji, a „Później” wyjaśnia teraz, czym grozi zostanie na starej wersji.',
    stats: [
      { value: 'co godzinę', label: 'sprawdzanie nowej wersji' },
      { value: 'komunikat', label: 'zamiast błędu „Bank not found”' },
      { value: 'wspólnoty', label: 'nowa miara paska postępu' },
    ],
    highlights: [
      {
        id: 'wygasla-sesja-komunikat',
        kind: 'fixed',
        icon: 'shield',
        title: 'Wygasła sesja zamiast błędu „Bank not found”',
        summary:
          'Kiedy logowanie do chmury przestaje być ważne, aplikacja przerywa pracę, wraca na ekran logowania i wyjaśnia dlaczego — zamiast pokazywać błędy, które sugerują zepsute dane.',
        details: [
          'Wspólne dane — banki, adresy, kontrahenci, historia, kalendarz — leżą w chmurze i są widoczne tylko dla zalogowanego użytkownika. Po wygaśnięciu sesji baza nie zwracała błędu, tylko pustą odpowiedź, więc aplikacja czytała to jako „takiego banku nie ma” i pisała „Bank not found”. Nic nie było zepsute: brakowało wyłącznie ważnego logowania, dlatego przelogowanie natychmiast pomagało.',
          'Teraz każde zapytanie bez ważnej sesji jest zatrzymywane z polskim komunikatem, a aplikacja przestaje udawać zalogowaną: znika menu boczne z „Wyloguj”, a na jego miejsce wraca ekran logowania z żółtą ramką i wyjaśnieniem.',
          'Konwersja pliku sprawdza sesję jeszcze przed odczytem banku, więc o wygaśnięciu dowiadujesz się od razu po wrzuceniu pliku, a nie w połowie przetwarzania.',
        ],
        where: ['Ekran logowania'],
        steps: [
          {
            do: 'Pracuj normalnie. Jeśli sesja wygaśnie, aplikacja sama wróci na ekran logowania.',
            then: 'Nad polami e-mail i hasło pojawi się żółta ramka: „Sesja wygasła i aplikacja wylogowała Cię automatycznie…”.',
          },
          {
            do: 'Wpisz e-mail i hasło, kliknij „Zaloguj”.',
            then: 'Wracasz do aplikacji, dane z chmury znów się wczytują, a ramka znika.',
          },
          {
            do: 'Jeśli komunikat zastał Cię w trakcie konwersji, wrzuć plik ponownie po zalogowaniu.',
            then: 'Konwersja przechodzi normalnie — przerwana próba nie zapisała pliku księgowego ani wpisu w historii.',
          },
        ],
        expect: [
          'Ten sam komunikat zobaczysz przy uruchomieniu aplikacji, jeśli sesja wygasła między jednym a drugim otwarciem.',
          'Kliknięcie „Wyloguj” samodzielnie nie pokazuje żadnego ostrzeżenia — to Twoja decyzja, nie awaria.',
          'Automatyczna kopia zapasowa nie zapisze się już jako pusta, gdy zabraknie sesji: zamiast pliku bez danych zostaje ostrzeżenie w logu (Ustawienia → „Otwórz folder logów”).',
        ],
        note: {
          type: 'tip',
          text: 'Jeśli komunikat wraca zaraz po każdym zalogowaniu, sprawdź datę i godzinę na komputerze — przesunięty zegar potrafi unieważnić logowanie.',
        },
      },
      {
        id: 'aktualizacje-co-godzine',
        kind: 'improved',
        icon: 'refresh',
        title: 'Sprawdzanie aktualizacji co godzinę, także w trakcie pracy',
        summary:
          'Nowa wersja jest wyszukiwana nie tylko przy uruchomieniu, ale też raz na godzinę, dopóki aplikacja jest włączona. A „Później” mówi wprost, czym grozi praca na starszej wersji.',
        details: [
          'Aplikację często zostawia się otwartą przez wiele dni. Do tej pory jedno sprawdzenie przy starcie oznaczało, że o poprawce wydanej w środę dowiadywałaś się w poniedziałek — albo dopiero przy zgłaszaniu błędu, który był już naprawiony.',
          'Aktualizacja nie jest tu opcją estetyczną: pliki księgowe muszą pasować do bieżących zasad w DOM, a poprawki dotyczą też rozpoznawania wpłat i przypisywania mieszkań. Dlatego „Później” nie zamyka już okienka po cichu.',
        ],
        where: ['Okienko w prawym górnym rogu'],
        steps: [
          {
            do: 'Pracuj normalnie. Gdy ukaże się nowa wersja, w prawym górnym rogu pojawi się okienko „Dostępna nowa wersja”.',
            then: 'Zobaczysz numer nowej wersji oraz przyciski „Pobierz” i „Później”.',
          },
          {
            do: 'Kliknij „Pobierz”, żeby zaktualizować od razu.',
            then: 'Windows: aplikacja pobierze aktualizację, zainstaluje ją i uruchomi się ponownie. macOS: otworzy się strona z plikiem DMG i instrukcją.',
          },
          {
            do: 'Kliknij „Później”, jeśli nie możesz teraz przerwać pracy.',
            then: 'Okienko zmieni się w ostrzeżenie „Aktualizacja jest konieczna” z opisem, czym grozi zostanie na starszej wersji.',
          },
          {
            do: 'W ostrzeżeniu wybierz „Aktualizuj teraz” albo „Rozumiem, pracuję dalej”.',
            then: '„Rozumiem, pracuję dalej” zamyka okienko, ale przypomnienie wróci przy następnym sprawdzeniu — najpóźniej po godzinie.',
          },
        ],
        expect: [
          'Sprawdzanie działa w wersji zainstalowanej (nie w trybie deweloperskim) i nie wchodzi w drogę trwającemu pobieraniu — w jego czasie godzinowe przypomnienie milczy.',
          'Nie musisz nic włączać: działa od tej wersji samo.',
          'Przycisk „Sprawdź aktualizacje” w Ustawieniach nadal działa jak dotąd, gdy chcesz sprawdzić natychmiast.',
        ],
        note: {
          type: 'warning',
          text: 'Praca na starszej wersji może powodować niewłaściwe działanie aplikacji — błędy konwersji, brak nowych banków i poprawek. Widzisz ostrzeżenie? Zaktualizuj przy pierwszej okazji.',
        },
      },
    ],
  },
  {
    version: '6.5.0',
    date: '2026-09-02',
    title: 'Dwa nowe ekrany: pulpit „Księgowania” i „Kalendarz”',
    tagline:
      'Aplikacja otwiera się teraz na pulpicie: u góry pasek z nazwą miesiąca i jego własną grafiką, pod nim cztery kategorie do klikania (niezaksięgowane, oczekujące na DOM, oznaczone w DOM, błędy), a niżej wspólnoty — każda jako pełnej szerokości wiersz z liczbami po prawej i dużym zielonym przyciskiem „Zaksięguj w DOM”. Drugą nowością jest „Kalendarz” tuż pod pulpitem: cały miesiąc jak na ściennym kalendarzu, a obok panel wybranego dnia. Spotkanie zaczynasz od typu i wspólnoty — tytuł składa się z nich sam — a uczestników dobierasz z kont, które mają dostęp do aplikacji.',
    stats: [
      { value: '2', label: 'nowe ekrany w menu' },
      { value: 'pulpit', label: 'nowy start aplikacji' },
      { value: '1 klik', label: 'zaksięgowanie wspólnoty w DOM' },
      { value: '12', label: 'grafik — po jednej na miesiąc' },
    ],
    highlights: [
      {
        id: 'pulpit-ksiegowania',
        kind: 'new',
        icon: 'home',
        title: 'Pulpit: pierwszy ekran po uruchomieniu',
        summary:
          'Aplikacja startuje na „Pulpicie” — widoku księgowań wybranego miesiąca od strony wspólnot. W menu po lewej jest on na samej górze, nad „Kalendarzem” i „Konwerterem”.',
        details: [
          'Pytanie, z którym siada się do pracy, brzmi „co jeszcze zostało w tym miesiącu”, a nie „jaki plik wrzucić”. Pulpit odpowiada na nie od razu po włączeniu: bez klikania, bez szukania w historii.',
          'Ten sam widok jest dodatkowo zakładką w „Konwerterze” (obok „Konwersja” i „Historia”), żeby po skonwertowaniu plików nie trzeba było wracać do menu. To jeden i ten sam ekran — wybrany miesiąc i kategoria są wspólne, więc przechodząc między nimi wracasz do tego samego miejsca.',
          'Księgowaniem jest wygenerowany plik księgowy — to jedyna miara, jaką aplikacja przyjmuje. Konwersja zakończona błędem nic nie wygenerowała, więc nie liczy się jako zrobiona i jest pokazywana osobno.',
        ],
        where: ['Menu boczne', 'Pulpit'],
        steps: [
          {
            do: 'Uruchom aplikację.',
            then: 'Otworzy się „Pulpit” z bieżącym miesiącem: pasek miesiąca, kafelki kategorii, pasek postępu i lista wspólnot.',
          },
          {
            do: 'Chcesz wrócić tu z innego widoku? Kliknij „Pulpit” na samej górze menu po lewej.',
            then: 'Wracasz do tego samego miesiąca i tej samej kategorii, na której skończyłaś.',
          },
        ],
        expect: [
          'Lista pokazuje wszystkie wspólnoty z widoku „Adresy” — także te, dla których w tym miesiącu nie było jeszcze żadnej konwersji, bo to one są „do zrobienia”.',
          'Konwersje sprzed tej wersji też trafiają do właściwej wspólnoty: nazwa wygenerowanego pliku zaczyna się od nazwy wspólnoty i po niej są rozpoznawane. Czego nie da się przypisać, ląduje w wierszu „Bez przypisanej wspólnoty” i nie znika.',
        ],
      },
      {
        id: 'pasek-miesiaca',
        kind: 'new',
        icon: 'calendar',
        title: 'Pasek miesiąca — z nazwą miesiąca i jego własną grafiką',
        summary:
          'U góry pulpitu jest nazwa miesiąca dużą czcionką, obok niej rysunek pory roku (inny dla każdego z dwunastu miesięcy), a w jednej linii obok: strzałki, wybór miesiąca z listy, „Dziś” i odświeżanie.',
        details: [
          'Cały widok dotyczy jednego miesiąca, więc miesiąc jest tytułem tego ekranu — nie napisem „Księgowania” w kącie. Grafika i delikatny kolor tła zmieniają się razem z nim, więc od razu wiadomo, że przełączenie się udało: styczeń to bałwan, marzec krokusy w śniegu, lipiec parasol na plaży, październik dynia, grudzień choinka.',
          'Pod paskiem miesiąca jest pasek postępu „Zaksięgowane w DOM” — procent plików tego miesiąca, które są już oznaczone.',
        ],
        where: ['Pulpit', 'pasek miesiąca'],
        steps: [
          {
            do: 'Kliknij strzałkę ‹ po lewej stronie nazwy miesiąca.',
            then: 'Cały pulpit — grafika, kafelki, pasek postępu i lista — przeskakuje na poprzedni miesiąc.',
          },
          {
            do: 'Chcesz skoczyć dalej? Rozwiń nazwę miesiąca i wybierz go z listy.',
            then: 'Lista podpowiada miesiące, w których cokolwiek się działo, oraz bieżący.',
          },
          {
            do: 'Kliknij „Dziś”, żeby wrócić do bieżącego miesiąca. Przycisk z kółeczkiem obok odświeża dane.',
            then: 'Odświeżenie nie czyści ekranu — dane po prostu się aktualizują, np. gdy ktoś z zespołu oznaczał pliki w tym samym czasie.',
          },
        ],
        expect: [
          'Wiersz z nazwą miesiąca zawiera też podsumowanie: ile wspólnot, ile plików księgowych i ile czeka na DOM.',
        ],
      },
      {
        id: 'kategorie-ksiegowan',
        kind: 'new',
        icon: 'bar-chart',
        title: 'Cztery kategorie, w których liczą się wspólnoty',
        summary:
          'Kafelki pod paskiem miesiąca to filtry: „Wszystkie”, „Niezaksięgowane”, „Oczekujące na DOM”, „Oznaczone w DOM”, „Błędy”. Każdy liczy wspólnoty — nie pliki — więc liczba na kafelku to dokładnie tyle wierszy, ile zobaczysz po kliknięciu.',
        details: [
          '„Niezaksięgowane” to wspólnoty, dla których w tym miesiącu nie powstał żaden plik księgowy. „Oczekujące na DOM” to te, które plik mają, ale nie jest jeszcze (w całości) oznaczony. „Oznaczone w DOM” to zamknięte tematy. „Błędy” to wspólnoty, przy których konwersja się nie udała, więc pliku nie ma wcale.',
          'Liczby dotyczące plików — ile ich powstało i ile jest oznaczonych — są w pasku miesiąca i na pasku postępu. Jedna jednostka na kafelkach, druga w pasku: dzięki temu żadna liczba nie znaczy dwóch rzeczy naraz.',
        ],
        where: ['Pulpit', 'kafelki kategorii'],
        steps: [
          {
            do: 'Kliknij kafelek „Oczekujące na DOM”.',
            then: 'Na liście zostają tylko wspólnoty z plikiem bez oznaczenia; kafelek zostaje podświetlony, żeby było jasne, że widzisz wycinek.',
          },
          {
            do: 'Zawężaj dalej polem wyszukiwania pod kafelkami — po nazwie wspólnoty, nazwie pliku, banku.',
            then: 'Wyszukiwanie działa razem z kategorią, a wiersze pasujące do frazy rozwijają się same.',
          },
          {
            do: 'Kolejność zmienisz listą po prawej: „Do zrobienia najpierw”, „Alfabetycznie”, „Ostatnia aktywność”.',
            then: 'Domyślnie na górze są błędy, potem wspólnoty czekające na DOM, dalej te bez pliku, a na końcu zamknięte.',
          },
          {
            do: 'Oznaczaj spokojnie kolejne wspólnoty — lista nie przestawia się pod kursorem.',
            then: 'Wiersz, który oznaczyłaś, zostaje dokładnie tam, gdzie był: robi się zielony i zmienia status na „W DOM”, ale nie ucieka na koniec listy ani nie znika, nawet gdy przestał pasować do wybranego kafelka. Gdy kolejność przestanie się zgadzać z wybranym sortowaniem, obok listy sortowania pojawia się przycisk „Przesortuj”.',
          },
          {
            do: 'Skończyłaś partię i chcesz poukładać listę na nowo? Kliknij „Przesortuj” (albo kółeczko odświeżania w pasku miesiąca).',
            then: 'Lista układa się od nowa według wybranego sortowania i kafelka — oznaczone wspólnoty schodzą na dół albo wypadają z filtra.',
          },
          {
            do: 'Wróć do pełnej listy kafelkiem „Wszystkie”.',
            then: 'Znów widzisz wszystkie wspólnoty tego miesiąca.',
          },
        ],
        expect: [
          'Kafelki liczą wybrany miesiąc, nie całą historię — po przełączeniu miesiąca liczby zmieniają się razem z listą.',
          'Kolejność układa się na nowo także wtedy, gdy zmienisz kafelek, sortowanie, frazę w wyszukiwaniu albo miesiąc — czyli zawsze, gdy sama o to poprosisz.',
        ],
      },
      {
        id: 'wiersz-wspolnoty',
        kind: 'new',
        icon: 'map-pin',
        title: 'Wspólnota to jeden wiersz na całą szerokość',
        summary:
          'Nazwa i status po lewej, liczby (pliki / w DOM / czeka / błędy) po prawej, obok nich mały pasek postępu, a na końcu duży zielony przycisk „Zaksięguj w DOM”. Kolorowa krawędź z lewej mówi, w jakim stanie jest wspólnota.',
        details: [
          'Wiersz jest szeroki i jednoznaczny: te same informacje w tych samych miejscach w każdej wspólnocie, więc listę da się przelecieć wzrokiem, a nie czytać po kolei.',
          'Pod nazwą jest linia z bankiem i datą ostatniej konwersji. Jeśli w tym miesiącu nie było żadnej, pisze, kiedy było ostatnie księgowanie tej wspólnoty — albo że nie było go nigdy.',
        ],
        where: ['Pulpit', 'lista wspólnot'],
        steps: [
          {
            do: 'Kliknij duży zielony przycisk „Zaksięguj w DOM” po prawej stronie wiersza.',
            then: 'Wszystkie nieoznaczone pliki tej wspólnoty z tego miesiąca dostają znacznik naraz — liczba na przycisku mówi z góry, ilu plików to dotyczy. Wiersz robi się zielony i zmienia status na „W DOM”.',
          },
          {
            do: 'Gdy wszystko jest już oznaczone, na miejscu przycisku jest napis „Zaksięgowane w DOM” i mały link „Zdejmij”.',
            then: 'Link zdejmuje oznaczenia z całej wspólnoty, razem z datą i podpisem osoby, która je postawiła.',
          },
          {
            do: 'Kliknij w wiersz (albo w strzałkę po lewej), żeby zobaczyć pliki.',
            then: 'Wiersz rozwija się w listę: kolumny „Data”, „Plik wejściowy → plik księgowy”, „Akcje” i — po prawej stronie każdej linii — „W DOM” z własnym przyciskiem „Zaksięguj w DOM” dla tego jednego pliku.',
          },
        ],
        expect: [
          'Wspólnota bez pliku księgowego nie ma przycisku — nie ma czego księgować, dopóki plik nie powstanie.',
          'Znaczniki zapisują się we wspólnej bazie, razem z datą i adresem e-mail osoby, która je postawiła, więc cały zespół widzi to samo.',
        ],
      },
      {
        id: 'pliki-w-wierszu',
        kind: 'new',
        icon: 'file-check',
        title: 'W rozwiniętym wierszu: z jakiego wyciągu powstał który plik',
        summary:
          'Każdy plik to jedna linia: data, para „plik wejściowy → plik księgowy” do otwarcia jednym kliknięciem, „Podgląd” i skrót do historii, a na samym końcu linii własny przycisk „Zaksięguj w DOM” — dla tego jednego pliku.',
        details: [
          'To ta sama konwersja, którą widzisz w zakładce „Historia” — tylko pokazana od strony wyniku. Strzałka między kafelkami mówi wprost, który wyciąg dał który plik księgowy.',
        ],
        where: ['Pulpit', 'wspólnota', 'lista plików'],
        steps: [
          {
            do: 'Kliknij lewy kafelek z nazwą wyciągu.',
            then: 'Otworzy się plik wejściowy, z którego powstało księgowanie.',
          },
          {
            do: 'Kliknij prawy kafelek z nazwą pliku księgowego.',
            then: 'Otworzy się wygenerowany plik księgowy — ten sam, który wgrywasz do DOM.',
          },
          {
            do: 'Oznaczasz pojedynczy plik? Kliknij zielony przycisk „Zaksięguj w DOM” na końcu tej linii.',
            then: 'Ten sam przycisk co dla całej wspólnoty, tylko dla jednego pliku: linia od razu robi się zielona, w miejscu przycisku pojawia się napis „W DOM” z linkiem „Zdejmij”, a w linii — data oznaczenia i kto je postawił. Reszta plików wspólnoty zostaje nietknięta.',
          },
          {
            do: 'Pomyłka? Kliknij „Zdejmij” pod napisem „W DOM” w tej samej linii.',
            then: 'Oznaczenie schodzi tylko z tego pliku, razem z datą i podpisem; wraca przycisk „Zaksięguj w DOM”.',
          },
          {
            do: 'Chcesz zobaczyć tę konwersję w kontekście dnia i banku? Kliknij ikonę zegara („Pokaż w historii”).',
            then: 'Aplikacja przechodzi do „Konwerter → Historia” i wpisuje nazwę tego pliku w wyszukiwanie, więc wpis jest od razu rozwinięty.',
          },
        ],
        expect: [
          'Pliki otwierają się z dysku komputera, na którym powstały. Jeśli konwersję zrobił ktoś inny na swoim komputerze, zobaczysz „Plik nie istnieje lub został usunięty” — sam wpis i znacznik DOM pozostają widoczne dla wszystkich.',
          'Nieudana konwersja nie ma przycisku — na jego miejscu jest czerwona plakietka „Błąd”, a w linii treść błędu zamiast pliku księgowego.',
        ],
        note: {
          type: 'tip',
          text: 'Znaczniki DOM wchodzą do kopii zapasowej i do eksportu historii do pliku, więc przenoszą się na inny komputer razem z resztą danych.',
        },
      },
      {
        id: 'historia-zapamietuje-wspolnote',
        kind: 'improved',
        icon: 'clipboard',
        title: 'Historia konwersji zapamiętuje wspólnotę',
        summary:
          'Każda konwersja zapisuje teraz w historii, dla której wspólnoty była zrobiona — także ta zatwierdzona na ekranie akceptacji i ta, która skończyła się błędem.',
        details: [
          'Dotąd historia pamiętała plik, bank i konwerter, ale nie adres — wspólnotę dało się odczytać tylko z nazwy wygenerowanego pliku. Teraz adres jest zapisany wprost, razem z nazwą wspólnoty, więc pulpit grupuje wpisy pewnie, a nie po nazwie pliku.',
          'Nazwa jest zapisywana obok numeru celowo: po odtworzeniu kopii zapasowej wspólnoty dostają nowe numery, a nazwa zostaje ta sama — i po niej wpisy wracają na swoje miejsce.',
        ],
        where: ['Pulpit'],
        expect: [
          'Konwersje z błędem także dostają adres, więc widać, przy której wspólnocie trzeba wrócić do pliku.',
          'Starsze wpisy nie znikają: gdy adresu nie ma, jest odczytywany z nazwy wygenerowanego pliku, a gdy i to nie wychodzi — wpis trafia do wiersza „Bez przypisanej wspólnoty”.',
        ],
      },
      {
        id: 'kalendarz-modul',
        kind: 'new',
        icon: 'calendar',
        title: 'Kalendarz: miesiąc po lewej, wybrany dzień po prawej',
        summary:
          'W menu po lewej, zaraz pod „Pulpitem”, jest nowa pozycja „Kalendarz”. Otwiera siatkę miesiąca — tydzień od poniedziałku — a obok niej panel, który pokazuje wszystkie szczegóły dnia, na który klikniesz.',
        details: [
          'Kalendarz zajmuje całą wysokość okna — tygodnie dzielą ją między siebie, więc pod miesiącem nie ma pustego miejsca. Gdy tygodnie są naprawdę zajęte, siatka przewija się zamiast ściskać kratki.',
          'W kratce dnia mieszczą się najwyżej trzy spotkania, bo więcej przestaje być czytelne — resztę zwija w „+2 więcej”, a kliknięcie tego napisu pokazuje cały dzień w panelu obok.',
          'W kratce każde spotkanie zostaje jedną linią, więc dłuższa nazwa jest przycięta wielokropkiem — całą przeczytasz najechaniem na nią myszką, bez klikania i bez rozpychania kalendarza.',
          'Do wyboru są dwie podpowiedzi. Domyślnie działa zwykła systemowa: pokazuje godzinę i pełną nazwę, ale trzeba na nią chwilę poczekać. W „Ustawieniach” (sekcja „Wygląd”) możesz włączyć „Podpowiedź spotkania w kalendarzu” — wtedy pojawia się natychmiast i jest w niej więcej: godzina, cała nazwa, typ, wspólnota, lista uczestników i początek notatki.',
          'Miesiąc przełączasz strzałkami przy jego nazwie, tak samo jak na „Pulpicie”. Wybrany miesiąc zostaje zapamiętany — jeśli przejdziesz do innego modułu i wrócisz, wracasz do tego samego miesiąca.',
          'Na dole panelu jest lista „Najbliższe spotkania”, licząc od teraz — także z innych miesięcy. Kliknięcie pozycji z tej listy przenosi kalendarz na jej miesiąc i dzień.',
        ],
        where: ['Menu boczne', 'Kalendarz', 'Kalendarz'],
        steps: [
          {
            do: 'Kliknij „Kalendarz” w menu po lewej.',
            then: 'Otworzy się bieżący miesiąc. Dzisiejszy dzień ma numer w kolorowym kółku, a wybrany dzień jest obramowany.',
          },
          {
            do: 'Kliknij dowolny dzień w siatce.',
            then: 'Panel po prawej zmienia nagłówek na ten dzień i pokazuje jego spotkania — albo informację, że tego dnia nic nie ma.',
          },
          {
            do: 'Kliknij konkretne spotkanie w kratce dnia.',
            then: 'Panel po prawej podświetla to spotkanie ramką, więc od razu widać, o które z kilku chodzi.',
          },
          {
            do: 'Kliknij to samo spotkanie dwukrotnie.',
            then: 'Otwiera się formularz edycji tego spotkania — bez szukania przycisku „Edytuj” w panelu obok.',
          },
          {
            do: 'Kliknij dwukrotnie puste miejsce w dowolnym dniu.',
            then: 'Otwiera się formularz nowego spotkania z datą już ustawioną na ten dzień.',
          },
          {
            do: 'Chcesz zawęzić widok? Wpisz frazę w pole wyszukiwania nad kalendarzem.',
            then: 'Zostają tylko spotkania pasujące nazwą, wspólnotą, notatką, typem lub adresem e-mail uczestnika — w siatce i w panelu jednocześnie.',
          },
        ],
        expect: [
          'Kalendarz jest wspólny dla całego zespołu: spotkanie dodane na jednym komputerze widzą wszyscy zalogowani. Przy każdym spotkaniu widać, kto je dodał.',
          'Natychmiastowa podpowiedź po najechaniu na spotkanie jest domyślnie wyłączona — włącza się ją w „Ustawieniach” → „Wygląd” → „Podpowiedź spotkania w kalendarzu”. Ustawienie jest lokalne, każdy na swoim komputerze decyduje sam.',
          'Przycisk z kółeczkiem przy nazwie miesiąca odświeża dane bez czyszczenia ekranu — przydaje się, gdy ktoś dopisywał spotkania w tym samym czasie.',
        ],
      },
      {
        id: 'kalendarz-nowe-spotkanie',
        kind: 'new',
        icon: 'clock',
        title: 'Nowe spotkanie: najpierw typ i adres, tytuł pisze się sam',
        summary:
          'Najszybciej: kliknij dwukrotnie dzień w kalendarzu. Można też przyciskiem „Nowe spotkanie” nad kalendarzem albo znakiem „+”, który pojawia się w kratce dnia po najechaniu na nią myszką. Formularz zaczyna od dwóch pól: typu spotkania i adresu wspólnoty. Z nich sam składa tytuł — „Zebranie wspólnoty — ul. Puławska 116” — który możesz nadpisać.',
        details: [
          'Typ i adres to jedyne dwie rzeczy, o których naprawdę decydujesz, a nazwa spotkania to prawie zawsze ich powtórzenie. Dlatego są pierwsze, a tytuł powstaje z nich: zmieniasz typ albo adres i tytuł zmienia się razem z nimi. W momencie, w którym zaczniesz pisać w polu tytułu, przestaje się aktualizować — pod polem widać, że jest już wpisany ręcznie, a obok napisu „Nazwa spotkania” pojawia się „Odtwórz z typu i adresu”, gdy chcesz wrócić do podpowiedzi.',
          'Gdy wypełnisz tylko jedno z dwóch pól, tytułem zostaje to jedno — sam myślnik bez drugiej połowy byłby gorszy niż krótka nazwa. Oba pola są opcjonalne: spotkanie wewnętrzne nie musi mieć wspólnoty.',
          'Godzina „do” jest opcjonalna — spotkanie bez podanego końca to po prostu punkt w dniu. Przy nowym spotkaniu podpowiada się godzina o jedną godzinę późniejsza niż początek, a gdy przesuniesz początek za koniec, koniec przesuwa się sam.',
          'Wspólnotę wybierasz z tej samej listy adresów, z której korzysta konwerter — pole ma wyszukiwanie, więc wystarczy wpisać dwie litery nazwy. Nazwa wspólnoty zapisuje się razem ze spotkaniem, nie tylko odnośnik do niej, więc spotkanie pozostaje czytelne nawet po odtworzeniu kopii zapasowej albo po usunięciu adresu z listy.',
        ],
        where: ['Kalendarz', 'Nowe spotkanie'],
        steps: [
          {
            do: 'Kliknij dwukrotnie dzień, w którym ma być spotkanie. (Można też najechać na kratkę i kliknąć „+” w jej prawym górnym rogu.)',
            then: 'Otworzy się formularz z datą już ustawioną na ten dzień.',
          },
          {
            do: 'Wybierz „Typ spotkania” z pierwszej listy.',
            then: 'W polu „Nazwa spotkania” od razu pojawia się nazwa typu. Jeśli nie masz jeszcze żadnego typu, formularz podpowie zakładkę „Typy spotkań”.',
          },
          {
            do: 'Obok wybierz wspólnotę w polu „Adres / wspólnota” — wpisz dwie litery nazwy, żeby ją znaleźć.',
            then: 'Tytuł uzupełnia się do pełnej postaci: „typ — adres”.',
          },
          {
            do: 'Tytuł Ci nie pasuje? Kliknij w pole i popraw je.',
            then: 'Od tej chwili tytuł jest Twój — zmiana typu albo adresu go nie nadpisze. Wrócisz do podpowiedzi linkiem „Odtwórz z typu i adresu”.',
          },
          {
            do: 'Ustaw godzinę „od”, a jeśli chcesz — także „do”. Godzinę „do” możesz zostawić puste.',
          },
          {
            do: 'Na koniec kliknij „Dodaj”.',
            then: 'Kalendarz przeskakuje na dzień tego spotkania i podświetla je w panelu — od razu widać, że się zapisało.',
          },
        ],
        expect: [
          'Spotkanie zmienisz dwuklikiem na nim w kalendarzu albo przyciskiem „Edytuj” pod nim w panelu po prawej. Usuwa się je przyciskiem „Usuń” obok — z potwierdzeniem, bo nie da się tego cofnąć.',
          'Przy edycji tytuł zachowuje się rozsądnie: jeśli był złożony z typu i adresu, dalej za nimi chodzi; jeśli ktoś wpisał go ręcznie, zostaje nietknięty.',
          'Jeśli przy edycji przeniesiesz spotkanie na inny miesiąc, kalendarz sam przełączy się na ten miesiąc po zapisaniu.',
        ],
        note: {
          type: 'tip',
          text: 'Pole „Opis / notatki” to dobre miejsce na miejsce spotkania, agendę albo listę rzeczy do przygotowania — jest pokazywane w całości w panelu dnia.',
        },
      },
      {
        id: 'kalendarz-typy',
        kind: 'new',
        icon: 'clipboard',
        title: 'Typy spotkań definiujesz sam — razem z kolorem',
        summary:
          'Druga zakładka modułu, „Typy spotkań”, to Twój własny słownik: sam decydujesz, jakie rodzaje spotkań prowadzi biuro. Każdy typ ma nazwę, kolor i opcjonalny opis.',
        details: [
          'Kolor jest częścią typu, nie pojedynczego spotkania — dzięki temu w siatce miesiąca od razu widać, czego dotyczy dany dzień, bez czytania nazw. Do wyboru jest dziesięć kolorów, które są czytelne w jasnym i ciemnym motywie, a obok nich pole na własny kolor.',
          'Kolorowe przyciski nad kalendarzem to filtry typów: kliknięcie zostawia tylko spotkania tego typu, kolejne kliknięcie zdejmuje filtr.',
          'Kolumna „Spotkania” w tabeli typów pokazuje, ile spotkań korzysta z danego typu — zanim go usuniesz, wiesz, ilu spotkań to dotknie.',
        ],
        where: ['Kalendarz', 'Typy spotkań'],
        steps: [
          {
            do: 'W module „Kalendarz” kliknij zakładkę „Typy spotkań” u góry.',
            then: 'Zobaczysz tabelę typów — na początku pustą.',
          },
          {
            do: 'Kliknij „Dodaj typ” i wpisz nazwę, np. „Zebranie wspólnoty”.',
          },
          {
            do: 'Wybierz kolor, klikając jeden z kwadracików.',
            then: 'Pod spodem widzisz podgląd: dokładnie tak ten typ będzie wyglądał w kalendarzu.',
          },
          {
            do: 'Kliknij „Dodaj”, a potem wróć na zakładkę „Kalendarz”.',
            then: 'Nowy typ jest już na liście w formularzu spotkania i jako kolorowy filtr nad kalendarzem.',
          },
        ],
        expect: [
          'Usunięcie typu nie usuwa spotkań — zostają, tylko bez typu (w kalendarzu jako „Bez typu”). Aplikacja ostrzega o tym i podaje liczbę takich spotkań.',
          'Dwa typy o tej samej nazwie nie przejdą — byłyby nie do rozróżnienia na listach.',
        ],
      },
      {
        id: 'kalendarz-uczestnicy',
        kind: 'new',
        icon: 'users',
        title: 'Uczestnicy z kont, które mają dostęp do aplikacji',
        summary:
          'W formularzu spotkania jest pole „Uczestnicy”. Lista do wyboru to konta założone dla Waszego zespołu — te same, którymi logujecie się do aplikacji. Nie trzeba przepisywać adresów e-mail, a całe biuro dodasz jednym kliknięciem.',
        details: [
          'Przy napisie „Uczestnicy” są dwa skróty: „Dodaj wszystkich” wstawia wszystkie konta naraz (w nawiasie widać ile), a „Wyczyść” zdejmuje całą listę. Zebranie zarządu jest zwykle dla całego biura, więc nie ma sensu wybierać piętnastu osób po jednej.',
          'Pole ma wyszukiwanie, więc wystarczy wpisać kilka liter imienia albo adresu. Każde kliknięcie dopisuje kolejną osobę pod polem, a krzyżyk przy nazwisku ją zdejmuje. Twoje własne konto jest oznaczone dopiskiem „(Ty)”.',
          'Uczestnicy zapisują się razem ze spotkaniem — także ich adres e-mail i nazwa. Dzięki temu lista obecności starego spotkania pozostaje czytelna, nawet jeśli ktoś w międzyczasie przestanie mieć konto.',
          'Uczestnika znajdziesz też wyszukiwaniem nad kalendarzem: wpisany adres e-mail zostawia w widoku tylko spotkania, w których ta osoba bierze udział.',
        ],
        where: ['Kalendarz', 'Nowe spotkanie', 'Uczestnicy'],
        steps: [
          {
            do: 'W formularzu spotkania kliknij pole „Dodaj uczestnika…”.',
            then: 'Rozwinie się lista kont z polem wyszukiwania na górze.',
          },
          {
            do: 'Wpisz kilka liter, żeby zawęzić listę, i kliknij osobę.',
            then: 'Osoba pojawia się jako plakietka pod polem; lista do wyboru przestaje ją proponować.',
          },
          {
            do: 'Pomyłkę zdejmiesz krzyżykiem na plakietce.',
          },
          {
            do: 'Spotkanie jest dla wszystkich? Kliknij „Dodaj wszystkich” przy napisie „Uczestnicy”.',
            then: 'Wszystkie konta pojawiają się jako plakietki; „Wyczyść” obok zdejmuje je z powrotem.',
          },
        ],
        expect: [
          'Lista uczestników pokazuje się przy spotkaniu w panelu dnia — po nazwie, a gdy konto jej nie ma, po adresie e-mail.',
          'Jeśli lista kont jest pusta, formularz to napisze. Nowe konta zakłada administrator w panelu Supabase — aplikacja ich nie tworzy.',
        ],
        note: {
          type: 'warning',
          text: 'Dodanie uczestnika nie wysyła powiadomienia ani zaproszenia — to zapis w kalendarzu, nie e-mail. Do wysyłki wiadomości służy moduł „Mailing”.',
        },
      },
      {
        id: 'kalendarz-w-kopii',
        kind: 'improved',
        icon: 'shield',
        title: 'Spotkania i typy spotkań wchodzą do kopii zapasowej',
        summary:
          'Kalendarz jest objęty tym samym backupem co reszta danych: codzienna kopia i ręczny eksport zapisują spotkania i typy spotkań, a odtworzenie kopii je przywraca.',
        details: [
          'W podsumowaniu kopii — tym, które pokazuje się po utworzeniu backupu i przed odtworzeniem — są teraz dwie nowe pozycje: „typy spotkań” i „spotkania”.',
          'Oznaczenia „w DOM” z pulpitu też jadą w kopii: razem z każdym wpisem historii zapisuje się, czy jest zaksięgowany, kiedy został oznaczony i przez kogo.',
          'Po odtworzeniu kopii spotkania trafiają z powrotem do właściwych wspólnot: powiązanie odtwarza się po nazwie wspólnoty, bo numery adresów po odtworzeniu są inne. Tak samo działa to już w „Księgowaniach”.',
        ],
        where: ['Ustawienia', 'Kopia zapasowa'],
        expect: [
          'Kopie zapasowe zrobione starszymi wersjami dalej działają — po prostu nie zawierają spotkań, a ich odtworzenie nie rusza tych, które są w bazie.',
        ],
      },
    ],
  },
  {
    version: '6.3.0',
    date: '2026-09-01',
    title: 'Jeden płatnik, kilka lokali — reguła pyta, na który zaksięgować',
    tagline:
      'Właściciel dwóch lokali płaci za oba z jednego konta, tym samym opisem. Reguła lokalu mogła dotąd wskazać tylko jeden lokal, więc drugą wpłatę trzeba było poprawiać ręcznie przy każdym wyciągu. Teraz w regule wpisujesz wszystkie lokale takiego płatnika, a na ekranie akceptacji wybierasz jednym kliknięciem, o który lokal chodzi w danej wpłacie. Drugi duży wątek tego wydania to Mailing: pola dynamiczne są w treści pigułkami nie do rozjechania, opis i wartość można rozdzielić na dwie kolumny tabeli, a samo pole ma teraz jednostkę („zł/m²”) i typ — tekst, data albo godzina.',
    stats: [
      { value: 'kilka', label: 'lokali w jednej regule' },
      { value: '1 klik', label: 'wybór lokalu w akceptacji' },
      { value: '0', label: 'wpłat na zgadnięty lokal' },
      { value: '3 typy', label: 'wartości pola w mailingu' },
    ],
    highlights: [
      {
        id: 'kilka-lokali-w-regule',
        kind: 'new',
        icon: 'building',
        title: 'Reguła lokalu może wskazywać więcej niż jeden lokal',
        summary:
          'W formularzu reguły zamiast jednego pola „Numer lokalu” jest lista lokali: przyciskiem „Dodaj kolejny lokal” dopisujesz drugi, trzeci i każdy następny, a przy każdym z nich możesz podać własne konto lokalu.',
        details: [
          'Reguła lokalu rozpoznaje płatnika po frazie z opisu przelewu — najczęściej po nazwisku. Jeśli ten sam właściciel ma w tej wspólnocie dwa lokale i płaci za oba tak samo, fraza mówi kto zapłacił, ale nie za co. Dotąd reguła musiała wybrać jeden lokal, więc wpłaty za drugi lądowały na koncie pierwszego albo trzeba je było co miesiąc przypisywać ręcznie.',
          'Kolejność lokali w regule jest tą samą kolejnością, w jakiej zobaczysz je do wyboru na ekranie akceptacji — warto ustawić najczęstszy lokal jako pierwszy.',
          'Lokal z literą (np. 17A) nadal wymaga podania konta — aplikacja nie zgaduje, jak Twoja wspólnota numeruje takie lokale. Reguła bez konta dla takiego lokalu nie zapisze się i powie dlaczego.',
        ],
        where: ['Menu boczne', 'Adresy', 'Reguły lokali'],
        steps: [
          {
            do: 'Wejdź w „Adresy” i przy wybranej wspólnocie kliknij „Reguły lokali”.',
            then: 'Otworzy się lista reguł. Kolumna „Lokale” pokazuje teraz wszystkie lokale danej reguły — jeden pod drugim, a obok, w tej samej linii, konto każdego z nich.',
          },
          {
            do: 'Kliknij „Dodaj regułę” (albo „Edytuj” przy istniejącej) i wpisz frazę, np. nazwisko płatnika.',
            then: 'Pod frazą jest sekcja „Lokale” z jednym wierszem: numer lokalu i konto lokalu.',
          },
          {
            do: 'Kliknij „Dodaj kolejny lokal” i wpisz drugi numer. Powtórz dla każdego lokalu tego płatnika.',
            then: 'Każdy wiersz ma własne pole konta i własny kosz do usunięcia. Konto zostaw puste, jeśli ma być domyślne (prefiks + numer dopełniony zerami, np. 204-000031).',
          },
          {
            do: 'Zapisz regułę przyciskiem „Zapisz”.',
            then: 'Aplikacja sprawdzi, czy ten sam lokal nie został wpisany dwa razy i czy każdy lokal z literą ma podane konto.',
          },
        ],
        expect: [
          'Reguła z jednym lokalem działa dokładnie jak dotąd — wpłata dostaje numer lokalu i pojawia się do akceptacji z gotowym „Akceptuj”.',
          'Reguła z kilkoma lokalami niczego nie księguje sama: wpłata czeka na Twój wybór na ekranie akceptacji.',
          'Wszystkie lokale reguły wchodzą do kopii zapasowej i do eksportu adresów do pliku TXT, więc przenoszą się razem z resztą konfiguracji. Plik z regułą jednolokalową otwiera się bez zmian także w starszej wersji aplikacji.',
        ],
      },
      {
        id: 'wybor-lokalu-w-akceptacji',
        kind: 'new',
        icon: 'map-pin',
        title: 'Na ekranie akceptacji wybierasz lokal z listy z reguły',
        summary:
          'Wpłata dopasowana regułą z kilkoma lokalami pokazuje niebieską ramkę „WYBIERZ LOKAL” z kafelkiem na każdy lokal z reguły. Na kafelku widzisz numer lokalu i konto, na które pójdzie kwota — jedno kliknięcie i wpłata jest przypisana.',
        details: [
          'Aplikacja nie proponuje tu żadnego lokalu „na start” i nie podpowiada domyślnego. Gdyby zgadywała, najczęściej trafiałaby dobrze — a kilka razy w roku zaksięgowałaby czynsz na konto drugiego lokalu tego samego właściciela, w sposób niewidoczny w pliku księgowym. Dlatego wybór należy do Ciebie.',
          'Do wyboru dostajesz dokładnie te lokale, które ma reguła — nic więcej. Jeśli wpłata jest jednak za coś innego, pola „Numer mieszkania”, „Konto lokalu” i „Pozostałe przychody” pod ramką działają jak zwykle; użycie któregokolwiek z nich anuluje wybór z reguły.',
          'Kafelek lokalu z literą, dla którego reguła nie podaje konta, jest nieaktywny — nie ma na co księgować. Ramka mówi wtedy, żeby dopisać konto w regule („Edytuj powiązanie”) albo wpisać je ręcznie w polu „Konto lokalu”.',
        ],
        where: ['Menu boczne', 'Konwerter', 'Akceptacja'],
        steps: [
          {
            do: 'Przekonwertuj wyciąg jak zawsze i wejdź na ekran akceptacji.',
            then: 'Wpłata od płatnika z regułą wielolokalową ma w miejscu ramki z numerem lokalu niebieską ramkę „WYBIERZ LOKAL”, a pod nią kafelki: duży numer lokalu i pod nim konto, np. „31” i „204-000031”.',
          },
          {
            do: 'Kliknij kafelek właściwego lokalu.',
            then: 'Ramka zmienia się na fioletową „Lokal wybrany z reguły”, wybrany kafelek jest obramowany, a na dole widzisz „W pliku księgowym: 204-000031”. Karta transakcji robi się fioletowa jak przy każdym ręcznym przypisaniu.',
          },
          {
            do: 'Pomyliłeś się? Kliknij inny kafelek albo „Wyczyść wybór lokalu”.',
            then: 'Wpłata wraca do stanu „czeka na wybór”. Przyciski „Oznacz jako nierozpoznane” i „Do wyjaśnienia” są nieaktywne, dopóki wybór jest aktywny — najpierw go wyczyść.',
          },
          {
            do: 'Chcesz dopisać do reguły kolejny lokal bez wychodzenia z akceptacji? Kliknij „Edytuj powiązanie”.',
            then: 'Formularz reguły ma tę samą listę lokali z przyciskiem „Dodaj kolejny lokal”. Po zapisaniu ramka od razu pokazuje nowy zestaw lokali do wyboru.',
          },
          {
            do: 'Dokończ akceptację i wygeneruj plik księgowy jak zwykle.',
          },
        ],
        expect: [
          'Wpłata, przy której nikt nie wybrał lokalu, trafia do sekcji „NIEROZPOZNANE” pliku księgowego — nigdy na jeden z lokali reguły „w ciemno”.',
          'W pliku księgowym wybrany lokal ląduje na koncie widocznym na kafelku: z reguły, jeśli reguła je podaje, albo domyślnym (prefiks + numer dopełniony zerami).',
          'Wybór dotyczy tylko tej jednej wpłaty. Kolejny przelew od tego samego płatnika znów zapyta, bo znów może być za którykolwiek z jego lokali.',
        ],
      },
      {
        id: 'reguly-dzialaja-od-razu',
        kind: 'improved',
        icon: 'refresh',
        title: 'Zmiana w regule działa od najbliższej konwersji',
        summary:
          'Wpłaty rozpoznane przez regułę nie są już zapamiętywane w pamięci podręcznej. Poprawiony numer lokalu, dopisane konto albo dodany drugi lokal działają od razu na następnym wyciągu — nie trzeba czekać, aż wpis się przedawni.',
        details: [
          'Pamięć podręczna jest sprawdzana przed regułami, więc raz zapamiętana odpowiedź przesłaniała późniejszą zmianę reguły dla tego samego płatnika. Przy jednym lokalu dawało to zaskakujące „poprawiłem regułę, a nic się nie zmieniło”; przy kilku lokalach wpłata w ogóle nie zapytałaby o wybór.',
          'Nic nie trzeba czyścić ani ustawiać — dopasowanie reguły to zwykłe szukanie frazy w tekście, więc liczenie go za każdym razem nic nie kosztuje. Pamięć podręczna dalej oszczędza wywołania AI dla pozostałych wpłat.',
        ],
        expect: [
          'Po zmianie reguły wystarczy przekonwertować wyciąg ponownie — nowa wersja reguły zadziała natychmiast.',
        ],
      },
      {
        id: 'pola-dynamiczne-jako-pigulki',
        kind: 'improved',
        icon: 'mail',
        title: 'Pola dynamiczne w mailingu są pigułkami, nie tekstem w nawiasach',
        summary:
          'W tytule i treści wiadomości pole dynamiczne wygląda jak kolorowa pigułka z nazwą pola, a nie jak {{Nazwa pola}}. Pigułki nie da się przypadkiem rozjechać — Backspace usuwa całe pole, nigdy pół nawiasu.',
        details: [
          'Nawiasy klamrowe łatwo było uszkodzić: skasowana jedna klamra albo literówka w nazwie i pole cicho przestawało się podstawiać — w wysłanym mailu zostawało „{{Zaliczka}}” zamiast kwoty. Pigułka jest jednym elementem: albo jest cała, albo jej nie ma.',
          'Pole, którego nie ma w słowniku „Pola dynamiczne”, jest czerwoną pigułką od razu w treści — nie trzeba wypatrywać ostrzeżenia pod formularzem.',
          'Zapis się nie zmienił: w bazie, w historii wysyłek i w PDF-ie dalej siedzi ten sam tekst z nawiasami, więc stare szablony otwierają się bez żadnej przeróbki i od razu z pigułkami.',
        ],
        where: ['Menu boczne', 'Mailing', 'Szablony'],
        steps: [
          {
            do: 'Wejdź w „Mailing” → „Szablony” i kliknij „Edytuj” przy dowolnym szablonie.',
            then: 'Pola dynamiczne w tytule i w treści są teraz pigułkami z nazwą pola. Najedź na pigułkę — podpowiedź mówi, co robi kliknięcie.',
          },
          {
            do: 'Ustaw kursor w treści i wybierz pole z listy „Wstaw pole…” w pasku narzędzi.',
            then: 'Pigułka wskakuje dokładnie tam, gdzie stał kursor, a nie na początek pisma.',
          },
          {
            do: 'Chcesz usunąć pole? Postaw kursor za pigułką i naciśnij Backspace.',
            then: 'Znika całe pole, jednym naciśnięciem.',
          },
        ],
        expect: [
          'Wysyłany mail i PDF wyglądają dokładnie tak samo jak wcześniej — zmienił się tylko wygląd edytora.',
          'Wklejenie tekstu z nawiasami (np. z maila od kogoś) też zamienia je w pigułki.',
        ],
      },
      {
        id: 'opis-i-wartosc-pola-osobno',
        kind: 'new',
        icon: 'table',
        title: 'Opis pola w jednej kolumnie, wartość w drugiej',
        summary:
          'Jedno pole dynamiczne można teraz wstawić w trzech wariantach: całe (stałe zdanie i kwota razem), sam opis albo samą wartość. Dzięki temu w tabeli narysowanej w treści wstawiasz opis „Zimna woda” do kolumny A, a kwotę do kolumny B — z tego samego pola.',
        details: [
          'Do tej pory pole podstawiało się zawsze jako „stałe zdanie + wartość”, jednym ciągiem. W tabeli to nie działało: nic w mailu nie przeniesie połowy takiego tekstu za krawędź komórki, więc tabelę z opisami w jednej kolumnie i kwotami w drugiej dawała tylko wbudowana „Tabela pól” — z jej stałym układem dwóch kolumn.',
          'Teraz układ tabeli rysujesz sam: dowolna liczba kolumn, nagłówki, tekst między komórkami — a pola dynamiczne wstawiasz do tych komórek, do których chcesz.',
          'Wartość wpisujesz przy wysyłce tak samo jak dotąd, raz na pole. Jeśli w piśmie użyłeś wyłącznie opisu pola, aplikacja nie pyta o jego wartość — nie byłoby jej gdzie pokazać.',
        ],
        where: ['Menu boczne', 'Mailing', 'Szablony'],
        steps: [
          {
            do: 'W edytorze treści szablonu kliknij ikonę tabeli, ustaw np. 2 kolumny i 4 wiersze, i kliknij „Wstaw tabelę”.',
            then: 'W treści pojawia się pusta tabela z widocznymi obramowaniami.',
          },
          {
            do: 'Ustaw kursor w pierwszej komórce lewej kolumny. W pasku narzędzi, przy „Wstaw:”, kliknij „opis” i wybierz pole, np. „Zimna woda”.',
            then: 'W komórce pojawia się pigułka „Zimna woda” z dopiskiem „opis” — w wysłanym mailu będzie tu samo stałe zdanie tego pola.',
          },
          {
            do: 'Przejdź do komórki obok, przy „Wstaw:” kliknij „wartość” i wybierz to samo pole.',
            then: 'Pigułka ma dopisek „wartość” — tu wejdzie sama kwota wpisana przy wysyłce.',
          },
          {
            do: 'Powtórz dla kolejnych wierszy. Pomyliłeś wariant? Kliknij pigułkę.',
            then: 'Pigułka przełącza się po kolei: całość → opis → wartość.',
          },
          {
            do: 'Zapisz szablon, wejdź w „Mailing”, wybierz go i wpisz wartości pól.',
            then: 'Podgląd pod formularzem pokazuje gotową tabelę: opisy w jednej kolumnie, kwoty w drugiej.',
          },
        ],
        expect: [
          'Jedno pole to nadal jedna wartość do wpisania przy wysyłce, nawet jeśli w piśmie stoi w dwóch komórkach.',
          'Wbudowana „Tabela pól” działa bez zmian — jeśli jej układ Ci wystarcza, nic nie musisz przestawiać.',
          'Pole bez stałego zdania wstawione jako „opis” pokazuje swoją nazwę, żeby komórka nie została pusta.',
        ],
      },
      {
        id: 'jednostka-pola-dynamicznego',
        kind: 'new',
        icon: 'mail',
        title: 'Pole dynamiczne ma własną jednostkę — przy wysyłce wpisujesz samą liczbę',
        summary:
          'W formularzu pola dynamicznego doszło pole „Jednostka”, np. „zł/m²”. Jednostka dopisuje się w treści zaraz po wartości: wpisujesz przy wysyłce „20”, a w liście jest „20 zł/m²”.',
        details: [
          'Jednostka jest tą częścią kwoty, która nie zmienia się między wysyłkami — a mimo to trzeba ją było co miesiąc wklepywać razem z liczbą, przy każdej pozycji z osobna. Wystarczyło raz napisać „20 zł/m2” zamiast „20 zł/m²” i jedno pismo miało dwa różne zapisy tej samej stawki.',
          'Jednostka jest opcjonalna. Pole bez jednostki działa dokładnie jak dotąd, więc żadnego istniejącego pola ani szablonu nie trzeba poprawiać.',
          'Wpisana wartość i jednostka są sklejane spacją, więc jednostkę wpisujesz bez wiodącej spacji — samo „zł/m²”.',
          'Jednostka dopisuje się tylko wtedy, gdy wartość jest wypełniona. Pominięta pozycja zostaje pusta, zamiast pokazać w piśmie samo „zł/m²”.',
        ],
        where: ['Menu boczne', 'Mailing', 'Pola dynamiczne'],
        steps: [
          {
            do: 'Wejdź w „Mailing” → „Pola dynamiczne” i kliknij „Dodaj pole” (albo „Edytuj” przy istniejącym).',
            then: 'Pod „Stałym zdaniem” jest nowe pole „Jednostka”.',
          },
          {
            do: 'Wpisz jednostkę, np. „zł/m²”.',
            then: 'Podgląd pod formularzem od razu pokazuje, co pojawi się w treści: „350,00 zł/m²” dla przykładowej wartości — czyli jednostka stoi po wartości.',
          },
          {
            do: 'Zapisz pole przyciskiem „Zapisz”.',
            then: 'Na liście pól doszła kolumna „Jednostka”, więc od razu widzisz, które pola ją mają.',
          },
          {
            do: 'Wejdź w „Mailing”, wybierz szablon używający tego pola i wpisz wartość — samą liczbę, np. „20”.',
            then: 'Obok pola do wpisania widnieje jednostka („zł/m²”), a podgląd pisma pokazuje „20 zł/m²”.',
          },
        ],
        expect: [
          'Jednostka wchodzi wszędzie tam, gdzie wchodzi wartość: w zdanie pola, we wstawkę „wartość”, w kolumnę kwot „Tabeli pól” i w PDF.',
          'W „Historii wysyłek” kwoty są pokazane z jednostką z chwili wysyłki — późniejsza zmiana jednostki w słowniku nie przepisuje tego, co już poszło.',
          'Jednostki wchodzą do kopii zapasowej razem z polami. Kopia zrobiona starszą wersją wczytuje się bez zmian — pola po prostu nie mają jednostki.',
        ],
      },
      {
        id: 'typ-pola-data-godzina',
        kind: 'new',
        icon: 'calendar',
        title: 'Pole dynamiczne może być datą albo godziną',
        summary:
          'W formularzu pola doszedł przełącznik „Typ wartości”: tekst, data albo godzina. Przy wysyłce pole typu „data” wybierasz z kalendarza, a „godzina” z zegara — w liście wychodzi zawsze „14.09.2026” i „18:00”, w jednym zapisie.',
        details: [
          'Termin zebrania czy dzień wejścia nowej stawki był dotąd zwykłym tekstem, więc w jednym piśmie potrafiło stanąć „14.09.2026”, w drugim „14 września”, a w trzecim „14/09/26” — literówka w dacie w piśmie do jednostki jest kosztowna, bo nikt jej nie zweryfikuje. Kalendarz nie pozwala wpisać dnia, którego nie ma.',
          'To wybór dla całej wysyłki, tak samo jak każda inna wartość pola: jedna data trafia do wszystkich zaznaczonych wspólnot. Pole zakłada się raz („Termin zebrania”) i używa co miesiąc z nową datą.',
          'Nie mylić z wbudowanym polem „Data”, które podstawia dzisiejszą datę i o nic nie pyta. Tutaj datę wybierasz Ty — i może być dowolna, także przyszła.',
          'Data i godzina nie mają jednostki, więc przy tych dwóch typach pole „Jednostka” znika z formularza. Wszystkie dotychczasowe pola są typu „tekst” i działają bez żadnej zmiany.',
        ],
        where: ['Menu boczne', 'Mailing', 'Pola dynamiczne'],
        steps: [
          {
            do: 'Wejdź w „Mailing” → „Pola dynamiczne” i kliknij „Dodaj pole”.',
            then: 'Pod „Stałym zdaniem” jest przełącznik „Typ wartości” z trzema pozycjami: tekst, data, godzina. Nowe pole startuje jako „tekst”.',
          },
          {
            do: 'Wpisz nazwę, np. „Termin zebrania”, stałe zdanie „Zebranie odbędzie się dnia:” i kliknij „data”.',
            then: 'Podgląd pod formularzem pokazuje „Zebranie odbędzie się dnia: 14.09.2026”, a pole „Jednostka” znika — data jej nie potrzebuje.',
          },
          {
            do: 'Zapisz pole. Tak samo załóż drugie, np. „Godzina zebrania” z typem „godzina”.',
            then: 'Na liście pól pod nazwą widnieje typ („data”, „godzina”), więc od razu wiadomo, które pole o co poprosi.',
          },
          {
            do: 'Wstaw oba pola do szablonu i wejdź w „Mailing” → wybierz ten szablon.',
            then: 'W sekcji „Wartości pól dynamicznych” pole daty ma kalendarz, a pole godziny — zegar. Nie ma czego wpisać z ręki.',
          },
          {
            do: 'Wybierz datę i godzinę, po czym zerknij na podgląd pisma.',
            then: 'W treści widnieje „Zebranie odbędzie się dnia: 14.09.2026” i „18:00”.',
          },
        ],
        expect: [
          'Typ zmienisz w każdej chwili — pole zapisane wcześniej jako tekst wystarczy wyedytować i przełączyć na „data”.',
          'Data i godzina działają wszędzie tam, gdzie zwykła wartość: we wstawce „wartość”, w „Tabeli pól”, w PDF i w historii wysyłek.',
          'Typ pola wchodzi do kopii zapasowej. Kopia zrobiona starszą wersją wczytuje się bez zmian — jej pola są po prostu tekstowe.',
        ],
      },
      {
        id: 'sklejony-kod-pocztowy-w-adresie',
        kind: 'fixed',
        icon: 'alert-triangle',
        title: 'Kod pocztowy sklejony z numerem lokalu nie wysyła już wpłaty na cudze konto',
        summary:
          'W wyciągach, w których bank zapisuje adres płatnika jednym ciągiem — „UL. PUŁAWSKA 116 M.202-620 WARSZAWA” — aplikacja czytała numer lokalu razem z kodem pocztowym i księgowała taką wpłatę na lokal 202 zamiast na lokal 2. Teraz kod pocztowy jest odcinany, a numer lokalu odczytywany poprawnie.',
        details: [
          'Bank wpisuje nazwę, ulicę, kod pocztowy i miasto do jednego pola o stałej szerokości, bez odstępu między nimi. „M.2” i „02-620” sklejają się wtedy w „M.202-620”, a aplikacja brała stąd lokal 202 — z pełną pewnością, bez ostrzeżenia i bez pytania, więc wpłata cicho szła na konto innego właściciela. W jednym wyciągu potrafiło tak przejść 8 z 10 wpłat od mieszkańców.',
          'Rozdzielenie jest pewne, a nie zgadywane: myślnik w kodzie pocztowym stoi zawsze w tym samym miejscu, więc dwie cyfry przed nim należą do kodu, a wszystko wcześniej to numer lokalu. Dlatego działa niezależnie od wielkości budynku — „M.70202-620” to lokal 702 — i dla kodów spoza Warszawy, np. „M.8322-300” to lokal 83 w Krasnymstawie.',
          'Przy okazji zniknęła odwrotna pomyłka: sam kod pocztowy stojący za numerem budynku („Puławska 116 02-620”) był czytany jako lokal 02, czyli lokal 2 — też bez żadnego sygnału, że coś jest nie tak.',
          'Jeśli bank sklei numer lokalu z czymś, czego aplikacja nie umie rozdzielić, wpłata nie księguje się „na oko”. Trafia do sprawdzenia na ekranie akceptacji, a w ostrzeżeniu jest napisane, co dokleiło się do numeru.',
        ],
        where: ['Menu boczne', 'Konwerter', 'Akceptacja'],
        steps: [
          {
            do: 'Przekonwertuj wyciąg jak zawsze i wejdź na ekran akceptacji.',
            then: 'Numery lokali przy wpłatach od mieszkańców zgadzają się z tym, co widać w PDF-ie wyciągu — np. „2”, a nie „202”.',
          },
          {
            do: 'Przejrzyj wpłaty oznaczone do sprawdzenia.',
            then: 'Wpłata, przy której numeru lokalu nie dało się odczytać pewnie, czeka na Twoją decyzję zamiast zaksięgować się sama, i pokazuje, co przykleiło się do numeru.',
          },
        ],
        expect: [
          'Nie trzeba nic czyścić ani przestawiać — poprawka działa od najbliższej konwersji, także dla płatników, których aplikacja zapamiętała wcześniej z błędnym numerem lokalu.',
          'Poprawka dotyczy wszystkich banków, nie tylko BOŚ — sklejone adresy z pozostałych formatów wyciągów są czytane tak samo.',
        ],
        note: {
          type: 'warning',
          text: 'Wyciągi przekonwertowane wcześniejszymi wersjami mogły trafić na zły lokal. Jeśli księgowałeś wyciągi, w których adres płatnika jest sklejony w jeden ciąg, warto sprawdzić numery lokali przy wpłatach mieszkańców.',
        },
      },
      {
        id: 'mailing-czysci-adresatow-po-wyslaniu',
        kind: 'improved',
        icon: 'mail',
        title: 'Po wysłaniu mailingu lista adresatów czyści się sama',
        summary:
          'Wspólnoty, do których mail poszedł, znikają z listy adresatów zaraz po wysyłce. Nie trzeba ich odklikiwać jedna po drugiej, żeby wysłać kolejny mailing, i nie ma jak wysłać drugi raz tego samego maila do tej samej wspólnoty.',
        details: [
          'Dotąd po wysyłce zaznaczenie zostawało takie samo, a mailing wysyła się jednym przyciskiem — wystarczyło poprawić treść i kliknąć „Wyślij”, żeby te same wspólnoty dostały maila po raz drugi.',
          'Wspólnota, do której mail nie doszedł, zostaje na liście zaznaczona. Poprawiasz to, co nie zadziałało (najczęściej adres jednostki miasta), i wysyłasz ponownie — bez szukania jej od nowa w wyszukiwarce adresatów.',
          'Reszta formularza zostaje bez zmian: szablon, wpisane wartości pól, zaznaczone pola do tabeli i załączniki. Kolejny mailing tego samego typu robisz więc tylko przez dobranie nowych wspólnot.',
        ],
        where: ['Menu boczne', 'Mailing', 'Wyślij'],
        steps: [
          {
            do: 'Przygotuj mailing jak zwykle — wybierz szablon, dobierz wspólnoty, wpisz wartości pól i kliknij „Wyślij”.',
            then: 'Po wysyłce pod przyciskiem pojawia się tabela wyników z nazwą każdej wspólnoty i statusem, a sekcja „Adresaci” wyżej jest już pusta — licznik pokazuje „wybrano 0”.',
          },
          {
            do: 'Jeśli przy którejś wspólnocie w wynikach jest czerwony status, przewiń do „Adresaci”.',
            then: 'Właśnie te wspólnoty zostały na liście — gotowe do ponowienia po naprawieniu przyczyny.',
          },
        ],
        expect: [
          'Tabela wyników zostaje na ekranie po wyczyszczeniu adresatów — widzisz, do kogo mail poszedł, także po opróżnieniu listy.',
          'Przycisk „Wyślij” jest nieaktywny, dopóki nie dobierzesz kolejnych adresatów.',
          'Historia mailingów zapisuje się tak jak dotąd — przycisk „Przejdź do historii” nad tabelą wyników.',
        ],
      },
      {
        id: 'mailing-podglad-kazdej-wspolnoty',
        kind: 'new',
        icon: 'eye',
        title: 'Podgląd maila dla każdej wspólnoty osobno',
        summary:
          'W sekcji „Podgląd wiadomości” doszła lista adresatów: wybierasz wspólnotę z rozwijanej listy albo przechodzisz strzałkami „‹ ›” po kolejnych, i widzisz dokładnie ten mail, który do niej poleci — z jej nazwą w tytule i treści oraz adresem skrzynki, na którą trafi.',
        details: [
          'Dotąd podgląd pokazywał zawsze pierwszą zaznaczoną wspólnotę. Mail każdej kolejnej różni się jej nazwą w tytule i w treści oraz skrzynką jednostki ZGN, na którą idzie — przy wysyłce do dwudziestu wspólnot dziewiętnaście listów widziałeś dopiero po wysłaniu, w historii.',
          'Na liście adresatów każdy wiersz ma teraz przycisk z ikoną oka: kliknięcie przenosi podgląd na tę wspólnotę i przewija ekran do podglądu. Wiersz, którego mail jest właśnie na ekranie, zostaje podświetlony.',
          'Wybór wspólnoty w podglądzie nie zmienia niczego w wysyłce — decyduje tylko o tym, który list czytasz. Lista adresatów, treść, wartości pól i załączniki zostają bez zmian.',
        ],
        where: ['Menu boczne', 'Mailing', 'Podgląd wiadomości'],
        steps: [
          {
            do: 'Przygotuj mailing jak zwykle — wybierz szablon i dobierz wspólnoty w sekcji „Wspólnoty i adresaci”.',
            then: 'Sekcja „Podgląd wiadomości” niżej pokazuje mail pierwszej wspólnoty z listy.',
          },
          {
            do: 'W podglądzie rozwiń listę „Podgląd dla wspólnoty” i wybierz wspólnotę — możesz wpisać kilka liter jej nazwy, żeby ją znaleźć.',
            then: 'Tytuł i treść przeliczają się na tę wspólnotę, a nad tytułem widać „Mail poleci na: …” z adresem jej jednostki ZGN.',
          },
          {
            do: 'Klikaj strzałki „‹” i „›” obok listy, żeby przejrzeć wszystkie listy po kolei.',
            then: 'Licznik między strzałkami mówi, na której wspólnocie jesteś, np. „3 z 12”. Po ostatniej wracasz do pierwszej.',
          },
          {
            do: 'Chcesz sprawdzić konkretną wspólnotę z listy adresatów? Kliknij przy niej ikonę oka.',
            then: 'Podgląd przeskakuje na tę wspólnotę, ekran przewija się do podglądu, a jej wiersz na liście adresatów jest podświetlony.',
          },
        ],
        expect: [
          'Podgląd pokazuje to samo, co zostanie wysłane (i zapisane do PDF, jeśli PDF jest włączony) — razem z logo INTER-EJ na górze.',
          'Jeśli usuniesz z listy adresatów wspólnotę, która była w podglądzie, podgląd wróci do pierwszej z listy — nie zostaje pusty.',
          'Przy pustej liście adresatów podgląd działa jak dotąd: w miejscu nazwy wspólnoty widać „[nazwa wspólnoty]”.',
        ],
      },
    ],
  },
  {
    version: '6.2.0',
    date: '2026-08-11',
    title: 'Lokale z literą (17A) już nie trafiają na cudze konto',
    tagline:
      'Wpłata za lokal 17A była rozpoznawana jako lokal 17 i księgowana na konto innego właściciela — bez żadnego ostrzeżenia. Teraz aplikacja widzi literę, sama takiej wpłaty nie księguje i pyta Cię o konto. Do reguł lokali doszło pole „Konto lokalu”, a w akceptacji obok „Numeru mieszkania” jest nowe pole „Konto lokalu”.',
    stats: [
      { value: '17A ≠ 17', label: 'rozróżniane numery lokali' },
      { value: '8', label: 'banków objętych poprawką' },
      { value: '1', label: 'nowe pole w regułach lokali' },
    ],
    highlights: [
      {
        id: 'lokale-z-litera-nie-ksieguja-sie-same',
        kind: 'fixed',
        icon: 'alert-triangle',
        title: 'Lokal z literą nie zaksięguje się sam na numer bez litery',
        summary:
          'Do tej pory z opisu „UL.BOGUNKI 5 M.17A” aplikacja czytała lokal „17”, dawała temu 95% pewności i księgowała wpłatę na 204-000017 — czyli na konto właściciela lokalu 17. Teraz czyta „17A”, wie że nie zna konta takiego lokalu, i zostawia wpłatę w nierozpoznanych do Twojej decyzji.',
        details: [
          'To był najgroźniejszy rodzaj błędu: cichy. Wpłata dostawała najwyższą pewność, więc nie pokazywała się na ekranie akceptacji, w pliku księgowym wyglądała normalnie, a pieniądze były już na koncie innej osoby. Nic w aplikacji nie sygnalizowało, że coś jest nie tak.',
          'Aplikacja nie próbuje sama wymyślić konta dla lokalu z literą, bo wspólnoty numerują je różnie — u jednej będzie to 204-00017A, u innej coś zupełnie innego. Zamiast zgadywać, pyta Ciebie. Konto podane raz w regule lokalu wystarczy: kolejne wpłaty od tego płatnika zaksięgują się już bez pytania.',
          'Poprawka obejmuje wszystkie osiem banków, ponieważ każdy z nich korzystał z tej samej, wspólnej logiki rozpoznawania adresu. Zabezpieczenie działa też wtedy, gdy litera pojawi się w formacie, którego nie przewidzieliśmy: jeśli w opisie widać lokal z literą, a rozpoznany numer jej nie ma, wpłata i tak trafia do akceptacji.',
          'Litera musi być przyklejona do cyfr — z opisu „BOGUNKI 5/27 A”, gdzie adres płatnika mówi „M.27”, dalej wychodzi lokal 27. Luźna litera obok numeru nie tworzy nowego lokalu.',
        ],
        where: ['Menu boczne', 'Konwerter', 'Akceptacja'],
        steps: [
          {
            do: 'Przekonwertuj wyciąg jak zawsze i wejdź na ekran akceptacji.',
            then: 'Wpłata za lokal z literą ma teraz pomarańczową ramkę z napisem „Numer lokalu rozpoznany — brak konta” i widocznym numerem, np. 17A.',
          },
          {
            do: 'Wpisz konto w nowym polu „Konto lokalu” — po lewej stronie pola stoi na szaro stały prefiks (np. „204-”), Ty dopisujesz tylko dalszą część, np. 00017A.',
            then: 'Pod polem od razu widzisz pełny symbol, który wejdzie do pliku księgowego: „W pliku księgowym: 204-00017A”. Pola „Numer mieszkania” i „Pozostałe przychody” zostają w tym momencie zablokowane, żeby dwa wpisy nie walczyły o jedną wpłatę.',
          },
          {
            do: 'Jeśli ten płatnik wpłaca co miesiąc, kliknij „Powiąż lokal” i zapisz regułę — numer lokalu i konto są już w formularzu wypełnione.',
            then: 'Od następnego wyciągu ta wpłata rozpozna się sama, z właściwym kontem. Nadal pokaże się do akceptacji, tak jak każda wpłata dopasowana regułą.',
          },
          {
            do: 'Dokończ akceptację i wygeneruj plik księgowy jak zwykle.',
          },
        ],
        expect: [
          'Jeśli nie podasz konta, wpłata wyląduje w sekcji „NIEROZPOZNANE” pliku księgowego — nigdy na koncie lokalu bez litery.',
          'W polu „Numer mieszkania” nie da się wpisać „17A”: aplikacja wyjaśni, że taki lokal wpisuje się w polu „Konto lokalu”, bo z samego numeru nie potrafi wyliczyć konta.',
          'Zwykłe numery lokali działają dokładnie jak dotąd — sprawdzone na 93 transakcjach z dwóch wyciągów: zmieniły się tylko te dwie, które dotyczyły lokalu 17A.',
        ],
        note: {
          type: 'warning',
          text: 'Ta poprawka działa od teraz w przód. Wyciągi zaksięgowane wcześniej mogą zawierać wpłaty, które trafiły na numer bez litery — jeśli masz w którejś wspólnocie lokale z literą, warto sprawdzić ich salda.',
        },
      },
      {
        id: 'konto-lokalu-w-regulach',
        kind: 'new',
        icon: 'wallet',
        title: 'Własne konto lokalu w regułach lokali',
        summary:
          'Reguła lokalu ma nowe, opcjonalne pole „Konto lokalu”. Jeśli je wypełnisz, wpłata pójdzie dokładnie na to konto — zamiast na domyślne, składane z prefiksu i numeru dopełnionego zerami (np. 204-000025).',
        details: [
          'Domyślna zasada wystarcza dla zwykłych numerów, ale nie dla każdego przypadku: lokale z literą, lokale zapisane w planie kont po swojemu, wyjątki po podziale mieszkania. Dotąd takie wpłaty trzeba było co miesiąc przypisywać ręcznie.',
          'Dla lokalu z literą to pole jest wymagane — bez niego reguła powiedziałaby, o który lokal chodzi, ale nie gdzie zaksięgować, i wpłata wracałaby do akceptacji przy każdym wyciągu. Aplikacja o tym przypomni przy zapisie.',
        ],
        where: ['Menu boczne', 'Adresy', 'Reguły lokali'],
        steps: [
          {
            do: 'Wejdź w „Adresy” i przy wybranej wspólnocie kliknij „Reguły lokali”.',
            then: 'Otworzy się lista reguł — ma teraz dodatkową kolumnę „Konto lokalu (opcjonalnie)”.',
          },
          {
            do: 'Kliknij „Dodaj regułę” albo „Edytuj” przy istniejącej.',
            then: 'W formularzu, pod „Numerem lokalu”, jest pole „Konto lokalu (opcjonalnie)” z wyjaśnieniem, kiedy je wypełnić.',
          },
          {
            do: 'Wpisz pełny symbol konta, np. 204-00017A, i zapisz.',
            then: 'Gwiazdka przy nazwie pola pojawia się automatycznie, gdy numer lokalu ma literę — wtedy konto jest wymagane.',
          },
        ],
        expect: [
          'Puste pole = zachowanie jak dotąd, czyli konto składane z prefiksu i numeru lokalu.',
          'Konto z reguły wygrywa z domyślną zasadą, a Twój ręczny wpis na ekranie akceptacji wygrywa z regułą.',
          'Reguły z kontem wchodzą do kopii zapasowej i do eksportu adresów do pliku TXT (segment „KONTO:”), więc przenoszą się razem z resztą konfiguracji.',
        ],
      },
      {
        id: 'numery-budynkow-z-litera',
        kind: 'fixed',
        icon: 'building',
        title: 'Adresy z literą w numerze budynku są w końcu rozpoznawane',
        summary:
          'Wspólnota zapisana jako np. „Bachmacka 6A” była pomijana przy dopasowywaniu adresu — aplikacja nie potrafiła odczytać „6A” jako numeru budynku i schodziła na ogólne, mniej pewne wzorce. Z opisu „UL. BACHMACKA 6A M.12” wychodziły wtedy bzdury w rodzaju budynku 12 i lokalu 12.',
        details: [
          'Ten sam brak litery, który psuł numery lokali, psuł też numery budynków. Efekt był inny i trudniejszy do zauważenia: adres formalnie się „zgadzał”, pewność wynosiła 95%, a numer budynku i lokalu bywał wzięty z zupełnie innego miejsca opisu.',
          'Nic tu nie trzeba klikać ani ustawiać — poprawka działa od razu dla wszystkich wspólnot, które mają literę w numerze budynku.',
        ],
        expect: [
          'Z „UL. BACHMACKA 6A/12” wychodzi budynek 6A i lokal 12.',
          'Adresy bez litery w numerze budynku działają bez zmian.',
        ],
      },
    ],
  },
  {
    version: '6.1.0',
    date: '2026-08-10',
    title: 'Tabela stawek w mailu, tańszy i pewniejszy OCR zaliczek, dwa nowe pliki TECHEM',
    tagline:
      'Trzy rzeczy. W mailingu wstawisz do treści tabelę, której wiersze wybierasz osobno przy każdej wysyłce. Podsumowanie zaliczek czyta PDF-y strona po stronie, pamięta raz odczytane strony (powtórny OCR jest darmowy) i samo sprawdza, czy kwoty się sumują. Odczyty liczników rozpoznają wszystkie trzy układy plików od TECHEM, a nie tylko jeden.',
    stats: [
      { value: '2', label: 'kolumny w tabeli pól' },
      { value: '0 zł', label: 'za powtórny OCR strony' },
      { value: '3', label: 'układy plików TECHEM' },
    ],
    highlights: [
      {
        id: 'mailing-tabela-pol',
        kind: 'new',
        icon: 'table',
        title: 'Tabela pól dynamicznych w treści maila',
        summary:
          'Nowe pole wbudowane „Tabela pól” wstawia do treści tabelę o dwóch kolumnach: po lewej stałe zdanie pola dynamicznego, po prawej wartość. W szablonie wybierasz raz, z których pól ta tabela może korzystać, a przy każdej wysyłce zaznaczasz, które z nich mają w niej faktycznie wystąpić.',
        details: [
          'Do tej pory każda pozycja musiała być wpisana w treść szablonu na sztywno. Jeśli w jednym miesiącu zmieniały się dwie stawki, a w następnym pięć, trzeba było trzymać kilka szablonów albo ręcznie kasować zdania przed wysyłką.',
          'Teraz szablon zostaje jeden i pracuje na dwóch poziomach. W szablonie ustalasz krótką listę pól dla tabeli — np. pięć z pięćdziesięciu, jakie masz w słowniku — i ich kolejność. Przy wysyłce widzisz tylko te pięć: odhaczasz trzy, które w tym miesiącu się zmieniły, i wpisujesz dla nich kwoty.',
          'Niezaznaczone pola nie pojawiają się nigdzie — nie zostaje po nich ani puste zdanie, ani pusty wiersz. Tabela wygląda tak samo w mailu i w załączonym PDF-ie, a w podglądzie widzisz ją dokładnie w takiej formie, w jakiej pójdzie do jednostki.',
        ],
        where: ['Menu boczne', 'Mailing'],
        steps: [
          {
            do: 'Wejdź w „Mailing” → zakładka „Szablony” i otwórz szablon przyciskiem „Edytuj” (albo dodaj nowy).',
            then: 'Otworzy się edytor z tytułem i treścią wiadomości.',
          },
          {
            do: 'Ustaw kursor w treści tam, gdzie ma stanąć tabela, i z listy „Wstaw pole…” (prawy górny róg paska narzędzi) wybierz „Tabela pól”.',
            then: 'W treści pojawi się wstawka „{{Tabela pól}}”, a pod edytorem informacja, że pola dla tabeli wybiera się poniżej.',
          },
          {
            do: 'Zjedź do sekcji „Pola dostępne w tabeli” i listą „Dodaj pole do tabeli…” dodaj te pola dynamiczne, które ta tabela ma móc pokazywać. Strzałkami ↑ ↓ ustaw ich kolejność, krzyżykiem usuń pomyłkę. Zapisz szablon przyciskiem „Zapisz”.',
            then: 'Pola pojawią się na numerowanej liście — ta kolejność to kolejność wierszy w mailu.',
          },
          {
            do: 'Przejdź do zakładki „Wysyłka” i wybierz ten szablon.',
            then: 'Nad listą wspólnot pojawi się karta „Tabela pól dynamicznych”, a w niej dokładnie te pola, które udostępnia szablon — nie cały słownik.',
          },
          {
            do: 'W kolumnie „Wartość” wpisz kwoty dla pól, które mają wejść do maila (np. 350,00 zł).',
            then: 'Wpisanie wartości samo zaznacza kwadracik w kolumnie „W tabeli”; możesz też zaznaczać i odznaczać ręcznie. Pod tabelą widzisz, ile wierszy pójdzie z ilu dostępnych, a podgląd na dole ekranu aktualizuje się od razu.',
          },
        ],
        expect: [
          'Wiersze idą w kolejności ustawionej w szablonie, niezależnie od tego, w jakiej kolejności je zaznaczasz przy wysyłce.',
          'Jeśli nie zaznaczysz nic, tabela w ogóle nie pojawi się w mailu — reszta treści zostaje bez zmian.',
          'Pole zaznaczone bez wartości wychodzi z pustą drugą kolumną — aplikacja wypisuje takie pola pod tabelą na pomarańczowo, żeby dało się to złapać przed wysłaniem.',
          'W historii wysyłek zapisują się wszystkie wartości z tabeli, więc po miesiącach widać, co dokładnie wysłano.',
        ],
        note: {
          type: 'tip',
          text: 'Zmiana szablonu na inny czyści zaznaczenia — nowy szablon udostępnia własną listę pól. Wstawki „Tabela pól” nie da się wstawić do tytułu wiadomości: tytuł jest zwykłym tekstem, tabela nie ma się gdzie w nim zmieścić.',
        },
      },
      {
        id: 'zaliczki-strony-pamiec-kontrola',
        kind: 'improved',
        icon: 'file-text',
        title: 'Zaliczki: strona po stronie, z pamięcią odczytów i kontrolą kwot',
        summary:
          'Podsumowanie zaliczek dzieli teraz PDF na pojedyncze strony i czyta każdą osobno. Raz odczytana strona zapisuje się na dysku, więc powtórny OCR tego samego pliku jest natychmiastowy i nic nie kosztuje. Po odczycie aplikacja sama sprawdza, czy kwoty się sumują, i pokazuje, które wspólnoty obejrzeć.',
        details: [
          'Wcześniej cały plik szedł do modelu w jednym zapytaniu. Jeden problem na jednej stronie przewracał odczyt całego pliku — a przy powtórce płaciło się za wszystko od nowa. Zdarzało się też, że model dopisywał do odpowiedzi swoje rozważania i wtedy odczyt kończył się błędem, mimo że same liczby były w środku poprawne. Teraz każda strona to osobne zapytanie i osobny wynik: kłopotliwa strona nie psuje pozostałych, a dopisana proza nie przeszkadza.',
          'W trakcie pracy widzisz, na której stronie jest aplikacja („strona 7/15”) i ile stron wzięła z pamięci. Po odczycie pod plikiem stoi podsumowanie: ile stron, ile z pamięci, ile ponowionych, ile nieudanych.',
          'Kontrola kwot korzysta z tego, że te dokumenty same podają sumy: składniki świadczeń muszą dać „Razem świadczenia”, a części — sumę całkowitą. Jeśli coś się nie zgadza, aplikacja ponawia tę jedną stronę mocniejszym modelem, a gdy nadal nie gra — wypisuje wspólnotę w sekcji „Kontrola kwot” i podświetla jej wiersz w tabeli. Nie musisz sprawdzać po kolei 28 wierszy, tylko te wskazane.',
        ],
        where: ['Menu boczne', 'Podsumowanie zaliczek'],
        steps: [
          {
            do: 'Kliknij „Podsumowanie zaliczek” w menu po lewej i wrzuć PDF-y jak dotąd.',
            then: 'W kolumnie statusu zamiast samego „OCR…” lecą teraz konkretne strony: „dzielenie na strony…”, potem „strona 3/15 · 2 z pamięci”.',
          },
          {
            do: 'Poczekaj na koniec odczytu i zjedź do tabeli z wynikami pliku.',
            then: 'Nad tabelą stoi linijka „15 stron · 4 z pamięci (bez ponownych kosztów)”, a pod nią sekcja „Kontrola kwot”: albo zielona informacja, że wszystkie kwoty się zgadzają, albo lista wspólnot do obejrzenia. Wskazane wiersze są w tabeli podświetlone.',
          },
          {
            do: 'Popraw ręcznie to, co trzeba, i wygeneruj Excel tak samo jak wcześniej.',
            then: 'Plik wychodzi bez zmian w formacie — poprawki wpisane w tabeli są w nim uwzględnione.',
          },
          {
            do: 'Jeśli chcesz odczytać plik od zera, użyj „OCR ponownie” przy tym pliku.',
            then: 'Tylko ten przycisk pomija pamięć i pyta model jeszcze raz. Zwykłe dodanie tego samego pliku korzysta z pamięci, czyli jest darmowe.',
          },
        ],
        expect: [
          'Pod listą plików pojawia się karta „Pamięć odczytów” z liczbą zapamiętanych stron i ich rozmiarem, a obok przycisk „Wyczyść pamięć odczytów”. Czyszczenie nic nie psuje — kosztuje tylko tyle, że następny odczyt tych stron znów pójdzie do modelu.',
          'Pamięć siedzi lokalnie na tym komputerze i nie wchodzi do kopii zapasowej: to dane odtwarzalne z Twoich PDF-ów, nie dane księgowe.',
          'Nazwy plików z rzymską dziesiątką („X 2026”) są teraz poprawnie rozpoznawane jako październik — wcześniej samotne „X” umykało i miesiąc trzeba było ustawiać ręcznie.',
        ],
        note: {
          type: 'tip',
          text: 'Nieudana strona nie blokuje pliku: pozostałe wchodzą do tabeli normalnie, a przy ponownym uruchomieniu OCR-u aplikacja dopyta tylko o te strony, których jeszcze nie ma.',
        },
      },
      {
        id: 'techem-dwa-nowe-uklady',
        kind: 'improved',
        icon: 'zap',
        title: 'TECHEM z drugiego portalu i TECHEM wypełniany ręcznie',
        summary:
          'Do tej pory moduł „Odczyty liczników” przyjmował tylko jeden układ pliku od TECHEM. Dwa pozostałe kończyły się komunikatem „Nie rozpoznano formatu pliku”. Teraz działają wszystkie trzy.',
        details: [
          'Pierwszy nowy układ to eksport z drugiego portalu TECHEM: wspólnota stoi w kolumnie „Ulica” (a nie „Adres”), numer mieszkania ma własną kolumnę, a odczyty są pod nagłówkiem z datą zapisaną krótko, np. „30.06.26”.',
          'Drugi to zestawienie wypełniane ręcznie: nagłówki są WIELKIMI LITERAMI i bez polskich znaków („NUMER URZADZENIA”, „ULICA”, „WARTOSC ODCZYTU”), a data odczytu stoi przy każdym wierszu w kolumnie „DATA STANU KONCOWEGO” zamiast w nagłówku.',
          'Aplikacja sama rozpoznaje, który to układ — nie wybierasz tego nigdzie z listy. Pliki od PIASKAN, METRONA i ISTA oraz dotychczasowy plik TECHEM czytają się dokładnie tak samo jak wcześniej.',
        ],
        where: ['Menu boczne', 'Odczyty liczników'],
        steps: [
          {
            do: 'Kliknij „Odczyty liczników” w menu po lewej (ikona błyskawicy).',
            then: 'Otworzy się ekran z polem na pliki i tabelą rozpoznanych plików.',
          },
          {
            do: 'Przeciągnij na pole plik .xls od TECHEM — obojętnie z którego portalu, albo ten wypełniany ręcznie.',
            then: 'W kolumnie „Dostawca” pojawi się „TECHEM”, a obok nazwa wspólnoty, data odczytu i liczba odczytów. Wcześniej w tym miejscu wyskakiwał czerwony komunikat „Nie rozpoznano formatu pliku”.',
          },
          {
            do: 'Kliknij „Konwertuj”.',
            then: 'Pliki TXT trafiają do folderu IMPEX — po jednym na wspólnotę, dokładnie jak przy pozostałych dostawcach.',
          },
        ],
        expect: [
          'Wynik jest identyczny niezależnie od układu pliku wejściowego: numer urządzenia, data w formacie 2026.06.30 i wartość odczytu z przecinkiem.',
          'Wiersze bez odczytu (pusta komórka albo myślnik „-”) nadal nie blokują konwersji — trafiają do „Pominiętych wierszy bez odczytu” z numerem wiersza takim, jak widzisz go w Excelu.',
        ],
        note: {
          type: 'tip',
          text: 'Jeżeli plik od TECHEM nadal się nie rozpoznaje, sprawdź, czy nie usunięto z niego wiersza nagłówków — to po nazwach kolumn aplikacja poznaje dostawcę i układ.',
        },
      },
    ],
  },
  {
    version: '6.0.1',
    date: '2026-08-07',
    title: 'Mailing do jednostek miasta, odczyty liczników i tańsze dopasowania',
    tagline:
      'Duże wydanie zbierające trzy wątki: nowy moduł Mailing (pisma o zmianie stawek prosto do jednostek ZGN), nowy moduł Odczyty liczników (excele od dostawców zamieniane na pliki do IMPEX) oraz akceptacja transakcji, która uczy się pisowni z wyciągów i przestała pytać AI o to, co już zna.',
    stats: [
      { value: '2', label: 'nowe moduły' },
      { value: '−89%', label: 'kosztu zapytania AI' },
      { value: '4', label: 'dostawców odczytów' },
      { value: '180 dni', label: 'pamięci dopasowań' },
    ],
    highlights: [
      {
        id: 'mailing-modul',
        kind: 'new',
        icon: 'mail',
        title: 'Mailing — nowa pozycja w menu',
        summary:
          'Kiedy wspólnota zmienia stawki (np. fundusz remontowy), zaznaczasz wspólnoty, wybierasz szablon, wpisujesz nowe kwoty i wysyłasz. Każda wspólnota dostaje osobny mail do swojej jednostki ZGN.',
        details: [
          'Adresata nie wpisujesz ręcznie: bierze się z jednostki ZGN przypisanej do adresu, a na liście wspólnot widzisz przy każdej nazwę jednostki i jej e-mail — jeszcze przed wysłaniem.',
          'Treść składa się z szablonu i „pól dynamicznych”. Pole to nazwa plus stałe zdanie (np. „Zmianie uległa zaliczka na fundusz remontowy w kwocie:”); kwotę wpisujesz raz przy wysyłce i trafia do wszystkich maili tej wysyłki.',
        ],
        where: ['Menu boczne', 'Mailing', 'Wysyłka'],
        steps: [
          {
            do: 'Kliknij „Mailing” w menu po lewej (ikona koperty).',
            then: 'Otworzy się zakładka „Wysyłka” z czterema zakładkami u góry: Wysyłka, Szablony, Pola dynamiczne, Historia.',
          },
          {
            do: 'W „Typ mailingu” zostaw „Zmiany zaliczek ZGN” i wybierz szablon z listy.',
            then: 'Pod spodem pojawią się pola do wypełnienia — dokładnie te, których używa wybrany szablon.',
          },
          {
            do: 'Wpisz nowe kwoty w pola dynamiczne.',
            then: 'Na dole, w „Podgląd wiadomości”, treść od razu układa się z podstawionymi wartościami.',
          },
          {
            do: 'W „Wspólnoty i adresaci” kliknij „Dodaj wspólnotę…”, wpisz kilka liter nazwy i wybierz wspólnotę z listy. Powtórz dla każdej kolejnej — albo kliknij „Zaznacz wszystkie”.',
            then: 'Wybrane wspólnoty układają się w listę pod spodem, każda z nazwą jednostki ZGN i jej e-mailem, plus „×” do usunięcia. Na liście do wyboru są tylko wspólnoty, które mają już przypisany mail jednostki — pozostałe są ukryte i aplikacja pisze, ile ich jest.',
          },
          {
            do: 'Zdecyduj o załącznikach: przełącznik „Dołącz treść jako PDF” i przycisk „Dodaj załącznik” dla własnych plików.',
            then: 'PDF powstaje osobno dla każdej wspólnoty (z jej adresem w treści); własne pliki są takie same dla wszystkich.',
          },
          {
            do: 'Kliknij „Wyślij” i potwierdź liczbę wiadomości oraz skrzynkę nadawcy.',
            then: 'Widzisz postęp („Wysłano X z Y”), a po zakończeniu tabelę wyników: wspólnota, adresat, status i klikalne załączniki.',
          },
        ],
        expect: [
          'Jeden mail na wspólnotę — pole „Adres Wspólnoty” podstawia jej nazwę, więc każde pismo jest o właściwej wspólnocie.',
          'Błąd przy jednej wspólnocie nie przerywa wysyłki: pozostałe idą dalej, a w tabeli wyników widać dokładnie, co się nie udało.',
          'Wspólnoty bez jednostki ZGN nie da się nawet wybrać — poprawia się je w „Adresy”, a nie tuż przed wysyłką.',
        ],
        note: {
          type: 'warning',
          text: 'Przed pierwszą wysyłką ustaw skrzynkę: Ustawienia → Skrzynka do wysyłki (dla home.pl serwer poczta.home.pl, port 465). Bez tego moduł pokaże czerwony pasek i nie wyśle.',
        },
      },
      {
        id: 'mailing-edycja-instancji',
        kind: 'new',
        icon: 'edit',
        title: 'Poprawki treści na jedną wysyłkę',
        summary:
          'Treść wczytuje się z szablonu, ale przed wysłaniem możesz ją dowolnie zmienić — tymi samymi narzędziami co w edytorze szablonu, razem z tytułem. Zmiany dotyczą tylko tej wysyłki; szablon zostaje nietknięty.',
        details: [
          'Prawie każde pismo o zmianie stawek ma coś swojego: numer uchwały, datę zebrania, jedno dodatkowe zdanie. Wcześniej trzeba było albo wpisać to na stałe do szablonu (i pamiętać, żeby usunąć przed kolejnym miesiącem), albo zrobić osobny szablon na jedną okazję.',
          'Pod treścią masz ten sam pasek narzędzi co przy szablonie: pogrubienie, listy, wyrównanie, tabela, wstawianie pól dynamicznych. Tytuł też jest edytowalny i też przyjmuje pola.',
        ],
        where: ['Mailing', 'Wysyłka', 'Treść wiadomości'],
        steps: [
          {
            do: 'Wybierz szablon w polu „Szablon wiadomości”.',
            then: 'W sekcji „Treść wiadomości” pojawi się tytuł i treść wczytane z szablonu.',
          },
          {
            do: 'Popraw tytuł albo treść — dopisz zdanie, pogrub fragment, wstaw pole dynamiczne.',
            then: 'Nad treścią zapali się informacja „Treść zmieniona na potrzeby tej wysyłki”, a podgląd pod spodem od razu pokazuje nową wersję.',
          },
          {
            do: 'Jeśli chcesz wrócić do wersji z szablonu, kliknij „Przywróć z szablonu”.',
            then: 'Tytuł i treść wracają do stanu zapisanego w szablonie, a informacja o zmianie znika.',
          },
        ],
        expect: [
          'Poprawki NIE zapisują się w szablonie — przy następnej wysyłce znów dostaniesz jego oryginalną treść.',
          'Jeśli dopiszesz w treści nowe pole dynamiczne, jego okienko na wartość pojawi się od razu wyżej, w „Wartościach pól dynamicznych”.',
          'W historii zapisuje się treść faktycznie wysłana, razem z nazwą szablonu, z którego wyszła.',
          'Jeśli nic nie zmieniałeś, a w zakładce „Szablony” poprawisz szablon i wrócisz — wysyłka podchwyci poprawioną wersję.',
        ],
      },
      {
        id: 'mailing-logo',
        kind: 'new',
        icon: 'sparkles',
        title: 'Firmowa oprawa maila: logo i papier INTER-EJ',
        summary:
          'Mail wychodzi w firmowej oprawie: wyśrodkowane logo INTER-EJ na ciemnym pasku, pomarańczowa linia z logo pod nim i treść na białej karcie o czytelnej szerokości. Nie trzeba nic wstawiać do szablonu.',
        details: [
          'Logo ma biały napis (na stronie firmy leży na ciemnym nagłówku), dlatego siedzi na ciemnym pasku w kolorze strony — inaczej biały tekst zniknąłby na białym tle.',
          'Treść maila jest ograniczona do szerokości kartki, a nie rozciąga się na całe okno programu pocztowego. Krótsze wiersze po prostu czyta się lepiej i wygląda to jak pismo, a nie jak wklejony tekst.',
          'Szare tło dochodzi w PDF-ie do samej krawędzi strony. Jeśli będziesz taki PDF drukować, pamiętaj, że drukarki nie drukują do krawędzi papieru — przy wydruku na brzegach może zostać biały pasek.',
          'W PDF-ie logo jest zapisane jako grafika wektorowa, więc jest ostre także po wydrukowaniu i przy powiększeniu — nie rozmywa się tak, jak zwykły obrazek ze strony internetowej.',
          'W mailu logo jest wstawiane jako obrazek osadzony w treści, nie jako załącznik, więc adresat nie widzi go na liście plików do pobrania.',
        ],
        where: ['Mailing', 'Wysyłka', 'Podgląd wiadomości'],
        expect: [
          'Podgląd na ekranie wysyłki pokazuje całą oprawę — dokładnie to, co zobaczy adresat.',
          'W szczegółach wpisu w historii wiadomość też wygląda tak, jak poszła.',
          'PDF wygląda tak samo jak mail: to samo szare tło i ta sama biała karta z logo, więc załącznik jest wierną kopią wiadomości.',
          'Nie trzeba (i nie warto) wklejać logo do treści szablonu — pojawiłoby się dwa razy.',
        ],
        note: {
          type: 'tip',
          text: 'Jeśli firma ma logo w oryginale od grafika (plik SVG, AI, EPS albo duży PNG), warto je podrzucić — wstawimy je w miejsce obecnego i jakość będzie idealna z pierwszej ręki.',
        },
      },
      {
        id: 'mailing-jednostki-zgn',
        kind: 'new',
        icon: 'building',
        title: 'Jednostki ZGN w Adresach',
        summary:
          'Nowy słownik: nazwa jednostki i jej e-mail. Na każdym adresie wybierasz jedną jednostkę — i to ona dostaje maile o zmianach stawek tej wspólnoty.',
        details: [
          'Jedna jednostka obsługuje zwykle wiele wspólnot, dlatego jest w słowniku, a nie wpisywana przy każdym adresie: zmiana adresu e-mail w jednym miejscu działa od razu dla wszystkich powiązanych wspólnot.',
        ],
        where: ['Adresy', 'Jednostki ZGN'],
        steps: [
          {
            do: 'Wejdź w „Adresy” i kliknij zakładkę „Jednostki ZGN” u góry.',
            then: 'Zobaczysz formularz i listę jednostek — widok „Adresy” ma teraz trzy zakładki: „Adresy wspólnot”, „Typy kont wspólnoty” i „Jednostki ZGN”.',
          },
          {
            do: 'Kliknij „Dodaj jednostkę”, w okienku wpisz nazwę i e-mail, kliknij „Dodaj”.',
            then: 'Jednostka pojawi się na liście razem z licznikiem „Wspólnot”, czyli ile adresów już ją wskazuje. Edycja działa tak samo — „Edytuj” otwiera to samo okienko z wypełnionymi polami.',
          },
          {
            do: 'Wróć na zakładkę „Adresy wspólnot”, kliknij „Edytuj” przy adresie i w polu „Jednostka ZGN” wybierz jednostkę z listy.',
            then: 'Po zapisaniu jednostka i jej e-mail są widoczne w nowej kolumnie „Jednostka ZGN” w tabeli adresów.',
          },
        ],
        expect: [
          'Do jednostek dojdziesz też wprost z formularza adresu — przycisk „Zarządzaj jednostkami” obok listy otwiera je w okienku, więc nie tracisz wpisanego adresu.',
          'Usunięcie jednostki nie usuwa adresów: tracą tylko adresata, a aplikacja ostrzega, ilu adresów to dotyczy.',
          'Jednostki, pola dynamiczne, szablony i historia wysyłek wchodzą do kopii zapasowych razem z resztą danych — codzienna kopia wypisuje ich liczby w podsumowaniu.',
        ],
      },
      {
        id: 'mailing-szablony-pola',
        kind: 'new',
        icon: 'file-text',
        title: 'Szablony i pola dynamiczne',
        summary:
          'Dowolnie wiele szablonów z formatowaniem (pogrubienie, listy, nagłówki) i własne pola dynamiczne, które wstawiasz jednym kliknięciem — do treści i do tytułu.',
        details: [
          'Tytuł też korzysta z pól dynamicznych, więc temat maila może zawierać nazwę wspólnoty i datę.',
          'Dwa pola są wbudowane i nie wymagają wypełniania: „Adres Wspólnoty” (nazwa wybranej wspólnoty) i „Data” (dzisiejsza data w formacie dd.mm.rrrr).',
        ],
        where: ['Mailing', 'Szablony'],
        steps: [
          {
            do: 'Wejdź w zakładkę „Pola dynamiczne”, kliknij „Dodaj pole” i w okienku wpisz nazwę (np. „Zaliczka fundusz remontowy”) oraz stałe zdanie (np. „Zmianie uległa zaliczka na fundusz remontowy w kwocie:”).',
            then: 'Jeszcze w okienku widzisz podgląd: jaką wstawkę dostaniesz do szablonu i jak zdanie zabrzmi w treści. Klikasz „Dodaj” i pole ląduje na liście.',
          },
          {
            do: 'Przejdź na „Szablony”, kliknij „+ Nowy szablon” i nadaj mu nazwę.',
            then: 'Pojawi się formularz z tytułem, edytorem treści i przełącznikiem PDF.',
          },
          {
            do: 'Ustaw kursor w miejscu, gdzie ma trafić pole. W treści rozwiń „Wstaw pole…” na pasku edytora (po prawej, obok przycisków formatowania), w tytule — listę pod polem tytułu. Wpisz kilka liter i kliknij pole.',
            then: 'Wstawka pojawi się dokładnie tam, gdzie stał kursor — nie na końcu tekstu — w podwójnych nawiasach, np. {{Adres Wspólnoty}}; przy wysyłce zamieni się na właściwy tekst. Lista pokazuje pod nazwą pola jego stałe zdanie, więc widzisz, co dokładnie wstawiasz.',
          },
          {
            do: 'Ustaw „Domyślnie dołącz PDF” i kliknij „Zapisz”.',
            then: 'Szablon pojawi się na liście; przy wysyłce przełącznik PDF startuje z tej wartości, ale można go zmienić.',
          },
        ],
        expect: [
          'Szablon możesz zduplikować („Duplikuj”) i zmienić w kopii tylko to, co się różni.',
          'Jeśli w szablonie zostanie wstawka do pola, którego nie ma w słowniku, aplikacja wypisze ją na czerwono — i wyśle dosłownie, żeby błąd nie przeszedł niezauważony.',
          'Formatowanie z edytora wygląda tak samo w mailu i w PDF — to ta sama treść, składana raz.',
        ],
        note: {
          type: 'tip',
          text: 'Wklejając tekst z Worda edytor zachowa same słowa, bez wordowego formatowania. To celowe: dzięki temu mail i PDF nie rozjeżdżają się wizualnie.',
        },
      },
      {
        id: 'mailing-edytor',
        kind: 'new',
        icon: 'table',
        title: 'Edytor treści: wyrównanie, tabele i czyszczenie formatowania',
        summary:
          'W edytorze szablonu doszły cztery przyciski wyrównania i wstawianie tabel o wybranym rozmiarze. Przycisk „Usuń formatowanie” działa teraz też bez zaznaczenia — czyści całą treść.',
        details: [
          'Tabela wygląda tak samo w edytorze, w podglądzie, w mailu i w PDF — obramowanie i marginesy komórek są wpisane w samą tabelę, więc nie gubią się w Outlooku.',
          'Wcześniej „Usuń formatowanie” przy zwykłym kursorze nie robiło nic (przeglądarka wymaga zaznaczonego tekstu) i nie ruszało nagłówków ani list. Teraz bez zaznaczenia czyści całą treść, a z zaznaczeniem tylko zaznaczony fragment — razem z nagłówkami, listami i wyrównaniem.',
        ],
        where: ['Mailing', 'Szablony', 'Treść wiadomości'],
        steps: [
          {
            do: 'Otwórz szablon („Edytuj”) i ustaw kursor w akapicie, który ma być inaczej wyrównany. Kliknij jeden z czterech przycisków wyrównania na pasku edytora.',
            then: 'Akapit przeskakuje do lewej, na środek, do prawej albo justuje się na całą szerokość.',
          },
          {
            do: 'Kliknij ikonę tabeli, ustaw liczbę wierszy i kolumn, opcjonalnie zaznacz „Pierwszy wiersz jako nagłówek” i kliknij „Wstaw tabelę”.',
            then: 'Tabela pojawi się w miejscu kursora, a pod nią zostanie puste miejsce do dalszego pisania.',
          },
          {
            do: 'Kliknij w komórkę tabeli.',
            then: 'Pod paskiem narzędzi pokaże się drugi rząd przycisków: „+ wiersz”, „− wiersz”, „+ kolumna”, „− kolumna”, „Usuń tabelę”. Działają na wierszu i kolumnie, w której stoi kursor.',
          },
          {
            do: 'Zaznacz fragment i kliknij „×” („Usuń formatowanie”), żeby wyczyścić tylko go — albo nic nie zaznaczaj i kliknij, żeby wyczyścić całą treść.',
            then: 'Znika pogrubienie, kursywa, nagłówki, listy i wyrównanie; tabele zostają (tracą tylko formatowanie tekstu w komórkach).',
          },
        ],
        expect: [
          'Usunięcie ostatniego wiersza albo ostatniej kolumny usuwa całą tabelę — nie zostaje po niej pusta ramka.',
          'Podgląd na ekranie wysyłki pokazuje tabelę dokładnie tak, jak trafi do maila i do PDF-a.',
        ],
        note: {
          type: 'tip',
          text: 'Tabelę wstawiaj tam, gdzie mail wymienia kilka pozycji z kwotami — czyta się ją lepiej niż listę punktowaną, a w PDF-ie wygląda jak w piśmie.',
        },
      },
      {
        id: 'adresy-zakladki',
        kind: 'improved',
        icon: 'map-pin',
        title: 'Adresy w trzech zakładkach',
        summary:
          'Konfiguracja typów kont i jednostek ZGN nie chowa się już pod ikonkami w prawym górnym rogu — to zwykłe zakładki u góry widoku, jak w Mailingu.',
        details: [
          'Obie konfiguracje były dotąd okienkami otwieranymi z ikon (koło zębate i budynek). Ikona nie mówi, co jest w środku, a okienko zasłaniało listę adresów, do której trzeba było wracać.',
        ],
        where: ['Adresy'],
        steps: [
          {
            do: 'Wejdź w „Adresy”.',
            then: 'U góry są trzy zakładki: „Adresy wspólnot” (lista, jak dotąd), „Typy kont wspólnoty” i „Jednostki ZGN”.',
          },
          {
            do: 'Kliknij „Typy kont wspólnoty”.',
            then: 'Ta sama lista typów co wcześniej w okienku, z importem, eksportem i dodawaniem — tylko na całej szerokości ekranu.',
          },
        ],
        expect: [
          'Nic nie trzeba przenosić ani ustawiać od nowa — to te same dane, tylko w innym miejscu.',
          'Dodawanie i edycja jednostek ZGN oraz pól dynamicznych odbywa się teraz w okienku — tak samo jak przy typach kont, więc formularz nie miesza się z listą pod nim.',
          'Formularz adresu nadal ma przycisk „Zarządzaj jednostkami”, który otwiera jednostki w okienku — dzięki temu nie tracisz w połowie wypełnionego adresu.',
        ],
      },
      {
        id: 'mailing-historia',
        kind: 'new',
        icon: 'history',
        title: 'Historia wysyłek z pełnymi szczegółami',
        summary:
          'Osobny wpis dla każdej wspólnoty: data, adresat, tytuł, cała treść, wpisane kwoty i klikalne załączniki. Plus przycisk do czyszczenia plików, gdy zajmą za dużo.',
        where: ['Mailing', 'Historia'],
        steps: [
          {
            do: 'Wejdź w zakładkę „Historia” i wyszukaj wpis (szukanie obejmuje wspólnoty, adresatów, tytuły i treść).',
          },
          {
            do: 'Kliknij „Szczegóły” przy wpisie.',
            then: 'Zobaczysz treść dokładnie w tej formie, w jakiej poszła, tabelę wpisanych kwot i listę załączników — kliknięcie w nazwę otwiera plik.',
          },
          {
            do: 'Jeśli chcesz odzyskać miejsce, kliknij „Wyczyść pliki” (przycisk pokazuje liczbę plików i ich rozmiar).',
            then: 'Znikają PDF-y i kopie załączników; wpisy historii z treścią i kwotami zostają.',
          },
        ],
        expect: [
          'Pliki modułu leżą w podfolderze „mailing” Twojego folderu wyjściowego, w katalogach po dacie wysyłki.',
          'Historia jest wspólna dla wszystkich komputerów (tak jak adresy i kontrahenci) i wchodzi do kopii zapasowych.',
          'Po wyczyszczeniu plików kliknięcie w załącznik powie, że pliku już nie ma — treść pisma nadal przeczytasz w szczegółach.',
        ],
      },
      {
        id: 'mailing-skrzynka',
        kind: 'new',
        icon: 'settings',
        title: 'Skrzynka do wysyłki w Ustawieniach',
        summary:
          'Konfiguracja SMTP z gotowymi ustawieniami home.pl, przycisk „Testuj połączenie” i opcja kopii do siebie (BCC).',
        details: [
          'Dane skrzynki zostają wyłącznie na tym komputerze. Nie trafiają do wspólnej bazy ani do kopii zapasowych, więc hasło nie wyjeżdża nigdzie razem z backupem — każdy komputer konfiguruje skrzynkę osobno.',
        ],
        where: ['Ustawienia', 'Skrzynka do wysyłki'],
        steps: [
          {
            do: 'Wejdź w „Ustawienia” i znajdź kartę „Skrzynka do wysyłki” (ikona koperty).',
            then: 'Serwer i port są już wypełnione dla home.pl: poczta.home.pl, port 465, połączenie szyfrowane.',
          },
          {
            do: 'Wpisz swój adres e-mail i hasło do skrzynki, opcjonalnie nazwę nadawcy.',
          },
          {
            do: 'Kliknij „Testuj połączenie”.',
            then: 'Aplikacja zapisuje dane i próbuje zalogować się do skrzynki — dostaniesz zielone potwierdzenie albo dokładny komunikat błędu z serwera.',
          },
        ],
        expect: [
          'Hasło raz zapisane nie jest już nigdzie pokazywane; pole pozostaje puste, a pod nim widnieje „Hasło jest zapisane”. Wpisujesz je ponownie tylko wtedy, gdy chcesz je zmienić.',
          'Wysyłka przez SMTP nie zostawia kopii w folderze „Wysłane” Twojej skrzynki — włącz „Wysyłaj kopię do siebie (BCC)”, jeśli chcesz mieć ślad w skrzynce.',
        ],
        note: {
          type: 'warning',
          text: 'W home.pl hasłem do SMTP jest hasło konta pocztowego (to samo, którym logujesz się do poczty), a nie hasło do panelu klienta.',
        },
      },
      {
        id: 'odczyty-licznikow',
        kind: 'new',
        icon: 'zap',
        title: 'Odczyty liczników — nowa pozycja w menu',
        summary:
          'Wrzucasz pliki Excel od dostawcy (PIASKAN, TECHEM, METRONA, ISTA), a aplikacja robi z nich pliki TXT do IMPEX — osobny plik na każdą wspólnotę.',
        details: [
          'Do tej pory odczyty przepisywało się ręcznie. Teraz aplikacja sama rozpoznaje, od którego dostawcy jest plik, wyciąga z niego numery urządzeń, wspólnoty i daty odczytów, i układa je w formacie, który przyjmuje IMPEX.',
          'Każdy plik od dostawcy potrafi zawierać kilka wspólnot naraz — konwersja rozbija je na osobne pliki wyjściowe, więc nic nie trzeba dzielić ręcznie.',
        ],
        where: ['Menu boczne', 'Odczyty liczników'],
        steps: [
          {
            do: 'Kliknij „Odczyty liczników” w menu po lewej (ikona błyskawicy).',
            then: 'Otworzy się ekran z polem na pliki i tabelą rozpoznanych plików.',
          },
          {
            do: 'Przeciągnij pliki .xlsx / .xls od dostawcy na pole albo kliknij je, żeby wybrać z dysku.',
            then: 'Przy każdym pliku pojawi się napis „rozpoznawanie…”, a po chwili: nazwa dostawcy, lista wspólnot, data odczytu i liczba odczytów.',
          },
          {
            do: 'Sprawdź kolumnę „Pominięte wiersze bez odczytu” i — jeśli coś tam jest — kliknij „Zobacz szczegóły”.',
            then: 'Zobaczysz tabelę z numerem wiersza i nazwą arkusza dokładnie takimi, jak w Excelu, oraz powodem pominięcia (pusta komórka, brak numeru urządzenia, brak wspólnoty, brak daty).',
          },
          {
            do: 'Kliknij „Konwertuj”, żeby przetworzyć wszystkie pliki naraz (albo ikonę przy jednym wierszu, żeby zrobić tylko ten plik).',
            then: 'Pliki TXT trafiają do folderu IMPEX, a na dole pojawia się lista wygenerowanych plików z podziałem na wspólnoty.',
          },
        ],
        expect: [
          'Nazwa pliku wyjściowego zawiera wspólnotę i datę odczytu — po jednym pliku na wspólnotę.',
          'Wiersz bez odczytu nie blokuje konwersji: trafia na listę pominiętych, resztę i tak przetworzymy.',
          'Jeżeli urządzenie ma pustą komórkę w danym miesiącu, pokażemy ostatni niepusty odczyt tego urządzenia — łatwiej ocenić, czy to błąd, czy licznik faktycznie nie był odczytany.',
          'Każda konwersja zapisuje się w zakładce „Historia” tego modułu (z wyszukiwarką) i wchodzi do kopii zapasowych razem z resztą danych.',
        ],
        note: {
          type: 'warning',
          text: 'Konwersja zapisuje do folderu IMPEX. Jeśli nie jest ustawiony, aplikacja o tym powie — ustawisz go w Ustawieniach albo wskażesz folder docelowy przy samej konwersji.',
        },
      },
      {
        id: 'nazwy-alternatywne',
        kind: 'new',
        icon: 'edit',
        title: 'Naucz kontrahenta pisowni z wyciągu',
        summary:
          'W ekranie akceptacji, przy każdym wydatku jest przycisk „Dodaj nazwę alternatywną” — zapisuje pisownię z wyciągu przy kontrahencie, więc kolejny miesiąc dopasuje się sam, bez pytania AI.',
        details: [
          'Banki potrafią rozjechać nazwę firmy: dodatkowe spacje w środku wyrazu, ucięty człon, inna kolejność. Dla dopasowania po nazwie to za każdym razem „nowy” kontrahent — i za każdym razem trafiał do AI albo do ręcznej decyzji.',
          'Zapisana nazwa alternatywna trafia na stałe do kartoteki kontrahenta, więc działa we wszystkich przyszłych konwersjach, nie tylko w tym pliku.',
        ],
        where: ['Konwerter', 'Akceptacja transakcji', 'karta wydatku', 'Dodaj nazwę alternatywną'],
        steps: [
          {
            do: 'Na ekranie akceptacji znajdź wydatek, którego nie rozpoznano, i przypisz mu kontrahenta ręcznie.',
            then: 'Transakcja dostaje kontrahenta na potrzeby tej konwersji.',
          },
          {
            do: 'Kliknij „Dodaj nazwę alternatywną” (niebieski przycisk z ikoną ołówka).',
            then: 'Rozwinie się formularz z już wybranym kontrahentem i wklejoną nazwą dokładnie w takiej postaci, jak widnieje na wyciągu.',
          },
          {
            do: 'Zostaw tekst bez poprawiania (łącznie z dziwnymi spacjami) i kliknij „Zapisz nazwę”.',
            then: 'Pojawi się potwierdzenie „Nazwa alternatywna zapisana — kolejne wyciągi dopasują się automatycznie”.',
          },
        ],
        expect: [
          'Przy następnej konwersji ta sama transakcja dopasuje się od razu, bez kosztu AI i bez ręcznej decyzji.',
          'Nazwy alternatywne widać i można je edytować w kartotece: menu „Kontrahenci” → wybrany kontrahent.',
          'Jeżeli kontrahent ma już taką nazwę, aplikacja powie „Ten kontrahent ma już taką nazwę” i nie zrobi duplikatu.',
        ],
        note: {
          type: 'tip',
          text: 'Nie „ładź” tekstu przed zapisem. Dopasowanie porównuje to, co przysyła bank — im wierniej przepisana pisownia, tym pewniejsze trafienie.',
        },
      },
      {
        id: 'dopasuj-ponownie',
        kind: 'new',
        icon: 'refresh',
        title: 'Przycisk „Dopasuj ponownie” w akceptacji',
        summary:
          'Dodałeś w trakcie przeglądania nowego kontrahenta? Jeden klik i AI przelicza wydatki bez kontrahenta jeszcze raz — już z jego uwzględnieniem.',
        details: [
          'Wcześniej, żeby uwzględnić kontrahenta dodanego w trakcie akceptacji, trzeba było przerwać przegląd i przekonwertować plik od nowa.',
        ],
        where: ['Konwerter', 'Akceptacja transakcji', 'Dopasuj ponownie'],
        steps: [
          {
            do: 'Dodaj brakującego kontrahenta (menu „Kontrahenci”) i wróć do ekranu akceptacji.',
          },
          {
            do: 'Kliknij „Dopasuj ponownie” u góry listy transakcji.',
            then: 'Pojawi się pasek postępu „AI dopasowuje kontrahentów — transakcji…”.',
          },
        ],
        expect: [
          'Przeliczane są tylko wydatki bez kontrahenta, których jeszcze nie ruszałeś — Twoje ręczne decyzje zostają nietknięte.',
          'Po zakończeniu zobaczysz, ile transakcji AI dopasowało; jeśli nie ma czego liczyć, aplikacja powie o tym zamiast wysyłać zapytanie.',
        ],
      },
      {
        id: 'zakladki-modulow',
        kind: 'improved',
        icon: 'history',
        title: 'Historia przeniesiona do zakładek modułu',
        summary:
          'Historia nie jest już osobną pozycją w menu — siedzi jako zakładka wewnątrz modułu, którego dotyczy: „Konwersja | Historia”.',
        details: [
          'Odczyty liczników mają własną historię operacji, więc jedna wspólna pozycja w menu przestała się bronić. Każdy moduł pokazuje teraz tylko swoje wpisy.',
        ],
        where: ['Konwerter', 'zakładka Historia'],
        steps: [
          {
            do: 'Wejdź w „Konwerter” i przełącz się na zakładkę „Historia” u góry ekranu.',
            then: 'Zobaczysz historię konwersji wyciągów — tę samą oś czasu co wcześniej, pogrupowaną po dniach i bankach.',
          },
          {
            do: 'W „Odczytach liczników” zrób to samo — tam zakładka „Historia” pokazuje historię konwersji odczytów.',
            then: 'Widać dostawcę, wspólnoty, pliki źródłowe i folder, do którego trafiły pliki wyjściowe; jest też wyszukiwarka.',
          },
        ],
        expect: [
          'Każdy moduł pamięta, na której zakładce byłeś — przełączenie się na inny moduł i powrót wraca w to samo miejsce.',
          'Nic z historii nie zniknęło; zmieniło się tylko miejsce, z którego się ją otwiera.',
        ],
      },
      {
        id: 'ai-przelacznik',
        kind: 'improved',
        icon: 'bot',
        title: 'Przełącznik „Używaj AI przy konwersji”',
        summary:
          'W Ustawieniach można wyłączyć AI i konwertować całkowicie bez łączenia się z API — przydatne offline albo gdy chcesz zrobić przebieg za zero.',
        where: ['Ustawienia', 'Używaj AI przy konwersji'],
        expect: [
          'Domyślnie włączone. AI i tak dostaje wyłącznie te transakcje, których nie rozpoznały reguły, cache ani regex — czyli dokładnie te, które i tak trafiłyby do ręcznej akceptacji.',
          'Po wyłączeniu konwersja działa dalej, tylko nierozpoznane pozycje trafiają w całości do ekranu akceptacji.',
        ],
      },
      {
        id: 'co-nowego',
        kind: 'new',
        icon: 'sparkles',
        title: 'Ten ekran: „Co nowego”',
        summary:
          'Po każdej aktualizacji zobaczysz okno z opisem zmian — co doszło, gdzie to kliknąć i czego się spodziewać.',
        where: ['Menu boczne', 'Co nowego'],
        expect: [
          'Okno pokazuje się raz, po pierwszym uruchomieniu nowej wersji.',
          'W menu bocznym przy pozycji „Co nowego” świeci kropka, dopóki nie przeczytasz opisu bieżącej wersji.',
          'Wcześniejsze wersje są dostępne z listy po lewej stronie ekranu — nic nie znika.',
        ],
      },
      {
        id: 'pamiec-dopasowan',
        kind: 'improved',
        icon: 'coins',
        title: 'Aplikacja pamięta dopasowania AI',
        summary:
          'Raz dopasowany dostawca (np. comiesięczna faktura za wodę) przy kolejnym wyciągu rozpoznaje się z pamięci — bez wysyłania czegokolwiek do AI.',
        details: [
          'Pamięć trzyma tylko identyfikator kontrahenta i odświeża się przy każdym odczycie, więc zmiana nazwy albo usunięcie kontrahenta nie podstawi starych danych.',
          'Wpisy kasują się automatycznie po zmianie listy kontrahentów — nowo dodany kontrahent mógł być lepszym dopasowaniem.',
        ],
        expect: [
          'Efekt widać przy drugim i kolejnym wyciągu od tego samego banku: mniej pozycji do akceptacji i krótsza konwersja.',
          'Niedopasowania nie są zapamiętywane — pozycja bez kontrahenta zawsze dostaje kolejną szansę.',
        ],
      },
      {
        id: 'koszt-zapytania',
        kind: 'improved',
        icon: 'zap',
        title: 'Lista kontrahentów wysyłana raz na zapytanie',
        summary:
          'Wcześniej pełna lista kontrahentów powtarzała się w zapytaniu przy każdej nierozpoznanej transakcji. Teraz idzie raz i jest cache’owana po stronie API.',
        expect: [
          'Na zmierzonej, prawdziwej konwersji koszt jednego zapytania spadł z $0,093 do $0,010.',
          'Jakość dopasowań została bez zmian — typowa ścieżka z 10 kandydatami wygląda dokładnie tak jak wcześniej.',
        ],
      },
    ],
  },
  {
    version: '5.5.0',
    date: '2026-07-29',
    title: 'Kopie poza komputerem i klucz AI poza instalatorem',
    tagline:
      'Kopie zapasowe lądują dodatkowo w prywatnym repozytorium, a klucz do AI nie jest już zaszyty w pliku instalacyjnym.',
    highlights: [
      {
        id: 'kopie-offsite',
        kind: 'new',
        icon: 'shield',
        title: 'Kopie zapasowe wysyłane poza komputer',
        summary:
          'Automatyczna kopia, oprócz zapisu lokalnego, trafia do prywatnego repozytorium — w osobnym folderze dla każdego komputera.',
        expect: [
          'Po zamknięciu aplikacji komunikat o kopii mówi też, czy wysyłka poza komputer się powiodła.',
          'Awaria dysku nie oznacza utraty danych — kopię można odtworzyć z repozytorium.',
        ],
      },
      {
        id: 'klucz-z-chmury',
        kind: 'improved',
        icon: 'shield',
        title: 'Klucz do AI pobierany w trakcie działania',
        summary:
          'Aplikacja czyta klucz z bazy w chmurze przy starcie, zamiast mieć go wbudowanego w instalator.',
        expect: [
          'Dla użytkownika bez zmian — poza tym, że publicznie dostępny plik instalacyjny nie zawiera już żadnego klucza.',
        ],
      },
    ],
  },
  {
    version: '5.4.0',
    date: '2026-07-29',
    title: 'Pełna kopia danych i automatyczne migawki',
    tagline:
      'Wszystkie dane w jednym pliku JSON, kopia robiona sama przy zamykaniu aplikacji, a eksporty kartotek wreszcie kompletne.',
    stats: [
      { value: '14', label: 'dziennych kopii w zapasie' },
      { value: '6', label: 'zestawów danych w kopii' },
    ],
    highlights: [
      {
        id: 'kopia-pelna',
        kind: 'new',
        icon: 'save',
        title: 'Kopia i odtworzenie całej bazy',
        summary:
          'Jeden plik JSON z bankami, kontrahentami, adresami, typami kont, historią i ustawieniami — z odtworzeniem z powrotem do aplikacji.',
        where: ['Ustawienia', 'Kopia zapasowa'],
        steps: [
          { do: 'Wejdź w Ustawienia i znajdź sekcję kopii zapasowej.' },
          {
            do: 'Kliknij eksport, żeby zapisać plik, albo odtworzenie, żeby wgrać wcześniejszy.',
            then: 'Przed odtworzeniem aplikacja robi kopię bezpieczeństwa obecnego stanu i prosi o dodatkowe potwierdzenie.',
          },
        ],
        note: {
          type: 'warning',
          text: 'Wszyscy użytkownicy pracują na jednej wspólnej bazie w chmurze — odtworzenie kopii zmienia dane także innym osobom. Dlatego aplikacja pyta o potwierdzenie dwa razy.',
        },
      },
      {
        id: 'kopia-automatyczna',
        kind: 'new',
        icon: 'refresh',
        title: 'Kopia robi się sama',
        summary:
          'Świeża kopia powstaje przy każdym zamknięciu aplikacji, a start uzupełnia ją, gdyby poprzednim razem coś przerwało pracę.',
        expect: [
          'Trzymane jest 14 dziennych plików — starsze kasują się same.',
          'Przy zamykaniu okno chwilę czeka, aż kopia się zapisze; komunikat mówi, czy się udało.',
        ],
      },
      {
        id: 'eksporty-kartotek',
        kind: 'improved',
        icon: 'clipboard',
        title: 'Kompletne eksporty kartotek',
        summary:
          'Eksport adresów zawiera przypisania mieszkań i typy kont, eksport kontrahentów — wszystkie nazwy alternatywne i typ.',
        expect: [
          'Import banków nie tworzy już duplikatów: dopasowuje po nazwie i aktualizuje istniejący wpis.',
          'Import adresów nie przerywa się na jednym błędnym wierszu — zbiera błędy i pokazuje je na koniec.',
        ],
      },
    ],
  },
  {
    version: '5.2.0',
    date: '2026-07-03',
    title: 'Historia pogrupowana po dniach i bankach',
    tagline:
      'Zamiast płaskiej tabeli — oś czasu zwijana po dniach, a w Konwerterze podgląd ostatnich 30 dni.',
    highlights: [
      {
        id: 'os-czasu-historii',
        kind: 'improved',
        icon: 'history',
        title: 'Oś czasu zamiast tabeli',
        summary:
          'Historia konwersji grupuje się w sekcje dzienne, a w środku każdej — podsekcje po bankach.',
        where: ['Menu boczne', 'Historia'],
        steps: [
          { do: 'Kliknij dzień, żeby go rozwinąć.', then: 'Pokażą się banki z tego dnia.' },
          {
            do: 'Użyj przełącznika przy dniu, żeby rozwinąć albo zwinąć wszystkie banki naraz.',
          },
        ],
        expect: ['Domyślnie wszystko jest zwinięte, żeby długa historia nie zalewała ekranu.'],
      },
      {
        id: 'ostatnia-aktywnosc',
        kind: 'new',
        icon: 'folder',
        title: 'Ostatnia aktywność w Konwerterze',
        summary:
          'Pod listą plików widać konwersje z ostatnich 30 dni — z odnośnikiem do pełnej historii.',
        where: ['Konwerter', 'panel na dole ekranu'],
        expect: ['Panel odświeża się na bieżąco, w miarę jak pliki kończą konwersję.'],
      },
    ],
  },
];

export const LATEST_RELEASE: Release | undefined = RELEASES[0];

/** Numeric comparison of dotted versions: -1 / 0 / 1. Missing parts read as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function findRelease(version: string): Release | undefined {
  return RELEASES.find((r) => r.version === version);
}

/**
 * The release to greet the user with for a given running app version: its own
 * entry, or — if this build has no entry yet — the newest one that isn't from
 * the future. Returns undefined when the running build predates every entry.
 */
export function releaseForVersion(appVersion: string): Release | undefined {
  return (
    findRelease(appVersion) ??
    RELEASES.find((r) => compareVersions(r.version, appVersion) <= 0)
  );
}

/**
 * Should the "what's new" modal open? Yes when the release notes we would show
 * are newer than what this machine has already acknowledged. A machine that has
 * never acknowledged anything (empty string) counts as "show it" — a first-time
 * user benefits the most from the walkthrough.
 */
export function shouldShowWhatsNew(appVersion: string, lastSeenVersion: string): boolean {
  const release = releaseForVersion(appVersion);
  if (!release) return false;
  if (!lastSeenVersion) return true;
  return compareVersions(release.version, lastSeenVersion) > 0;
}
