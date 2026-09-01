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
