# Feature Specification: Mejoras a la configuración del bot (009-mejoras-bot)

**Feature Branch**: `feature-mejoras-bot`

**Created**: 2026-09-01

**Status**: Implementada el 2026-09-01 (3.5.0) — carril **liviano** (sin cambios de esquema; un
endpoint nuevo de solo lectura; UI). No toca la Constitución: OpenRouter ya es
dependencia permitida (II) y la clave sigue sin salir del servidor (I).

**Input**: "Mejorar la experiencia del usuario al configurar el bot: (1) cambiar
el campo donde se informa el modelo elegido por un selector para que la persona
pueda elegir el modelo que desee (OpenRouter, vía API key); (2) permitir la
edición de los documentos de texto que conforman las preguntas frecuentes y la
base de conocimiento — hoy la única manera de modificar es eliminar y volver a
crear."

## Decisiones del dueño (2026-09-01)

1. El catálogo se **filtra**: solo modelos que producen texto; fuera imagen,
   embeddings, audio y los `:free` (con límite de tasa, no aptos para un bot
   de negocio). Los sugeridos van arriba.
2. **Se muestran precios** (USD por millón de tokens, entrada/salida) y el
   tamaño de contexto junto a cada modelo.
3. **Sin reordenar** entradas de la base de conocimiento (fuera de alcance).

## Hallazgos del análisis

- El modelo hoy es un `<Input>` de texto libre: hay que saber el ID exacto
  `proveedor/modelo` de OpenRouter. El backend (`PUT /api/settings/ai`,
  `org_ai_config.model`) acepta cualquier string ≤120 y NO cambia.
- `PATCH /api/kb/[id]` **ya existe** (scoped + `agent.write`); falta solo la
  UI. El PATCH acepta campos que no corresponden al `kind` de la fila y un
  body vacío: se endurece sin cambiar el contrato para quien lo usa bien.
- La lista de KB borra al primer click, sin confirmación.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Elegir el modelo desde un catálogo (P1)

En Configuración → IA, el propietario abre el campo "Modelo del agente" y ve
la lista de modelos que ofrece el proveedor, con precio y contexto; escribe
para filtrar, elige uno y guarda. Lo mismo para el juez del Laboratorio.

**Acceptance Scenarios**:

1. **Given** una organización con clave guardada, **When** abre la pantalla,
   **Then** el campo de modelo ofrece el catálogo del proveedor con los
   sugeridos primero; cada opción muestra ID, nombre, contexto y precio.
2. **Given** el catálogo cargado, **When** escribe "haiku", **Then** la lista
   se reduce a los modelos cuyo ID o nombre lo contiene.
3. **Given** un ID que NO está en el catálogo (proveedor compatible distinto,
   modelo recién publicado), **When** lo escribe y guarda, **Then** se guarda
   igual — el selector nunca bloquea el texto libre.
4. **Given** un modelo guardado que ya no figura en el catálogo, **Then** la
   pantalla lo avisa ("no aparece en el catálogo del proveedor") sin
   borrarlo ni impedir guardar.
5. **Given** el proveedor caído o sin clave, **When** abre la pantalla,
   **Then** el campo funciona como texto libre con un aviso; nada se cuelga.
6. **Given** el catálogo del proveedor incluye modelos de imagen/embeddings/
   `:free`, **Then** NO aparecen en la lista.
7. El juez ofrece además la opción vacía "usar el del agente".

### User Story 2 — Editar una entrada de la base de conocimiento (P1)

En Agente → Knowledge base, cada entrada tiene "Editar": la fila pasa a modo
edición con los mismos campos que el alta; Guardar persiste, Cancelar (o
`Escape`) descarta.

**Acceptance Scenarios**:

1. **Given** una P/R existente, **When** edita la respuesta y guarda, **Then**
   la lista muestra el texto nuevo y `GET /api/bot/profile` lo refleja al
   instante en `kb`.
2. **Given** un bloque de texto libre, **When** lo edita y guarda, **Then**
   idem; el contador de caracteres se actualiza.
3. **Given** una fila en edición, **When** pulsa Cancelar o `Escape`, **Then**
   vuelve a la vista sin cambios.
4. **Given** intenta guardar un campo vacío, **Then** el botón Guardar está
   deshabilitado; la API devuelve 422 si se la llama directo.
5. **Given** pulsa Eliminar, **Then** se pide confirmación antes de borrar.
6. **Given** `PATCH` con `content` sobre una entrada `qa` (o `question` sobre
   un `block`) o con body vacío, **Then** 422 con mensaje claro.

## Requirements

- **FR-001**: `GET /api/settings/ai/models` (permiso `settings.ai.write`)
  devuelve `{ models: [{ id, name, contextLength, promptPerM, completionPerM }],
  suggested: string[], error?: string }`. Consulta `${OPENROUTER_BASE_URL}/v1/models`
  con la clave guardada si existe (sin ella, sin auth: el catálogo es público),
  timeout 10 s, cache en memoria 10 min por base URL. Ante fallo responde 200
  con `models: []` y `error` — jamás 5xx por un hipo del proveedor.
- **FR-002**: Filtro de catálogo: salida de texto, sin `:free`; orden
  alfabético por ID; los sugeridos presentes en el catálogo van primero.
- **FR-003**: El selector es un combobox con filtro y texto libre; la
  validación de `PUT /api/settings/ai` no cambia.
- **FR-004**: El ai-mock expone `GET /v1/models` con un catálogo fijo que
  incluye un modelo de imagen y uno `:free` para probar el filtro.
- **FR-005**: `PATCH /api/kb/[id]` valida contra el `kind` de la fila y exige
  al menos un campo.
- **FR-006**: UI de edición inline en la KB + confirmación al eliminar.
- **FR-007**: La clave del proveedor jamás viaja al cliente ni a logs
  (sin cambio: la ruta la usa en servidor).

## Fuera de alcance

Reordenar/agrupar entradas de la KB; importar documentos; cambiar el
proveedor; guardar preferencias de precio.
