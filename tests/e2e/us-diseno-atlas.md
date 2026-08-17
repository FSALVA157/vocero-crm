# Guion E2E — 002: Rediseño Atlas + White-label

> Conducido con Playwright (script) contra `pnpm dev` con mocks.

## Regresión funcional sobre el rediseño (ejecutado ✅)

1. Inbound mock → visible en la bandeja SIN recargar (SSE). ✅
2. Abrir conversación → responder desde el composer nuevo (Enter envía). ✅
3. Colapsar el panel de detalles (chevron) → reabrir desde el header del chat;
   preferencia persistida en localStorage. ✅
4. Conversación con ventana cerrada → aviso + selector de plantilla aprobada. ✅
5. Stepper de etapas en el panel → clic en un paso mueve el lead (PATCH 200)
   y el kanban lo refleja. ✅
6. Filtros Todas/No leídas y búsqueda en la lista. ✅ (visual)

## White-label (ejecutado ✅)

7. PUT nombre "El Martillo" + acento Verde apagado →
   ✅ brand de la nav, `<title>` y variable CSS `--accent: #3f6b66` aplicados
   (SSR, `router.refresh()`); el login PÚBLICO muestra la marca; restaurar a
   defaults funciona.
8. Solo el owner puede cambiar la marca (PUT con rol member → 403).
9. Unit tests: presets exactos, derivación de color personalizado con ajuste
   de contraste, normalización (vacío→default, hex inválido→default). ✅

## Icono de la pestaña

Automatizado en `scripts/e2e-favicon.mjs`. Con cinco instancias abiertas en
pestañas, el icono genérico del navegador las vuelve indistinguibles.

10. **Toda instancia tiene icono sin configurar nada.**
    ✅ `GET /api/branding/favicon` devuelve un SVG con la inicial sobre el
    acento, y responde **sin sesión** — el login también tiene pestaña.
    ✅ Si el archivo subido se perdiera (volumen sin montar), cae al generado
    en vez de dejar la pestaña vacía: un 404 ahí se ve como instancia rota.
11. **El dueño sube su logo** en Ajustes → Marca (PNG, SVG, ICO, JPEG, WebP).
    ✅ Se sirve byte por byte con su tipo real.
    ✅ Se puede **quitar** y volver al generado.
    ✅ Guardar nombre o color **no** borra el logo: son formularios distintos.
12. **No se cuela un documento disfrazado de imagen.** El tipo sale de los
    BYTES, no del `content-type` que declare el cliente.
    ✅ Declarar `image/png` y mandar HTML → **422**, y el icono bueno intacto.
    ✅ Más de 256 KB → **413**. Cuerpo vacío → **422**.
    ✅ Todo icono se sirve con `Content-Security-Policy: default-src 'none'` y
    `nosniff`: un SVG subido no ejecuta nada si alguien navega a su URL.
13. **El navegador suelta el icono viejo.** La URL lleva `?v=`.
    ✅ Cambia al subir, al quitar y al cambiar nombre o acento.
    ✅ Quitar y volver a subir **no repite** una URL ya cacheada.

## Fidelidad visual (juicio humano pendiente)

Capturas en `docs/screenshots/` comparadas contra el handoff: layout 4
columnas, tokens, burbujas, stepper, chips. Revisión estética final: Kevin.
