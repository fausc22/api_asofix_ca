import pool from '../config/database';
import logger from './logger';
import asofixApi, { AsofixVehicle } from './asofix-api';
import { VehicleFilters } from './vehicle-filters';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';

export interface VehicleData {
  asofix_id: string;
  title: string;
  content: string;
  brand: string | null;
  model: string | null;
  condition: string | null;
  transmission: string | null;
  fuel_type: string | null;
  color: string | null;
  segment: string | null;
  year: number | null;
  kilometres: number;
  license_plate: string | null;
  price_usd: number | null;
  price_ars: number | null;
  status: string;
}

class SyncService {
  /**
   * Encuentra un vehículo por su ID de Asofix
   */
  async findVehicleByAsofixId(asofixId: string): Promise<number | null> {
    try {
      const [rows] = await pool.execute<any[]>(
        'SELECT id FROM vehicles WHERE asofix_id = ?',
        [asofixId]
      );
      return rows.length > 0 ? rows[0].id : null;
    } catch (error: any) {
      logger.error(`Error al buscar vehículo por Asofix ID: ${error.message}`);
      return null;
    }
  }

  /**
   * Obtiene o crea un término de taxonomía
   */
  async getOrCreateTerm(taxonomy: string, termName: string): Promise<number | null> {
    if (!termName || !termName.trim()) return null;

    try {
      const [existing] = await pool.execute<any[]>(
        'SELECT id FROM taxonomy_terms WHERE taxonomy = ? AND name = ?',
        [taxonomy, termName.trim()]
      );

      if (existing.length > 0) {
        return existing[0].id;
      }

      const [result] = await pool.execute<any>(
        'INSERT INTO taxonomy_terms (taxonomy, name) VALUES (?, ?)',
        [taxonomy, termName.trim()]
      );

      return (result as any).insertId;
    } catch (error: any) {
      logger.error(`Error al crear/buscar término "${termName}" en "${taxonomy}": ${error.message}`);
      return null;
    }
  }

  /**
   * Asigna taxonomías a un vehículo
   */
  async assignTaxonomies(vehicleId: number, vehicle: AsofixVehicle): Promise<void> {
    const taxonomyMap: Record<string, string | null> = {
      brand: vehicle.brand_name || null,
      model: vehicle.model_name || null,
      condition: vehicle.car_condition === 'new' ? '0KM' : 'Usado',
      transmission: vehicle.car_transmission || null,
      fuel_type: vehicle.car_fuel_type || null,
      color: vehicle.colors?.[0]?.name || null,
      segment: vehicle.car_segment || null,
    };

    for (const [taxonomy, termName] of Object.entries(taxonomyMap)) {
      if (termName) {
        const termId = await this.getOrCreateTerm(taxonomy, termName);
        if (termId) {
          try {
            await pool.execute(
              'DELETE FROM vehicle_taxonomies WHERE vehicle_id = ? AND taxonomy = ?',
              [vehicleId, taxonomy]
            );
            await pool.execute(
              'INSERT INTO vehicle_taxonomies (vehicle_id, taxonomy, term_id) VALUES (?, ?, ?)',
              [vehicleId, taxonomy, termId]
            );
          } catch (error: any) {
            logger.error(`Error al asignar taxonomía ${taxonomy}: ${error.message}`);
          }
        }
      }
    }
  }

  /**
   * Establece los metadatos de un vehículo
   */
  async setVehicleMetadata(vehicleId: number, vehicle: AsofixVehicle): Promise<void> {
    const kilometres = parseInt(String(vehicle.kilometres || 0));
    const finalKilometres = kilometres < 100 ? 0 : kilometres;

    const price = parseFloat(String(vehicle.price?.list_price || 0));
    const currency = vehicle.price?.currency_name || '';

    let priceUsd: number | null = null;
    let priceArs: number | null = null;

    if (currency.toLowerCase().includes('dolar') || currency.toLowerCase().includes('usd')) {
      if (price >= 1000) {
        priceUsd = price;
      }
    } else {
      if (price > 901000) {
        priceArs = price;
      } else if (price >= 1000 && price <= 900000) {
        priceUsd = price;
      }
    }

    try {
      await pool.execute(
        `UPDATE vehicles SET 
          kilometres = ?,
          year = ?,
          license_plate = ?,
          price_usd = ?,
          price_ars = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          finalKilometres,
          vehicle.year || null,
          vehicle.license_plate || null,
          priceUsd,
          priceArs,
          vehicleId
        ]
      );
    } catch (error: any) {
      logger.error(`Error al actualizar metadatos del vehículo: ${error.message}`);
    }
  }

  /**
   * Guarda las URLs de imágenes pendientes
   */
  async savePendingImages(vehicleId: number, imageUrls: string[]): Promise<void> {
    if (imageUrls.length === 0) return;

    try {
      await pool.execute(
        'DELETE FROM pending_images WHERE vehicle_id = ?',
        [vehicleId]
      );

      for (const url of imageUrls) {
        await pool.execute(
          'INSERT INTO pending_images (vehicle_id, image_url) VALUES (?, ?)',
          [vehicleId, url]
        );
      }
    } catch (error: any) {
      logger.error(`Error al guardar imágenes pendientes: ${error.message}`);
    }
  }

  /**
   * Genera un hash de versión para detectar cambios en un vehículo
   * Incluye URLs de imágenes ordenadas para detectar cambios en el set de imágenes
   */
  private generateVersionHash(vehicle: AsofixVehicle): string {
    // Ordenar URLs de imágenes para comparación consistente
    const imageUrls = (vehicle.images || [])
      .map(img => img.url || '')
      .filter(url => url)
      .sort();
    
    const relevantData = {
      id: vehicle.id,
      title: `${vehicle.brand_name || ''} ${vehicle.model_name || ''} ${vehicle.version || ''}`.trim(),
      description: vehicle.description || '',
      year: vehicle.year,
      kilometres: vehicle.kilometres,
      price: vehicle.price?.list_price || 0,
      currency: vehicle.price?.currency_name || '',
      condition: vehicle.car_condition,
      transmission: vehicle.car_transmission,
      fuel_type: vehicle.car_fuel_type,
      segment: vehicle.car_segment,
      color: vehicle.colors?.[0]?.name || '',
      license_plate: vehicle.license_plate,
      images_urls: imageUrls, // URLs ordenadas para detectar cambios
      images_count: imageUrls.length,
      stock_status: vehicle.stocks?.find(s => s.status?.toUpperCase() === 'ACTIVO')?.status || ''
    };
    
    const dataString = JSON.stringify(relevantData);
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }

  /**
   * Verifica si un vehículo necesita actualización comparando versiones
   */
  async needsUpdate(asofixId: string, newHash: string): Promise<boolean> {
    try {
      const [rows] = await pool.execute<any[]>(
        'SELECT version_hash FROM vehicles WHERE asofix_id = ?',
        [asofixId]
      );
      
      if (rows.length === 0) {
        return true; // Vehículo nuevo
      }
      
      const currentHash = rows[0].version_hash;
      return currentHash !== newHash;
    } catch (error: any) {
      logger.error(`Error al verificar actualización: ${error.message}`);
      return true;
    }
  }

  /**
   * Procesa un vehículo (Fase 1: sin imágenes) con lógica incremental
   * IMPORTANTE: Aplica los filtros obligatorios antes de procesar
   */
  async processVehicle(vehicle: AsofixVehicle, incremental: boolean = false): Promise<{ 
    success: boolean; 
    message: string; 
    vehicleId?: number; 
    wasNew?: boolean; 
    wasUpdated?: boolean;
    filtered?: boolean;
  }> {
    const asofixId = vehicle.id;
    if (!asofixId) {
      return { success: false, message: 'Falta Asofix ID' };
    }

    // APLICAR FILTROS OBLIGATORIOS
    const { omit, reason } = VehicleFilters.shouldOmitVehicle(vehicle);
    const existingId = await this.findVehicleByAsofixId(asofixId);
    
    if (omit) {
      // Vehículo debe ser filtrado: archivar si existe
      if (existingId) {
        try {
          // Obtener additional_data actual para preservar y agregar filter_reason
          const [existingRows] = await pool.execute<any[]>(
            'SELECT additional_data FROM vehicles WHERE id = ?',
            [existingId]
          );
          
          let additionalData: any = {};
          try {
            additionalData = existingRows[0]?.additional_data ? JSON.parse(existingRows[0].additional_data) : {};
          } catch (e) {
            // Si hay error parseando, usar objeto vacío
          }
          
          // Determinar filter_reason basado en la razón
          let filterReason = 'unknown';
          if (reason?.toLowerCase().includes('dakota') || reason?.toLowerCase().includes('location_name')) {
            filterReason = 'dakota_location';
          } else if (reason?.toLowerCase().includes('precio')) {
            filterReason = 'min_price';
          } else if (reason?.toLowerCase().includes('estado')) {
            filterReason = 'blocked_status';
          } else if (reason?.toLowerCase().includes('imagen')) {
            filterReason = 'no_images';
          } else if (reason?.toLowerCase().includes('stock')) {
            filterReason = 'no_active_stock';
          }
          
          additionalData.filter_reason = filterReason;
          
          await pool.execute(
            'UPDATE vehicles SET status = ?, additional_data = ?, updated_at = NOW() WHERE id = ?',
            ['archived', JSON.stringify(additionalData), existingId]
          );
          logger.warn(`Vehículo ${asofixId} archivado por filtro: ${reason}`);
        } catch (error: any) {
          logger.error(`Error al archivar vehículo ${asofixId}: ${error.message}`);
        }
      }
      return { success: true, message: `FILTRADO: ${reason}`, filtered: true };
    } else {
      // Vehículo NO debe ser filtrado: reactivar si estaba archivado
      if (existingId) {
        try {
          // Verificar si está archivado
          const [statusRows] = await pool.execute<any[]>(
            'SELECT status, additional_data FROM vehicles WHERE id = ?',
            [existingId]
          );
          
          if (statusRows[0]?.status === 'archived') {
            // Remover filter_reason del additional_data si existe
            let additionalData: any = {};
            try {
              additionalData = statusRows[0]?.additional_data ? JSON.parse(statusRows[0].additional_data) : {};
            } catch (e) {
              // Si hay error parseando, usar objeto vacío
            }
            
            if (additionalData.filter_reason) {
              delete additionalData.filter_reason;
            }
            
            await pool.execute(
              'UPDATE vehicles SET status = ?, additional_data = ?, updated_at = NOW() WHERE id = ?',
              ['published', JSON.stringify(additionalData), existingId]
            );
            logger.info(`Vehículo ${asofixId} reactivado (ya no cumple filtros de exclusión)`);
          }
        } catch (error: any) {
          logger.error(`Error al reactivar vehículo ${asofixId}: ${error.message}`);
        }
      }
    }

    // Generar hash de versión para detectar cambios
    const versionHash = this.generateVersionHash(vehicle);
    
    // En modo incremental, verificar si necesita actualización
    if (incremental) {
      const needsUpdate = await this.needsUpdate(asofixId, versionHash);
      if (!needsUpdate) {
        await pool.execute(
          'UPDATE vehicles SET last_synced_at = NOW() WHERE asofix_id = ?',
          [asofixId]
        );
        return { 
          success: true, 
          message: `Sin cambios para ${asofixId}`,
          wasNew: false,
          wasUpdated: false
        };
      }
    }

    // Preparar datos
    const brand = vehicle.brand_name || '';
    const model = vehicle.model_name || '';
    const version = vehicle.version || '';
    const title = `${brand} ${model} ${version}`.trim() || `Vehículo Asofix ID: ${asofixId}`;
    const content = vehicle.description || '';

    const additionalData = {
      version: vehicle.version || null,
      brand_id: (vehicle as any).brand_id || null,
      model_id: (vehicle as any).model_id || null,
      stock_info: vehicle.stocks?.map(s => ({
        status: s.status,
        branch_office_name: s.branch_office_name,
        location_name: s.location_name
      })) || [],
      colors: vehicle.colors || [],
      original_price: vehicle.price || null
    };

    try {
      const existingId = await this.findVehicleByAsofixId(asofixId);
      const wasNew = !existingId;
      const wasUpdated = !!existingId;

      let vehicleId: number;

      if (existingId) {
        // Actualizar vehículo existente
        await pool.execute(
          `UPDATE vehicles SET 
            title = ?,
            content = ?,
            status = 'published',
            version_hash = ?,
            last_synced_at = NOW(),
            asofix_updated_at = NOW(),
            additional_data = ?,
            updated_at = NOW()
          WHERE id = ?`,
          [title, content, versionHash, JSON.stringify(additionalData), existingId]
        );
        vehicleId = existingId;

        // LÓGICA IDEMPOTENTE: Comparar URLs antes de eliminar imágenes
        const newImageUrls = (vehicle.images || []).map(img => img.url || '').filter(url => url);
        
        // Obtener URLs de imágenes existentes
        const [existingImages] = await pool.execute<any[]>(
          'SELECT image_url FROM vehicle_images WHERE vehicle_id = ?',
          [vehicleId]
        );
        const existingUrls = existingImages.map((img: any) => img.image_url).filter((url: string) => url);
        
        // Convertir a Sets para comparación eficiente
        const newUrlsSet = new Set(newImageUrls);
        const existingUrlsSet = new Set(existingUrls);
        
        // Encontrar URLs que deben eliminarse (existen en BD pero no en nueva data)
        const urlsToDelete = existingUrls.filter(url => !newUrlsSet.has(url));
        
        // Encontrar URLs que deben agregarse (existen en nueva data pero no en BD)
        const urlsToAdd = newImageUrls.filter(url => !existingUrlsSet.has(url));
        
        // Eliminar solo las imágenes que ya no están en la nueva lista
        if (urlsToDelete.length > 0) {
          // MySQL requiere placeholders individuales para IN clause
          const placeholders = urlsToDelete.map(() => '?').join(',');
          await pool.execute(
            `DELETE FROM vehicle_images WHERE vehicle_id = ? AND image_url IN (${placeholders})`,
            [vehicleId, ...urlsToDelete]
          );
          logger.info(`Eliminadas ${urlsToDelete.length} imágenes obsoletas para vehículo ${vehicleId}`);
        }
        
        // Solo guardar URLs nuevas en pending_images (las existentes no se vuelven a descargar)
        if (urlsToAdd.length > 0) {
          await this.savePendingImages(vehicleId, urlsToAdd);
          logger.info(`Agregadas ${urlsToAdd.length} nuevas URLs a pending_images para vehículo ${vehicleId}`);
        } else {
          // Si no hay URLs nuevas, limpiar pending_images para este vehículo
          await pool.execute('DELETE FROM pending_images WHERE vehicle_id = ?', [vehicleId]);
        }
      } else {
        // Crear nuevo vehículo
        const [result] = await pool.execute<any>(
          `INSERT INTO vehicles (
            asofix_id, title, content, status, version_hash, last_synced_at, asofix_updated_at, additional_data, created_at, updated_at
          ) VALUES (?, ?, ?, 'published', ?, NOW(), NOW(), ?, NOW(), NOW())`,
          [asofixId, title, content, versionHash, JSON.stringify(additionalData)]
        );
        vehicleId = (result as any).insertId;
      }

      // Asignar taxonomías
      await this.assignTaxonomies(vehicleId, vehicle);

      // Establecer metadatos
      await this.setVehicleMetadata(vehicleId, vehicle);

      // Guardar URLs de imágenes pendientes (solo si es vehículo nuevo)
      if (wasNew) {
      const imageUrls = (vehicle.images || []).map(img => img.url || '').filter(url => url);
      await this.savePendingImages(vehicleId, imageUrls);
      }

      return {
        success: true,
        message: wasNew 
          ? `NUEVO: ${asofixId} creado (Vehicle ID: ${vehicleId})`
          : `ACTUALIZADO: ${asofixId} (Vehicle ID: ${vehicleId})`,
        vehicleId,
        wasNew,
        wasUpdated
      };
    } catch (error: any) {
      logger.error(`Error al procesar vehículo ${asofixId}: ${error.message}`);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Obtiene vehículos con imágenes pendientes
   */
  async getPendingImages(): Promise<Array<{ vehicle_id: number; image_url: string }>> {
    try {
      const [rows] = await pool.execute<any[]>(
        'SELECT vehicle_id, image_url FROM pending_images ORDER BY id'
      );
      return rows;
    } catch (error: any) {
      logger.error(`Error al obtener imágenes pendientes: ${error.message}`);
      return [];
    }
  }

  /**
   * Descarga y guarda una imagen
   * Proceso idempotente: verifica si la imagen ya existe antes de insertar
   */
  async downloadImage(imageUrl: string, vehicleId: number): Promise<{ success: boolean; message: string; imageId?: number }> {
    try {
      // Verificar si la imagen ya existe (proceso idempotente)
      const [existingImage] = await pool.execute<any[]>(
        'SELECT id FROM vehicle_images WHERE vehicle_id = ? AND image_url = ? LIMIT 1',
        [vehicleId, imageUrl]
      );

      // Si ya existe, retornar éxito sin descargar ni insertar
      if (existingImage && existingImage.length > 0) {
        const existingImageId = existingImage[0].id;
        
        // Eliminar de pendientes (por si acaso)
        await pool.execute(
          'DELETE FROM pending_images WHERE vehicle_id = ? AND image_url = ?',
          [vehicleId, imageUrl]
        );

        return {
          success: true,
          message: `Imagen ya existe para vehículo ${vehicleId}`,
          imageId: existingImageId
        };
      }

      const highResUrl = imageUrl.replace('/th-', '/');

      // Usar IMAGES_PATH si está configurado, sino UPLOAD_PATH, sino default
      const imagesPath = process.env.IMAGES_PATH || process.env.UPLOAD_PATH || './uploads';
      const vehicleDir = path.join(imagesPath, 'autos', String(vehicleId));
      if (!fs.existsSync(vehicleDir)) {
        fs.mkdirSync(vehicleDir, { recursive: true });
      }

      const response = await axios.get(highResUrl, {
        responseType: 'arraybuffer',
        timeout: 300000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const urlParts = highResUrl.split('/');
      const filename = urlParts[urlParts.length - 1] || `image-${Date.now()}.jpg`;
      const filePath = path.join(vehicleDir, filename);

      fs.writeFileSync(filePath, response.data);

      const [result] = await pool.execute<any>(
        'INSERT INTO vehicle_images (vehicle_id, image_url, file_path) VALUES (?, ?, ?)',
        [vehicleId, imageUrl, filePath]
      );

      const imageId = (result as any).insertId;

      // Si es la primera imagen, establecer como destacada
      const [existingImages] = await pool.execute<any[]>(
        'SELECT COUNT(*) as count FROM vehicle_images WHERE vehicle_id = ?',
        [vehicleId]
      );
      if (existingImages[0].count === 1) {
        await pool.execute(
          'UPDATE vehicles SET featured_image_id = ? WHERE id = ?',
          [imageId, vehicleId]
        );
      }

      // Eliminar de pendientes
      await pool.execute(
        'DELETE FROM pending_images WHERE vehicle_id = ? AND image_url = ?',
        [vehicleId, imageUrl]
      );

      return {
        success: true,
        message: `Imagen descargada para vehículo ${vehicleId}`,
        imageId
      };
    } catch (error: any) {
      logger.error(`Error al descargar imagen ${imageUrl}: ${error.message}`);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Sincroniza una página de vehículos
   * IMPORTANTE: NO filtra por stock ACTIVO aquí - deja que processVehicle maneje todos los vehículos
   * para que pueda archivar correctamente los que ya no están activos/reservados/eliminados
   */
  async syncPage(page: number): Promise<{ vehicles: AsofixVehicle[]; hasMore: boolean }> {
    try {
      const response = await asofixApi.getVehiclesPage(page);
      const allVehicles = response.data || [];

      // NO filtrar por stock ACTIVO aquí - processVehicle manejará todos los vehículos
      // Esto permite archivar vehículos que pasaron de activos a reservados/eliminados
      // APLICAR SOLO FILTROS DE NEGOCIO (no stock activo)
      // Nota: VehicleFilters.filterVehicles aplicará shouldOmitVehicle que verifica stock activo,
      // pero processVehicle necesita recibir TODOS los vehículos para poder archivarlos correctamente
      
      // Retornar TODOS los vehículos - processVehicle aplicará los filtros y archivará los omitidos
      const meta = response.meta;
      const hasMore = meta ? (meta.current_page || 0) < (meta.total_pages || 0) : allVehicles.length > 0;

      return { vehicles: allVehicles, hasMore };
    } catch (error: any) {
      logger.error(`Error al sincronizar página ${page}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Descarga todas las imágenes pendientes
   */
  async downloadAllImages(
    onProgress?: (message: string, progress: { current: number; total: number; percentage: number }) => void,
    delay: number = 0
  ): Promise<{ processed: number; created: number; errors: number }> {
    let processed = 0;
    let created = 0;
    let errors = 0;

    onProgress?.('🖼️  Iniciando descarga de imágenes...', { current: 0, total: 0, percentage: 0 });

    try {
      const pendingImages = await this.getPendingImages();

      if (pendingImages.length === 0) {
        onProgress?.('✅ No se encontraron imágenes pendientes.', { current: 0, total: 0, percentage: 100 });
        return { processed: 0, created: 0, errors: 0 };
      }

      onProgress?.(`📦 Se encontraron ${pendingImages.length} imágenes para descargar.`, { 
        current: 0, 
        total: pendingImages.length, 
        percentage: 0 
      });

      for (let i = 0; i < pendingImages.length; i++) {
        const imageJob = pendingImages[i];
        const { vehicle_id, image_url } = imageJob;

        onProgress?.(`⬇️  Descargando imagen ${i + 1}/${pendingImages.length} para vehículo ${vehicle_id}...`, { 
          current: i, 
          total: pendingImages.length, 
          percentage: Math.round((i / pendingImages.length) * 100) 
        });

        try {
          const result = await this.downloadImage(image_url, vehicle_id);

          if (result.success) {
            onProgress?.(`✅ Imagen ${i + 1} descargada para vehículo ${vehicle_id}`, { 
              current: i + 1, 
              total: pendingImages.length, 
              percentage: Math.round(((i + 1) / pendingImages.length) * 100) 
            });
            processed++;
            if (result.imageId) {
              created++;
            }
          } else {
            onProgress?.(`❌ Error al descargar imagen ${i + 1}: ${result.message}`, { 
              current: i + 1, 
              total: pendingImages.length, 
              percentage: Math.round(((i + 1) / pendingImages.length) * 100) 
            });
            errors++;
          }
        } catch (error: any) {
          onProgress?.(`❌ Error al descargar imagen ${i + 1}: ${error.message}`, { 
            current: i + 1, 
            total: pendingImages.length, 
            percentage: Math.round(((i + 1) / pendingImages.length) * 100) 
          });
          errors++;
        }

        if (i < pendingImages.length - 1 && delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      onProgress?.(`🎉 Descarga completada. ${processed} imágenes descargadas (${created} nuevas), ${errors} errores.`, { 
        current: pendingImages.length, 
        total: pendingImages.length, 
        percentage: 100 
      });
    } catch (error: any) {
      onProgress?.(`❌ Error fatal: ${error.message}`, { 
        current: processed, 
        total: processed, 
        percentage: 0 
      });
      errors++;
    }

    return { processed, created, errors };
  }

  /**
   * Ejecuta la sincronización completa (Fase 1 + Fase 2)
   */
  async syncAll(
    onProgress?: (phase: 'fase1' | 'fase2', message: string, progress: { current: number; total: number; percentage: number }) => void,
    incremental: boolean = false,
    syncType: 'full' | 'incremental' | 'manual' = 'incremental'
  ): Promise<{ 
    fase1: { processed: number; created: number; updated: number; errors: number; filtered: number; archived: number }; 
    fase2: { processed: number; created: number; errors: number } 
  }> {
    // Registrar inicio en sync_logs (opcional, no falla si no existe)
    let syncLogId: number | null = null;
    try {
      const { SyncLogger } = await import('./sync-logger');
      syncLogId = await SyncLogger.logSyncStart(syncType);
    } catch (error) {
      // No fallar si sync-logger no está disponible
    }
    const limit = parseInt(process.env.SYNC_LIMIT || '0');
    const delay = parseInt(process.env.SYNC_IMAGE_DELAY || '0');
    
    let fase1Processed = 0;
    let fase1Created = 0;
    let fase1Updated = 0;
    let fase1Errors = 0;
    let fase1Filtered = 0;
    let fase1Archived = 0; // Vehículos archivados en fase de limpieza global
    let fase2Processed = 0;
    let fase2Created = 0;
    let fase2Errors = 0;

    // Set para trackear vehículos válidos durante la sincronización
    // Equivalente a $all_api_ids en cleanup_phase_cron() del PHP
    const validVehicleIds = new Set<string>();

    // ========== FASE 1: Sincronización de Datos ==========
    onProgress?.('fase1', '🚀 Iniciando Fase 1: Sincronización de datos...', { current: 0, total: 0, percentage: 0 });

    // ========== FASE 1.1: Obtener TODOS los vehículos de la API (sin procesar en BD) ==========
    onProgress?.('fase1', '📡 Fase 1.1: Obteniendo todos los vehículos de la API...', { current: 0, total: 0, percentage: 5 });
    
    const allVehiclesFromAPI: AsofixVehicle[] = [];
    let currentPage = 1;
    let hasMore = true;
    let totalVehicles = 0;

    try {
      const firstPage = await asofixApi.getVehiclesPage(1);
      const meta = firstPage.meta;
      if (meta && meta.total_count) {
        totalVehicles = meta.total_count;
        onProgress?.('fase1', `📊 Total aproximado de vehículos en ASOFIX: ${totalVehicles}`, { current: 0, total: totalVehicles, percentage: 5 });
      }
    } catch (error) {
      logger.warn('No se pudo obtener el total de vehículos');
    }

    // Obtener todos los vehículos de la API primero (sin procesar en BD)
    while (hasMore && (limit === 0 || allVehiclesFromAPI.length < limit)) {
      try {
        onProgress?.('fase1', `📄 Obteniendo página ${currentPage} de la API...`, { 
          current: allVehiclesFromAPI.length, 
          total: totalVehicles || allVehiclesFromAPI.length + 10, 
          percentage: totalVehicles > 0 ? Math.round((allVehiclesFromAPI.length / totalVehicles) * 40) + 5 : 10 
        });

        const result = await this.syncPage(currentPage);
        const vehicles = result.vehicles;
        hasMore = result.hasMore;

        if (vehicles.length === 0) {
          onProgress?.('fase1', '✅ No hay más vehículos en la API.', { 
            current: allVehiclesFromAPI.length, 
            total: allVehiclesFromAPI.length, 
            percentage: 45 
          });
          break;
        }

        allVehiclesFromAPI.push(...vehicles);

        onProgress?.('fase1', `📦 Página ${currentPage} recibida. Total acumulado: ${allVehiclesFromAPI.length} vehículos.`, { 
          current: allVehiclesFromAPI.length, 
          total: totalVehicles || allVehiclesFromAPI.length, 
          percentage: totalVehicles > 0 ? Math.round((allVehiclesFromAPI.length / totalVehicles) * 40) + 5 : 20 
        });


        currentPage++;
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        onProgress?.('fase1', `❌ Error al obtener página ${currentPage} de la API: ${error.message}`, { 
          current: allVehiclesFromAPI.length, 
          total: totalVehicles || allVehiclesFromAPI.length, 
          percentage: 45 
        });
        fase1Errors++;
        hasMore = false;
        logger.error(`Error al obtener página ${currentPage} de la API: ${error.message}`);
      }
    }

    onProgress?.('fase1', `✅ Fase 1.1 completada: ${allVehiclesFromAPI.length} vehículos obtenidos de la API.`, { 
      current: allVehiclesFromAPI.length, 
      total: allVehiclesFromAPI.length, 
      percentage: 45 
    });

    // ========== FASE 1.2: Procesar vehículos en lotes controlados ==========
    onProgress?.('fase1', `🔄 Fase 1.2: Procesando ${allVehiclesFromAPI.length} vehículos en BD...`, { 
      current: 0, 
      total: allVehiclesFromAPI.length, 
      percentage: 45 
    });

    const batchSize = parseInt(process.env.SYNC_BATCH_SIZE || '50', 10); // Tamaño de lote configurable, default 50
    const maxRetries = 3; // Reintentos para errores transitorios

    for (let i = 0; i < allVehiclesFromAPI.length; i += batchSize) {
      const batch = allVehiclesFromAPI.slice(i, Math.min(i + batchSize, allVehiclesFromAPI.length));
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(allVehiclesFromAPI.length / batchSize);

      onProgress?.('fase1', `📦 Procesando lote ${batchNumber}/${totalBatches} (${batch.length} vehículos)...`, { 
        current: i, 
        total: allVehiclesFromAPI.length, 
        percentage: 45 + Math.round((i / allVehiclesFromAPI.length) * 50) 
      });

      // Usar índice real del array, no el contador fase1Processed (que solo cuenta cambios)
      let vehicleIndexInArray = i;
      for (const vehicle of batch) {
        vehicleIndexInArray++; // Incrementar ANTES de procesar para tener el índice correcto (1-based)
        if (limit > 0 && fase1Processed >= limit) {
          onProgress?.('fase1', `⏹️  Límite de sincronización alcanzado (${limit}).`, { 
            current: fase1Processed, 
            total: limit, 
            percentage: 95 
          });
          break;
        }

        const asofixId = vehicle.id || 'ID_DESCONOCIDO';
        let result: { success: boolean; message: string; vehicleId?: number; wasNew?: boolean; wasUpdated?: boolean; filtered?: boolean } | null = null;
        let retryCount = 0;
        let success = false;

        // Reintentos para errores transitorios
        while (retryCount < maxRetries && !success) {
          try {
            onProgress?.('fase1', `🔄 Procesando vehículo ${vehicleIndexInArray}/${allVehiclesFromAPI.length} (ID: ${asofixId})${retryCount > 0 ? ` [Reintento ${retryCount}]` : ''}...`, { 
              current: vehicleIndexInArray - 1, 
              total: allVehiclesFromAPI.length, 
              percentage: 45 + Math.round(((vehicleIndexInArray - 1) / allVehiclesFromAPI.length) * 50) 
            });

            result = await this.processVehicle(vehicle, incremental);
            success = true;

            // Agregar al Set de vehículos válidos SOLO después de confirmar procesamiento exitoso
            // Esto evita que vehículos válidos se archiven incorrectamente en la limpieza global
            // IMPORTANTE: Incluir vehículos con "Sin cambios" ya que son válidos y están publicados
            // CRÍTICO: Usar índice real del array, no fase1Processed (que solo cuenta cambios)
            if (result.success && !result.filtered && asofixId && asofixId !== 'ID_DESCONOCIDO') {
              validVehicleIds.add(asofixId);
              // Log específico para debugging de vehículos problemáticos (131-134)
              if (vehicleIndexInArray >= 131 && vehicleIndexInArray <= 134) {
                logger.info(`[DEBUG] Vehículo ${asofixId} agregado al Set de válidos (índice real: ${vehicleIndexInArray}, resultado: ${result.message})`);
              }
            } else if (result.success && result.message.includes('Sin cambios') && asofixId && asofixId !== 'ID_DESCONOCIDO') {
              // Asegurar que vehículos con "Sin cambios" se agreguen al Set (por si acaso)
              validVehicleIds.add(asofixId);
              if (vehicleIndexInArray >= 131 && vehicleIndexInArray <= 134) {
                logger.info(`[DEBUG] Vehículo ${asofixId} agregado al Set de válidos (Sin cambios, índice real: ${vehicleIndexInArray})`);
              }
            }

            if (result.success) {
              if (result.filtered) {
                fase1Filtered++;
                onProgress?.('fase1', `🚫 ${result.message}`, { 
                  current: fase1Processed, 
                  total: allVehiclesFromAPI.length, 
                  percentage: 45 + Math.round((fase1Processed / allVehiclesFromAPI.length) * 50) 
                });
              } else if (result.message.includes('Sin cambios')) {
                onProgress?.('fase1', `⏭️  ${result.message}`, { 
                  current: fase1Processed, 
                  total: allVehiclesFromAPI.length, 
                  percentage: 45 + Math.round((fase1Processed / allVehiclesFromAPI.length) * 50) 
                });
              } else {
                onProgress?.('fase1', `✅ ${result.message}`, { 
                  current: fase1Processed + 1, 
                  total: allVehiclesFromAPI.length, 
                  percentage: 45 + Math.round(((fase1Processed + 1) / allVehiclesFromAPI.length) * 50) 
                });
                fase1Processed++;
                if (result.wasNew) {
                  fase1Created++;
                } else if (result.wasUpdated) {
                  fase1Updated++;
                }
              }
            } else {
              onProgress?.('fase1', `❌ ${result.message}`, { 
                current: fase1Processed, 
                total: allVehiclesFromAPI.length, 
                percentage: 45 + Math.round((fase1Processed / allVehiclesFromAPI.length) * 50) 
              });
              fase1Errors++;
              // Si falla pero el vehículo es válido según filtros, agregarlo al Set para evitar archivado
              const { omit } = VehicleFilters.shouldOmitVehicle(vehicle);
              if (!omit && asofixId && asofixId !== 'ID_DESCONOCIDO') {
                validVehicleIds.add(asofixId);
                logger.warn(`[DEBUG] Vehículo ${asofixId} agregado al Set después de error (para evitar archivado incorrecto)`);
              }
            }
          } catch (error: any) {
            retryCount++;
            if (retryCount >= maxRetries) {
              logger.error(`Error al procesar vehículo ${asofixId} después de ${maxRetries} intentos: ${error.message}`);
              onProgress?.('fase1', `❌ Error fatal en vehículo ${asofixId}: ${error.message}`, { 
                current: fase1Processed, 
                total: allVehiclesFromAPI.length, 
                percentage: 45 + Math.round((fase1Processed / allVehiclesFromAPI.length) * 50) 
              });
              fase1Errors++;
              // Aún así, si el vehículo es válido según los filtros, agregarlo al Set para evitar archivarlo
              const { omit } = VehicleFilters.shouldOmitVehicle(vehicle);
              if (!omit && asofixId && asofixId !== 'ID_DESCONOCIDO') {
                validVehicleIds.add(asofixId);
                logger.warn(`Vehículo ${asofixId} agregado al Set de válidos a pesar del error (para evitar archivado incorrecto)`);
              }
            } else {
              logger.warn(`Error transitorio al procesar vehículo ${asofixId}, reintentando... (${retryCount}/${maxRetries}): ${error.message}`);
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Backoff exponencial
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100)); // Delay reducido entre vehículos
      }

      // Pausa entre lotes para evitar saturar la BD
      if (i + batchSize < allVehiclesFromAPI.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    onProgress?.('fase1', `✅ Fase 1.2 completada. ${fase1Processed} vehículos procesados (${fase1Created} nuevos, ${fase1Updated} actualizados, ${fase1Filtered} filtrados), ${fase1Errors} errores.`, { 
      current: fase1Processed, 
      total: fase1Processed, 
      percentage: 90 
    });

    // ========== FASE 1.3: Reactivación de vehículos archivados que deberían estar publicados ==========
    onProgress?.('fase1', `🔄 Fase 1.3: Verificando vehículos archivados que deberían estar publicados...`, { 
      current: fase1Processed, 
      total: fase1Processed, 
      percentage: 92 
    });

    try {
      // Buscar vehículos archivados que fueron archivados recientemente o tienen filter_reason relacionado con limpieza
      // Estos son vehículos que fueron archivados porque no estaban en el Set, pero podrían estar en la API
      // Buscar todos los archivados recientemente (últimos 30 días) para asegurar que no se pierdan vehículos válidos
      const [archivedVehicles] = await pool.execute<any[]>(
        `SELECT id, asofix_id, title, license_plate, additional_data, updated_at
         FROM vehicles 
         WHERE status = 'archived'
           AND license_plate IS NOT NULL
           AND license_plate != ''
           AND (
             JSON_EXTRACT(additional_data, '$.filter_reason') = 'not_in_valid_set'
             OR JSON_EXTRACT(additional_data, '$.filter_reason') = 'no_encontrado_en_api'
             OR JSON_EXTRACT(additional_data, '$.cleanup_verification') IS NOT NULL
             OR updated_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
           )
         ORDER BY updated_at DESC
         LIMIT 200`,
        []
      );

      if (archivedVehicles.length > 0) {
        logger.info(`[Reactivación] Encontrados ${archivedVehicles.length} vehículos archivados para verificar.`);
        let reactivatedCount = 0;

        for (const archivedVehicle of archivedVehicles) {
          try {
            const licensePlate = archivedVehicle.license_plate;
            if (!licensePlate || licensePlate.trim().length === 0) {
              continue;
            }

            logger.info(`[Reactivación] Verificando vehículo archivado ${archivedVehicle.asofix_id} (${archivedVehicle.title}) con patente ${licensePlate}...`);

            // Buscar el vehículo en la API
            const apiVehicle = await asofixApi.getVehicleByLicensePlate(licensePlate);

            if (apiVehicle && apiVehicle.id === archivedVehicle.asofix_id) {
              // Vehículo encontrado en la API, verificar si pasa los filtros
              const { omit, reason } = VehicleFilters.shouldOmitVehicle(apiVehicle);

              if (!omit) {
                // El vehículo existe en la API y pasa los filtros - REACTIVAR
                let additionalData: any = {};
                try {
                  additionalData = archivedVehicle.additional_data ? JSON.parse(archivedVehicle.additional_data) : {};
                } catch (e) {
                  additionalData = {};
                }

                // Remover filter_reason y cleanup_verification
                if (additionalData.filter_reason) {
                  delete additionalData.filter_reason;
                }
                if (additionalData.cleanup_verification) {
                  delete additionalData.cleanup_verification;
                }
                if (additionalData.archived_at) {
                  delete additionalData.archived_at;
                }

                await pool.execute(
                  'UPDATE vehicles SET status = ?, additional_data = ?, updated_at = NOW() WHERE id = ?',
                  ['published', JSON.stringify(additionalData), archivedVehicle.id]
                );

                // Agregarlo al Set de válidos para evitar que se archive nuevamente
                validVehicleIds.add(archivedVehicle.asofix_id);
                reactivatedCount++;
                logger.info(`[Reactivación] ✅ Vehículo ${archivedVehicle.asofix_id} (${archivedVehicle.title}) REACTIVADO - encontrado en API y válido`);
              } else {
                logger.info(`[Reactivación] Vehículo ${archivedVehicle.asofix_id} encontrado en API pero filtrado: ${reason} - NO se reactiva`);
              }
            } else {
              logger.info(`[Reactivación] Vehículo ${archivedVehicle.asofix_id} NO encontrado en API - permanece archivado`);
            }

            // Pausa para no sobrecargar la API
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error: any) {
            logger.error(`[Reactivación] Error al verificar vehículo ${archivedVehicle.asofix_id}: ${error.message}`);
          }
        }

        if (reactivatedCount > 0) {
          logger.info(`[Reactivación] ${reactivatedCount} vehículos reactivados exitosamente.`);
          onProgress?.('fase1', `✅ Fase 1.3 completada: ${reactivatedCount} vehículos reactivados.`, { 
            current: fase1Processed, 
            total: fase1Processed, 
            percentage: 94 
          });
        } else {
          onProgress?.('fase1', `✅ Fase 1.3 completada: no se encontraron vehículos para reactivar.`, { 
            current: fase1Processed, 
            total: fase1Processed, 
            percentage: 94 
          });
        }
      } else {
        logger.info(`[Reactivación] No se encontraron vehículos archivados para verificar.`);
        onProgress?.('fase1', `✅ Fase 1.3 completada: no hay vehículos archivados para verificar.`, { 
          current: fase1Processed, 
          total: fase1Processed, 
          percentage: 94 
        });
      }
    } catch (error: any) {
      logger.error(`[Reactivación] Error en fase de reactivación: ${error.message}`);
      onProgress?.('fase1', `❌ Error en fase de reactivación: ${error.message}`, { 
        current: fase1Processed, 
        total: fase1Processed, 
        percentage: 94 
      });
    }

    onProgress?.('fase1', `✅ Fase 1 completada. ${fase1Processed} vehículos procesados (${fase1Created} nuevos, ${fase1Updated} actualizados, ${fase1Filtered} filtrados), ${fase1Errors} errores.`, { 
      current: fase1Processed, 
      total: fase1Processed, 
      percentage: 95 
    });

    // ========== FASE 1.5: Limpieza Global (equivalente a cleanup_phase_cron() en PHP) ==========
    onProgress?.('fase1', `🧹 Iniciando fase de limpieza global: archivando vehículos publicados que no están en el set de válidos...`, { 
      current: fase1Processed, 
      total: fase1Processed, 
      percentage: 96 
    });

    logger.info(`[Cleanup] Vehículos válidos detectados en esta sincronización: ${validVehicleIds.size}`);

    try {
      if (validVehicleIds.size > 0) {
        // Construir lista de IDs válidos para la query SQL
        const validIdsArray = Array.from(validVehicleIds);
        const placeholders = validIdsArray.map(() => '?').join(',');

        // Buscar vehículos publicados que NO están en el Set de válidos
        // Excluir vehículos publicados recientemente (últimas 48 horas) para evitar archivar vehículos
        // que fueron publicados manualmente o que acaban de ser procesados
        // Equivalente a la query que busca posts publicados en cleanup_phase_cron() del PHP
        const [publishedVehicles] = await pool.execute<any[]>(
          `SELECT id, asofix_id, title, updated_at, additional_data
           FROM vehicles 
           WHERE status = 'published'
             AND asofix_id NOT IN (${placeholders})
             AND (updated_at < DATE_SUB(NOW(), INTERVAL 48 HOUR) OR updated_at IS NULL)
           LIMIT 10000`,
          validIdsArray
        );

        if (publishedVehicles.length > 0) {
          logger.info(`[Cleanup] Encontrados ${publishedVehicles.length} vehículos publicados que no están en el set de válidos. Verificando antes de archivar...`);
          logger.info(`[Cleanup] IDs de vehículos a verificar: ${publishedVehicles.map(v => v.asofix_id).join(', ')}`);

          for (const vehicle of publishedVehicles) {
            try {
              logger.info(`[Cleanup] Verificando vehículo ${vehicle.asofix_id} (${vehicle.title})...`);
              
              // Obtener datos completos del vehículo de la BD para verificar license_plate
              const [vehicleRows] = await pool.execute<any[]>(
                'SELECT license_plate, additional_data FROM vehicles WHERE id = ?',
                [vehicle.id]
              );

              const licensePlate = vehicleRows[0]?.license_plate;
              const updatedAt = vehicle.updated_at ? new Date(vehicle.updated_at) : null;
              const hoursSinceUpdate = updatedAt ? (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60) : Infinity;
              let shouldArchive = true;
              let verificationReason = 'no_encontrado_en_api';
              
              logger.info(`[Cleanup] Vehículo ${vehicle.asofix_id} tiene license_plate: ${licensePlate || 'NULL'}, actualizado hace ${hoursSinceUpdate.toFixed(1)} horas`);
              
              // Verificar si tiene flag de mantener publicado
              let additionalData: any = {};
              try {
                additionalData = vehicleRows[0]?.additional_data ? JSON.parse(vehicleRows[0].additional_data) : {};
              } catch (e) {
                // Si hay error parseando, usar objeto vacío
              }
              
              // Si tiene flag keep_published, NO archivar
              if (additionalData.keep_published === true) {
                shouldArchive = false;
                verificationReason = 'keep_published_flag';
                validVehicleIds.add(vehicle.asofix_id);
                logger.info(`[Cleanup] Vehículo ${vehicle.asofix_id} tiene flag keep_published - NO se archiva`);
                continue; // Saltar al siguiente vehículo
              }
              
              // Si fue actualizado recientemente (menos de 48 horas), ser más conservador y NO archivar
              // Esto evita archivar vehículos que fueron publicados manualmente recientemente
              if (hoursSinceUpdate < 48) {
                shouldArchive = false;
                verificationReason = `actualizado_recientemente_${hoursSinceUpdate.toFixed(1)}h`;
                validVehicleIds.add(vehicle.asofix_id);
                logger.info(`[Cleanup] Vehículo ${vehicle.asofix_id} fue actualizado recientemente (${hoursSinceUpdate.toFixed(1)}h) - NO se archiva para evitar pérdida de vehículos publicados manualmente`);
                continue; // Saltar al siguiente vehículo
              }

              // ANTES de archivar, verificar si el vehículo existe en la API y pasa los filtros
              if (licensePlate && licensePlate.trim().length > 0) {
                try {
                  const apiVehicle = await asofixApi.getVehicleByLicensePlate(licensePlate);
                  
                  if (apiVehicle && apiVehicle.id === vehicle.asofix_id) {
                    // Vehículo encontrado en la API, verificar si pasa los filtros
                    const { omit, reason } = VehicleFilters.shouldOmitVehicle(apiVehicle);
                    
                    if (!omit) {
                      // El vehículo existe en la API y pasa los filtros - NO archivar
                      shouldArchive = false;
                      verificationReason = 'valido_en_api';
                      // Agregarlo al Set de válidos para evitar futuros archivados
                      validVehicleIds.add(vehicle.asofix_id);
                      logger.info(`[Cleanup] Vehículo ${vehicle.asofix_id} (${vehicle.title}) encontrado en API y válido - NO se archiva`);
                    } else {
                      // El vehículo existe en la API pero NO pasa los filtros - archivar
                      shouldArchive = true;
                      verificationReason = `filtrado_en_api: ${reason}`;
                      logger.warn(`[Cleanup] Vehículo ${vehicle.asofix_id} (${vehicle.title}) encontrado en API pero filtrado: ${reason}`);
                    }
                  } else {
                    // Vehículo no encontrado en la API - archivar
                    shouldArchive = true;
                    verificationReason = 'no_encontrado_en_api';
                    logger.warn(`[Cleanup] Vehículo ${vehicle.asofix_id} (${vehicle.title}) no encontrado en API - archivando`);
                  }
                } catch (apiError: any) {
                  // Error al consultar la API - asumir que debe archivarse (comportamiento conservador)
                  shouldArchive = true;
                  verificationReason = `error_consulta_api: ${apiError.message}`;
                  logger.warn(`[Cleanup] Error al verificar vehículo ${vehicle.asofix_id} en API: ${apiError.message} - archivando por seguridad`);
                }
              } else {
                // Sin license_plate - no se puede verificar en API, archivar
                shouldArchive = true;
                verificationReason = 'sin_license_plate';
                logger.warn(`[Cleanup] Vehículo ${vehicle.asofix_id} (${vehicle.title}) sin license_plate - no se puede verificar en API - archivando`);
              }

              if (shouldArchive) {
                // Obtener additional_data actual para preservar y agregar motivo de archivado
                let additionalData: any = {};
                try {
                  additionalData = vehicleRows[0]?.additional_data ? JSON.parse(vehicleRows[0].additional_data) : {};
                } catch (e) {
                  // Si hay error parseando, usar objeto vacío
                }

                additionalData.filter_reason = 'not_in_valid_set';
                additionalData.cleanup_verification = verificationReason;
                additionalData.archived_at = new Date().toISOString();

                await pool.execute(
                  'UPDATE vehicles SET status = ?, additional_data = ?, updated_at = NOW() WHERE id = ?',
                  ['archived', JSON.stringify(additionalData), vehicle.id]
                );

                fase1Archived++;
                logger.warn(`[Cleanup] Vehículo ${vehicle.asofix_id} (${vehicle.title}) archivado: ${verificationReason}`);
              }
            } catch (error: any) {
              logger.error(`[Cleanup] Error al procesar vehículo ${vehicle.asofix_id}: ${error.message}`);
            }
          }

          onProgress?.('fase1', `🧹 Limpieza global completada: ${fase1Archived} vehículos archivados.`, { 
            current: fase1Processed, 
            total: fase1Processed, 
            percentage: 98 
          });
        } else {
          logger.info(`[Cleanup] No se encontraron vehículos publicados para archivar.`);
          onProgress?.('fase1', `✅ Limpieza global: no se encontraron vehículos para archivar.`, { 
            current: fase1Processed, 
            total: fase1Processed, 
            percentage: 98 
          });
        }
      } else {
        logger.warn(`[Cleanup] No se encontraron vehículos válidos en la sincronización. Saltando limpieza para evitar archivar todos los vehículos.`);
        onProgress?.('fase1', `⚠️  Limpieza global omitida: no se encontraron vehículos válidos.`, { 
          current: fase1Processed, 
          total: fase1Processed, 
          percentage: 98 
        });
      }
    } catch (error: any) {
      logger.error(`[Cleanup] Error en fase de limpieza global: ${error.message}`);
      onProgress?.('fase1', `❌ Error en limpieza global: ${error.message}`, { 
        current: fase1Processed, 
        total: fase1Processed, 
        percentage: 98 
      });
    }

    onProgress?.('fase1', `🎉 Fase 1 completada. ${fase1Processed} vehículos procesados (${fase1Created} nuevos, ${fase1Updated} actualizados, ${fase1Filtered} filtrados, ${fase1Archived} archivados en limpieza), ${fase1Errors} errores.`, { 
      current: fase1Processed, 
      total: fase1Processed, 
      percentage: 100 
    });

    // ========== FASE 2: Descarga de Imágenes ==========
    onProgress?.('fase2', '🖼️  Iniciando Fase 2: Descarga de imágenes...', { current: 0, total: 0, percentage: 0 });

    try {
      const pendingImages = await this.getPendingImages();

      if (pendingImages.length === 0) {
        onProgress?.('fase2', '✅ No se encontraron imágenes pendientes.', { current: 0, total: 0, percentage: 100 });
      } else {
        onProgress?.('fase2', `📦 Se encontraron ${pendingImages.length} imágenes para descargar.`, { 
          current: 0, 
          total: pendingImages.length, 
          percentage: 0 
        });

        const imageResult = await this.downloadAllImages(
          (message, progress) => {
            onProgress?.('fase2', message, progress);
          },
          delay
        );
        
        fase2Processed = imageResult.processed;
        fase2Created = imageResult.created;
        fase2Errors = imageResult.errors;

        onProgress?.('fase2', `🎉 Fase 2 completada. ${fase2Processed} imágenes descargadas (${fase2Created} nuevas), ${fase2Errors} errores.`, { 
          current: pendingImages.length, 
          total: pendingImages.length, 
          percentage: 100 
        });
      }
    } catch (error: any) {
      onProgress?.('fase2', `❌ Error fatal en Fase 2: ${error.message}`, { 
        current: fase2Processed, 
        total: fase2Processed, 
        percentage: 0 
      });
      fase2Errors++;
    }

    // Registrar finalización en sync_logs
    try {
      const { SyncLogger } = await import('./sync-logger');
      if (fase1Errors === 0 && fase2Errors === 0) {
        await SyncLogger.logSyncComplete(syncLogId, {
          vehicles_processed: fase1Processed,
          vehicles_created: fase1Created,
          vehicles_updated: fase1Updated,
          images_processed: fase2Processed,
          images_created: fase2Created,
          errors_count: fase1Errors + fase2Errors
        });
      } else {
        await SyncLogger.logSyncFailed(
          syncLogId,
          `Sync completada con errores: ${fase1Errors} errores en fase1, ${fase2Errors} errores en fase2`,
          {
            vehicles_processed: fase1Processed,
            errors_count: fase1Errors + fase2Errors
          }
        );
      }
    } catch (error) {
      // No fallar si sync-logger no está disponible
    }

    return {
      fase1: { 
        processed: fase1Processed, 
        created: fase1Created, 
        updated: fase1Updated, 
        errors: fase1Errors, 
        filtered: fase1Filtered,
        archived: fase1Archived
      },
      fase2: { processed: fase2Processed, created: fase2Created, errors: fase2Errors }
    };
  }
}

export default new SyncService();

