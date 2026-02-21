## Changes in v1.0.32

### ✨ New Features
- Added accounting TXT export format (tab-separated) for bookkeeping software
- Unrecognized transactions are now listed at the beginning with reference numbers
- Enhanced summary view with full XML data display

### 🔧 Improvements  
- Added support for 'GOSP. NIERUCHOM' pattern → ZGN classification
- Fixed regex patterns for apartment recognition (M. 23, lokalu 17, etc.)
- Improved confidence scoring - reduced false AI warnings
- Added support for FRYDERYKA JOLIOT-CURIE street name variant
- Added support for addresses without 'M' prefix (e.g., '3  19')

### 🐛 Bug Fixes
- Fixed duplicate pattern bug that caused undefined apartment numbers
- Fixed date formatting in accounting export (D.MM.YYYY format)
- Fixed transaction counting mismatch between UI and exports

### 📄 Export Formats
- **Summary TXT**: Detailed human-readable transaction view
- **Accounting TXT**: Tab-separated format ready for import to accounting software
