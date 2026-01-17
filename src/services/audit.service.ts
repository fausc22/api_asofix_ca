import pool from '../config/database';
import logger from './logger';

export interface VehicleAuditRecord {
  id: number;
  brand: string | null;
  model: string | null;
  title: string;
  license_plate: string | null;
}

export interface AuditResult {
  totalVehicles: number;
  vehicles: VehicleAuditRecord[];
  generatedAt: string;
}

/**
 * Servicio de auditoría para extraer el catálogo completo de vehículos
 * desde la base de datos para comparación con fuentes externas.
 */
class AuditService {
  /**
   * Obtiene todos los vehículos de la base de datos con los campos mínimos
   * requeridos para auditoría: id, brand, model, title, status, license_plate
   * 
   * IMPORTANTE: Solo devuelve vehículos que están en status 'published'
   * (excluye 'archived' y cualquier otro estado)
   * 
   * @returns Promise con el resultado de la auditoría
   */
  async getAllVehiclesForAudit(): Promise<AuditResult> {
    try {
      // Consulta SQL con LEFT JOINs para obtener brand y model desde taxonomías
      // Usamos LEFT JOIN porque brand y model pueden ser NULL
      // FILTRO: Solo vehículos que están en status 'published' (comparación estricta y case-sensitive)
      // IMPORTANTE: No seleccionamos v.status porque solo queremos vehículos published
      // Usamos BINARY para comparación case-sensitive y LOWER para normalizar
      const query = `
        SELECT 
          v.id,
          v.title,
          v.license_plate,
          v.status,
          MAX(CASE WHEN tt_brand.taxonomy = 'brand' THEN tt_brand.name END) as brand,
          MAX(CASE WHEN tt_model.taxonomy = 'model' THEN tt_model.name END) as model
        FROM vehicles v
        LEFT JOIN vehicle_taxonomies vt_brand 
          ON v.id = vt_brand.vehicle_id 
          AND vt_brand.taxonomy = 'brand'
        LEFT JOIN taxonomy_terms tt_brand 
          ON vt_brand.term_id = tt_brand.id
        LEFT JOIN vehicle_taxonomies vt_model 
          ON v.id = vt_model.vehicle_id 
          AND vt_model.taxonomy = 'model'
        LEFT JOIN taxonomy_terms tt_model 
          ON vt_model.term_id = tt_model.id
        WHERE LOWER(TRIM(v.status)) = 'published'
        GROUP BY v.id, v.title, v.license_plate, v.status
        ORDER BY v.id ASC
      `;

      const [rows] = await pool.execute<any[]>(query);

      // FILTRO ADICIONAL EN JAVASCRIPT como doble verificación (por si acaso hay algún problema en SQL)
      // Esto asegura que SOLO se devuelvan vehículos con status 'published'
      const vehicles: VehicleAuditRecord[] = rows
        .filter((row: any) => {
          const status = String(row.status || '').trim().toLowerCase();
          const isPublished = status === 'published';
          
          if (!isPublished) {
            logger.warn(`[Audit] Vehículo ${row.id} excluido por tener status '${row.status}' (esperado: 'published')`);
          }
          
          return isPublished;
        })
        .map((row: any) => ({
          id: row.id,
          brand: row.brand || null,
          model: row.model || null,
          title: row.title || '',
          license_plate: row.license_plate || null
        }));

      logger.info(`[Audit] Vehículos obtenidos: ${vehicles.length} publicados (de ${rows.length} totales en query)`);

      return {
        totalVehicles: vehicles.length,
        vehicles,
        generatedAt: new Date().toISOString()
      };
    } catch (error: any) {
      logger.error(`Error al obtener vehículos para auditoría: ${error.message}`, {
        stack: error.stack
      });
      throw new Error(`Error al obtener vehículos para auditoría: ${error.message}`);
    }
  }

  /**
   * Convierte el resultado de auditoría a formato CSV
   * 
   * @param auditResult Resultado de la auditoría
   * @returns String CSV con los datos de vehículos
   */
  convertToCSV(auditResult: AuditResult): string {
    // Headers sin la columna 'status' ya que solo mostramos vehículos published
    const headers = ['id', 'brand', 'model', 'title', 'license_plate'];
    
    // Función para escapar valores CSV (manejar comillas y comas)
    const escapeCSV = (value: string | null): string => {
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      // Si contiene comillas, comas o saltos de línea, envolver en comillas y escapar comillas internas
      if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const csvLines = [
      headers.join(','),
      ...auditResult.vehicles.map(vehicle => 
        [
          vehicle.id,
          escapeCSV(vehicle.brand),
          escapeCSV(vehicle.model),
          escapeCSV(vehicle.title),
          escapeCSV(vehicle.license_plate)
        ].join(',')
      )
    ];

    // Log para verificar que el CSV tiene la cantidad correcta de líneas
    logger.info(`[Audit] CSV generado: ${csvLines.length - 1} vehículos (totalVehicles en result: ${auditResult.totalVehicles})`);

    return csvLines.join('\n');
  }
}

export default new AuditService();

