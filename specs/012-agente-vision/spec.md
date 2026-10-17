# Spec 012 — El agente ve imágenes

Estado: Implementada, verificada con mocks (falta prueba con modelo real) · Versión objetivo 3.8.0 · Rama `feature-vision`

## Problema

Probado en producción el 2026-10-17: el cliente manda una foto y el agente
contesta como si no hubiera llegado nada. El pipeline arma el historial solo
con los mensajes que traen texto (`.filter((m) => m.text)`), así que una foto
sin pie no llega al modelo, y el adaptador LLM no admite contenido multimodal.

## Decisiones del dueño (2026-10-17, "según tu sugerencia")

1. **Solo imágenes.** Audios (transcripción) → futura 012b. PDFs/documentos
   fuera de alcance.
2. **Interruptor por organización** «El agente puede ver imágenes»,
   **encendido por defecto**: cada imagen encarece el turno y viaja al
   proveedor de IA.
3. Sin dependencias nuevas: OpenRouter ya está en la lista cerrada de la
   constitución (II). Sin enmienda.

## Historias

### US1 — El agente entiende una foto (P1)

El cliente manda una foto (con o sin pie). Con el interruptor encendido y un
modelo con visión, el agente la recibe y responde en contexto.

- AC1: la imagen viaja al proveedor como `image_url` con data URL base64
  (jamás una URL pública: los adjuntos son privados por organización).
- AC2: si la foto todavía no se descargó, el turno la descarga antes de llamar
  al modelo (con tiempo máximo); no depende de que alguien abra la bandeja.
- AC3: solo las **2 imágenes más recientes** de la ventana del historial se
  adjuntan; las anteriores van como marcador de texto.
- AC4: el pie de foto, si existe, va junto a la imagen.

### US2 — Degradar sin colgarse (P1)

- AC5: interruptor apagado → la foto llega como marcador de texto
  («[El cliente envió una imagen …]»): el agente sabe que existe y puede pedir
  que la describa. Nunca se envía la imagen.
- AC6: el modelo no acepta imágenes (el proveedor rechaza la llamada) → se
  reintenta UNA vez el mismo turno con marcadores de texto; el cliente recibe
  respuesta igual.
- AC7: descarga fallida, archivo > 5 MB o formato no admitido (solo
  jpeg/png/webp/gif) → marcador «no se pudo ver».
- AC8: otros adjuntos (audio, video, documento, sticker, ubicación, contacto)
  también llegan como marcador en vez de desaparecer; la ubicación incluye
  nombre/dirección si vienen.
- AC9: los errores 4xx no transitorios del proveedor (400/401/403/404/413/422)
  no se reintentan 3 veces.

### US3 — Configurar (P2)

- AC10: Configuración → IA muestra el interruptor y lo guarda.
- AC11: si el modelo elegido figura en el catálogo SIN entrada de imagen, aviso
  «Este modelo no ve imágenes: el agente recibirá solo una nota».

## Fuera de alcance

Audio/transcripción (012b), documentos, imágenes del Laboratorio (sus personas
son de texto), adjuntos salientes del negocio en el historial (se omiten como
hoy), redimensionado de imágenes.

## Constitución

- I: la imagen sale solo hacia el proveedor LLM de la organización, con su
  clave. Nada a logs (no se loguea el base64).
- II: sin dependencias nuevas. Binarios siguen en `MEDIA_DIR`.
- III: el asset se lee por `organizationId` del turno (`ensureAssetAvailable`
  ya filtra por organización).
- IV: migración `ADD COLUMN IF NOT EXISTS`, re-ejecutable.
- Sandbox: el Laboratorio no cambia.
