# Diagnóstico: Problema de Estados de Vehículos

## Problema Reportado

Cuando un vehículo pasa de **publicado → reservado** o **publicado → eliminado** en la API externa, y se ejecuta una sincronización manual, el vehículo **sigue apareciendo en el catálogo público**, cuando debería dejar de mostrarse automáticamente.

## Análisis del Flujo Actual

### 1. Flujo de Sincronización Actual

```
syncAll() 
  → syncPage() [obtiene vehículos de API externa]
    → processVehicle() [para cada vehículo]
      → shouldOmitVehicle() [verifica filtros]
        → Si omit=true: archiva vehículo
        → Si omit=false: publica/actualiza vehículo
```

### 2. Problema Identificado

**Caso 1: Vehículo reservado que SÍ aparece en la API externa**
- Si la API externa devuelve el vehículo con stock status="RESERVADO"
- `shouldOmitVehicle()` busca stock con status="ACTIVO"
- No encuentra stock activo → retorna `omit: true`
- `processVehicle()` debería archivarlo
- ✅ **ESTE CASO DEBERÍA FUNCIONAR** (si la API devuelve vehículos reservados)

**Caso 2: Vehículo reservado que NO aparece en la API externa** ⚠️ **PROBLEMA CRÍTICO**
- Si la API externa NO devuelve vehículos reservados/eliminados (filtrado por defecto)
- El vehículo nunca llega a `processVehicle()`
- El vehículo nunca se archiva
- Sigue con `status='published'` en la BD
- Sigue apareciendo en el catálogo público
- ❌ **ESTE ES EL PROBLEMA PRINCIPAL**

## Campos y Estados de la API Externa

### Campos Relevantes (según código actual)

1. **stocks[]**
   - `status`: "ACTIVO", "RESERVADO", "ELIMINADO", etc.
   - `branch_office_name`: Nombre de la concesionaria
   - `location_name`: Nombre de la ubicación

2. **Parámetros de la API**
   - `only_available_stock`: Si es `true`, solo devuelve vehículos con stock disponible
   - `include_unpublished`: Si es `true`, incluye vehículos no publicados

### Estado en Base de Datos

- `status`: enum('draft','published','archived')
- `additional_data.stock_info[]`: Array con información de stock (incluyendo status)
- `last_synced_at`: Última vez que se sincronizó este vehículo

## Solución Propuesta

### Opción A: Si la API externa SÍ devuelve vehículos reservados

1. Asegurar que la API incluya vehículos reservados:
   - Configurar parámetros: `only_available_stock=false`
   - O: `include_unpublished=true` (si aplica)

2. `shouldOmitVehicle()` ya maneja esto:
   - Si no hay stock ACTIVO → `omit: true`
   - `processVehicle()` archiva el vehículo
   - ✅ **Ya debería funcionar**

### Opción B: Si la API externa NO devuelve vehículos reservados

**Necesitamos una fase de limpieza:**

1. Durante la sincronización, trackear todos los `asofix_id` procesados
2. Al final de la sincronización:
   - Buscar vehículos con `status='published'` en la BD
   - Que NO fueron procesados en esta sync
   - Que tienen `last_synced_at` antiguo (más de X horas)
   - Archivarlos automáticamente

**Lógica:**
- Si un vehículo estaba publicado y ya no aparece en la API externa
- Y no fue procesado en esta sincronización
- Asumimos que ya no está disponible (reservado/eliminado)
- Lo archivamos

### Implementación Recomendada

**Combinar ambas opciones:**

1. Intentar obtener vehículos reservados de la API (si es posible)
2. Agregar fase de limpieza como respaldo
3. La fase de limpieza solo se activa si hay vehículos publicados que no fueron procesados

## Preguntas Clave a Resolver

1. ¿La API externa devuelve vehículos reservados por defecto?
2. ¿Qué parámetros acepta la API para incluir/excluir vehículos?
3. ¿Cuál es el comportamiento real de `only_available_stock` y `include_unpublished`?
4. ¿Cuánto tiempo es razonable para considerar un vehículo "obsoleto" si no aparece en la API?

## Próximos Pasos

1. Revisar documentación oficial de la API externa
2. Probar llamadas a la API con diferentes parámetros
3. Verificar qué vehículos devuelve la API en cada caso
4. Implementar solución basada en hallazgos

