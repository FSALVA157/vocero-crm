# Roadmap PMV — guía de objetivos (GRIFTIA)

Fuente: "GRIFTIA — Plan de Trabajo PMV" (PM: Oscar, ago 2026 v2), **reconciliado
el 2026-08-31 con el estado real del repositorio**. Esta es la guía de
objetivos del desarrollo; las specs (`specs/NNN-*`) son el detalle por feature.

## Objetivo del PMV

Convertir el producto en un **SaaS self-service multi-tenant vendible**: una
PyME se registra, crea su agente, conecta WhatsApp (e Instagram), elige plan,
paga (Stripe/MercadoPago) y opera sola. Criterios de éxito del PM:

- **Alta sola**: registro → agente activo en < 30 min sin intervención.
- **Cobra solo**: plan + pago + consumo medido por conversación + excedentes.
- **4 módulos multi-tenant**: Agente, CRM, Dashboard, Laboratorio.
- **2–3 pilotos reales**: agente de Grefting, estudio de abogados, AGN Innova.

## Estado real por épica (lo que el plan del PM no refleja)

| Épica | Plan del PM | Estado REAL en el repo | Falta de verdad |
|---|---|---|---|
| E1 Multi-tenant & Auth | "a desarrollar, 1 sem" | **HECHO** (004+005+006, en producción 28-08, verificado con arnés: `scoped()`, invitación, roles, secretos por org, cola durable) | Caso 009 (org activa entre logins) — pulido, ver memoria `vocero-org-activa-caso-gustavo` |
| E2 Onboarding self-service | 2 días | Parcial: registro con código, wizard WhatsApp, demo con confirmación (007) | Wizard guiado end-to-end, plantillas por rubro, invitación→autoservicio |
| E3 Agente IA | hecho | HECHO (clave por org, prompts, acciones, handoff) | — |
| E4 CRM | hecho | HECHO | — |
| E5 WhatsApp oficial | "hecho · revisar plantillas (2d)" | Conexión, plantillas multivariable, ventana 24h, suscripción por pasos (007) HECHOS. **Embedded Signup NO existe** (el plan lo da por hecho) | **Embedded Signup + App Review de Meta** — sostiene "alta sola <30 min"; el review es calendario externo: arrancarlo en Sprint 0 |
| E6 Instagram | 2 días | No existe. Misma Graph API de Meta; el ingest ya es por identidad (`wa_identity`/BSUID), ayuda | Conexión IG + DM→agente; enmienda constitucional. Candidata a post-GA si aprieta |
| E7 Billing & metering | 1 sem | No existe. La materia prima del metering ya se registra (`conversation`, `message`, ventana 24h) | Medición por conversación, cupos/excedente, Stripe + MercadoPago, add-on Meta. **Camino crítico** |
| E8 Dashboard | "~1 sem" | **~70% HECHO** (008/3.4.0: leads, fuentes, embudo, eficacia bot/equipo, deltas) | Vista de consumo y facturación (depende de E7) — ~2 días |
| E9 Laboratorio | hecho | HECHO (+ juez, sandbox) | — |
| E10 Infra/DevOps & QA | transversal, 1 sem | CI (typecheck/lint/test/build), arneses E2E por historia, deploy Coolify+webhook, backups diarios | Staging separado, monitoreo, **límites/alertas de costo LLM por tenant**, P0 adjuntos sin volumen (memoria `vocero-adjuntos-sin-volumen`) |

**Esfuerzo restante recalculado: ~17–19 días-persona** (el plan estimaba 26;
E1 ya está y E8 casi). El camino crítico pasa de "E1→E7" a
**E7 (billing/metering) + App Review de Meta (calendario externo)**.

## Precondición: enmienda de la constitución (Sprint 0)

La constitución vigente (Soberanía II) **prohíbe** Stripe, MercadoPago y
servicios externos, y limita el canal a WhatsApp Cloud API. E6 y E7 la violan.
Decisión del dueño (31-08): se enmienda. Debe quedar escrito ANTES de escribir
código de E7 (Principio VI): qué servicios externos se admiten, con qué
salvaguardas (secretos cifrados por org, degradación sin el servicio, datos de
pago solo en el PSP). Aprovechar el análisis previo en la memoria
`vocero-constitucion-desalineada` (Fase 2 A/B/C pendiente de decisión).

## Plan por sprints (ajustado al estado real)

- **Sprint 0 (1–2 sep)**: enmienda constitucional · **iniciar App Review de
  Meta para Embedded Signup** (skills `whatsapp-meta-app-review` /
  `whatsapp-saas-meta-infra` como guía) · P0 adjuntos (volumen en Coolify) ·
  backlog en GRIFMINE · staging.
- **Semana 1 (3–9 sep)**: E7 billing & metering (diseño metering junto a
  E8-consumo, conciliación medido=cobrado) · E5 revisar plantillas · 009 org
  activa · límites de costo LLM por tenant.
- **Semana 2 (10–16 sep)**: E2 onboarding self-service completo (con Embedded
  Signup si el review llegó; si no, flujo manual guiado como fallback
  documentado) · E8 consumo/facturación · E6 Instagram (o post-GA).
- **Semana 3 (17–23 sep)**: E10 hardening + QA · pilotos (Grefting, estudio
  de abogados, AGN Innova) · GA.

## DoD y métricas (del PM, se adoptan tal cual)

- DoD: PR revisado · probado en staging · manejo de errores y logging · sin
  romper multi-tenant. (Se suma el DoD reforzado local: self-test E2E verde.)
- Métricas: alta < 30 min sola · 0 errores de facturación en pilotos
  (consumo medido = cobrado) · ≥ 2 de 3 pilotos en producción real.

## Riesgos (del PM + los que el repo conoce)

1. **App Review de Meta tarda** (no estaba en el plan): arrancar Sprint 0;
   fallback = alta guiada con token manual (existe hoy, probada en 007).
2. Descuadre medido vs. cobrado: metering y billing se diseñan juntos.
3. Costos LLM sin control: límites por tenant desde Semana 1.
4. Equipo reducido: Instagram post-GA antes que resignar calidad del cobro.
5. Adjuntos sin volumen (P0 vigente): se pierde media en cada deploy — va en
   Sprint 0, es pérdida de datos en curso.
