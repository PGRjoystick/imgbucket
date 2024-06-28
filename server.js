const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Load checksums
let checksums = {};
if (fs.existsSync('checksums.json')) {
  checksums = JSON.parse(fs.readFileSync('checksums.json'));
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
    fileSize: 1000 * 1024 * 1024 // Same file size limit as before
  }
}).single('file');

// Initialize multer with the permanent storage configuration
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
}).single('file');

require('dotenv').config();

const REGISTERED_API_KEYS = process.env.REGISTERED_API_KEYS.split(',');

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
      // A Multer error occurred when uploading.
      return res.status(500).json({ message: err.message });
    } else if (err) {
      // An unknown error occurred when uploading.
      return res.status(500).json({ message: err.message });
    }

    // Calculate SHA256 checksum
    const fileBuffer = fs.readFileSync(req.file.path);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hex = hashSum.digest('hex');

    // Check if file with same checksum exists
    if (checksums[hex]) {
      return res.status(200).json({
        message: 'File already exists',
        fileUrl: `https://${process.env.APP_URL}/uploads/${checksums[hex]}`
      });
    }

    // Save checksum and filename
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
      return res.status(500).json({ message: err.message });
    }

    // Calculate SHA256 checksum
    const fileBuffer = fs.readFileSync(req.file.path);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const hex = hashSum.digest('hex');

    // Save checksum and filename with expiration time
    const expirationTime = Date.now() + (2 * 60 * 60 * 1000); // 2 hours in milliseconds
    checksums[hex] = { filename: req.file.filename, expires: expirationTime, path: 'tempuploads/' };
    fs.writeFileSync('checksums.json', JSON.stringify(checksums));

    // Schedule file deletion
    setTimeout(() => {
      fs.unlinkSync(req.file.path);
      delete checksums[hex];
      fs.writeFileSync('checksums.json', JSON.stringify(checksums));
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

app.listen(process.env.APP_PORT, () => console.log(`Server is running on port ${process.env.APP_PORT}`));