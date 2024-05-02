const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Directory where the files are stored
const uploadsDir = 'uploads';

// Load existing checksums
let checksums = {};
if (fs.existsSync('checksums.json')) {
  checksums = JSON.parse(fs.readFileSync('checksums.json'));
}

// Read the uploads directory
fs.readdir(uploadsDir, (err, files) => {
  if (err) {
    console.error(`Error reading directory: ${err}`);
    return;
  }

  // For each file in the directory
  files.forEach(file => {
    // Skip if the file already has a checksum
    if (Object.values(checksums).includes(file)) {
      return;
    }

    // Calculate the SHA256 checksum
    const fileBuffer = fs.readFileSync(path.join(uploadsDir, file));
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hex = hashSum.digest('hex');

    // Store the checksum and filename
    checksums[hex] = file;
  });

  // Write the checksums to the JSON file
  fs.writeFileSync('checksums.json', JSON.stringify(checksums, null, 2));
});