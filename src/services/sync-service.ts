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
   */
  private generateVersionHash(vehicle: AsofixVehicle): string {
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
      images_count: (vehicle.images || []).length,
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
    if (omit) {
      // Si el vehículo ya existe en la BD pero ahora debe ser filtrado, marcarlo como archived
      const existingId = await this.findVehicleByAsofixId(asofixId);
      if (existingId) {
        try {
          await pool.execute(
            'UPDATE vehicles SET status = ? WHERE id = ?',
            ['archived', existingId]
          );
          logger.info(`Vehículo ${asofixId} archivado por filtro: ${reason}`);
        } catch (error: any) {
          logger.error(`Error al archivar vehículo: ${error.message}`);
        }
      }
      return { success: true, message: `FILTRADO: ${reason}`, filtered: true };
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

        // Eliminar imágenes anteriores (se volverán a descargar si hay cambios)
        await pool.execute('DELETE FROM vehicle_images WHERE vehicle_id = ?', [vehicleId]);
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

      // Guardar URLs de imágenes pendientes
      const imageUrls = (vehicle.images || []).map(img => img.url || '').filter(url => url);
      await this.savePendingImages(vehicleId, imageUrls);

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
   */
  async downloadImage(imageUrl: string, vehicleId: number): Promise<{ success: boolean; message: string; imageId?: number }> {
    try {
      const highResUrl = imageUrl.replace('/th-', '/');

      const uploadPath = process.env.UPLOAD_PATH || './uploads';
      const vehicleDir = path.join(uploadPath, 'vehicles', String(vehicleId));
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
   * Sincroniza una página de vehículos aplicando filtros obligatorios
   */
  async syncPage(page: number): Promise<{ vehicles: AsofixVehicle[]; hasMore: boolean }> {
    try {
      const response = await asofixApi.getVehiclesPage(page);
      const allVehicles = response.data || [];

      // Filtrar solo vehículos activos
      const activeVehicles = allVehicles.filter(vehicle => {
        if (!vehicle.stocks || vehicle.stocks.length === 0) return false;
        return vehicle.stocks.some(stock => 
          stock.status && stock.status.toUpperCase() === 'ACTIVO'
        );
      });

      // APLICAR FILTROS OBLIGATORIOS
      const { filtered } = VehicleFilters.filterVehicles(activeVehicles);

      const meta = response.meta;
      const hasMore = meta ? (meta.current_page || 0) < (meta.total_pages || 0) : filtered.length > 0;

      return { vehicles: filtered, hasMore };
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
    incremental: boolean = false
  ): Promise<{ 
    fase1: { processed: number; created: number; updated: number; errors: number; filtered: number }; 
    fase2: { processed: number; created: number; errors: number } 
  }> {
    const limit = parseInt(process.env.SYNC_LIMIT || '0');
    const delay = parseInt(process.env.SYNC_IMAGE_DELAY || '0');
    
    let fase1Processed = 0;
    let fase1Created = 0;
    let fase1Updated = 0;
    let fase1Errors = 0;
    let fase1Filtered = 0;
    let fase2Processed = 0;
    let fase2Created = 0;
    let fase2Errors = 0;

    // ========== FASE 1: Sincronización de Datos ==========
    onProgress?.('fase1', '🚀 Iniciando Fase 1: Sincronización de datos...', { current: 0, total: 0, percentage: 0 });

    let currentPage = 1;
    let hasMore = true;
    let totalVehicles = 0;

    try {
      const firstPage = await asofixApi.getVehiclesPage(1);
      const meta = firstPage.meta;
      if (meta && meta.total_count) {
        totalVehicles = meta.total_count;
        onProgress?.('fase1', `📊 Total aproximado de vehículos en ASOFIX: ${totalVehicles}`, { current: 0, total: totalVehicles, percentage: 0 });
      }
    } catch (error) {
      logger.warn('No se pudo obtener el total de vehículos');
    }

    while (hasMore && (limit === 0 || fase1Processed < limit)) {
      try {
        onProgress?.('fase1', `📄 Obteniendo página ${currentPage} de la API...`, { 
          current: fase1Processed, 
          total: totalVehicles || fase1Processed + 1, 
          percentage: totalVehicles > 0 ? Math.round((fase1Processed / totalVehicles) * 100) : 0 
        });

        const result = await this.syncPage(currentPage);
        const vehicles = result.vehicles;
        hasMore = result.hasMore;

        if (vehicles.length === 0) {
          onProgress?.('fase1', '✅ No hay más vehículos para procesar.', { 
            current: fase1Processed, 
            total: fase1Processed, 
            percentage: 100 
          });
          break;
        }

        onProgress?.('fase1', `📦 Página ${currentPage} recibida. ${vehicles.length} vehículos después de filtros.`, { 
          current: fase1Processed, 
          total: totalVehicles || fase1Processed + vehicles.length, 
          percentage: totalVehicles > 0 ? Math.round((fase1Processed / totalVehicles) * 100) : 0 
        });

        for (const vehicle of vehicles) {
          if (limit > 0 && fase1Processed >= limit) {
            onProgress?.('fase1', `⏹️  Límite de sincronización alcanzado (${limit}).`, { 
              current: fase1Processed, 
              total: limit, 
              percentage: 100 
            });
            hasMore = false;
            break;
          }

          const asofixId = vehicle.id || 'ID_DESCONOCIDO';
          onProgress?.('fase1', `🔄 Procesando vehículo ${fase1Processed + 1} (ID: ${asofixId})...`, { 
            current: fase1Processed, 
            total: totalVehicles || fase1Processed + 1, 
            percentage: totalVehicles > 0 ? Math.round((fase1Processed / totalVehicles) * 100) : 0 
          });

          const result = await this.processVehicle(vehicle, incremental);

          if (result.success) {
            if (result.filtered) {
              fase1Filtered++;
              onProgress?.('fase1', `🚫 ${result.message}`, { 
                current: fase1Processed, 
                total: totalVehicles || fase1Processed + 1, 
                percentage: totalVehicles > 0 ? Math.round((fase1Processed / totalVehicles) * 100) : 0 
              });
            } else if (result.message.includes('Sin cambios')) {
              onProgress?.('fase1', `⏭️  ${result.message}`, { 
                current: fase1Processed, 
                total: totalVehicles || fase1Processed + 1, 
                percentage: totalVehicles > 0 ? Math.round((fase1Processed / totalVehicles) * 100) : 0 
              });
            } else {
              onProgress?.('fase1', `✅ ${result.message}`, { 
                current: fase1Processed + 1, 
                total: totalVehicles || fase1Processed + 1, 
                percentage: totalVehicles > 0 ? Math.round(((fase1Processed + 1) / totalVehicles) * 100) : 0 
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
              total: totalVehicles || fase1Processed + 1, 
              percentage: totalVehicles > 0 ? Math.round((fase1Processed / totalVehicles) * 100) : 0 
            });
            fase1Errors++;
          }

          await new Promise(resolve => setTimeout(resolve, 200));
        }

        currentPage++;
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        onProgress?.('fase1', `❌ Error al procesar página ${currentPage}: ${error.message}`, { 
          current: fase1Processed, 
          total: totalVehicles || fase1Processed, 
          percentage: totalVehicles > 0 ? Math.round((fase1Processed / totalVehicles) * 100) : 0 
        });
        fase1Errors++;
        hasMore = false;
      }
    }

    onProgress?.('fase1', `🎉 Fase 1 completada. ${fase1Processed} vehículos procesados (${fase1Created} nuevos, ${fase1Updated} actualizados, ${fase1Filtered} filtrados), ${fase1Errors} errores.`, { 
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

    return {
      fase1: { processed: fase1Processed, created: fase1Created, updated: fase1Updated, errors: fase1Errors, filtered: fase1Filtered },
      fase2: { processed: fase2Processed, created: fase2Created, errors: fase2Errors }
    };
  }
}

export default new SyncService();

