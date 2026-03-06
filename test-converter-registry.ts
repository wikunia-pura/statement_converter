/**
 * Test converter registry - sprawdza czy konwertery są prawidłowo załadowane
 */

import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

// Wczytaj converters.yml
const configPath = path.join(__dirname, 'config', 'converters.yml');

console.log('=== Test ConverterRegistry ===\n');
console.log('Config path:', configPath);
console.log('File exists:', fs.existsSync(configPath));

if (fs.existsSync(configPath)) {
  const fileContents = fs.readFileSync(configPath, 'utf8');
  console.log('\nFile contents:');
  console.log(fileContents);
  
  const config = yaml.load(fileContents) as { converters: any[] };
  console.log('\nParsed config:');
  console.log(JSON.stringify(config, null, 2));
  
  console.log('\nLoaded converters:');
  config.converters.forEach((converter) => {
    console.log(`- ${converter.id}: ${converter.name}`);
  });
  
  // Check for pko_sa
  const pkoSa = config.converters.find(c => c.id === 'pko_sa');
  if (pkoSa) {
    console.log('\n✅ PKO SA converter found:');
    console.log(JSON.stringify(pkoSa, null, 2));
  } else {
    console.log('\n❌ PKO SA converter NOT found!');
  }
} else {
  console.log('\n❌ Config file NOT found!');
}
