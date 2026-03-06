# Release Notes - Version 2.0.20

## 🎨 UI Improvements

### Bank Icon Update
- **Replaced emoji with custom bank icon**: Replaced the 🏦 emoji with a professional bank icon image
- **Large icon display**: Icon is now displayed at 240x240 pixels for better visibility
- **Dark mode support**: Icon adapts to dark mode with brightness adjustment
- **Asset optimization**: Added bank icon to renderer assets for consistent branding

## 📝 Technical Changes

- Added `bank.png` to `src/renderer/assets/`
- Updated Converter.tsx to import and display custom bank icon
- Icon uses `objectFit: 'contain'` to maintain aspect ratio
- Added conditional brightness filter for dark mode compatibility

## 📦 Assets

- New custom bank icon added to application assets
- Icon size: 2.2 MB (optimized for quality)

---
**Date**: 2026-03-06  
**Previous Version**: 2.0.19
