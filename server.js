import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import multer from 'multer';
import cors from 'cors';
import os from 'os';
import https from 'https';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3007;

// Get network IPs
function getNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

const networkIPs = getNetworkIPs();

// // Enhanced CORS middleware to allow all devices on network
// app.use(cors({
//     origin: function (origin, callback) {
//         // Allow requests with no origin (like mobile apps or curl requests)
//         if (!origin) return callback(null, true);
        
//         // Allow localhost and all network IPs
//         if (
//             origin.includes('localhost') || 
//             origin.includes('127.0.0.1') ||
//             networkIPs.some(ip => origin.includes(ip))
//         ) {
//             return callback(null, true);
//         }
        
//         // Allow any origin in development
//         return callback(null, true);
//     },
//     credentials: true
// }));

// In your server.js, update the CORS configuration:
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Allow all origins in development
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        
        // In production, specify your allowed domains
const allowedOrigins = [
    'http://localhost:3000',
    'https://atomo.in',
    'https://614c7d5ea070.ngrok-free.app',
];

        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve ALL static files from current directory
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.\-]/g, '_');
    cb(null, Date.now() + '-' + originalName);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

// JSON file path for storing news
const NEWS_FILE = path.join(__dirname, 'news.json');

// Initialize news.json if it doesn't exist
function initializeNewsFile() {
  if (!fs.existsSync(NEWS_FILE)) {
    fs.writeFileSync(NEWS_FILE, JSON.stringify([]));
  }
}

// Read news from JSON file
function readNews() {
  try {
    const data = fs.readFileSync(NEWS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading news file:', error);
    return [];
  }
}

// Write news to JSON file
function writeNews(news) {
  try {
    fs.writeFileSync(NEWS_FILE, JSON.stringify(news, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing news file:', error);
    return false;
  }
}

// Routes

// API Routes
app.get('/api/news', (req, res) => {
  const news = readNews();
  // Add full URL for images
  const newsWithFullUrls = news.map(item => ({
    ...item,
    image: item.image ? `${req.protocol}://${req.get('host')}${item.image}` : null
  }));
  res.json(newsWithFullUrls);
});

app.get('/api/news/:id', (req, res) => {
  const news = readNews();
  const newsItem = news.find(item => item.id === parseInt(req.params.id));
  if (newsItem) {
    const itemWithFullUrl = {
      ...newsItem,
      image: newsItem.image ? `${req.protocol}://${req.get('host')}${newsItem.image}` : null
    };
    res.json(itemWithFullUrl);
  } else {
    res.status(404).json({ error: 'News item not found' });
  }
});

app.post('/api/news', upload.single('image'), (req, res) => {
  try {
    const { title, subtitle, date, content } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Title and content are required' });
    }
    
    const news = readNews();
    
    const newNewsItem = {
      id: news.length > 0 ? Math.max(...news.map(item => item.id)) + 1 : 1,
      title: title.trim(),
      subtitle: subtitle ? subtitle.trim() : '',
      date: date || new Date().toISOString().split('T')[0],
      content: content.trim(),
      image: req.file ? `/uploads/${req.file.filename}` : null,
      createdAt: new Date().toISOString()
    };
    
    news.unshift(newNewsItem);
    
    if (writeNews(news)) {
      res.json({ 
        success: true, 
        message: 'News published successfully!', 
        news: newNewsItem 
      });
    } else {
      res.status(500).json({ success: false, message: 'Failed to publish news' });
    }
  } catch (error) {
    console.error('Error publishing news:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.delete('/api/news/:id', (req, res) => {
  const news = readNews();
  const newsItem = news.find(item => item.id === parseInt(req.params.id));
  
  if (!newsItem) {
    return res.status(404).json({ success: false, message: 'News item not found' });
  }
  
  if (newsItem.image) {
    const imagePath = path.join(__dirname, newsItem.image);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }
  
  const filteredNews = news.filter(item => item.id !== parseInt(req.params.id));
  
  if (writeNews(filteredNews)) {
    res.json({ success: true, message: 'News deleted successfully!' });
  } else {
    res.status(500).json({ success: false, message: 'Failed to delete news' });
  }
});

// Add this route to serve your main Atomo website
app.get('/website', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Also update your existing routes to serve from correct directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html')); // or your main site
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Error handling
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum size is 5MB.' });
    }
  }
  res.status(500).json({ success: false, message: error.message });
});

// Create HTTPS server
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

const server = https.createServer(httpsOptions, app);

// Start HTTPS server on all network interfaces
server.listen(PORT, '0.0.0.0', () => {
  initializeNewsFile();
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  console.log(`🔒 HTTPS Server running on all network interfaces!`);
  console.log(`📍 Local access:`);
  console.log(`   https://localhost:${PORT}`);
  console.log(`   https://127.0.0.1:${PORT}`);

  console.log(`🌐 Network access from other devices:`);
  networkIPs.forEach(ip => {
    console.log(`   https://${ip}:${PORT}`);
  });

  console.log(`\n📝 Admin panel: https://localhost:${PORT}/admin`);
  console.log(`🌐 Main website: https://localhost:${PORT}/`);
  console.log(`📁 Current directory: ${__dirname}`);

  if (networkIPs.length === 0) {
    console.log(`\n⚠️  No network IPs found. Make sure you're connected to a network.`);
  } else {
    console.log(`\n💡 To access from other devices, use any of the network URLs above.`);
  }
});
