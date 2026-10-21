'use strict';
const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const prom = require('prom-client');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'uniforum',
  waitForConnections: true, connectionLimit: 10, queueLimit: 0,
  charset: 'utf8mb4'
});

fs.mkdirSync('/app/logs', { recursive: true });
const logger = fs.createWriteStream('/app/logs/app.log', { flags: 'a' });
function log(level, msg) {
  const row = `${new Date().toISOString()} ${level} ${msg}\n`;
  logger.write(row);
  process.stdout.write(row);
}

prom.collectDefaultMetrics({ prefix: 'uniforum_' });
const requests = new prom.Counter({
  name: 'uniforum_http_requests_total',
  help: 'Total HTTP requests by route and status',
  labelNames: ['method', 'route', 'status']
});
const durations = new prom.Histogram({
  name: 'uniforum_http_duration_seconds',
  help: 'HTTP response time in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // The application is reachable only through Nginx.
app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  name: 'uniforum.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 }
  // MemoryStore is for local demo only. Use Redis/MySQL session storage for production.
}));
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.siteName = 'UniForum';
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route && req.route.path ? String(req.baseUrl + req.route.path) : (req.path.startsWith('/static') ? '/static' : 'other');
    const status = String(res.statusCode);
    requests.inc({ method: req.method, route, status });
    durations.observe({ method: req.method, route }, Number(process.hrtime.bigint() - started) / 1e9);
    log(res.statusCode >= 500 ? 'ERROR' : 'INFO', `${req.method} ${req.originalUrl} status=${status} user=${req.session.user ? req.session.user.id : 'guest'}`);
  });
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
function mustLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function safeText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function isOwnerOrAdmin(req, authorId) {
  return req.session.user && (req.session.user.id === Number(authorId) || req.session.user.role === 'admin');
}
function handleErr(err, req, res, next) {
  log('ERROR', `${err.code || 'UNKNOWN'} ${err.message}`);
  next(err);
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'uniforum' }); }
  catch (err) { log('ERROR', `health: ${err.message}`); res.status(503).json({ ok: false }); }
});
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prom.register.contentType);
  res.end(await prom.register.metrics());
});

app.get('/', async (req, res, next) => {
  try {
    const [topics] = await pool.execute(`
      SELECT t.id, t.title, t.description, t.created_at, u.username,
        (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id) AS post_count
      FROM topics t JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC LIMIT 50`);
    res.render('home', { title: 'Các chủ đề', topics });
  } catch (err) { next(err); }
});

app.get('/register', (_req, res) => res.render('auth', { title: 'Đăng ký', mode: 'register', error: null }));
app.post('/register', authLimiter, async (req, res, next) => {
  const username = safeText(req.body.username, 50);
  const email = safeText(req.body.email, 190).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (username.length < 3 || !/^[\p{L}\p{N}_ -]+$/u.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) {
    return res.status(400).render('auth', { title: 'Đăng ký', mode: 'register', error: 'Tên đăng nhập từ 3 ký tự, email hợp lệ và mật khẩu ít nhất 8 ký tự.' });
  }
  try {
    await pool.execute('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, await bcrypt.hash(password, 12)]);
    res.redirect('/login?registered=1');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).render('auth', { title: 'Đăng ký', mode: 'register', error: 'Email hoặc tên đăng nhập đã tồn tại.' });
    next(err);
  }
});
app.get('/login', (req, res) => res.render('auth', { title: 'Đăng nhập', mode: 'login', error: null, registered: req.query.registered === '1' }));
app.post('/login', authLimiter, async (req, res, next) => {
  const email = safeText(req.body.email, 190).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  try {
    const [users] = await pool.execute('SELECT id, username, email, password_hash, role FROM users WHERE email = ? LIMIT 1', [email]);
    if (!users.length || !await bcrypt.compare(password, users[0].password_hash)) {
      return res.status(401).render('auth', { title: 'Đăng nhập', mode: 'login', error: 'Email hoặc mật khẩu không chính xác.', registered: false });
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { id: users[0].id, username: users[0].username, role: users[0].role };
      req.session.save(err2 => err2 ? next(err2) : res.redirect('/'));
    });
  } catch (err) { next(err); }
});
app.post('/logout', mustLogin, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('uniforum.sid');
    res.redirect('/');
  });
});

app.get('/topics/new', mustLogin, (_req, res) => res.render('new-topic', { title: 'Tạo chủ đề', error: null }));
app.post('/topics', mustLogin, async (req, res, next) => {
  const title = safeText(req.body.title, 180);
  const description = safeText(req.body.description, 2000);
  if (title.length < 5 || description.length < 10) {
    return res.status(400).render('new-topic', { title: 'Tạo chủ đề', error: 'Tiêu đề ít nhất 5 ký tự, phần mô tả ít nhất 10 ký tự.' });
  }
  try {
    const [result] = await pool.execute('INSERT INTO topics (user_id, title, description) VALUES (?, ?, ?)', [req.session.user.id, title, description]);
    res.redirect(`/topics/${result.insertId}`);
  } catch (err) { next(err); }
});
app.get('/topics/:id', async (req, res, next) => {
  try {
    const [topics] = await pool.execute('SELECT t.*, u.username FROM topics t JOIN users u ON u.id=t.user_id WHERE t.id=?', [req.params.id]);
    if (!topics.length) return res.status(404).send('Không tìm thấy chủ đề.');
    const [posts] = await pool.execute('SELECT p.*, u.username FROM posts p JOIN users u ON u.id=p.user_id WHERE p.topic_id=? ORDER BY p.created_at ASC', [req.params.id]);
    const [comments] = await pool.execute('SELECT c.*, u.username FROM comments c JOIN users u ON u.id=c.user_id JOIN posts p ON p.id=c.post_id WHERE p.topic_id=? ORDER BY c.created_at ASC', [req.params.id]);
    const commentsByPost = {};
    for (const c of comments) (commentsByPost[c.post_id] ||= []).push(c);
    res.render('topic', { title: topics[0].title, topic: topics[0], posts, commentsByPost, canEdit: id => isOwnerOrAdmin(req, id) });
  } catch (err) { next(err); }
});
app.post('/topics/:id/posts', mustLogin, async (req, res, next) => {
  const content = safeText(req.body.content, 8000);
  if (content.length < 2) return res.status(400).send('Bài viết phải có từ 2 ký tự.');
  try {
    const [found] = await pool.execute('SELECT id FROM topics WHERE id=?', [req.params.id]);
    if (!found.length) return res.status(404).send('Không tìm thấy chủ đề.');
    await pool.execute('INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)', [req.params.id, req.session.user.id, content]);
    res.redirect(`/topics/${req.params.id}`);
  } catch (err) { next(err); }
});
app.post('/posts/:id/comments', mustLogin, async (req, res, next) => {
  const content = safeText(req.body.content, 1000);
  if (!content) return res.status(400).send('Bình luận không được để trống.');
  try {
    const [posts] = await pool.execute('SELECT topic_id FROM posts WHERE id=?', [req.params.id]);
    if (!posts.length) return res.status(404).send('Không tìm thấy bài viết.');
    await pool.execute('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)', [req.params.id, req.session.user.id, content]);
    res.redirect(`/topics/${posts[0].topic_id}`);
  } catch (err) { next(err); }
});
app.post('/posts/:id/delete', mustLogin, async (req, res, next) => {
  try {
    const [posts] = await pool.execute('SELECT user_id, topic_id FROM posts WHERE id=?', [req.params.id]);
    if (!posts.length) return res.status(404).send('Bài viết không tồn tại.');
    if (!isOwnerOrAdmin(req, posts[0].user_id)) return res.status(403).send('Không có quyền xóa bài viết này.');
    await pool.execute('DELETE FROM posts WHERE id=?', [req.params.id]);
    res.redirect(`/topics/${posts[0].topic_id}`);
  } catch (err) { next(err); }
});
app.post('/comments/:id/delete', mustLogin, async (req, res, next) => {
  try {
    const [comments] = await pool.execute('SELECT c.user_id, p.topic_id FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?', [req.params.id]);
    if (!comments.length) return res.status(404).send('Bình luận không tồn tại.');
    if (!isOwnerOrAdmin(req, comments[0].user_id)) return res.status(403).send('Không có quyền xóa bình luận này.');
    await pool.execute('DELETE FROM comments WHERE id=?', [req.params.id]);
    res.redirect(`/topics/${comments[0].topic_id}`);
  } catch (err) { next(err); }
});
app.post('/topics/:id/delete', mustLogin, async (req, res, next) => {
  try {
    const [topics] = await pool.execute('SELECT user_id FROM topics WHERE id=?', [req.params.id]);
    if (!topics.length) return res.status(404).send('Chủ đề không tồn tại.');
    if (!isOwnerOrAdmin(req, topics[0].user_id)) return res.status(403).send('Không có quyền xóa chủ đề này.');
    await pool.execute('DELETE FROM topics WHERE id=?', [req.params.id]);
    res.redirect('/');
  } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  log('ERROR', `${err.code || 'UNKNOWN'} ${err.message}`);
  res.status(500).send('Có lỗi máy chủ. Vui lòng kiểm tra log.');
});
app.listen(PORT, '0.0.0.0', () => log('INFO', `UniForum listening on ${PORT}`));
