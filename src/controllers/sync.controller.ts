import { Request, Response } from 'express';
import syncService from '../services/sync-service';
import logger from '../services/logger';

/**
 * Controlador para endpoints de sincronización
 */
export class SyncController {
  /**
   * POST /sync/inicial
   * Carga inicial completa de todos los autos desde ASOFIX
   * Aplica todos los filtros obligatorios durante la sincronización
   */
  static async syncInicial(req: Request, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    req.on('close', () => {
      logger.info('Cliente desconectado de la sincronización inicial');
      res.end();
    });

    try {
      sendEvent({
        type: 'start',
        message: '🚀 Iniciando carga inicial completa de vehículos desde ASOFIX...',
        timestamp: new Date().toISOString()
      });

      // Ejecutar sincronización completa (no incremental)
      const result = await syncService.syncAll((phase, message, progress) => {
        sendEvent({
          type: 'progress',
          phase,
          message,
          progress: {
            current: progress.current,
            total: progress.total,
            percentage: progress.percentage
          },
          timestamp: new Date().toISOString()
        });
      }, false); // incremental = false para carga inicial completa

      sendEvent({
        type: 'complete',
        message: '✅ Carga inicial completada',
        result: {
          fase1: {
            processed: result.fase1.processed,
            created: result.fase1.created,
            updated: result.fase1.updated,
            filtered: result.fase1.filtered,
            errors: result.fase1.errors
          },
          fase2: {
            processed: result.fase2.processed,
            created: result.fase2.created,
            errors: result.fase2.errors
          }
        },
        timestamp: new Date().toISOString()
      });

      res.end();
    } catch (error: any) {
      logger.error(`Error en sincronización inicial: ${error.message}`);
      
      sendEvent({
        type: 'error',
        message: `❌ Error fatal: ${error.message}`,
        timestamp: new Date().toISOString()
      });
      res.end();
    }
  }

  /**
   * POST /sync/cron
   * Sincronización incremental (para uso del cron job)
   * Solo actualiza vehículos que han cambiado
   */
  static async syncCron(req: Request, res: Response) {
    try {
      logger.info('🔄 Iniciando sincronización incremental (cron)...');

      const result = await syncService.syncAll(
        (phase, message, progress) => {
          logger.info(`[${phase.toUpperCase()}] ${message} (${progress.percentage}%)`);
        },
        true // incremental = true
      );

      res.json({
        success: true,
        message: 'Sincronización incremental completada',
        data: {
          summary: {
            vehicles: {
              processed: result.fase1.processed,
              created: result.fase1.created,
              updated: result.fase1.updated,
              filtered: result.fase1.filtered,
              errors: result.fase1.errors
            },
            images: {
              processed: result.fase2.processed,
              created: result.fase2.created,
              errors: result.fase2.errors
            }
          },
          details: result
        }
      });
    } catch (error: any) {
      logger.error(`Error en sincronización cron: ${error.message}`);
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * POST /sync/manual
   * Sincronización manual on-demand
   * Misma lógica que syncCron pero con validación de seguridad opcional
   * Respuesta detallada con estadísticas completas
   */
  static async syncManual(req: Request, res: Response) {
    try {
      // Validación de seguridad opcional
      const syncToken = process.env.SYNC_MANUAL_TOKEN;
      if (syncToken) {
        const providedToken = req.headers['x-sync-token'] || req.body.token;
        if (providedToken !== syncToken) {
          logger.warn('Intento de sincronización manual sin token válido');
          return res.status(401).json({
            success: false,
            message: 'Token de autorización requerido para sincronización manual'
          });
        }
      }

      logger.info('🔄 Iniciando sincronización manual (on-demand)...');

      const startTime = Date.now();
      const result = await syncService.syncAll(
        (phase, message, progress) => {
          logger.info(`[${phase.toUpperCase()}] ${message} (${progress.percentage}%)`);
        },
        true // incremental = true (misma lógica que cron)
      );

      const duration = Math.round((Date.now() - startTime) / 1000); // segundos

      logger.info(`✅ Sincronización manual completada en ${duration}s`);

      res.json({
        success: true,
        message: 'Sincronización manual completada exitosamente',
        data: {
          duration_seconds: duration,
          timestamp: new Date().toISOString(),
          summary: {
            vehicles: {
              processed: result.fase1.processed,
              created: result.fase1.created,
              updated: result.fase1.updated,
              filtered: result.fase1.filtered,
              errors: result.fase1.errors
            },
            images: {
              processed: result.fase2.processed,
              created: result.fase2.created,
              errors: result.fase2.errors
            }
          },
          details: result
        }
      });
    } catch (error: any) {
      logger.error(`Error en sincronización manual: ${error.message}`);
      res.status(500).json({
        success: false,
        message: error.message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}

