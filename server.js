const { createClient } = require('@libsql/client');
     const express = require('express');
     const session = require('express-session');
     const KnexSessionStore = require('connect-session-knex')(session);
     const knex = require('knex');
     const multer = require('multer');
     const path = require('path');
     const fs = require('fs');
     const app = express();

     // Initialize Turso client
     const db = createClient({
       url: process.env.TURSO_DATABASE_URL || 'libsql://file-share-db-jelpsIT.turso.io', // Use env variable
       authToken: process.env.TURSO_AUTH_TOKEN || 'YOUR_TOKEN' // Use env variable
     });

     // Initialize Knex for session store
     const knexInstance = knex({
       client: 'sqlite3', // Turso uses SQLite-compatible protocol
       connection: {
         host: process.env.TURSO_DATABASE_URL,
         user: '',
         password: process.env.TURSO_AUTH_TOKEN,
         database: ''
       },
       useNullAsDefault: true
     });

     // Configure session store
     const store = new KnexSessionStore({
       knex: knexInstance,
       tablename: 'sessions',
       createtable: true,
       clearInterval: 1000 * 60 * 60 // Clear expired sessions every hour
     });

     // Initialize database tables
     async function initializeDatabase() {
       await db.execute(`
         CREATE TABLE IF NOT EXISTS users (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           username TEXT UNIQUE,
           password TEXT
         )
       `);
       await db.execute(`
         CREATE TABLE IF NOT EXISTS files (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           filename TEXT,
           filepath TEXT
         )
       `);
       await db.execute(`
         INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)
       `, ['test', 'test']);
     }
     initializeDatabase().catch(console.error);

     // Middleware
     app.set('view engine', 'ejs');
     app.use(express.urlencoded({ extended: true }));
     app.use(session({
       secret: 'secret-key',
       resave: false,
       saveUninitialized: false,
       store: store
     }));

     // Create /tmp/uploads if it doesn't exist
     const uploadDir = '/tmp/uploads';
     if (!fs.existsSync(uploadDir)) {
       fs.mkdirSync(uploadDir, { recursive: true });
     }
     app.use(express.static(uploadDir));

     // Multer for file uploads
     const storage = multer.diskStorage({
       destination: uploadDir,
       filename: (req, file, cb) => {
         const uniqueSuffix = Math.random().toString(36).substring(2, 8);
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

     app.post('/login', async (req, res) => {
       const { username, password } = req.body;
       const result = await db.execute({
         sql: `SELECT * FROM users WHERE username = ? AND password = ?`,
         args: [username, password]
       });
       if (result.rows.length > 0) {
         req.session.user = result.rows[0];
         res.redirect('/dashboard');
       } else {
         res.redirect('/login');
       }
     });

     app.get('/dashboard', isAuthenticated, async (req, res) => {
       const result = await db.execute(`SELECT id, filename FROM files`);
       const filesWithBinaryId = result.rows.map(file => ({
         ...file,
         binaryId: file.id.toString(2)
       }));
       console.log('Files:', filesWithBinaryId);
       res.render('dashboard', { user: req.session.user, files: filesWithBinaryId || [] });
     });

     app.post('/upload', isAuthenticated, upload.single('file'), async (req, res) => {
       await db.execute({
         sql: `INSERT INTO files (filename, filepath) VALUES (?, ?)`,
         args: [req.file.originalname, req.file.filename]
       });
       res.redirect('/dashboard');
     });

     app.get('/file/:binaryId', isAuthenticated, async (req, res) => {
       const binaryId = req.params.binaryId;
       const id = parseInt(binaryId, 2);
       const result = await db.execute({
         sql: `SELECT filepath, filename FROM files WHERE id = ?`,
         args: [id]
       });
       if (result.rows.length > 0) {
         const file = result.rows[0];
         const filePath = path.join(uploadDir, file.filepath);
         res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
         res.download(filePath, file.filename, (err) => {
           if (err) console.error('Download error:', err);
         });
       } else {
         res.status(404).send('File not found');
       }
     });

     app.post('/delete/:id', isAuthenticated, async (req, res) => {
       const id = req.params.id;
       const result = await db.execute({
         sql: `SELECT filepath FROM files WHERE id = ?`,
         args: [id]
       });
       if (result.rows.length > 0) {
         const file = result.rows[0];
         fs.unlink(path.join(uploadDir, file.filepath), (err) => {
           if (err) console.error('Error deleting file:', err);
           db.execute({
             sql: `DELETE FROM files WHERE id = ?`,
             args: [id]
           }).then(() => res.redirect('/dashboard'));
         });
       } else {
         res.redirect('/dashboard');
       }
     });

     app.get('/logout', (req, res) => {
       req.session.destroy();
       res.redirect('/login');
     });

     app.listen(process.env.PORT || 3000, () => console.log('Server running'));