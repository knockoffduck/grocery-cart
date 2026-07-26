import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { cartRoutes } from './routes/cart';
import { searchRoutes } from './routes/search';
import { eanRoutes } from './routes/ean';
import { catalogueRoutes } from './routes/catalogue';
import { productRoutes } from './routes/product';
import { manualMatchRoutes } from './routes/manual-match';
import { correctionsRoutes } from './routes/corrections';
import { refreshRoutes } from './routes/refresh';
import { statsRoutes } from './routes/stats';
import { healthRoutes } from './routes/health';
import { adminRoutes } from './routes/admin';

const app = new Hono();

app.use('*', cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.route('/api', authRoutes);
app.route('/api', cartRoutes);
app.route('/api', searchRoutes);
app.route('/api', eanRoutes);
app.route('/api', catalogueRoutes);
app.route('/api', productRoutes);
app.route('/api', manualMatchRoutes);
app.route('/api', correctionsRoutes);
app.route('/api', refreshRoutes);
app.route('/api', statsRoutes);
app.route('/api', healthRoutes);
app.route('/api', adminRoutes);

export default app;
