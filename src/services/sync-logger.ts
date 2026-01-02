import pool from '../config/database';
import logger from './logger';

/**
 * Servicio para persistir métricas de sincronización en la tabla sync_logs
 */
export class SyncLogger {
  /**
   * Registra el inicio de una sincronización
   */
  static async logSyncStart(syncType: 'full' | 'incremental' | 'manual'): Promise<number | null> {
    try {
      const [result] = await pool.execute<any>(
        `INSERT INTO sync_logs (sync_type, status, started_at) 
         VALUES (?, 'running', NOW())`,
        [syncType]
      );
      return (result as any).insertId;
    } catch (error: any) {
      // No fallar si la tabla no existe o hay error
      logger.debug(`No se pudo registrar inicio de sync en BD: ${error.message}`);
      return null;
    }
  }

  /**
   * Registra el final exitoso de una sincronización
   */
  static async logSyncComplete(
    syncLogId: number | null,
    stats: {
      vehicles_processed: number;
      vehicles_created: number;
      vehicles_updated: number;
      images_processed: number;
      images_created: number;
      errors_count: number;
    }
  ): Promise<void> {
    if (!syncLogId) return;

    try {
      await pool.execute(
        `UPDATE sync_logs 
         SET status = 'completed',
             vehicles_processed = ?,
             vehicles_created = ?,
             vehicles_updated = ?,
             images_processed = ?,
             images_created = ?,
             errors_count = ?,
             completed_at = NOW()
         WHERE id = ?`,
        [
          stats.vehicles_processed,
          stats.vehicles_created,
          stats.vehicles_updated,
          stats.images_processed,
          stats.images_created,
          stats.errors_count,
          syncLogId
        ]
      );
    } catch (error: any) {
      // No fallar si hay error
      logger.debug(`No se pudo registrar finalización de sync en BD: ${error.message}`);
    }
  }

  /**
   * Registra el fallo de una sincronización
   */
  static async logSyncFailed(
    syncLogId: number | null,
    errorMessage: string,
    stats?: {
      vehicles_processed: number;
      errors_count: number;
    }
  ): Promise<void> {
    if (!syncLogId) return;

    try {
      await pool.execute(
        `UPDATE sync_logs 
         SET status = 'failed',
             vehicles_processed = ?,
             errors_count = ?,
             error_message = ?,
             completed_at = NOW()
         WHERE id = ?`,
        [
          stats?.vehicles_processed || 0,
          stats?.errors_count || 1,
          errorMessage.substring(0, 1000), // Limitar tamaño
          syncLogId
        ]
      );
    } catch (error: any) {
      // No fallar si hay error
      logger.debug(`No se pudo registrar fallo de sync en BD: ${error.message}`);
    }
  }

  /**
   * Obtiene la última sincronización exitosa
   */
  static async getLastSuccessfulSync(): Promise<{
    completed_at: Date | null;
    sync_type: string | null;
    vehicles_processed: number;
  } | null> {
    try {
      const [rows] = await pool.execute<any[]>(
        `SELECT completed_at, sync_type, vehicles_processed
         FROM sync_logs
         WHERE status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 1`
      );
      
      if (rows.length === 0) {
        return null;
      }

      return {
        completed_at: rows[0].completed_at ? new Date(rows[0].completed_at) : null,
        sync_type: rows[0].sync_type,
        vehicles_processed: rows[0].vehicles_processed || 0
      };
    } catch (error: any) {
      // Si la tabla no existe o hay error, retornar null sin fallar
      logger.debug(`No se pudo consultar última sync exitosa: ${error.message}`);
      return null;
    }
  }
}

