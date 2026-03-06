# Release Notes - Version 2.0.19

## 🐛 Bug Fixes

### PKO SA Converter
- **Fixed critical bug**: Resolved "Cannot read properties of undefined (reading 'description')" error when converting PKO SA EXP files
- **Root cause**: Incorrect path to `rawData` - changed from `trn.rawData` to `trn.extracted.rawData` in converterRegistry.ts

### Converter Registry
- **Enhanced logging**: Added detailed converter loading logs showing which converters are successfully loaded at startup
- **Better error messages**: When a converter is not found, the error now shows:
  - Which converter ID was requested
  - The bank name having issues
  - List of all available converters
- **Improved validation**: Added checks to ensure converters config file exists and is valid

### Settings UI
- **Visual warnings**: Banks with invalid/missing converters now show:
  - Red background highlight on the row
  - Warning icon (⚠️) next to bank name
  - "(nie znaleziono)" text for missing converter
- **Better error handling**: Added null checks to prevent crashes when converter data is undefined

## 🔧 Technical Changes

- Added comprehensive logging in `converterRegistry.ts`:
  - Config file path verification
  - Converter loading confirmation
  - Success/failure messages
- Improved error handling in `main.ts` conversion handlers
- Added defensive programming in Settings.tsx converter list rendering

## 📝 Notes

This release focuses on stability improvements for the PKO SA converter and better diagnostics when converter configuration issues occur.

---
**Date**: 2026-03-06  
**Previous Version**: 2.0.18
