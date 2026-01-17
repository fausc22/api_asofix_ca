import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller';

const router = Router();

/**
 * GET /internal/vehicles/audit
 * Endpoint de auditoría para obtener el catálogo completo de vehículos
 * 
 * Query params:
 * - format: 'json' (default) o 'csv'
 * 
 * Ejemplos:
 * - GET /internal/vehicles/audit (retorna JSON)
 * - GET /internal/vehicles/audit?format=json (retorna JSON)
 * - GET /internal/vehicles/audit?format=csv (retorna CSV descargable)
 */
router.get('/vehicles/audit', AuditController.getVehiclesAudit);

export default router;

