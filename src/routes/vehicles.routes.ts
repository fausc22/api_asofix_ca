import { Router } from 'express';
import { VehiclesController } from '../controllers/vehicles.controller';

const router = Router();

/**
 * GET /autos
 * Obtiene vehículos con filtros aplicados
 */
router.get('/', VehiclesController.getVehicles);

/**
 * GET /autos/filters/options
 * Obtiene opciones de filtros disponibles
 */
router.get('/filters/options', VehiclesController.getFilterOptions);

/**
 * GET /autos/:id/related
 * Obtiene vehículos relacionados
 */
router.get('/:id/related', VehiclesController.getRelatedVehicles);

/**
 * GET /autos/:id
 * Obtiene un vehículo por ID
 */
router.get('/:id', VehiclesController.getVehicleById);

export default router;

