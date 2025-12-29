import cron from 'node-cron';
import syncService from '../services/sync-service';
import logger from '../services/logger';
import axios from 'axios';

class SyncCronJob {
  private syncJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private baseUrl: string;

  constructor() {
    const port = process.env.PORT || 3002;
    this.baseUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
  }

  /**
   * Inicia el cron job de sincronización
   * Por defecto se ejecuta cada 1 hora
   */
  start(): void {
    if (this.syncJob) {
      logger.warn('⚠️  El cron job ya está corriendo');
      return;
    }

    // Configurar cron job cada 1 hora
    // Formato: minuto hora día mes día-semana
    // '0 * * * *' = cada hora en el minuto 0
    const cronExpression = process.env.SYNC_CRON_SCHEDULE || '0 * * * *';
    
    logger.info(`📅 Configurando cron job de sincronización: ${cronExpression}`);
    logger.info('⏰ La sincronización se ejecutará cada 1 hora (o según SYNC_CRON_SCHEDULE)');

    this.syncJob = cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        logger.warn('⚠️  Sincronización ya en ejecución, omitiendo...');
        return;
      }

      this.isRunning = true;
      logger.info('🔄 Iniciando sincronización automática (cron job)...');

      try {
        // Llamar al endpoint de sincronización
        const response = await axios.post(`${this.baseUrl}/sync/cron`, {}, {
          timeout: 3600000, // 1 hora de timeout
        });

        if (response.data.success) {
          logger.info('✅ Sincronización automática completada exitosamente');
          logger.info(`📊 Resumen: ${JSON.stringify(response.data.data.summary)}`);
        } else {
          logger.error(`❌ Sincronización completada con errores: ${response.data.message}`);
        }
      } catch (error: any) {
        logger.error(`❌ Error en sincronización automática: ${error.message}`);
        
        // Si falla la llamada HTTP, intentar ejecutar directamente
        try {
          logger.info('🔄 Intentando ejecutar sincronización directamente...');
          const result = await syncService.syncAll(
            (phase, message, progress) => {
              logger.info(`[${phase.toUpperCase()}] ${message} (${progress.percentage}%)`);
            },
            true // incremental
          );
          
          logger.info('✅ Sincronización directa completada');
          logger.info(`📊 Resumen: ${result.fase1.processed} vehículos procesados`);
        } catch (directError: any) {
          logger.error(`❌ Error en sincronización directa: ${directError.message}`);
        }
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: process.env.TZ || 'America/Argentina/Buenos_Aires'
    });

    logger.info('✅ Cron job iniciado correctamente');
  }

  /**
   * Detiene el cron job
   */
  stop(): void {
    if (this.syncJob) {
      this.syncJob.stop();
      this.syncJob = null;
      logger.info('🛑 Cron job detenido');
    }
  }

  /**
   * Verifica si el cron job está activo
   */
  isActive(): boolean {
    return this.syncJob !== null;
  }

  /**
   * Ejecuta la sincronización manualmente (útil para testing)
   */
  async runManualSync(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Sincronización ya en ejecución');
    }

    this.isRunning = true;
    try {
      logger.info('🔄 Ejecutando sincronización manual...');

      const result = await syncService.syncAll(
        (phase, message, progress) => {
          logger.info(`[${phase.toUpperCase()}] ${message} (${progress.percentage}%)`);
        },
        true // incremental
      );

      logger.info('✅ Sincronización manual completada exitosamente');
      logger.info(`📊 Resumen: ${result.fase1.processed} vehículos procesados`);
    } catch (error: any) {
      logger.error(`❌ Error en sincronización manual: ${error.message}`);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
}

export default new SyncCronJob();

