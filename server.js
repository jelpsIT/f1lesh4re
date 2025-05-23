const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    filepath TEXT
  )`);
  // Insert a test user (username: test, password: test)
  db.run(`INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)`, ['test', 'test']);
});

// Middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false
}));
app.use(express.static('uploads'));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    // Generate a 6-character random string
    const uniqueSuffix = Math.random().toString(36).substring(2, 8);
    // Keep original filename, add unique suffix before extension
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage });

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

// Routes
app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
    if (user) {
      req.session.user = user;
      res.redirect('/dashboard');
    } else {
      res.redirect('/login');
    }
  });
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  db.all(`SELECT id, filename, printf("%b", id) as binaryId FROM files`, [], (err, files) => {
    res.render('dashboard', { user: req.session.user, files: files || [] });
  });
});

app.post('/upload', isAuthenticated, upload.single('file'), (req, res) => {
  db.run(`INSERT INTO files (filename, filepath) VALUES (?, ?)`, [req.file.originalname, req.file.filename], () => {
    res.redirect('/dashboard');
  });
});

app.get('/file/:binaryId', isAuthenticated, (req, res) => {
  const binaryId = req.params.binaryId;
  const id = parseInt(binaryId, 2); // Convert binary to decimal
  db.get(`SELECT filepath FROM files WHERE id = ?`, [id], (err, file) => {
    if (file) {
      res.download(path.join(__dirname, 'uploads', file.filepath));
    } else {
      res.status(404).send('File not found');
    }
  });
});

app.post('/delete/:id', isAuthenticated, (req, res) => {
  const id = req.params.id;
  db.get(`SELECT filepath FROM files WHERE id = ?`, [id], (err, file) => {
    if (file) {
      // Delete file from uploads folder
      fs.unlink(path.join(__dirname, 'uploads', file.filepath), (err) => {
        if (err) console.error('Error deleting file:', err);
        // Delete file record from database
        db.run(`DELETE FROM files WHERE id = ?`, [id], () => {
          res.redirect('/dashboard');
        });
      });
    } else {
      res.redirect('/dashboard');
    }
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));