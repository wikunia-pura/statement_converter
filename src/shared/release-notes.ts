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
