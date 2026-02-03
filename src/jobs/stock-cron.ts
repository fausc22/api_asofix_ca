/**
 * Cron job para generar y subir stock a Google Sheets
 * Se ejecuta cada hora a los 30 minutos (08:30, 09:30, 10:30, etc.)
 */
import cron from 'node-cron';
import bigQueryService from '../services/big-query.service';
import { getGoogleConfig } from '../config/google.config';
import path from 'path';
import logger from '../services/logger';

class StockCronJob {
  private stockJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  /**
   * Inicia el cron job de stock
   * Por defecto se ejecuta cada hora a los 30 minutos
   */
  start(): void {
    if (this.stockJob) {
      logger.warn('⚠️  El cron job de stock ya está corriendo');
      return;
    }

    // Configurar cron job cada hora a los 30 minutos
    // Formato: minuto hora día mes día-semana
    // '30 * * * *' = cada hora a los 30 minutos
    const cronExpression = process.env.STOCK_CRON_SCHEDULE || '30 * * * *';
    
    logger.info(`📅 Configurando cron job de stock: ${cronExpression}`);
    logger.info('⏰ El stock se ejecutará cada hora a los 30 minutos (08:30, 09:30, 10:30, etc.)');

    this.stockJob = cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        logger.warn('⚠️  Generación de stock ya en ejecución, omitiendo...');
        return;
      }

      this.isRunning = true;
      logger.info('🔄 Iniciando generación de stock automática (cron job)...');

      try {
        await this.executeStockGeneration();
        logger.info('✅ Generación de stock automática completada exitosamente');
      } catch (error: any) {
        logger.error(`❌ Error en generación de stock automática: ${error.message}`);
        logger.error('Stack:', error.stack);
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: process.env.TZ || 'America/Argentina/Buenos_Aires'
    });

    logger.info('✅ Cron job de stock iniciado correctamente');
  }

  /**
   * Detiene el cron job
   */
  stop(): void {
    if (this.stockJob) {
      this.stockJob.stop();
      this.stockJob = null;
      logger.info('🛑 Cron job de stock detenido');
    }
  }

  /**
   * Verifica si el cron job está activo
   */
  isActive(): boolean {
    return this.stockJob !== null;
  }

  /**
   * Ejecuta la generación de stock manualmente (útil para testing)
   */
  async runManualGeneration(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Generación de stock ya en ejecución');
    }

    this.isRunning = true;
    try {
      logger.info('🔄 Ejecutando generación de stock manual...');
      await this.executeStockGeneration();
      logger.info('✅ Generación de stock manual completada exitosamente');
    } catch (error: any) {
      logger.error(`❌ Error en generación de stock manual: ${error.message}`);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Ejecuta el proceso completo de generación y subida de stock
   */
  private async executeStockGeneration(): Promise<void> {
    try {
      const config = getGoogleConfig();
      const specificFileId = config.STOCK_FILE_ID;
      const sheetName = config.STOCK_SHEET_NAME;

      logger.info('📊 Iniciando proceso completo de generación de stock...');

      // 1. Obtener datos de BigQuery
      logger.info('📊 Obteniendo datos de stock desde BigQuery...');
      const rows = await bigQueryService.getStockData();
      const mappedRows = rows.map(row => bigQueryService.mapColumnNames(row));

      logger.info(`📋 ${rows.length} registros obtenidos de BigQuery`);

      // 2. Generar Excel local
      logger.info('📊 Generando Excel local...');
      const outputPath = path.join(__dirname, '../../Stock_Asofix.xlsx');
      const excelResult = await bigQueryService.generateStockExcel(outputPath);

      logger.info(`✅ Excel generado: ${excelResult.filePath} (${excelResult.recordCount} registros)`);

      // 3. Subir/Actualizar en Google Sheets
      logger.info('📤 Subiendo/actualizando en Google Sheets...');
      const uploadResult = await bigQueryService.uploadOrUpdateGoogleSheets(
        outputPath,
        sheetName,
        mappedRows,
        specificFileId
      );

      logger.info('✅ Proceso completado exitosamente');
      logger.info(`📊 Excel: ${excelResult.recordCount} registros`);
      logger.info(`📤 Google Sheets: ${uploadResult.mainUrl || 'URL no disponible'}`);

    } catch (error: any) {
      logger.error('❌ Error ejecutando generación de stock:', error);
      throw error;
    }
  }
}

export default new StockCronJob();
