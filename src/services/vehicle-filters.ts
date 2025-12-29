import { AsofixVehicle } from './asofix-api';
import { filterConfig } from '../config/filters';
import logger from './logger';

/**
 * Servicio para aplicar filtros obligatorios a vehículos
 * Estos filtros se aplican tanto durante la sincronización como en los endpoints públicos
 */
export class VehicleFilters {
  /**
   * Verifica si un vehículo debe ser omitido según los filtros obligatorios
   * 
   * Filtros aplicados:
   * 1. No pertenecer a concesionaria bloqueada (por defecto: Dakota)
   * 2. Precio mayor al mínimo configurado (por defecto: > 1)
   * 3. Estado distinto de los estados bloqueados (por defecto: != reservado)
   * 4. Debe tener al menos una imagen (si REQUIRE_IMAGES = true)
   * 
   * @param vehicle Vehículo de ASOFIX a verificar
   * @returns Objeto con indicador de omisión y razón
   */
  static shouldOmitVehicle(vehicle: AsofixVehicle): { omit: boolean; reason?: string } {
    // Verificar stock activo
    const activeStock = vehicle.stocks?.find(
      stock => stock.status && stock.status.toUpperCase() === 'ACTIVO'
    );

    if (!activeStock) {
      return { omit: true, reason: 'No tiene stock activo' };
    }

    // FILTRO 1: Verificar concesionaria bloqueada (Dakota por defecto)
    const branchName = (activeStock.branch_office_name || '').toLowerCase();
    for (const blockedOffice of filterConfig.blockedBranchOffices) {
      if (branchName.includes(blockedOffice.toLowerCase())) {
        return { 
          omit: true, 
          reason: `Concesionaria bloqueada: ${activeStock.branch_office_name} (filtro: ${blockedOffice})` 
        };
      }
    }

    // FILTRO 2: Verificar precio mínimo
    const price = parseFloat(String(vehicle.price?.list_price || 0));
    if (price <= filterConfig.minPrice) {
      return { 
        omit: true, 
        reason: `Precio (${price}) menor o igual al mínimo permitido (${filterConfig.minPrice})` 
      };
    }

    // FILTRO 3: Verificar estado bloqueado
    const stockStatus = (activeStock.status || '').toLowerCase();
    for (const blockedStatus of filterConfig.blockedStatuses) {
      if (stockStatus === blockedStatus.toLowerCase()) {
        return { 
          omit: true, 
          reason: `Estado bloqueado: ${activeStock.status} (filtro: ${blockedStatus})` 
        };
      }
    }

    // FILTRO 4: Verificar que tenga al menos una imagen
    if (filterConfig.requireImages) {
      const hasImages = vehicle.images && vehicle.images.length > 0 && 
                       vehicle.images.some(img => img.url && img.url.trim().length > 0);
      if (!hasImages) {
        return { 
          omit: true, 
          reason: 'No tiene imágenes asociadas (REQUIRE_IMAGES=true)' 
        };
      }
    }

    return { omit: false };
  }

  /**
   * Aplica los filtros obligatorios a una lista de vehículos
   * @param vehicles Lista de vehículos a filtrar
   * @returns Lista de vehículos que pasan los filtros
   */
  static filterVehicles(vehicles: AsofixVehicle[]): {
    filtered: AsofixVehicle[];
    omitted: number;
    reasons: Record<string, number>;
  } {
    const filtered: AsofixVehicle[] = [];
    let omitted = 0;
    const reasons: Record<string, number> = {};

    for (const vehicle of vehicles) {
      const { omit, reason } = this.shouldOmitVehicle(vehicle);
      
      if (omit) {
        omitted++;
        if (reason) {
          reasons[reason] = (reasons[reason] || 0) + 1;
        }
        logger.debug(`Vehículo omitido (ID: ${vehicle.id}): ${reason}`);
      } else {
        filtered.push(vehicle);
      }
    }

    return { filtered, omitted, reasons };
  }

  /**
   * Obtiene un resumen de los filtros aplicados
   */
  static getFilterSummary(): {
    blockedBranchOffices: string[];
    minPrice: number;
    blockedStatuses: string[];
    requireImages: boolean;
  } {
    return {
      blockedBranchOffices: filterConfig.blockedBranchOffices,
      minPrice: filterConfig.minPrice,
      blockedStatuses: filterConfig.blockedStatuses,
      requireImages: filterConfig.requireImages
    };
  }
}

