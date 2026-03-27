// build.js - Place this file in your project root folder
const fs = require('fs');
const path = require('path');

console.log('🔧 Building Starks Galaxy PWA...');

// Update cache version in sw.js
const swPath = path.join(__dirname, 'sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  const timestamp = Date.now();
  const newVersion = `starks-galaxy-v${timestamp}`;
  
  // Update cache name
  swContent = swContent.replace(/starks-galaxy-v\d+/, newVersion);
  
  // Update offline page reference if needed
  swContent = swContent.replace(/offline\.html\?v=\d+/, `offline.html?v=${timestamp}`);
  
  fs.writeFileSync(swPath, swContent);
  console.log(`✅ Updated service worker cache version to: ${newVersion}`);
} else {
  console.log('⚠️ sw.js not found, skipping cache update');
}

// Optional: Create a version.json file for tracking
const versionFile = {
  version: timestamp,
  buildDate: new Date().toISOString(),
  appName: 'Starks Galaxy'
};

fs.writeFileSync(
  path.join(__dirname, 'version.json'), 
  JSON.stringify(versionFile, null, 2)
);
console.log('✅ Created version.json');

console.log('🎉 Build complete!');
