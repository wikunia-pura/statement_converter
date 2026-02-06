# Statement Converter

A desktop application for converting bank statements from various formats to a unified format for accounting software.

**Developers**: Wikunia & Pura

## Features

- **Multi-format Support**: Handles XML, MT940, CSV, Excel, and custom text formats
- **Bank Management**: Configure multiple banks and assign them to appropriate converters
- **Drag & Drop**: Easy file upload via drag and drop or file selection
- **Batch Processing**: Convert multiple files at once
- **Conversion History**: Track all conversions with detailed history
- **Cross-platform**: Works on Windows and macOS

## Installation

### Development

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
- Set the output folder where converted files will be saved
- Add banks and assign them to converters

### 2. Convert Files

- Go to **Converter** view
- Select a bank from the dropdown
- Drag & drop files or click to select them
- Files appear in the table
- Click **Convert** for individual files or **Convert All** for batch processing
- Successfully converted files can be opened directly from the table

### 3. View History

- Go to **History** view
- See all past conversions with timestamps
- Open successfully converted files
- Clear history if needed

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

Edit `config/accepted-formats.yml` to modify accepted file extensions:

```yaml
accepted_formats:
  - .xml
  - .txt
  - .csv
```

## Architecture

- **Electron**: Main process and window management
- **React**: User interface
- **TypeScript**: Type-safe development
- **SQLite**: Local database for banks and history
- **YAML**: Configuration files

## Project Structure

```
statement_converter/
├── config/              # Configuration files
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts
│   │   ├── database.ts
│   │   └── converterRegistry.ts
│   ├── renderer/       # React UI
│   │   ├── views/
│   │   └── App.tsx
│   └── shared/         # Shared types
└── package.json
```

## Development Notes

- The converter currently generates mock output ("wikunia i pura")
- Real converter implementations will be added later
- Each converter type needs to be implemented in the codebase

## Documentation

- 📊 [Optimization Report](OPTIMIZATION_REPORT.md) - Lista zrealizowanych optymalizacji i propozycje dalszych ulepszeń
- 🤝 [Contributing Guide](CONTRIBUTING.md) - Jak rozwijać aplikację i zgłaszać zmiany
- 🧪 [Test Data](test-data/README.md) - Przykładowe dane testowe dla konwerterów

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

## License

Wikunia & Pura
