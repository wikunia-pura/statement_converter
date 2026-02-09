# Santander XML Converter - Setup Guide

## 🚀 Quick Start

### 1. Configure AI API Keys

The converter requires an AI API key to extract tenant information from transaction descriptions.

**Copy the example config:**
```bash
cp config/ai-config.example.yml config/ai-config.yml
```

**Edit `config/ai-config.yml` and add your API key:**

```yaml
ai:
  # Anthropic (Claude) - recommended, cheaper
  anthropic_api_key: "sk-ant-your-key-here"
  
  # OpenAI (GPT-4) - alternative
  openai_api_key: ""
  
  # Which provider to use
  default_provider: "anthropic"
```

**Getting API Keys:**
- **Anthropic Claude** (recommended): https://console.anthropic.com
  - Cost: ~$0.0018 per transaction
  - ~$4.50/month for 5000 transactions
  
- **OpenAI GPT-4**: https://platform.openai.com/api-keys
  - Cost: ~$0.004 per transaction
  - ~$10/month for 5000 transactions

### 2. Add Bank in Application

1. Launch the app: `npm run dev`
2. Go to **Settings** tab
3. Click **Add Bank**
4. Name: `Santander Joliot-Curie`
5. Converter: `Santander XML (Wyciąg bankowy)`
6. Click **Save**

### 3. Convert Your First File

1. Go to **Converter** tab
2. Select your bank from dropdown
3. Drag & drop XML file or click to select
4. Click **Convert**
5. Open the result file to see extracted data

## 📊 How It Works

### Hybrid Extraction (3-tier system)

1. **Regex Extraction** (free, instant)
   - Pattern matching for common formats
   - ~37% success rate on test data
   - High confidence (85%+)

2. **Cache** (free, instant)
   - Reuses previous results
   - 30-day expiration
   - Perfect for recurring transactions

3. **AI Extraction** (costs apply)
   - Only for remaining transactions
   - Claude 3.5 Sonnet or GPT-4 Turbo
   - Batch processing (20 transactions/request)

### Confidence Levels

- **≥85% - Auto-approved**: Ready to use
- **60-84% - Needs review**: Should be checked
- **<60% - Needs manual**: Requires manual entry

## 📁 File Structure

```
config/
  ai-config.yml          # Your API keys (gitignored)
  ai-config.example.yml  # Template
  converters.yml         # Available converters

src/converters/santander-xml/
  index.ts              # Main orchestrator
  parser.ts             # XML parser
  regex-extractor.ts    # Pattern matching
  ai-extractor.ts       # AI extraction
  cache.ts              # Caching system
  types.ts              # TypeScript interfaces

examples/
  quick-test.ts         # Test without AI
  santander-converter-example.ts  # Full example
  debug-regex.ts        # Debug patterns
```

## 🧪 Testing

**Test without AI (free):**
```bash
npx ts-node examples/quick-test.ts
```

**Test with AI:**
```bash
npx ts-node examples/santander-converter-example.ts
```

## 💰 Cost Optimization

The converter is designed to minimize costs:

1. **Regex first**: ~37% extracted for free
2. **Caching**: Recurring transactions cached
3. **Batch processing**: 20 transactions per API call
4. **Smart filtering**: Skips expenses, bank fees

**Expected costs for 5000 transactions/month:**
- With Claude: ~$4.50/month
- With OpenAI: ~$10/month

## 🔒 Security

- API keys stored in `config/ai-config.yml` (gitignored)
- Never committed to repository
- Only accessible from backend
- Not exposed to UI

## 📖 Documentation

- [src/converters/santander-xml/README.md](src/converters/santander-xml/README.md) - Technical details
- [docs/CONVERTER_DESIGN.md](docs/CONVERTER_DESIGN.md) - Architecture and design decisions

## ⚠️ Important Notes

1. **First run**: No cache = higher costs
2. **Subsequent runs**: ~60-70% cached = lower costs
3. **Always verify**: Check transactions with <85% confidence
4. **Monthly costs**: Predictable based on transaction volume
