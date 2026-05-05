#!/bin/bash
# FileFunky — skrypt odblokowujący aplikację po przeciągnięciu do /Applications.
# macOS oznacza pobrane pliki atrybutem "com.apple.quarantine", przez co niepodpisana
# (przez Apple) aplikacja nie chce się uruchomić. Ten skrypt usuwa ten atrybut.
#
# Użycie: po skopiowaniu FileFunky do /Applications kliknij ten plik dwukrotnie.
# Jeśli macOS zablokuje uruchomienie skryptu — kliknij prawym, "Otwórz" → Otwórz.

set -e

APP_PATHS=(
  "/Applications/FileFunky.app"
  "$HOME/Applications/FileFunky.app"
)

FOUND=""
for p in "${APP_PATHS[@]}"; do
  if [ -d "$p" ]; then
    FOUND="$p"
    break
  fi
done

if [ -z "$FOUND" ]; then
  echo ""
  echo "❌ Nie znaleziono FileFunky.app w /Applications ani ~/Applications."
  echo "   Najpierw przeciągnij FileFunky do folderu Aplikacje, potem uruchom ten skrypt."
  echo ""
  read -n 1 -s -r -p "Naciśnij dowolny klawisz, aby zamknąć..."
  exit 1
fi

echo ""
echo "Odblokowuję: $FOUND"
xattr -cr "$FOUND"
echo ""
echo "✅ Gotowe. Możesz teraz uruchomić FileFunky."
echo ""
read -n 1 -s -r -p "Naciśnij dowolny klawisz, aby zamknąć..."
