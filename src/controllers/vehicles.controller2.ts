import { Request, Response } from 'express';
import pool from '../config/database';
import logger from '../services/logger';
import { VehicleFilters } from '../services/vehicle-filters';

/**
 * Controlador para endpoints de vehículos
 * Aplica automáticamente los filtros obligatorios en todos los endpoints públicos
 */
export class VehiclesController {
  /**
   * GET /autos
   * Obtiene vehículos con filtros aplicados
   * Filtros obligatorios aplicados automáticamente:
   * - No Dakota
   * - Precio > 1
   * - Estado != reservado
   * - Al menos una imagen
   */
  static async getVehicles(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const brand = req.query.brand ? String(req.query.brand).trim() : null;
      const model = req.query.model ? String(req.query.model).trim() : null;
      
      const parseNumericParam = (value: any): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return (!isNaN(num) && isFinite(num) && num > 0) ? num : null;
      };
      
      const parseNumericParamWithZero = (value: any): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return (!isNaN(num) && isFinite(num) && num >= 0) ? num : null;
      };
      
      const minPrice = parseNumericParam(req.query.minPrice);
      const maxPrice = parseNumericParam(req.query.maxPrice);
      const minYear = parseNumericParam(req.query.minYear);
      const maxYear = parseNumericParam(req.query.maxYear);
      const minKilometres = parseNumericParamWithZero(req.query.minKilometres);
      const maxKilometres = parseNumericParam(req.query.maxKilometres);
      
      const condition = req.query.condition ? String(req.query.condition).trim() : null;
      const transmission = req.query.transmission ? String(req.query.transmission).trim() : null;
      const fuel_type = req.query.fuel_type ? String(req.query.fuel_type).trim() : null;
      const color = req.query.color ? String(req.query.color).trim() : null;
      const segment = req.query.segment ? String(req.query.segment).trim() : null;
      const search = req.query.search ? String(req.query.search).trim() : null;
      const sortBy = String(req.query.sortBy || 'created_at');
      const sortOrder = String(req.query.sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      const currencyParam = req.query.currency ? String(req.query.currency).trim() : null;
      const currency = (currencyParam === 'USD' || currencyParam === 'ARS') ? currencyParam : null;
      
      const offset = (page - 1) * limit;
      
      // Construir condiciones WHERE
      const whereConditions: string[] = [];
      const whereParams: any[] = [];
      
      // FILTROS OBLIGATORIOS aplicados automáticamente
      // 1. Status = published (solo vehículos publicados)
      whereConditions.push('v.status = ?');
      whereParams.push('published');
      
      // 2. License plate NO NULL y NO vacío (OBLIGATORIO)
      whereConditions.push('v.license_plate IS NOT NULL');
      whereConditions.push('v.license_plate != ?');
      whereParams.push('');
      
      // 3. Precio > MIN_PRICE (por defecto > 1)
      const filterConfig = VehicleFilters.getFilterSummary();
      whereConditions.push('(v.price_usd > ? OR v.price_ars > ?)');
      whereParams.push(filterConfig.minPrice, filterConfig.minPrice);
      
      // 4. Debe tener al menos una imagen
      if (filterConfig.requireImages) {
        whereConditions.push('v.featured_image_id IS NOT NULL');
        whereConditions.push('EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)');
      }
      
      // 5. Excluir concesionarias bloqueadas (Dakota por defecto)
      // Se verifica en el JSON additional_data.stock_info[].branch_office_name
      if (filterConfig.blockedBranchOffices.length > 0) {
        // Para cada concesionaria bloqueada, verificar que no esté en el JSON
        const blockedConditions = filterConfig.blockedBranchOffices.map(() => {
          return `(v.additional_data IS NULL OR v.additional_data NOT LIKE ?)`;
        });
        whereConditions.push(`(${blockedConditions.join(' AND ')})`);
        for (const blocked of filterConfig.blockedBranchOffices) {
          whereParams.push(`%${blocked.toLowerCase()}%`);
        }
      }
      
      // Filtros opcionales del usuario
      if (search && search.length > 0) {
        whereConditions.push('(v.title LIKE ? OR v.content LIKE ?)');
        const searchTerm = `%${search}%`;
        whereParams.push(searchTerm, searchTerm);
      }
      
      if (brand && brand.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'brand' AND tt.name = ?
        )`);
        whereParams.push(brand);
      }
      
      if (model && model.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'model' AND tt.name = ?
        )`);
        whereParams.push(model);
      }
      
      if (condition && condition.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'condition' AND tt.name = ?
        )`);
        whereParams.push(condition);
      }
      
      if (transmission && transmission.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'transmission' AND tt.name = ?
        )`);
        whereParams.push(transmission);
      }
      
      if (fuel_type && fuel_type.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'fuel_type' AND tt.name = ?
        )`);
        whereParams.push(fuel_type);
      }
      
      if (color && color.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'color' AND tt.name = ?
        )`);
        whereParams.push(color);
      }
      
      if (segment && segment.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'segment' AND tt.name = ?
        )`);
        whereParams.push(segment);
      }
      
      // Filtro por moneda: si está especificada, solo mostrar vehículos con precio en esa moneda
      if (currency) {
        if (currency === 'USD') {
          whereConditions.push('v.price_usd IS NOT NULL AND v.price_usd > 0');
        } else {
          whereConditions.push('v.price_ars IS NOT NULL AND v.price_ars > 0');
        }
        
        const priceField = currency === 'USD' ? 'v.price_usd' : 'v.price_ars';
        if (minPrice !== null) {
          whereConditions.push(`${priceField} >= ?`);
          whereParams.push(minPrice);
        }
        if (maxPrice !== null) {
          whereConditions.push(`${priceField} <= ?`);
          whereParams.push(maxPrice);
        }
      } else {
        // Sin moneda especificada: aplicar filtros a ambas monedas
        if (minPrice !== null) {
          whereConditions.push('(v.price_usd >= ? OR v.price_ars >= ?)');
          whereParams.push(minPrice, minPrice);
        }
        if (maxPrice !== null) {
          whereConditions.push('(v.price_usd <= ? OR v.price_ars <= ?)');
          whereParams.push(maxPrice, maxPrice);
        }
      }
      
      if (minYear !== null) {
        whereConditions.push('v.year >= ?');
        whereParams.push(minYear);
      }
      
      if (maxYear !== null) {
        whereConditions.push('v.year <= ?');
        whereParams.push(maxYear);
      }
      
      if (minKilometres !== null) {
        whereConditions.push('v.kilometres >= ?');
        whereParams.push(minKilometres);
      }
      
      if (maxKilometres !== null) {
        whereConditions.push('v.kilometres <= ?');
        whereParams.push(maxKilometres);
      }
      
      const whereClause = whereConditions.join(' AND ');
      
      // ORDER BY
      let orderByField: string;
      if (sortBy === 'price') {
        if (currency === 'USD') {
          orderByField = 'v.price_usd';
        } else if (currency === 'ARS') {
          orderByField = 'v.price_ars';
        } else {
          orderByField = 'COALESCE(v.price_usd, v.price_ars, 0)';
        }
      } else {
        const sortFields: Record<string, string> = {
          'created_at': 'v.created_at',
          'year': 'v.year',
          'kilometres': 'v.kilometres',
          'title': 'v.title'
        };
        orderByField = sortFields[sortBy] || 'v.created_at';
      }
      
      const query = `SELECT DISTINCT
        v.id,
        v.asofix_id,
        v.title,
        v.content,
        v.year,
        v.kilometres,
        v.license_plate,
        v.price_usd,
        v.price_ars,
        v.created_at,
        v.updated_at,
        vi.file_path as featured_image_path,
        vi.image_url as featured_image_url
      FROM vehicles v
      LEFT JOIN vehicle_images vi ON v.featured_image_id = vi.id
      WHERE ${whereClause}
      ORDER BY ${orderByField} ${sortOrder}
      LIMIT ? OFFSET ?`;
      
      const finalParams = [...whereParams, parseInt(String(limit), 10), parseInt(String(offset), 10)];
      
      const [rows] = await pool.query<any[]>(query, finalParams);
      const vehicles = rows as any[];
      
      // Obtener taxonomías para cada vehículo
      for (const vehicle of vehicles) {
        const [taxonomies] = await pool.execute<any[]>(
          `SELECT tt.taxonomy, tt.name 
           FROM vehicle_taxonomies vt
           JOIN taxonomy_terms tt ON vt.term_id = tt.id
           WHERE vt.vehicle_id = ?`,
          [vehicle.id]
        );
        
        vehicle.taxonomies = taxonomies.reduce((acc: any, tax: any) => {
          if (!acc[tax.taxonomy]) acc[tax.taxonomy] = [];
          acc[tax.taxonomy].push(tax.name);
          return acc;
        }, {});
      }
      
      // Contar total con mismos filtros
      const countQuery = `SELECT COUNT(DISTINCT v.id) as total 
        FROM vehicles v
        WHERE ${whereClause}`;
      
      const [countResult] = await pool.execute<any[]>(countQuery, whereParams);
      const total = countResult[0]?.total || 0;
      
      res.json({
        success: true,
        data: {
          vehicles,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          },
          filters_applied: VehicleFilters.getFilterSummary()
        }
      });
    } catch (error: any) {
      logger.error(`Error en GET /autos: ${error.message}`);
      logger.error(`Stack: ${error.stack}`);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * GET /autos/:id
   * Obtiene un vehículo por ID
   * Aplica los mismos filtros obligatorios que el listado
   * Permite buscar por ID numérico o asofix_id (string)
   */
  static async getVehicleById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      const filterConfig = VehicleFilters.getFilterSummary();
      
      // Intentar convertir a número para buscar por ID numérico
      const numericId = Number(id);
      const isNumericId = !isNaN(numericId) && isFinite(numericId);
      
      // Construir condiciones WHERE con filtros obligatorios
      const whereConditions: string[] = [];
      const whereParams: any[] = [];
      
      // Buscar por ID numérico o asofix_id
      if (isNumericId) {
        whereConditions.push('(v.id = ? OR v.asofix_id = ?)');
        whereParams.push(numericId, String(id));
      } else {
        whereConditions.push('v.asofix_id = ?');
        whereParams.push(String(id));
      }
      
      whereConditions.push('v.status = ?');
      whereParams.push('published');
      
      // License plate NO NULL y NO vacío (OBLIGATORIO)
      whereConditions.push('v.license_plate IS NOT NULL');
      whereConditions.push('v.license_plate != ?');
      whereParams.push('');
      
      whereConditions.push('(v.price_usd > ? OR v.price_ars > ?)');
      whereParams.push(filterConfig.minPrice, filterConfig.minPrice);
      
      if (filterConfig.requireImages) {
        whereConditions.push('v.featured_image_id IS NOT NULL');
        whereConditions.push('EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)');
      }
      
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
      
      // Aplicar filtros obligatorios en la consulta
      const [vehicles] = await pool.execute<any[]>(
        `SELECT v.*, 
          vi.file_path as featured_image_path,
          vi.image_url as featured_image_url
        FROM vehicles v
        LEFT JOIN vehicle_images vi ON v.featured_image_id = vi.id
        WHERE ${whereClause}`,
        whereParams
      );
      
      if (vehicles.length === 0) {
        // Si no se encuentra con filtros obligatorios, intentar sin ellos para dar mejor mensaje de error
        const [vehicleExists] = await pool.execute<any[]>(
          `SELECT v.id FROM vehicles v WHERE v.id = ? OR v.asofix_id = ?`,
          [isNumericId ? numericId : null, String(id)]
        );
        
        if (vehicleExists.length === 0) {
          return res.status(404).json({ 
            success: false, 
            message: 'Vehículo no encontrado' 
          });
        } else {
          return res.status(404).json({ 
            success: false, 
            message: 'Vehículo no disponible (no cumple con los filtros obligatorios)' 
          });
        }
      }
      
      // Verificar que tenga imágenes si es requerido
      if (filterConfig.requireImages) {
        const vehicleId = vehicles[0].id;
        const [imageCount] = await pool.execute<any[]>(
          'SELECT COUNT(*) as count FROM vehicle_images WHERE vehicle_id = ?',
          [vehicleId]
        );
        if (imageCount[0].count === 0) {
          return res.status(404).json({ 
            success: false, 
            message: 'Vehículo no encontrado (no tiene imágenes)' 
          });
        }
      }
      
      const vehicle = vehicles[0];
      const vehicleId = vehicle.id;
      
      // Obtener imágenes
      const [images] = await pool.execute<any[]>(
        'SELECT image_url, file_path FROM vehicle_images WHERE vehicle_id = ? ORDER BY id',
        [vehicleId]
      );
      
      // Obtener taxonomías
      const [taxonomies] = await pool.execute<any[]>(
        `SELECT tt.taxonomy, tt.name 
         FROM vehicle_taxonomies vt
         JOIN taxonomy_terms tt ON vt.term_id = tt.id
         WHERE vt.vehicle_id = ?`,
        [vehicleId]
      );
      
      vehicle.images = images;
      vehicle.taxonomies = taxonomies.reduce((acc: any, tax: any) => {
        if (!acc[tax.taxonomy]) acc[tax.taxonomy] = [];
        acc[tax.taxonomy].push(tax.name);
        return acc;
      }, {});
      
      res.json({ 
        success: true, 
        data: vehicle,
        filters_applied: filterConfig
      });
    } catch (error: any) {
      logger.error(`Error en GET /autos/:id: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * GET /autos/filters/options
   * Obtiene opciones de filtros disponibles con conteos dinámicos según filtros aplicados
   * Compatible con el backend antiguo: acepta filtros como query params
   */
  static async getFilterOptions(req: Request, res: Response) {
    try {
      const filterConfig = VehicleFilters.getFilterSummary();
      
      // Parsear filtros de query params (igual que en el backend antiguo)
      const condition = req.query.condition ? String(req.query.condition).trim() : null;
      const brand = req.query.brand ? String(req.query.brand).trim() : null;
      
      const parseNumericParam = (value: any): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return (!isNaN(num) && isFinite(num) && num > 0) ? num : null;
      };
      
      const parseNumericParamWithZero = (value: any): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return (!isNaN(num) && isFinite(num) && num >= 0) ? num : null;
      };
      
      const minPrice = parseNumericParam(req.query.minPrice);
      const maxPrice = parseNumericParam(req.query.maxPrice);
      const minYear = parseNumericParam(req.query.minYear);
      const maxYear = parseNumericParam(req.query.maxYear);
      const minKilometres = parseNumericParamWithZero(req.query.minKilometres);
      const maxKilometres = parseNumericParam(req.query.maxKilometres);
      
      const currencyParam = req.query.currency ? String(req.query.currency).trim() : null;
      const currency = (currencyParam === 'USD' || currencyParam === 'ARS') ? currencyParam : null;
      
      // Construir WHERE base con filtros obligatorios
      const baseWhere: string[] = ['v.status = ?'];
      const baseParams: any[] = ['published'];
      
      // License plate NO NULL y NO vacío (OBLIGATORIO)
      baseWhere.push('v.license_plate IS NOT NULL');
      baseWhere.push('v.license_plate != ?');
      baseParams.push('');
      
      // Aplicar filtros obligatorios del sistema
      baseWhere.push('(v.price_usd > ? OR v.price_ars > ?)');
      baseParams.push(filterConfig.minPrice, filterConfig.minPrice);
      
      if (filterConfig.requireImages) {
        baseWhere.push('v.featured_image_id IS NOT NULL');
        baseWhere.push('EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)');
      }
      
      if (filterConfig.blockedBranchOffices.length > 0) {
        const blockedConditions = filterConfig.blockedBranchOffices.map(() => {
          return `(v.additional_data IS NULL OR v.additional_data NOT LIKE ?)`;
        });
        baseWhere.push(`(${blockedConditions.join(' AND ')})`);
        for (const blocked of filterConfig.blockedBranchOffices) {
          baseParams.push(`%${blocked.toLowerCase()}%`);
        }
      }
      
      // Aplicar filtros del usuario para calcular conteos dinámicos
      if (condition && condition.length > 0) {
        baseWhere.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'condition' AND tt.name = ?
        )`);
        baseParams.push(condition);
      }
      
      if (brand && brand.length > 0) {
        baseWhere.push(`EXISTS (
          SELECT 1 FROM vehicle_taxonomies vt 
          JOIN taxonomy_terms tt ON vt.term_id = tt.id 
          WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'brand' AND tt.name = ?
        )`);
        baseParams.push(brand);
      }
      
      // Filtro por precio
      if (currency) {
        const priceField = currency === 'USD' ? 'v.price_usd' : 'v.price_ars';
        if (minPrice !== null) {
          baseWhere.push(`${priceField} >= ?`);
          baseParams.push(minPrice);
        }
        if (maxPrice !== null) {
          baseWhere.push(`${priceField} <= ?`);
          baseParams.push(maxPrice);
        }
      } else {
        if (minPrice !== null) {
          baseWhere.push('(v.price_usd >= ? OR v.price_ars >= ?)');
          baseParams.push(minPrice, minPrice);
        }
        if (maxPrice !== null) {
          baseWhere.push('(v.price_usd <= ? OR v.price_ars <= ?)');
          baseParams.push(maxPrice, maxPrice);
        }
      }
      
      // Filtro por año
      if (minYear !== null) {
        baseWhere.push('v.year >= ?');
        baseParams.push(minYear);
      }
      
      if (maxYear !== null) {
        baseWhere.push('v.year <= ?');
        baseParams.push(maxYear);
      }
      
      // Filtro por kilómetros
      if (minKilometres !== null) {
        baseWhere.push('v.kilometres >= ?');
        baseParams.push(minKilometres);
      }
      
      if (maxKilometres !== null) {
        baseWhere.push('v.kilometres <= ?');
        baseParams.push(maxKilometres);
      }
      
      const whereClause = baseWhere.join(' AND ');
      
      // Función helper para obtener opciones con conteos (igual que backend antiguo)
      const getOptionsWithCounts = async (taxonomy: string, filterBrand?: string | null) => {
        let query = `
          SELECT 
            tt.name,
            COUNT(DISTINCT v.id) as count
          FROM taxonomy_terms tt
          JOIN vehicle_taxonomies vt ON tt.id = vt.term_id
          JOIN vehicles v ON vt.vehicle_id = v.id
          WHERE tt.taxonomy = ? AND ${whereClause}
        `;
        
        const params: any[] = [taxonomy, ...baseParams];
        
        // Si es modelo y hay marca seleccionada, filtrar por marca
        if (taxonomy === 'model' && filterBrand) {
          query += ` AND EXISTS (
            SELECT 1 FROM vehicle_taxonomies vt2
            JOIN taxonomy_terms tt2 ON vt2.term_id = tt2.id
            WHERE vt2.vehicle_id = v.id AND tt2.taxonomy = 'brand' AND tt2.name = ?
          )`;
          params.push(filterBrand);
        }
        
        query += ` GROUP BY tt.name ORDER BY tt.name ASC`;
        
        const [results] = await pool.execute<any[]>(query, params);
        return results.map((r: any) => ({
          name: r.name,
          count: Number(r.count)
        }));
      };
      
      // Obtener opciones con conteos dinámicos
      const conditions = await getOptionsWithCounts('condition');
      const brands = await getOptionsWithCounts('brand');
      const models = brand ? await getOptionsWithCounts('model', brand) : [];
      
      // Obtener otras opciones (segments, transmissions, fuelTypes, colors) si están disponibles
      const segments = await getOptionsWithCounts('segment');
      const transmissions = await getOptionsWithCounts('transmission');
      const fuelTypes = await getOptionsWithCounts('fuel_type');
      const colors = await getOptionsWithCounts('color');
      
      // Obtener rangos de precios, años y kilómetros
      const [ranges] = await pool.execute<any[]>(
        `SELECT 
          MIN(v.price_usd) as min_price_usd,
          MAX(v.price_usd) as max_price_usd,
          MIN(v.price_ars) as min_price_ars,
          MAX(v.price_ars) as max_price_ars,
          MIN(v.year) as min_year,
          MAX(v.year) as max_year,
          MIN(v.kilometres) as min_kilometres,
          MAX(v.kilometres) as max_kilometres
         FROM vehicles v
         WHERE ${whereClause}`,
        baseParams
      );
      
      const rangeData = ranges[0] || {};
      
      res.json({
        success: true,
        data: {
          conditions: conditions,
          brands: brands,
          models: models,
          segments: segments.length > 0 ? segments : undefined,
          transmissions: transmissions.length > 0 ? transmissions : undefined,
          fuelTypes: fuelTypes.length > 0 ? fuelTypes : undefined,
          colors: colors.length > 0 ? colors : undefined,
          ranges: {
            min_price_usd: rangeData.min_price_usd ? Number(rangeData.min_price_usd) : undefined,
            max_price_usd: rangeData.max_price_usd ? Number(rangeData.max_price_usd) : undefined,
            min_price_ars: rangeData.min_price_ars ? Number(rangeData.min_price_ars) : undefined,
            max_price_ars: rangeData.max_price_ars ? Number(rangeData.max_price_ars) : undefined,
            min_year: rangeData.min_year ? Number(rangeData.min_year) : undefined,
            max_year: rangeData.max_year ? Number(rangeData.max_year) : undefined,
            min_kilometres: rangeData.min_kilometres ? Number(rangeData.min_kilometres) : undefined,
            max_kilometres: rangeData.max_kilometres ? Number(rangeData.max_kilometres) : undefined,
          }
        }
      });
    } catch (error: any) {
      logger.error(`Error en GET /autos/filters/options: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * GET /autos/:id/related
   * Obtiene vehículos relacionados usando múltiples criterios para asegurar resultados
   * Implementación mejorada basada en el backend antiguo con múltiples estrategias
   */
  static async getRelatedVehicles(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const targetLimit = Math.min(Number(req.query.limit) || 8, 8);
      
      const filterConfig = VehicleFilters.getFilterSummary();
      
      // Obtener información completa del vehículo actual
      const [currentVehicleRows] = await pool.execute<any[]>(
        `SELECT v.id, v.title, v.year, v.kilometres, v.price_usd, v.price_ars
         FROM vehicles v
         WHERE v.id = ? AND v.status = 'published'`,
        [Number(id)]
      );
      
      if (currentVehicleRows.length === 0) {
        return res.json({ success: true, data: [] });
      }
      
      const currentVehicle = currentVehicleRows[0];
      
      // Obtener todas las taxonomías del vehículo actual
      const [taxonomies] = await pool.execute<any[]>(
        `SELECT tt.taxonomy, tt.name 
         FROM vehicle_taxonomies vt
         JOIN taxonomy_terms tt ON vt.term_id = tt.id
         WHERE vt.vehicle_id = ?`,
        [Number(id)]
      );
      
      const brand = taxonomies.find((t: any) => t.taxonomy === 'brand')?.name;
      const model = taxonomies.find((t: any) => t.taxonomy === 'model')?.name;
      const transmission = taxonomies.find((t: any) => t.taxonomy === 'transmission')?.name;
      const fuelType = taxonomies.find((t: any) => t.taxonomy === 'fuel_type')?.name;
      
      // Determinar precio de referencia (priorizar USD si existe, sino ARS)
      const referencePrice = currentVehicle.price_usd && currentVehicle.price_usd > 0 
        ? currentVehicle.price_usd 
        : (currentVehicle.price_ars && currentVehicle.price_ars > 0 ? currentVehicle.price_ars : null);
      const priceCurrency = currentVehicle.price_usd && currentVehicle.price_usd > 0 ? 'USD' : 'ARS';
      
      // Calcular rangos de precio (±30% para más flexibilidad)
      const minPrice = referencePrice ? Math.floor(referencePrice * 0.7) : null;
      const maxPrice = referencePrice ? Math.ceil(referencePrice * 1.3) : null;
      
      // Calcular rango de año (±3 años)
      const minYear = currentVehicle.year ? currentVehicle.year - 3 : null;
      const maxYear = currentVehicle.year ? currentVehicle.year + 3 : null;
      
      let relatedVehicles: any[] = [];
      const usedIds = new Set<number>([Number(id)]);
      
      // Construir condiciones base con filtros obligatorios
      const getBaseWhere = (): { conditions: string[], params: any[] } => {
        const conditions: string[] = ['v.status = ?', 'v.id != ?'];
        const params: any[] = ['published', Number(id)];
        
        // License plate NO NULL y NO vacío (OBLIGATORIO)
        conditions.push('v.license_plate IS NOT NULL');
        conditions.push('v.license_plate != ?');
        params.push('');
        
        conditions.push('(v.price_usd > ? OR v.price_ars > ?)');
        params.push(filterConfig.minPrice, filterConfig.minPrice);
        
        if (filterConfig.requireImages) {
          conditions.push('v.featured_image_id IS NOT NULL');
          conditions.push('EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)');
        }
        
        if (filterConfig.blockedBranchOffices.length > 0) {
          const blockedConditions = filterConfig.blockedBranchOffices.map(() => {
            return `(v.additional_data IS NULL OR v.additional_data NOT LIKE ?)`;
          });
          conditions.push(`(${blockedConditions.join(' AND ')})`);
          for (const blocked of filterConfig.blockedBranchOffices) {
            params.push(`%${blocked.toLowerCase()}%`);
          }
        }
        
        return { conditions, params };
      };
      
      // Función auxiliar para obtener vehículos con criterios específicos
      const getVehiclesByCriteria = async (
        additionalConditions: string[],
        additionalParams: any[],
        priority: number
      ): Promise<any[]> => {
        const { conditions: baseConditions, params: baseParams } = getBaseWhere();
        const whereConditions = [...baseConditions, ...additionalConditions];
        const whereParams = [...baseParams, ...additionalParams];
        
        // Excluir IDs ya usados
        if (usedIds.size > 1) {
          const excludedIds = Array.from(usedIds).filter(usedId => usedId !== Number(id));
          if (excludedIds.length > 0) {
            whereConditions.push(`v.id NOT IN (${excludedIds.join(',')})`);
          }
        }
        
        const whereClause = whereConditions.join(' AND ');
        
        const [rows] = await pool.query<any[]>(
          `SELECT DISTINCT
            v.id,
            v.asofix_id,
            v.title,
            v.year,
            v.kilometres,
            v.price_usd,
            v.price_ars,
            v.created_at,
            vi.file_path as featured_image_path,
            vi.image_url as featured_image_url
          FROM vehicles v
          LEFT JOIN vehicle_images vi ON v.featured_image_id = vi.id
          WHERE ${whereClause}
          ORDER BY v.created_at DESC
          LIMIT ?`,
          [...whereParams, targetLimit * 2] // Buscar más para tener opciones
        );
        
        return rows as any[];
      };
      
      // Estrategia 1: Mismo modelo (máxima prioridad)
      if (model && relatedVehicles.length < targetLimit) {
        const vehicles = await getVehiclesByCriteria(
          [`EXISTS (
            SELECT 1 FROM vehicle_taxonomies vt 
            JOIN taxonomy_terms tt ON vt.term_id = tt.id 
            WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'model' AND tt.name = ?
          )`],
          [model],
          1
        );
        relatedVehicles.push(...vehicles);
        vehicles.forEach(v => usedIds.add(v.id));
      }
      
      // Estrategia 2: Misma marca
      if (brand && relatedVehicles.length < targetLimit) {
        const vehicles = await getVehiclesByCriteria(
          [`EXISTS (
            SELECT 1 FROM vehicle_taxonomies vt 
            JOIN taxonomy_terms tt ON vt.term_id = tt.id 
            WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'brand' AND tt.name = ?
          )`],
          [brand],
          2
        );
        relatedVehicles.push(...vehicles);
        vehicles.forEach(v => usedIds.add(v.id));
      }
      
      // Estrategia 3: Rango de precio similar + año similar
      if (referencePrice && minYear && maxYear && relatedVehicles.length < targetLimit) {
        const priceField = priceCurrency === 'USD' ? 'v.price_usd' : 'v.price_ars';
        const vehicles = await getVehiclesByCriteria(
          [
            `${priceField} IS NOT NULL AND ${priceField} >= ? AND ${priceField} <= ?`,
            'v.year IS NOT NULL AND v.year >= ? AND v.year <= ?'
          ],
          [minPrice, maxPrice, minYear, maxYear],
          3
        );
        relatedVehicles.push(...vehicles);
        vehicles.forEach(v => usedIds.add(v.id));
      }
      
      // Estrategia 4: Misma transmisión o combustible
      if ((transmission || fuelType) && relatedVehicles.length < targetLimit) {
        const conditions: string[] = [];
        const params: any[] = [];
        
        if (transmission) {
          conditions.push(`EXISTS (
            SELECT 1 FROM vehicle_taxonomies vt 
            JOIN taxonomy_terms tt ON vt.term_id = tt.id 
            WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'transmission' AND tt.name = ?
          )`);
          params.push(transmission);
        }
        
        if (fuelType) {
          conditions.push(`EXISTS (
            SELECT 1 FROM vehicle_taxonomies vt 
            JOIN taxonomy_terms tt ON vt.term_id = tt.id 
            WHERE vt.vehicle_id = v.id AND tt.taxonomy = 'fuel_type' AND tt.name = ?
          )`);
          params.push(fuelType);
        }
        
        if (conditions.length > 0) {
          const vehicles = await getVehiclesByCriteria(
            [`(${conditions.join(' OR ')})`],
            params,
            4
          );
          relatedVehicles.push(...vehicles);
          vehicles.forEach(v => usedIds.add(v.id));
        }
      }
      
      // Estrategia 5: Rango de precio similar (sin restricción de año)
      if (referencePrice && relatedVehicles.length < targetLimit) {
        const priceField = priceCurrency === 'USD' ? 'v.price_usd' : 'v.price_ars';
        const vehicles = await getVehiclesByCriteria(
          [`${priceField} IS NOT NULL AND ${priceField} >= ? AND ${priceField} <= ?`],
          [minPrice, maxPrice],
          5
        );
        relatedVehicles.push(...vehicles);
        vehicles.forEach(v => usedIds.add(v.id));
      }
      
      // Estrategia 6: Año similar (sin restricción de precio)
      if (minYear && maxYear && relatedVehicles.length < targetLimit) {
        const vehicles = await getVehiclesByCriteria(
          ['v.year IS NOT NULL AND v.year >= ? AND v.year <= ?'],
          [minYear, maxYear],
          6
        );
        relatedVehicles.push(...vehicles);
        vehicles.forEach(v => usedIds.add(v.id));
      }
      
      // Estrategia 7: Cualquier vehículo publicado (último recurso)
      if (relatedVehicles.length < targetLimit) {
        const vehicles = await getVehiclesByCriteria(
          [],
          [],
          7
        );
        relatedVehicles.push(...vehicles);
      }
      
      // Eliminar duplicados y limitar resultados
      const uniqueVehicles = Array.from(
        new Map(relatedVehicles.map(v => [v.id, v])).values()
      ).slice(0, targetLimit);
      
      // Obtener taxonomías para cada vehículo relacionado
      for (const vehicle of uniqueVehicles) {
        const [vehicleTaxonomies] = await pool.execute<any[]>(
          `SELECT tt.taxonomy, tt.name 
           FROM vehicle_taxonomies vt
           JOIN taxonomy_terms tt ON vt.term_id = tt.id
           WHERE vt.vehicle_id = ?`,
          [vehicle.id]
        );
        
        vehicle.taxonomies = vehicleTaxonomies.reduce((acc: any, tax: any) => {
          if (!acc[tax.taxonomy]) acc[tax.taxonomy] = [];
          acc[tax.taxonomy].push(tax.name);
          return acc;
        }, {});
      }
      
      res.json({ success: true, data: uniqueVehicles });
    } catch (error: any) {
      logger.error(`Error en GET /autos/:id/related: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

