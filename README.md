# Statement Converter

A desktop application for converting bank statements from various formats to a unified format for accounting software used by housing communities.

**Developers**: Wikunia & Pura

## Features

- **Multi-format Support**: Handles XML, MT940, CSV, Excel, and custom text formats
- **Bank Management**: Configure multiple banks and assign them to appropriate converters
- **Drag & Drop**: Easy file upload via drag and drop or file selection
- **Batch Processing**: Convert multiple files at once
- **Duplicate Detection**: Automatically detects duplicate files in the list
- **Conversion History**: Track all conversions with detailed history and pagination (100 entries per page)
- **Dark Mode**: Switch between light and dark themes
- **Multilingual**: Polish and English language support
- **Settings Export/Import**: Backup and restore your configuration
- **Auto-Update**: Automatic updates via GitHub Releases
- **Cross-platform**: Works on Windows and macOS

## Installation

### For End Users

Download the latest version from [GitHub Releases](https://github.com/wikunia-pura/statement_converter/releases):

#### Windows
1. Download `FileFunky-Setup-X.X.X.exe`
2. Run the installer
3. The application will auto-update when new versions are available

#### macOS
1. Download the appropriate ZIP file:
   - Apple Silicon (M1/M2/M3): `FileFunky-X.X.X-arm64.zip`
   - Intel Mac: `FileFunky-X.X.X-x64.zip`
2. Unzip the file (double-click)
3. Drag FileFunky to Applications folder
4. **First run**: Right-click → Open → Confirm
   - See [macOS Installation Guide](docs/MACOS_INSTALLATION.md) for details
   - Only needed once, then works normally

### For Developers

1. Install dependencies:
```bash
npm install
```

2. Run the application in development mode:
```bash
npm run dev
```

### Building for Production

#### Windows
```bash
npm run build
npm run package:win
```

#### macOS
```bash
npm run build
npm run package:mac
```

The packaged application will be available in the `release/` directory.

## Usage

### 1. Configure Settings

- Go to **Settings** view
- **Appearance**: Toggle dark mode and select language (Polish/English)
- **Output Folder**: Set where converted files will be saved
- **Banks**: Add banks and assign them to converters
- **Export/Import**: Backup or restore your settings
- **Available Converters**: View all configured converter types

### 2. Convert Files

- Go to **Converter** view
- Select a bank from the dropdown
- Drag & drop files or click to select them
- Files appear in the table
- Click **Convert** for individual files or **Convert All** for batch processing
- Successfully converted files can be opened directly from the table

### 3. View History

- Go to **History** view
- See all past conversions with timestamps, status, and error messages
- Browse through history with pagination (100 entries per page)
- Open successfully converted files directly
- Clear entire history if needed

## Configuration

### Adding Converters

Edit `config/converters.yml` to add new converter types:

```yaml
converters:
  - id: my_converter
    name: My Converter
    description: Description of the converter
```

### Accepted File Formats

The application accepts the following bank statement formats:
- `.xml` - XML statements
- `.txt` - Text-based formats
- `.940`, `.mt940` - MT940 format
- `.csv` - CSV files
- `.xlsx`, `.xls` - Excel spreadsheets

## Architecture

- **Electron**: Main process and window management
- **React**: User interface with modern component architecture
- **TypeScript**: Type-safe development across the entire codebase
- **Electron Store**: Persistent local storage for configuration and history
- **Vite**: Fast development server and optimized production builds
- **YAML**: Converter configuration files

## Project Structure

```
statement_converter/
├── config/              # Configuration files
│   └── converters.yml   # Converter definitions
├── resources/           # Application icons
│   ├── icon.icns       # macOS icon
│   └── icon.ico        # Windows icon
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts
│   │   ├── database.ts
│   │   ├── converterRegistry.ts
│   │   └── preload.ts
│   ├── renderer/       # React UI
│   │   ├── views/      # Main application views
│   │   ├── components/ # Reusable components
│   │   ├── assets/     # Images and static files
│   │   ├── App.tsx
│   │   └── translations.ts
│   └── shared/         # Shared types and utilities
│       ├── types.ts
│       └── utils.ts
└── package.json
```

## Development Notes

- The application uses **electron-store** for persistent data storage
- Converter implementations are modular and can be extended via `converterRegistry.ts`
- Currently generates mock output ("wikunia i pura") for testing - real converters need to be implemented
- UI supports responsive design with dark mode
- All user-facing text is internationalized (i18n) via `translations.ts`
- File icons are automatically generated from the logo with rounded corners

## Documentation

- 🏗️ [Architecture Guide](ARCHITECTURE.md) - Detailed architecture overview
- 📊 [Optimization Report](OPTIMIZATION_REPORT.md) - Lista zrealizowanych optymalizacji i propozycje dalszych ulepszeń
- 🤝 [Contributing Guide](CONTRIBUTING.md) - Jak rozwijać aplikację i zgłaszać zmiany
- 🧪 [Test Data](test-data/README.md) - Przykładowe dane testowe dla konwerterów
- 🔄 [Auto-Update Guide](docs/AUTO_UPDATE.md) - How to release updates via GitHub

## Requirements

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Operating System**: 
  - macOS 10.12+ (Sierra or later)
  - Windows 10 or later

## Scripts

```bash
# Development
npm run dev              # Start development mode
npm run build            # Build for production

# Code Quality
npm run lint             # Check for linting errors
npm run lint:fix         # Fix linting errors automatically
npm run format           # Format code with Prettier
npm run type-check       # TypeScript type checking

# Packaging
npm run package:win      # Build Windows installer
npm run package:mac      # Build macOS .dmg
```

## Building with GitHub Actions

The application uses GitHub Actions for automated building and releasing:

### Quick Start

1. **Add API Key to GitHub Secrets**:
   - Go to your repository → Settings → Secrets and variables → Actions
   - Add secret: `ANTHROPIC_API_KEY` with your API key

2. **Create a Release**:
   ```bash
   git tag v2.0.4
   git push origin v2.0.4
   ```

3. **Download artifacts** from the Actions tab or from the GitHub Release

📚 **Full Guide**: See [GitHub Actions Setup](docs/GITHUB_ACTIONS_SETUP.md) for detailed instructions

### What Gets Built

- **macOS**: `.dmg` installer with auto-update support
- **Windows**: `.exe` installer with auto-update support
- **Artifacts**: Automatically uploaded to GitHub Releases

The AI configuration is automatically injected during the build process from GitHub Secrets, so end users don't need to configure anything.

## License

Wikunia & Pura
