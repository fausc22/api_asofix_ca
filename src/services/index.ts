import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import vehiclesRoutes from './routes/vehicles.routes';
import syncRoutes from './routes/sync.routes';
import feedsRoutes from './routes/feeds.routes';
import auditRoutes from './routes/audit.routes';
import asofixRoutes from './routes/asofix.routes';
import leadsRoutes from './routes/leads.routes';
import logger from './services/logger';
import syncCronJob from './jobs/sync-cron';
import { VehicleFilters } from './services/vehicle-filters';
import pool from './config/database';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';


const allowedOrigins = [
  'https://caradvice.com.ar',
  'https://recibos-caradvice.vercel.app',

  'https://excel-ima.vercel.app',
];

// Configuración de CORS
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de rutas de medios
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/opt/caradvice-media';
const IMAGES_PATH = process.env.IMAGES_PATH || path.join(MEDIA_ROOT, 'images');
const VIDEOS_PATH = process.env.VIDEOS_PATH || path.join(MEDIA_ROOT, 'videos');
const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE || '604800', 10); // 7 días por defecto

// Función helper para servir archivos estáticos con cache
const serveStaticFile = (filePath: string, res: express.Response, contentType?: string) => {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Determinar content type si no se proporciona
  if (!contentType) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime'
    };
    contentType = contentTypes[ext] || 'application/octet-stream';
  }

  // Headers de cache para producción
  if (NODE_ENV === 'production') {
    res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE}, immutable`);
    res.setHeader('Expires', new Date(Date.now() + CACHE_MAX_AGE * 1000).toUTCString());
  }

  res.setHeader('Content-Type', contentType);
  res.sendFile(filePath);
};

// Servir imágenes de vehículos (compatibilidad con endpoint antiguo)
app.get('/api/image', (req, res) => {
  const imagePath = req.query.path as string;
  if (!imagePath) {
    return res.status(400).json({ error: 'Path parameter is required' });
  }

  // Normalizar la ruta: puede venir como ruta completa o relativa
  let fullPath: string;

  // Si la ruta ya es absoluta y apunta a MEDIA_ROOT, usarla directamente
  if (path.isAbsolute(imagePath) && imagePath.startsWith(MEDIA_ROOT)) {
    fullPath = imagePath;
  } else {
    // Si es relativa, buscar en IMAGES_PATH
    // Remover prefijos comunes como "uploads/" o "vehicles/"
    const normalizedPath = imagePath.replace(/^.*uploads[\\/]/, '').replace(/^.*vehicles[\\/]/, '');
    fullPath = path.join(IMAGES_PATH, normalizedPath);
  }

  // Validación de seguridad: asegurar que está dentro de IMAGES_PATH
  const resolvedPath = path.resolve(fullPath);
  const resolvedImagesPath = path.resolve(IMAGES_PATH);

  if (!resolvedPath.startsWith(resolvedImagesPath)) {
    logger.warn(`Intento de acceso a ruta no permitida: ${imagePath}`);
    return res.status(403).json({ error: 'Invalid path' });
  }

  serveStaticFile(resolvedPath, res);
});

// Servir medios estáticos desde /media/images
app.get('/media/images/*', (req, res) => {
  // Extraer la ruta relativa después de /media/images/
  const match = req.path.match(/^\/media\/images\/(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid path format' });
  }

  const relativePath = match[1];
  const fullPath = path.join(IMAGES_PATH, relativePath);

  // Validación de seguridad
  const resolvedPath = path.resolve(fullPath);
  const resolvedImagesPath = path.resolve(IMAGES_PATH);

  if (!resolvedPath.startsWith(resolvedImagesPath)) {
    logger.warn(`Intento de acceso a ruta no permitida: ${relativePath}`);
    return res.status(403).json({ error: 'Invalid path' });
  }

  serveStaticFile(resolvedPath, res);
});

// Servir medios estáticos desde /media/videos
app.get('/media/videos/*', (req, res) => {
  // Extraer la ruta relativa después de /media/videos/
  const match = req.path.match(/^\/media\/videos\/(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Invalid path format' });
  }

  const relativePath = match[1];
  const fullPath = path.join(VIDEOS_PATH, relativePath);

  // Validación de seguridad
  const resolvedPath = path.resolve(fullPath);
  const resolvedVideosPath = path.resolve(VIDEOS_PATH);

  if (!resolvedPath.startsWith(resolvedVideosPath)) {
    logger.warn(`Intento de acceso a ruta no permitida: ${relativePath}`);
    return res.status(403).json({ error: 'Invalid path' });
  }

  serveStaticFile(resolvedPath, res);
});

// Rutas
app.use('/autos', vehiclesRoutes);
app.use('/sync', syncRoutes);
app.use('/feeds', feedsRoutes);
app.use('/internal', auditRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/asofix', asofixRoutes);

// Ruta de salud
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  let dbStatus = 'unknown';
  let lastSuccessfulSync = null;

  // Verificar conectividad a base de datos
  try {
    await pool.execute('SELECT 1');
    dbStatus = 'connected';
  } catch (error: any) {
    dbStatus = 'disconnected';
    logger.error(`Health check: Error de conexión a BD: ${error.message}`);
  }

  // Obtener última sincronización exitosa
  try {
    const { SyncLogger } = await import('./services/sync-logger');
    const lastSync = await SyncLogger.getLastSuccessfulSync();
    if (lastSync?.completed_at) {
      lastSuccessfulSync = lastSync.completed_at.toISOString();
    }
  } catch (error: any) {
    // No fallar si no se puede obtener (la tabla puede no existir)
    // Solo loguear en debug, no en producción
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`Health check: No se pudo obtener última sync: ${error.message}`);
    }
  }

  // Calcular uptime
  const uptimeSeconds = Math.floor(process.uptime());

  // Determinar estado general
  let status = 'healthy';
  if (dbStatus !== 'connected') {
    status = 'unhealthy';
  } else if (!lastSuccessfulSync) {
    // Si no hay syncs registradas, asumir healthy (puede ser primera ejecución)
    status = 'healthy';
  } else {
    // Verificar si la última sync es muy antigua (más de 2 horas)
    const lastSyncTime = new Date(lastSuccessfulSync).getTime();
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    if (lastSyncTime < twoHoursAgo) {
      status = 'degraded';
    }
  }

  // Timestamp en zona horaria Argentina
  const timestamp = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  res.json({
    status,
    timestamp,
    uptime_seconds: uptimeSeconds,
    database: dbStatus,
    last_successful_sync_at: lastSuccessfulSync,
    cron_active: syncCronJob.isActive()
  });
});

// Ruta para obtener información de filtros
app.get('/filters/info', (req, res) => {
  res.json({
    success: true,
    data: {
      filters: VehicleFilters.getFilterSummary(),
      description: {
        blockedBranchOffices: 'Concesionarias que están bloqueadas y no se muestran en la web',
        minPrice: 'Precio mínimo permitido (en USD o ARS)',
        blockedStatuses: 'Estados de stock que están bloqueados y no se muestran',
        requireImages: 'Si es true, solo se muestran vehículos con al menos una imagen'
      }
    }
  });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error: Error) => {
  logger.error(`Uncaught Exception - ${error.message}`, { stack: error.stack });
  // Dar tiempo para loguear antes de salir
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error(`Unhandled Rejection - ${reason?.message || String(reason)}`);
});

// Manejo de errores de Express
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Error no manejado en ${req.method} ${req.path}: ${err.message}`, {
    stack: err.stack,
    url: req.url
  });
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
  logger.info(`Sistema iniciado - Servidor backend corriendo en http://localhost:${PORT}`);
  logger.info(`Entorno: ${NODE_ENV}`);
  logger.info(`📊 Health check: http://localhost:${PORT}/health`);
  logger.info(`🚗 Endpoints de vehículos: http://localhost:${PORT}/autos`);
  logger.info(`🔄 Endpoints de sincronización: http://localhost:${PORT}/sync`);
  logger.info(`📋 Información de filtros: http://localhost:${PORT}/filters/info`);
  logger.info(`🔍 Endpoint de auditoría: http://localhost:${PORT}/internal/vehicles/audit`);
  logger.info(`🖼️  Medios estáticos: http://localhost:${PORT}/media/images/* y /media/videos/*`);
  logger.info(`📁 MEDIA_ROOT: ${MEDIA_ROOT}`);
  logger.info(`📁 IMAGES_PATH: ${IMAGES_PATH}`);
  logger.info(`📁 VIDEOS_PATH: ${VIDEOS_PATH}`);

  // Verificar API Key
  const apiKey = process.env.ASOFIX_API_KEY || '';
  if (!apiKey) {
    logger.warn('⚠️  ASOFIX_API_KEY no está configurada. La sincronización no funcionará.');
  } else {
    const maskedKey = apiKey.length > 10
      ? `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}`
      : '***';
    logger.info(`✅ API Key configurada: ${maskedKey} (longitud: ${apiKey.length})`);
  }

  // Mostrar configuración de filtros
  const filterSummary = VehicleFilters.getFilterSummary();
  logger.info('📋 Filtros obligatorios configurados:');
  logger.info(`   - Concesionarias bloqueadas: ${filterSummary.blockedBranchOffices.join(', ') || 'ninguna'}`);
  logger.info(`   - Precio mínimo: ${filterSummary.minPrice}`);
  logger.info(`   - Estados bloqueados: ${filterSummary.blockedStatuses.join(', ') || 'ninguno'}`);
  logger.info(`   - Requiere imágenes: ${filterSummary.requireImages ? 'Sí' : 'No'}`);

  // Iniciar cron job de sincronización automática
  const enableCron = process.env.ENABLE_AUTO_SYNC !== 'false';
  if (enableCron) {
    syncCronJob.start();
    logger.info('Cron job de sincronización automática iniciado');
  } else {
    logger.info('Cron job de sincronización automática deshabilitado (ENABLE_AUTO_SYNC=false)');
  }
});

// Manejo de shutdown graceful
process.on('SIGTERM', () => {
  logger.info('Señal SIGTERM recibida - Iniciando shutdown graceful');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Señal SIGINT recibida - Iniciando shutdown graceful');
  process.exit(0);
});

export default app;

