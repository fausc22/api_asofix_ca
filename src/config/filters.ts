/**
 * Configuración de filtros obligatorios para vehículos
 * Estos filtros se aplican automáticamente en todos los endpoints públicos
 */

export interface FilterConfig {
  blockedBranchOffices: string[];
  minPrice: number;
  blockedStatuses: string[];
  requireImages: boolean;
}

/**
 * Carga la configuración de filtros desde variables de entorno
 */
export function loadFilterConfig(): FilterConfig {
  const blockedStr = process.env.BLOCKED_BRANCH_OFFICES || 'Dakota';
  const blockedBranchOffices = blockedStr
    .split(',')
    .map(office => office.trim().toLowerCase())
    .filter(office => office.length > 0);

  const minPrice = parseFloat(process.env.MIN_PRICE || '1');
  const blockedStatusesStr = process.env.BLOCKED_STATUSES || 'reservado';
  const blockedStatuses = blockedStatusesStr
    .split(',')
    .map(status => status.trim().toLowerCase())
    .filter(status => status.length > 0);

  const requireImages = process.env.REQUIRE_IMAGES !== 'false';

  return {
    blockedBranchOffices,
    minPrice,
    blockedStatuses,
    requireImages
  };
}

/**
 * Configuración global de filtros
 */
export const filterConfig = loadFilterConfig();

