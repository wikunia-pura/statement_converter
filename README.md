# FileFunky (statement_converter)

A desktop application for an office that manages housing communities: it turns Polish bank statements into
accounting files and handles the communities' taxes, meetings, mailing, calendar and team tasks.

**Developers**: Wikunia & Pura

## Features

- **Statement conversion** for 9 bank formats (MT940, Santander XML, CAMT XML, ELIXIR ZIP, EXP): apartment and contractor
  matching by rules, regex and optional AI, with a review screen before anything is booked
- **Księgowania / Pulpit**: the month's conversions per community, booking marks, priorities, notes, @mentions
- **Adresy, Kontrahenci, Banki**: the dictionaries the matching runs on
- **Mailing**: templates, recipients and SMTP sending with history
- **Kalendarz, Zadania, Zebrania**: meetings with document deadlines, tasks, meeting packages and resolutions
- **Sprawozdania, Plany gospodarcze**: statements imported from vDom PDFs, budget plans
- **Podatki**: DN-1, CIT-8 and PIT forms, e-Deklaracje submission, qualified signature with a Szafir card
- **Homebanking, Scalanie wpłat, Odczyty liczników, Noty świadczeń, Zaliczki**: file tools for the office
- Shared data in Supabase for the whole team, automatic backups, Polish and English UI, dark mode,
  auto-update from GitHub Releases, Windows and macOS (Apple Silicon)

## Installation

Download the latest version from [GitHub Releases](https://github.com/wikunia-pura/statement_converter/releases):

- **Windows**: `FileFunky-Setup-X.X.X.exe`, then run the installer.
- **macOS (Apple Silicon)**: the `.dmg` (or `.zip`); on first launch see the
  [macOS Installation Guide](docs/MACOS_INSTALLATION.md).

The app updates itself when a new release is published. Signing in needs an account in the team's Supabase
project.

## Development

Requirements: **Node.js 24** (`.nvmrc`; `engines` allows >= 22.12) and npm 11.

```bash
npm ci          # install exactly what package-lock.json pins
npm run dev     # main process (tsc --watch) + Vite dev server + Electron
```

The AI key is read at runtime from Supabase (`app_config`) after sign-in; a local `config/ai-config.yml`
(see `config/ai-config.example.yml`) overrides it for development. Never commit keys: the repository is public.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development mode |
| `npm run build` | Compile the main process and bundle the renderer into `dist/` |
| `npm run type-check` | TypeScript check of both the main and the renderer project |
| `npm test` | Unit tests (Vitest), `npm run test:watch` to keep them running |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run eval:lokal-cases` | Apartment-number regression cases (no statement files needed) |
| `npm run package:mac` / `package:win` | Build installers into `release/` (no publishing) |

## Project structure

```
config/            converter list (converters.yml), example AI and backup configs
docs/              auto-update, release, macOS install and troubleshooting guides
resources/         application icons
scripts/           evaluation and check harnesses (tsx)
src/
  main/            Electron main process: IPC, Supabase data layer, modules (podatki, podpis, zebrania, mailing …)
  renderer/        React UI: views/, components/, translations.ts
  shared/          pure logic shared by both processes (matching, accounts, taxes, calendar …)
  converters/      one folder per statement format, plus shared MT940/CAMT readers
supabase/          idempotent SQL migrations, run by hand in the Supabase SQL Editor
```

Unit tests live next to the code they test (`*.test.ts`) and use synthetic data only.

## Releasing

1. Bump the version in `package.json` and add the entry to `src/shared/release-notes.ts` ("Co nowego").
2. Run any new `supabase/*.sql` migration the release needs.
3. Make sure `npm run type-check`, `npm test` and `npm run lint` pass.
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. GitHub Actions builds macOS and Windows and
   publishes the GitHub Release; installed apps pick it up through auto-update.

No AI key is baked into the build. See [GitHub Actions Setup](docs/GITHUB_ACTIONS_SETUP.md) and the
[Auto-Update Guide](docs/AUTO_UPDATE.md).

## Documentation

- [Architecture](ARCHITECTURE.md) — processes, data, converters, modules, security model
- [Contributing](CONTRIBUTING.md)
- [Supabase setup](SUPABASE_SETUP.md)
- [Auto-Update](docs/AUTO_UPDATE.md) and [Troubleshooting updates](docs/TROUBLESHOOTING_UPDATES.md)
- [Converter design](docs/CONVERTER_DESIGN.md)

## License

Wikunia & Pura
