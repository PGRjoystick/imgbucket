const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Directories to process
const uploadsDir = 'uploads';
const tempUploadsDir = 'tempuploads';

// Function to calculate checksum for a file
function calculateFileChecksum(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    console.error(`Error calculating checksum for ${filePath}:`, error);
    return null;
  }
}

// Function to process files in a directory
function processDirectory(dirPath, checksumFile, isTemp = false) {
  console.log(`\n=== Processing ${dirPath} directory ===`);
  
  // Check if directory exists
  if (!fs.existsSync(dirPath)) {
    console.log(`Directory ${dirPath} does not exist. Skipping...`);
    return;
  }

  // Load existing checksums
  let checksums = {};
  if (fs.existsSync(checksumFile)) {
    try {
      checksums = JSON.parse(fs.readFileSync(checksumFile));
      console.log(`Loaded ${Object.keys(checksums).length} existing checksums from ${checksumFile}`);
    } catch (error) {
      console.error(`Error reading ${checksumFile}:`, error);
      checksums = {};
    }
  } else {
    console.log(`Creating new checksum file: ${checksumFile}`);
  }

  // Read the directory
  try {
    const files = fs.readdirSync(dirPath);
    console.log(`Found ${files.length} files in ${dirPath}`);
    
    let newFiles = 0;
    let existingFiles = 0;
    let errors = 0;

    // For each file in the directory
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      
      // Skip directories
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        return;
      }

      // Check if file already has a checksum
      const existingEntry = Object.values(checksums).find(entry => {
        if (isTemp && typeof entry === 'object') {
          return entry.filename === file;
        } else if (!isTemp && typeof entry === 'string') {
          return entry === file;
        }
        return false;
      });

      if (existingEntry) {
        console.log(`Skipping ${file} - already has checksum`);
        existingFiles++;
        return;
      }

      // Calculate the SHA256 checksum
      const hex = calculateFileChecksum(filePath);
      if (hex === null) {
        errors++;
        return;
      }

      // Store the checksum and filename
      if (isTemp) {
        // For temp files, store as object with expiration (set to 2 hours from now)
        const expirationTime = Date.now() + (2 * 60 * 60 * 1000);
        checksums[hex] = { 
          filename: file, 
          expires: expirationTime, 
          path: 'tempuploads/' 
        };
      } else {
        // For permanent files, store as simple string
        checksums[hex] = file;
      }

      console.log(`Added checksum for ${file}: ${hex.substring(0, 16)}...`);
      newFiles++;
    });

    // Write the checksums to the JSON file
    try {
      fs.writeFileSync(checksumFile, JSON.stringify(checksums, null, 2));
      console.log(`\n✅ Successfully updated ${checksumFile}`);
      console.log(`📊 Summary for ${dirPath}:`);
      console.log(`   - New files processed: ${newFiles}`);
      console.log(`   - Existing files skipped: ${existingFiles}`);
      console.log(`   - Errors encountered: ${errors}`);
      console.log(`   - Total checksums in file: ${Object.keys(checksums).length}`);
    } catch (error) {
      console.error(`Error writing ${checksumFile}:`, error);
    }

  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
}

// Function to clean up expired temp files
function cleanupExpiredTempFiles() {
  console.log(`\n=== Cleaning up expired temporary files ===`);
  
  if (!fs.existsSync('temp-checksums.json')) {
    console.log('No temp-checksums.json file found. Skipping cleanup.');
    return;
  }

  try {
    let tempChecksums = JSON.parse(fs.readFileSync('temp-checksums.json'));
    const currentTime = Date.now();
    let cleanedFiles = 0;

    Object.keys(tempChecksums).forEach(hash => {
      const entry = tempChecksums[hash];
      if (typeof entry === 'object' && entry.expires && entry.expires < currentTime) {
        const filePath = path.join('tempuploads', entry.filename);
        
        // Delete the file if it exists
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`Deleted expired file: ${entry.filename}`);
            cleanedFiles++;
          } catch (error) {
            console.error(`Error deleting ${filePath}:`, error);
          }
        }
        
        // Remove from checksums
        delete tempChecksums[hash];
      }
    });

    // Save updated checksums
    fs.writeFileSync('temp-checksums.json', JSON.stringify(tempChecksums, null, 2));
    console.log(`✅ Cleanup complete. Removed ${cleanedFiles} expired files.`);

  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// Main execution
console.log('🔧 File Checksum Calculator Tool');
console.log('================================');

// Process permanent uploads
processDirectory(uploadsDir, 'checksums.json', false);

// Process temporary uploads
processDirectory(tempUploadsDir, 'temp-checksums.json', true);

// Clean up expired temporary files
cleanupExpiredTempFiles();

console.log('\n🎉 All operations completed!');