import { Router } from 'express';
import { SyncController } from '../controllers/sync.controller';

const router = Router();

/**
 * POST /sync/inicial
 * Carga inicial completa de todos los autos desde ASOFIX
 */
router.post('/inicial', SyncController.syncInicial);

/**
 * POST /sync/cron
 * Sincronización incremental (para uso del cron job)
 */
router.post('/cron', SyncController.syncCron);

/**
 * POST /sync/manual
 * Sincronización manual on-demand (misma lógica que el cron)
 * Requiere token de seguridad si está configurado
 */
router.post('/manual', SyncController.syncManual);

export default router;

