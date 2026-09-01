# US — Mejoras a la configuración del bot (spec 009)

Automatizado en `scripts/e2e-selftest.mjs` (sección "us-mejoras-bot"),
`pnpm test:e2e`. Requiere la app viva con mocks (`OPENROUTER_BASE_URL` →
ai-mock).

## Editar la base de conocimiento

1. Crear una P/R ("¿Cuánto cuesta?" / "$800.") → editar la respuesta a
   "$900." con `PATCH /api/kb/:id` → 200 con el texto nuevo.
2. `GET /api/bot/profile` refleja "$900." y ya no "$800." (sin caché).
3. `PATCH` con `content` sobre una P/R → 422; body `{}` → 422; id
   inexistente (o de otra organización) → 404.
4. **Navegador**: en Agente → Knowledge base, el lápiz abre la fila en
   edición con los campos precargados; Guardar persiste y actualiza el
   contador; Cancelar/`Escape` descarta; Eliminar pide confirmación.

## Selector de modelo

5. `GET /api/settings/ai/models` → 200 con el catálogo del mock: sin
   `mock/pintor` (imagen) ni `mock/gratis:free`; sugeridos primero; precio
   en USD por millón y contexto; la clave no aparece en la respuesta.
6. **Navegador**: en Configuración → IA, "Modelo del agente" abre el
   catálogo con grupo "Sugeridos"; escribir filtra; elegir uno rellena el
   campo; un ID inventado muestra el aviso "no aparece en el catálogo" y se
   guarda igual; el juez ofrece "Usar el del agente".
7. **Camino infeliz**: con el proveedor caído (`OPENROUTER_BASE_URL` a un
   puerto cerrado) la pantalla dice "Catálogo no disponible" y los campos
   funcionan como texto libre; Guardar sigue operativo.
