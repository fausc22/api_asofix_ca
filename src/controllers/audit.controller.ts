import { Request, Response } from 'express';
import auditService from '../services/audit.service';
import logger from '../services/logger';

export class AuditController {
  /**
   * GET /internal/vehicles/audit
   * Obtiene el catálogo completo de vehículos para auditoría
   * 
   * Query params:
   * - format: 'json' (default) o 'csv'
   */
  static async getVehiclesAudit(req: Request, res: Response): Promise<void> {
    try {
      const format = (req.query.format as string) || 'json';
      
      logger.info('Solicitud de auditoría de vehículos recibida', { format });

      const auditResult = await auditService.getAllVehiclesForAudit();

      if (format === 'csv') {
        const csv = auditService.convertToCSV(auditResult);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="vehicles-audit-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
      } else {
        res.json({
          success: true,
          data: auditResult
        });
      }
    } catch (error: any) {
      logger.error(`Error en auditoría de vehículos: ${error.message}`, {
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        message: 'Error al obtener datos de auditoría',
        error: error.message
      });
    }
  }
}

