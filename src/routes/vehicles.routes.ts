import { Router, Request, Response, NextFunction } from 'express';
import { VehiclesController } from '../controllers/vehicles.controller';

const router = Router();

// Middleware de cache para endpoints de solo lectura (GET)
const NODE_ENV = process.env.NODE_ENV || 'development';
const cacheMiddleware = (duration: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Solo aplicar cache a métodos GET y en producción
    if (req.method === 'GET' && NODE_ENV === 'production') {
      res.setHeader('Cache-Control', `public, max-age=${duration}`);
    }
    next();
  };
};

// Aplicar cache a todas las rutas GET de vehículos (5 minutos)
router.use(cacheMiddleware(300));

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

