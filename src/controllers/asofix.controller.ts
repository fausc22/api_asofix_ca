import { Request, Response } from 'express';
import asofixApi from '../services/asofix-api';
import logger from '../services/logger';

/**
 * Controlador para endpoints que interactúan directamente con la API de Asofix
 * Estos endpoints NO interactúan con la base de datos
 */
export class AsofixController {
  /**
   * GET /asofix/vehicle/:license_plate
   * Busca un vehículo por license_plate directamente en la API de Asofix
   * No interactúa con la base de datos
   */
  static async getVehicleByLicensePlate(req: Request, res: Response) {
    try {
      const { license_plate } = req.params;

      if (!license_plate || license_plate.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'El parámetro license_plate es requerido'
        });
      }

      logger.info(`Buscando vehículo en Asofix con license_plate: ${license_plate}`);

      const vehicle = await asofixApi.getVehicleByLicensePlate(license_plate);

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: `No se encontró ningún vehículo con license_plate: ${license_plate}`
        });
      }

      logger.info(`Vehículo encontrado: ${vehicle.id} - ${vehicle.brand_name} ${vehicle.model_name}`);

      res.json({
        success: true,
        data: vehicle
      });
    } catch (error: any) {
      logger.error(`Error en GET /asofix/vehicle/:license_plate: ${error.message}`);
      logger.error(`Stack: ${error.stack}`);
      
      // Si es un error de API Key, devolver un mensaje más claro
      if (error.message?.includes('API Key')) {
        return res.status(500).json({
          success: false,
          message: 'Error de configuración: La API Key de Asofix no está configurada correctamente'
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Error al buscar vehículo en la API de Asofix'
      });
    }
  }

  /**
   * GET /asofix/vehicle/origin/:origin
   * Busca un vehículo por origin directamente en la API de Asofix
   * No interactúa con la base de datos
   */
  static async getVehicleByOrigin(req: Request, res: Response) {
    try {
      const { origin } = req.params;

      if (!origin || origin.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'El parámetro origin es requerido'
        });
      }

      logger.info(`Buscando vehículo en Asofix con origin: ${origin}`);

      const vehicle = await asofixApi.getVehicleByOrigin(origin);

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: `No se encontró ningún vehículo con origin: ${origin}`
        });
      }

      logger.info(`Vehículo encontrado: ${vehicle.id} - ${vehicle.brand_name} ${vehicle.model_name}`);

      res.json({
        success: true,
        data: vehicle
      });
    } catch (error: any) {
      logger.error(`Error en GET /asofix/vehicle/origin/:origin: ${error.message}`);
      logger.error(`Stack: ${error.stack}`);
      
      // Si es un error de API Key, devolver un mensaje más claro
      if (error.message?.includes('API Key')) {
        return res.status(500).json({
          success: false,
          message: 'Error de configuración: La API Key de Asofix no está configurada correctamente'
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Error al buscar vehículo en la API de Asofix'
      });
    }
  }
}

