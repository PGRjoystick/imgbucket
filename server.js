const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();
const https = require('https');
require('dotenv').config();

// Logging middleware
function logRequests(req, res, next) {
  const now = new Date();
  // Format the date and time to be more readable
  const readableDate = now.toLocaleString();

  // Check for the Cloudflare header 'CF-Connecting-IP'
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = cfConnectingIp || req.headers['x-real-ip'] || (forwardedFor ? forwardedFor.split(',')[0] : '') || req.socket.remoteAddress;

  const userAgent = req.headers['user-agent'];

  const logMessage = `${readableDate} - ${req.method} ${req.url} - IP: ${ip} - User-Agent: ${userAgent}\n`;

  // Append log message to server.log
  fs.appendFile(path.join(__dirname, 'server.log'), logMessage, (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
    }
  });

  next();
}

app.use(logRequests);

// Serve static files from the 'public' directory
app.use(express.static('public'));

// SSL certificate paths
const privateKeyPath = process.env.CERT_KEY_PATH;
const certificatePath = process.env.CERT_PATH;

const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const certificate = fs.readFileSync(certificatePath, 'utf8');

const credentials = { key: privateKey, cert: certificate };

// Creating HTTPS server
const httpsServer = https.createServer(credentials, app);

// Load checksums for permanent uploads
let checksums = {};
if (fs.existsSync('checksums.json')) {
  checksums = JSON.parse(fs.readFileSync('checksums.json'));
}

// Load checksums for temporary uploads
let tempChecksums = {};
if (fs.existsSync('temp-checksums.json')) {
  tempChecksums = JSON.parse(fs.readFileSync('temp-checksums.json'));
}

// Define storage for temporary uploads with improved path injection protection
const tempStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'tempuploads/'); // Use 'tempuploads/' directory for temporary files
  },
  filename: function(req, file, cb) {
    // Extract file extension and sanitize
    const ext = path.extname(file.originalname).replace(/(\.\.\/|\.\.\\)/g, '');
    // Generate a safe file name to prevent path injection
    const safeFileName = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, safeFileName);
  }
});

// Define storage for permanent uploads with improved path injection protection
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function(req, file, cb) {
    // Extract file extension and sanitize
    const ext = path.extname(file.originalname).replace(/(\.\.\/|\.\.\\)/g, '');
    // Generate a safe file name to prevent path injection
    const safeFileName = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, safeFileName);
  }
});

// Initialize multer with the temporary storage configuration
const tempUpload = multer({ 
  storage: tempStorage,
  limits: {
    fileSize: 2000 * 1024 * 1024 // Same file size limit as before
  }
}).single('file');

// Initialize multer with the permanent storage configuration
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024
  }
}).single('file');

const REGISTERED_API_KEYS = (process.env.REGISTERED_API_KEYS || '').split(',');

// Function to clean up expired temporary files and their checksum entries
function cleanupExpiredTempFiles() {
  const currentTime = Date.now();
  let cleanedFiles = 0;
  let cleanedEntries = 0;

  Object.keys(tempChecksums).forEach(hash => {
    const entry = tempChecksums[hash];
    if (typeof entry === 'object' && entry.expires) {
      const filePath = path.join('tempuploads', entry.filename);
      const isExpired = entry.expires < currentTime;
      const fileExists = fs.existsSync(filePath);

      if (isExpired || !fileExists) {
        // Delete the file if it exists but is expired
        if (fileExists && isExpired) {
          try {
            fs.unlinkSync(filePath);
            console.log(`[Cleanup] Deleted expired file: ${entry.filename}`);
            cleanedFiles++;
          } catch (error) {
            console.error(`[Cleanup] Error deleting expired file: ${entry.filename}`, error);
          }
        }

        // Remove the checksum entry
        delete tempChecksums[hash];
        cleanedEntries++;
      }
    }
  });

  if (cleanedEntries > 0) {
    fs.writeFileSync('temp-checksums.json', JSON.stringify(tempChecksums));
    console.log(`[Cleanup] Removed ${cleanedEntries} expired/invalid checksum entries and ${cleanedFiles} files`);
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupExpiredTempFiles, 30 * 60 * 1000);

// Run initial cleanup on server start
setTimeout(cleanupExpiredTempFiles, 5000); // 5 seconds after startup

// Middleware for checking the API key
function checkApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !REGISTERED_API_KEYS.includes(apiKey)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

app.post('/upload', checkApiKey, (req, res, next) => {
  upload(req, res, function(err) {
    if (err instanceof multer.MulterError) {
      return res.status(500).json({ message: err.message });
    } else if (err) {
      return res.status(500).json({ message: err.message });
    }

    // Calculate SHA256 checksum
    const fileBuffer = fs.readFileSync(req.file.path);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hex = hashSum.digest('hex');

    // Check if file with same checksum exists in PERMANENT storage only
    if (checksums[hex]) {
      const existingFilePath = path.join('uploads', checksums[hex]);
      
      // Verify the file actually exists
      if (fs.existsSync(existingFilePath)) {
        // File exists - return the existing file
        fs.unlinkSync(req.file.path);
        
        return res.status(200).json({
          message: 'File already exists',
          fileUrl: `https://${process.env.APP_URL}/uploads/${checksums[hex]}`
        });
      } else {
        // File doesn't exist - clean up the checksum entry
        console.log(`[Cleanup] Removing stale checksum entry for missing file: ${checksums[hex]}`);
        delete checksums[hex];
        fs.writeFileSync('checksums.json', JSON.stringify(checksums));
        
        // Continue with normal upload process since the old entry is now cleaned up
      }
    }

    // Save checksum and filename for permanent uploads
    checksums[hex] = req.file.filename;
    fs.writeFileSync('checksums.json', JSON.stringify(checksums));

    return res.status(201).json({
      message: 'File uploaded successfully',
      fileUrl: `https://${process.env.APP_URL}/uploads/${req.file.filename}`
    });
  });
});

app.post('/upload-temp', checkApiKey, (req, res, next) => {
  tempUpload(req, res, function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: err.message });
    }

    // Calculate SHA256 checksum
    const fileBuffer = fs.readFileSync(req.file.path);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hex = hashSum.digest('hex');

    // Check if file already exists in temporary storage
    if (tempChecksums[hex]) {
      const existingEntry = tempChecksums[hex];
      const existingFilePath = path.join('tempuploads', existingEntry.filename);
      
      // Check if the existing file actually exists and hasn't expired
      const currentTime = Date.now();
      const isExpired = existingEntry.expires && existingEntry.expires < currentTime;
      const fileExists = fs.existsSync(existingFilePath);
      
      if (fileExists && !isExpired) {
        // File exists and is not expired - return the existing file
        fs.unlinkSync(req.file.path);
        
        return res.status(200).json({
          message: 'File already exists in temporary storage',
          fileUrl: `https://${process.env.APP_URL}/tempuploads/${existingEntry.filename}`,
          expiry: 'This link will expire in 2 hours'
        });
      } else {
        // File is expired or doesn't exist - clean up the checksum entry
        console.log(`[Cleanup] Removing stale checksum entry for ${existingEntry.filename} (expired: ${isExpired}, exists: ${fileExists})`);
        delete tempChecksums[hex];
        fs.writeFileSync('temp-checksums.json', JSON.stringify(tempChecksums));
        
        // If the file still exists but is expired, delete it
        if (fileExists && isExpired) {
          try {
            fs.unlinkSync(existingFilePath);
            console.log(`[Cleanup] Deleted expired file: ${existingEntry.filename}`);
          } catch (error) {
            console.error(`[Cleanup] Error deleting expired file: ${existingEntry.filename}`, error);
          }
        }
        
        // Continue with normal upload process since the old entry is now cleaned up
      }
    }

    // Save checksum and filename with expiration time in temp checksums
    const expirationTime = Date.now() + (2 * 60 * 60 * 1000); // 2 hours in milliseconds
    tempChecksums[hex] = { filename: req.file.filename, expires: expirationTime, path: 'tempuploads/' };
    fs.writeFileSync('temp-checksums.json', JSON.stringify(tempChecksums));

    // Schedule file deletion
    setTimeout(() => {
      try {
        fs.unlinkSync(req.file.path);
        delete tempChecksums[hex];
        fs.writeFileSync('temp-checksums.json', JSON.stringify(tempChecksums));
        console.log(`[Cleanup] Deleted temporary file: ${req.file.filename}`);
      } catch (error) {
        console.error(`[Cleanup] Error deleting temporary file: ${req.file.filename}`, error);
      }
    }, 2 * 60 * 60 * 1000); // 2 hours

    // Return response
    return res.status(201).json({
      message: 'File uploaded successfully',
      fileUrl: `https://${process.env.APP_URL}/tempuploads/${req.file.filename}`,
      expiry: 'This link will expire in 2 hours'
    });
  });
});


app.use('/uploads', express.static('uploads'));
app.use('/tempuploads', express.static('tempuploads'));

// Listen on HTTP port
app.listen(process.env.INSECURE_APP_PORT, () => console.log(`HTTP Server is running on port ${process.env.INSECURE_APP_PORT}`));

// Listen on HTTPS port
httpsServer.listen(process.env.APP_PORT, () => {
  console.log(`HTTPS Server is running on port ${process.env.APP_PORT}`);
});