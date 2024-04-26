const express = require('express');
const multer = require('multer');

const app = express();

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Set up Multer storage
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function(req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
}).single('image');

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

    // Everything went fine.
    return res.status(201).json({
      message: 'File uploaded successfully',
      fileUrl: `http://localhost:3000/uploads/${req.file.filename}`
    });
  });
});

app.use('/uploads', express.static('uploads'));

app.listen(process.env.APP_PORT, () => console.log('Server started on port 3000'));