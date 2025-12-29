# Decisiones Técnicas - API Backend

## 📋 Resumen

Este documento explica las decisiones técnicas tomadas durante el desarrollo de la API backend, el razonamiento detrás de ellas, y cómo afectan al funcionamiento del sistema.

## 🎯 Objetivo Principal

Crear una API profesional, clara y mantenible que:
1. Se integre correctamente con ASOFIX
2. Aplique filtros obligatorios de forma consistente
3. Sea fácil de entender y mantener
4. Escale bien en el futuro

## 🔧 Decisiones Técnicas

### 1. Estructura de Carpetas

**Decisión**: Organizar código en carpetas por responsabilidad (controllers, services, routes, etc.)

**Razonamiento**:
- Separación clara de responsabilidades
- Fácil de navegar y entender
- Escalable para futuras funcionalidades
- Sigue convenciones de Express/Node.js

**Alternativas consideradas**:
- Estructura por feature (todos los archivos de vehículos juntos)
- Estructura plana (todo en una carpeta)

**Impacto**: Código más organizado y mantenible.

### 2. Filtros en Dos Capas

**Decisión**: Aplicar filtros obligatorios tanto durante la sincronización como en los endpoints públicos.

**Razonamiento**:
- **Seguridad**: Doble capa de protección garantiza que nunca se muestren vehículos no válidos
- **Consistencia**: Los datos en BD ya están filtrados, pero los endpoints tienen validación adicional
- **Mantenibilidad**: Si un filtro falla en una capa, la otra lo captura
- **Performance**: Los endpoints son más rápidos porque la BD ya tiene datos filtrados

**Implementación**:
1. Durante sincronización: `VehicleFilters.shouldOmitVehicle()` filtra antes de guardar
2. En endpoints: Queries SQL incluyen condiciones de filtros

**Alternativas consideradas**:
- Solo filtrar en sincronización (más rápido, pero menos seguro)
- Solo filtrar en endpoints (más flexible, pero menos eficiente)

**Impacto**: Mayor seguridad y consistencia, con ligero overhead en queries.

### 3. Hash de Versión para Detección de Cambios

**Decisión**: Usar hash SHA-256 de datos relevantes para detectar cambios en vehículos.

**Razonamiento**:
- **Eficiencia**: Solo actualizar vehículos que realmente cambiaron
- **Precisión**: Hash incluye todos los campos relevantes
- **Performance**: Comparación de hash es muy rápida
- **Mantenibilidad**: Fácil agregar/quitar campos del hash

**Campos incluidos en hash**:
- ID, título, descripción
- Año, kilometraje, precio
- Condición, transmisión, combustible
- Color, patente
- Cantidad de imágenes
- Estado de stock

**Alternativas consideradas**:
- Comparar campo por campo (más lento)
- Timestamp de última actualización (menos preciso)
- Checksum simple (menos robusto)

**Impacto**: Sincronización incremental mucho más rápida.

### 4. Sincronización en Dos Fases

**Decisión**: Separar sincronización de datos (Fase 1) y descarga de imágenes (Fase 2).

**Razonamiento**:
- **Velocidad**: Fase 1 es rápida, permite tener datos disponibles pronto
- **Resiliencia**: Si falla descarga de imágenes, los datos ya están guardados
- **Flexibilidad**: Se puede ejecutar solo Fase 1 o solo Fase 2
- **Monitoreo**: Progreso más claro y fácil de seguir

**Flujo**:
1. Fase 1: Obtener vehículos de ASOFIX → Aplicar filtros → Guardar en BD → Guardar URLs de imágenes pendientes
2. Fase 2: Obtener imágenes pendientes → Descargar → Guardar archivos → Actualizar BD

**Alternativas consideradas**:
- Todo en una fase (más simple, pero más lento)
- Tres fases (más granular, pero más complejo)

**Impacto**: Mejor experiencia de usuario y mayor flexibilidad.

### 5. Server-Sent Events para Progreso

**Decisión**: Usar SSE (Server-Sent Events) para reportar progreso de sincronización inicial.

**Razonamiento**:
- **Tiempo real**: Usuario ve progreso en tiempo real
- **Simplicidad**: Más simple que WebSockets para este caso
- **Compatibilidad**: Funciona bien en navegadores modernos
- **Debugging**: Fácil ver qué está pasando durante sincronización

**Alternativas consideradas**:
- Polling (más simple, pero menos eficiente)
- WebSockets (más complejo, no necesario aquí)
- Solo respuesta final (menos informativo)

**Impacto**: Mejor experiencia de usuario y debugging más fácil.

### 6. Configuración de Filtros en Variables de Entorno

**Decisión**: Configurar filtros obligatorios mediante variables de entorno.

**Razonamiento**:
- **Flexibilidad**: Cambiar filtros sin modificar código
- **Seguridad**: No hardcodear valores sensibles
- **Ambientes**: Diferentes configuraciones para dev/prod
- **Documentación**: `.env.example` documenta opciones disponibles

**Estructura**:
```env
BLOCKED_BRANCH_OFFICES=Dakota
MIN_PRICE=1
BLOCKED_STATUSES=reservado
REQUIRE_IMAGES=true
```

**Alternativas consideradas**:
- Hardcodear en código (menos flexible)
- Base de datos (más complejo, overhead)
- Archivo de configuración JSON (menos estándar)

**Impacto**: Mayor flexibilidad y facilidad de configuración.

### 7. Cron Job Cada 1 Hora

**Decisión**: Ejecutar sincronización incremental cada 1 hora por defecto.

**Razonamiento**:
- **Balance**: No sobrecargar ASOFIX, pero mantener datos actualizados
- **Configurable**: Se puede cambiar con `SYNC_CRON_SCHEDULE`
- **Incremental**: Solo actualiza cambios, no carga completa
- **Resiliente**: Si falla, se reintenta en la próxima hora

**Configuración**:
```env
SYNC_CRON_SCHEDULE=0 * * * *  # Cada hora
ENABLE_AUTO_SYNC=true
```

**Alternativas consideradas**:
- Cada 30 minutos (más frecuente, pero más carga)
- Cada 6 horas (menos carga, pero datos menos actualizados)
- Solo manual (más control, pero requiere intervención)

**Impacto**: Datos actualizados automáticamente sin intervención manual.

### 8. Almacenamiento de Imágenes Local

**Decisión**: Descargar y almacenar imágenes localmente en `uploads/vehicles/{id}/`.

**Razonamiento**:
- **Control**: Control total sobre las imágenes
- **Performance**: Servir desde servidor local es rápido
- **Costo**: No hay costos de CDN
- **Simplicidad**: No requiere servicios externos

**Estructura**:
```
uploads/
  vehicles/
    1/
      image1.jpg
      image2.jpg
    2/
      image1.jpg
```

**Alternativas consideradas**:
- CDN (mejor performance, pero más complejo y costoso)
- Solo URLs de ASOFIX (más simple, pero dependencia externa)
- Híbrido (local + CDN, más complejo)

**Impacto**: Simplicidad y control, con potencial necesidad de CDN en el futuro.

### 9. Taxonomías en Tablas Separadas

**Decisión**: Usar tablas `taxonomy_terms` y `vehicle_taxonomies` para marcas, modelos, etc.

**Razonamiento**:
- **Normalización**: Evita duplicación de datos
- **Flexibilidad**: Fácil agregar nuevas taxonomías
- **Búsqueda**: Fácil buscar por taxonomía
- **Consistencia**: Mismos términos para todos los vehículos

**Estructura**:
- `taxonomy_terms`: Términos únicos (marca "Toyota", modelo "Corolla")
- `vehicle_taxonomies`: Relación vehículo-término

**Alternativas consideradas**:
- Campos directos en `vehicles` (más simple, pero menos flexible)
- JSON en `vehicles` (más flexible, pero menos eficiente para búsquedas)

**Impacto**: Mayor flexibilidad y mejor normalización.

### 10. Logging con Winston

**Decisión**: Usar Winston para logging estructurado.

**Razonamiento**:
- **Estructura**: Logs en formato JSON, fácil de parsear
- **Niveles**: Diferentes niveles (info, warn, error)
- **Archivos**: Logs separados por nivel
- **Producción**: Fácil integrar con sistemas de logging

**Configuración**:
- `logs/sync.log`: Todos los logs
- `logs/error.log`: Solo errores
- Consola en desarrollo

**Alternativas consideradas**:
- `console.log` (más simple, pero menos estructurado)
- Otros sistemas de logging (más complejo, no necesario)

**Impacto**: Mejor debugging y monitoreo.

## 📊 Comparación con API Anterior

### Mejoras Implementadas

1. **Filtros obligatorios**: Ahora se aplican correctamente
2. **Estructura clara**: Código más organizado y mantenible
3. **Documentación**: Documentación completa y clara
4. **Cron job**: Sincronización automática cada hora
5. **Detección de cambios**: Solo actualiza vehículos que cambiaron

### Mantenido de API Anterior

1. **Conexión con ASOFIX**: Misma lógica, mejor organizada
2. **Base de datos**: Misma estructura de BD
3. **Descarga de imágenes**: Misma lógica, mejor integrada
4. **Compatibilidad**: Endpoints compatibles con frontend existente

## 🔮 Consideraciones Futuras

### Escalabilidad

- **Caching**: Agregar Redis para cachear respuestas frecuentes
- **CDN**: Mover imágenes a CDN cuando el tráfico crezca
- **Load Balancing**: Múltiples instancias del servidor si es necesario

### Mantenibilidad

- **Tests**: Agregar tests unitarios e integración
- **TypeScript estricto**: Mejorar tipos para mayor seguridad
- **Validación**: Agregar validación de entrada más robusta

### Funcionalidades

- **Webhooks**: Notificar cambios importantes
- **Analytics**: Métricas y estadísticas más detalladas
- **Búsqueda avanzada**: Búsqueda más potente

## ✅ Conclusión

Las decisiones técnicas tomadas priorizan:
1. **Claridad**: Código fácil de entender
2. **Mantenibilidad**: Fácil de modificar y extender
3. **Seguridad**: Filtros aplicados correctamente
4. **Performance**: Sincronización eficiente
5. **Escalabilidad**: Preparado para crecer

Estas decisiones forman una base sólida para el futuro desarrollo de la API.

