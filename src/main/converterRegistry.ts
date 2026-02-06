import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Converter } from '../shared/types';

class ConverterRegistry {
  private converters: Map<string, Converter> = new Map();

  constructor() {
    this.loadConverters();
  }

  private loadConverters() {
    try {
      // Go up from dist/main/main to reach config/
      const configPath = path.join(__dirname, '../../../config/converters.yml');
      const fileContents = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContents) as { converters: Converter[] };

      config.converters.forEach((converter) => {
        this.converters.set(converter.id, converter);
      });
    } catch (error) {
      console.error('Error loading converters config:', error);
    }
  }

  getAllConverters(): Converter[] {
    return Array.from(this.converters.values());
  }

  getConverter(id: string): Converter | undefined {
    return this.converters.get(id);
  }

  // Mock conversion - will be replaced with actual converters later
  async convert(
    converterId: string,
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Mock conversion: write "wikunia i pura" to output file
        const content = 'wikunia i pura';
        fs.writeFileSync(outputPath, content, 'utf8');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
}

export default ConverterRegistry;
