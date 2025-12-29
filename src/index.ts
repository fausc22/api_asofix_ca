import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import vehiclesRoutes from './routes/vehicles.routes';
import syncRoutes from './routes/sync.routes';
import logger from './services/logger';
import syncCronJob from './jobs/sync-cron';
import { VehicleFilters } from './services/vehicle-filters';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir imágenes de vehículos
app.get('/api/image', (req, res) => {
  const imagePath = req.query.path as string;
  if (!imagePath) {
    return res.status(400).json({ error: 'Path parameter is required' });
  }

  const uploadsDir = path.join(__dirname, '../uploads');
  const fullPath = path.join(uploadsDir, imagePath.replace(/^.*uploads[\\/]/, ''));

  if (!fullPath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: 'Invalid path' });
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Image not found' });
  }

  res.sendFile(fullPath);
});

// Rutas
app.use('/autos', vehiclesRoutes);
app.use('/sync', syncRoutes);

// Ruta de salud
app.get('/health', (req, res) => {
  const filterSummary = VehicleFilters.getFilterSummary();
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    filters: filterSummary,
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

// Manejo de errores
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Error no manejado: ${err.message}`);
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

// Iniciar servidor
app.listen(PORT, () => {
  logger.info(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
  logger.info(`📊 Health check: http://localhost:${PORT}/health`);
  logger.info(`🚗 Endpoints de vehículos: http://localhost:${PORT}/autos`);
  logger.info(`🔄 Endpoints de sincronización: http://localhost:${PORT}/sync`);
  logger.info(`📋 Información de filtros: http://localhost:${PORT}/filters/info`);
  
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
    logger.info('✅ Cron job de sincronización automática iniciado');
  } else {
    logger.info('⏸️  Cron job de sincronización automática deshabilitado (ENABLE_AUTO_SYNC=false)');
  }
});

export default app;

