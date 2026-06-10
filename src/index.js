require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { initDb } = require('./db/connection');
const { sessionMiddleware } = require('./middleware/auth');
const { apiKeyGuard } = require('./middleware/apiKey');
const { csrfProtection } = require('./middleware/csrf');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();

initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(sessionMiddleware);
app.use('/admin', csrfProtection);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(apiKeyGuard);
app.use('/', publicRoutes);
app.use('/', adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found' });
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Listening on :${PORT}`);
});

module.exports = server;
