#!/usr/bin/env ts-node

/**
 * Script para ejecutar la carga inicial completa de vehículos
 * 
 * Uso:
 *   npm run sync:inicial
 *   o
 *   ts-node src/scripts/sync-inicial.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import syncService from '../services/sync-service';
import logger from '../services/logger';
import { VehicleFilters } from '../services/vehicle-filters';

// Cargar variables de entorno
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
  logger.info('🚀 Iniciando carga inicial completa de vehículos...');
  logger.info('');
  
  // Mostrar configuración de filtros
  const filterConfig = VehicleFilters.getFilterSummary();
  logger.info('📋 Filtros obligatorios que se aplicarán:');
  logger.info(`   - Concesionarias bloqueadas: ${filterConfig.blockedBranchOffices.join(', ') || 'ninguna'}`);
  logger.info(`   - Precio mínimo: ${filterConfig.minPrice}`);
  logger.info(`   - Estados bloqueados: ${filterConfig.blockedStatuses.join(', ') || 'ninguno'}`);
  logger.info(`   - Requiere imágenes: ${filterConfig.requireImages ? 'Sí' : 'No'}`);
  logger.info('');

  try {
    const result = await syncService.syncAll(
      (phase, message, progress) => {
        const percentage = progress.total > 0 
          ? Math.round((progress.current / progress.total) * 100)
          : 0;
        logger.info(`[${phase.toUpperCase()}] ${message} (${percentage}%)`);
      },
      false // incremental = false para carga inicial completa
    );

    logger.info('');
    logger.info('🎉 Carga inicial completada exitosamente!');
    logger.info('');
    logger.info('📊 Resumen:');
    logger.info(`   Fase 1 (Datos):`);
    logger.info(`     - Procesados: ${result.fase1.processed}`);
    logger.info(`     - Nuevos: ${result.fase1.created}`);
    logger.info(`     - Actualizados: ${result.fase1.updated}`);
    logger.info(`     - Filtrados: ${result.fase1.filtered}`);
    logger.info(`     - Errores: ${result.fase1.errors}`);
    logger.info(`   Fase 2 (Imágenes):`);
    logger.info(`     - Procesadas: ${result.fase2.processed}`);
    logger.info(`     - Nuevas: ${result.fase2.created}`);
    logger.info(`     - Errores: ${result.fase2.errors}`);
    logger.info('');
    logger.info('✅ Los vehículos están listos para ser consumidos por la web');
    
    process.exit(0);
  } catch (error: any) {
    logger.error('');
    logger.error('❌ Error en carga inicial:');
    logger.error(`   ${error.message}`);
    if (error.stack) {
      logger.error(`   Stack: ${error.stack}`);
    }
    logger.error('');
    process.exit(1);
  }
}

// Ejecutar
main();

