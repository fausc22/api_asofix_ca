import pool from '../config/database';
import logger from './logger';
import { filterConfig } from '../config/filters';
import {
  normalizeBodyStyle,
  normalizeStateOfVehicle,
  normalizeFuelType,
  normalizeTransmission,
  normalizeAvailability,
  normalizeMileage,
  getVehicleAddress,
} from './meta-feed-normalizers';

/**
 * Servicio para generar feeds CSV compatibles con Meta Ads (Facebook Catalog) - Automotive Inventory Ads
 * 
 * Referencia: Guía técnica Meta Ads para feeds de vehículos (CSV)
 */
export class MetaFeedService {
  // URL del frontend (para links de páginas de vehículos)
  private static FRONTEND_URL = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://caradvice.com.ar';
  // URL de la API (para imágenes y recursos)
  private static API_URL = process.env.API_BASE_URL || 'https://api-caradvice.duckdns.org';
  private static CACHE_TTL = 10 * 60 * 1000; // 10 minutos
  private static cache: { csv: string; timestamp: number } | null = null;

  /**
   * Construye la URL completa de una imagen
   * Usa API_URL para todas las imágenes (endpoints de API y recursos estáticos)
   */
  private static buildImageUrl(image: { file_path?: string | null; image_url?: string | null }): string | null {
    // Si hay file_path y es una ruta estática
    if (image.file_path) {
      if (image.file_path.startsWith('/IMG/static/')) {
        return `${this.API_URL}${image.file_path}`;
      }
      // Si es una ruta local, usar el endpoint de API
      return `${this.API_URL}/api/image?path=${encodeURIComponent(image.file_path)}`;
    }
    
    // Si hay image_url externa, usarla directamente
    if (image.image_url) {
      // Si ya es una URL completa, devolverla tal cual
      if (image.image_url.startsWith('http://') || image.image_url.startsWith('https://')) {
        return image.image_url;
      }
      // Si es relativa, construir URL completa usando API_URL
      if (image.image_url.startsWith('/IMG/static/')) {
        return `${this.API_URL}${image.image_url}`;
      }
      // Para otras rutas relativas, usar el endpoint de API
      return `${this.API_URL}/api/image?path=${encodeURIComponent(image.image_url)}`;
    }
    
    return null;
  }

  /**
   * Escapa un campo para CSV
   * - Si contiene comas, comillas dobles o saltos de línea, se envuelve en comillas dobles
   * - Las comillas dobles dentro del campo se duplican
   */
  private static escapeCsvField(field: string | null | undefined): string {
    if (field === null || field === undefined) return '';
    
    const str = String(field);
    
    // Si contiene comas, comillas dobles o saltos de línea, envolver en comillas
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      // Escapar comillas dobles duplicándolas
      return `"${str.replace(/"/g, '""')}"`;
    }
    
    return str;
  }

  /**
   * Sanitiza HTML de la descripción (remueve tags pero mantiene texto)
   * Meta recomienda hasta 500 caracteres
   */
  private static sanitizeDescription(html: string | null | undefined): string {
    if (!html) return '';
    // Remover tags HTML y limitar longitud
    const text = html.replace(/<[^>]*>/g, '').trim();
    // Limitar a 500 caracteres (recomendación de Meta)
    return text.substring(0, 500);
  }

  // Dirección por defecto para vehículos sin ubicación
  private static DEFAULT_ADDRESS = process.env.META_FEED_DEFAULT_ADDRESS || 'Córdoba, Córdoba, Argentina';

  /**
   * Obtiene todos los vehículos publicados con sus imágenes y taxonomías
   * Reutiliza la misma lógica de filtrado que Google Feed para mantener consistencia
   */
  private static async getPublishedVehicles(): Promise<any[]> {
    // Construir condiciones WHERE con los mismos filtros que los endpoints públicos
    const whereConditions: string[] = [];
    const whereParams: any[] = [];

    // 1. Solo vehículos publicados
    whereConditions.push(`v.status = 'published'`);
    
    // 2. License plate NO NULL y NO vacío
    whereConditions.push(`v.license_plate IS NOT NULL`);
    whereConditions.push(`v.license_plate != ?`);
    whereParams.push('');
    
    // 3. Precio mayor al mínimo
    whereConditions.push(`(
      (v.price_usd IS NOT NULL AND v.price_usd > ?) OR
      (v.price_ars IS NOT NULL AND v.price_ars > ?)
    )`);
    whereParams.push(filterConfig.minPrice, filterConfig.minPrice);
    
    // 4. Excluir concesionarias bloqueadas (Dakota por defecto)
    // Se verifica en el JSON additional_data.stock_info[].branch_office_name o location_name
    if (filterConfig.blockedBranchOffices.length > 0) {
      const blockedConditions = filterConfig.blockedBranchOffices.map(() => {
        return `(v.additional_data IS NULL OR v.additional_data NOT LIKE ?)`;
      });
      whereConditions.push(`(${blockedConditions.join(' AND ')})`);
      for (const blocked of filterConfig.blockedBranchOffices) {
        whereParams.push(`%${blocked.toLowerCase()}%`);
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Query optimizada: obtener vehículos, imágenes y taxonomías en una sola consulta
    const query = `
      SELECT 
        v.id,
        v.asofix_id,
        v.title,
        v.content,
        v.year,
        v.kilometres,
        v.license_plate,
        v.price_usd,
        v.price_ars,
        v.additional_data,
        -- Imagen destacada
        vi_featured.id as featured_image_id,
        vi_featured.file_path as featured_file_path,
        vi_featured.image_url as featured_image_url,
        vi_featured.sort_order as featured_sort_order
      FROM vehicles v
      LEFT JOIN vehicle_images vi_featured ON v.featured_image_id = vi_featured.id
      WHERE ${whereClause}
      ORDER BY v.id ASC
    `;

    const [vehicles] = await pool.execute<any[]>(query, whereParams);

    // Obtener todas las imágenes para todos los vehículos en batch
    const vehicleIds = vehicles.map(v => v.id);
    if (vehicleIds.length === 0) {
      return [];
    }

    const placeholders = vehicleIds.map(() => '?').join(',');
    const [allImages] = await pool.execute<any[]>(
      `SELECT 
        vehicle_id,
        id,
        file_path,
        image_url,
        is_featured,
        sort_order
      FROM vehicle_images
      WHERE vehicle_id IN (${placeholders})
      ORDER BY vehicle_id, is_featured DESC, sort_order ASC, id ASC`,
      vehicleIds
    );

    // Obtener todas las taxonomías para todos los vehículos en batch
    const [allTaxonomies] = await pool.execute<any[]>(
      `SELECT 
        vt.vehicle_id,
        tt.taxonomy,
        tt.name
      FROM vehicle_taxonomies vt
      JOIN taxonomy_terms tt ON vt.term_id = tt.id
      WHERE vt.vehicle_id IN (${placeholders})
      ORDER BY vt.vehicle_id, tt.taxonomy, tt.name`,
      vehicleIds
    );

    // Organizar imágenes y taxonomías por vehículo
    const imagesByVehicle: Record<number, any[]> = {};
    for (const img of allImages) {
      if (!imagesByVehicle[img.vehicle_id]) {
        imagesByVehicle[img.vehicle_id] = [];
      }
      imagesByVehicle[img.vehicle_id].push(img);
    }

    const taxonomiesByVehicle: Record<number, Record<string, string[]>> = {};
    for (const tax of allTaxonomies) {
      if (!taxonomiesByVehicle[tax.vehicle_id]) {
        taxonomiesByVehicle[tax.vehicle_id] = {};
      }
      if (!taxonomiesByVehicle[tax.vehicle_id][tax.taxonomy]) {
        taxonomiesByVehicle[tax.vehicle_id][tax.taxonomy] = [];
      }
      taxonomiesByVehicle[tax.vehicle_id][tax.taxonomy].push(tax.name);
    }

    // Combinar datos
    return vehicles.map(vehicle => ({
      ...vehicle,
      images: imagesByVehicle[vehicle.id] || [],
      taxonomies: taxonomiesByVehicle[vehicle.id] || {}
    }));
  }

  /**
   * Genera el CSV del feed
   */
  private static async generateCSV(): Promise<string> {
    const vehicles = await this.getPublishedVehicles();
    
    logger.info(`[MetaFeed] Generando feed CSV para ${vehicles.length} vehículos publicados`);

    // Definir columnas del CSV según especificación de Meta
    // Orden: campos requeridos primero, luego opcionales
    // IMPORTANTE: Nombres de columnas deben coincidir exactamente con especificación Meta
    const columns = [
      'vehicle_id',            // Requerido (renombrado de 'id')
      'title',                 // Requerido
      'description',           // Requerido
      'availability',          // Requerido
      'state_of_vehicle',      // Requerido (renombrado de 'condition')
      'price',                 // Requerido
      'link',                  // Requerido
      'image',                 // Requerido (renombrado de 'image_link')
      'make',                  // Requerido (brand)
      'model',                 // Requerido
      'year',                  // Requerido
      'mileage',               // Requerido (obligatorio)
      'address',               // Requerido (nuevo campo obligatorio)
      'fuel_type',             // Recomendado
      'transmission',          // Recomendado
      'body_style',            // Recomendado (segment)
      'additional_image_link'  // Opcional (hasta 10 imágenes)
    ];

    const rows: string[][] = [];
    
    // Agregar header
    rows.push(columns);

    let includedCount = 0;
    let skippedCount = 0;

    for (const vehicle of vehicles) {
      try {
        // Determinar precio y moneda
        const hasUsdPrice = vehicle.price_usd && vehicle.price_usd > 1;
        const hasArsPrice = vehicle.price_ars && vehicle.price_ars > 1;
        
        if (!hasUsdPrice && !hasArsPrice) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: sin precio válido`);
          continue;
        }

        // Usar USD si existe, sino ARS
        const price = hasUsdPrice ? parseFloat(vehicle.price_usd) : parseFloat(vehicle.price_ars);
        const currency = hasUsdPrice ? 'USD' : 'ARS';
        // Formato Meta: "15000 USD" (número + espacio + código ISO, sin símbolos)
        const priceFormatted = `${Math.round(price)} ${currency}`;

        // Construir URL del vehículo (usar FRONTEND_URL para páginas)
        const vehicleUrl = `${this.FRONTEND_URL}/autos/${vehicle.id}`;

        // Obtener imágenes
        const images = vehicle.images || [];
        const imageUrls: string[] = [];
        
        for (const img of images) {
          const url = this.buildImageUrl(img);
          if (url) {
            imageUrls.push(url);
          }
        }

        // Remover duplicados
        const uniqueImageUrls = Array.from(new Set(imageUrls));

        if (uniqueImageUrls.length === 0) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: sin imágenes`);
          continue;
        }

        const imageLink = uniqueImageUrls[0];
        const additionalImageLinks = uniqueImageUrls.slice(1, 11); // Máximo 10 imágenes adicionales

        // Obtener datos de taxonomías
        const taxonomies = vehicle.taxonomies || {};
        const brand = taxonomies.brand?.[0] || '';
        const model = taxonomies.model?.[0] || '';
        const rawCondition = taxonomies.condition?.[0];
        const rawFuelType = taxonomies.fuel_type?.[0];
        const rawTransmission = taxonomies.transmission?.[0];
        const rawBodyStyle = taxonomies.segment?.[0];

        // Validar campos requeridos básicos
        if (!brand || !model) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: falta brand o model (brand: ${brand}, model: ${model})`);
          continue;
        }

        // 2️⃣ Normalizar y validar state_of_vehicle (OBLIGATORIO)
        const stateOfVehicle = normalizeStateOfVehicle(rawCondition);
        if (!stateOfVehicle) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: condition inválido o faltante (valor: ${rawCondition || 'null'})`);
          continue;
        }

        // 7️⃣ Validar mileage (OBLIGATORIO)
        const mileage = normalizeMileage(vehicle.kilometres);
        if (!mileage) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: mileage inválido o faltante (valor: ${vehicle.kilometres})`);
          continue;
        }

        // 8️⃣ Normalizar y validar transmission (OBLIGATORIO)
        const transmission = normalizeTransmission(rawTransmission);
        if (!transmission) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: transmission vacío o inválido (valor: ${rawTransmission || 'null'})`);
          continue;
        }

        // 4️⃣ Normalizar fuel_type (si no se puede normalizar, excluir)
        const fuelType = normalizeFuelType(rawFuelType);
        if (!fuelType) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: fuel_type no se puede normalizar (valor: ${rawFuelType || 'null'})`);
          continue;
        }

        // 1️⃣ Normalizar body_style
        const bodyStyle = normalizeBodyStyle(rawBodyStyle);

        // 9️⃣ Normalizar availability (todos los vehículos aquí son published)
        const availability = normalizeAvailability('published', true);

        // 5️⃣ Obtener address (OBLIGATORIO)
        const address = getVehicleAddress(vehicle.additional_data, this.DEFAULT_ADDRESS);

        // Construir descripción
        const description = this.sanitizeDescription(vehicle.content || vehicle.title);

        // Construir fila CSV con campos corregidos
        const row: string[] = [
          String(vehicle.id),                    // vehicle_id (renombrado de 'id')
          vehicle.title,                         // title
          description,                           // description
          availability,                          // availability (normalizado)
          stateOfVehicle,                        // state_of_vehicle (renombrado y normalizado)
          priceFormatted,                        // price
          vehicleUrl,                            // link
          imageLink,                             // image (renombrado de 'image_link')
          brand,                                 // make (brand)
          model,                                 // model
          vehicle.year ? String(vehicle.year) : '', // year
          mileage,                              // mileage (validado y normalizado)
          address,                               // address (nuevo campo obligatorio)
          fuelType,                              // fuel_type (normalizado)
          transmission,                          // transmission (normalizado)
          bodyStyle,                             // body_style (normalizado)
          additionalImageLinks.join(',')         // additional_image_link (comma-separated URLs)
        ];

        // Escapar todos los campos
        const escapedRow = row.map(field => this.escapeCsvField(field));
        rows.push(escapedRow);
        includedCount++;

      } catch (error: any) {
        skippedCount++;
        logger.error(`[MetaFeed] Error procesando vehículo ${vehicle.id}: ${error.message}`);
        // Continuar con el siguiente vehículo
      }
    }

    // Unir filas con saltos de línea
    const csvContent = rows.map(row => row.join(',')).join('\n');

    logger.info(`[MetaFeed] Feed generado: ${includedCount} vehículos incluidos, ${skippedCount} omitidos`);

    return csvContent;
  }

  /**
   * Obtiene el feed CSV (con cache)
   */
  static async getFeedCSV(): Promise<string> {
    const now = Date.now();
    
    // Verificar cache
    if (this.cache && (now - this.cache.timestamp) < this.CACHE_TTL) {
      logger.debug('[MetaFeed] Sirviendo feed desde cache');
      return this.cache.csv;
    }

    // Generar nuevo feed
    try {
      const csv = await this.generateCSV();
      this.cache = {
        csv,
        timestamp: now
      };
      return csv;
    } catch (error: any) {
      logger.error(`[MetaFeed] Error generando feed: ${error.message}`);
      
      // Si hay error pero tenemos cache viejo, devolverlo como fallback
      if (this.cache) {
        logger.warn('[MetaFeed] Devolviendo cache viejo debido a error');
        return this.cache.csv;
      }
      
      throw error;
    }
  }

  /**
   * Invalida el cache del feed
   */
  static invalidateCache(): void {
    this.cache = null;
    logger.info('[MetaFeed] Cache invalidado');
  }
}
