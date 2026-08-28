# US — Cola durable del agente y rol worker (006)

> Automatizado en `scripts/e2e-cola-durable.mjs` (`pnpm test:e2e:cola`).
> Requiere app viva con mocks y BD migrada; el arnés lanza él mismo un proceso
> `ROLE=worker` contra la misma base.

## Criterios

1. **Job durable**: un mensaje entrante deja una fila `agent_job` `pending`
   antes de que venza el debounce.
2. **Ráfaga**: 3 mensajes en 2 s → un solo job, `run_after` se reinicia, UNA
   respuesta del agente que sale por el canal.
3. **Turno siguiente**: un mensaje tras terminar el turno → job nuevo, segunda
   respuesta.
4. **Proceso muerto**: un job `running` con `locked_at` vencido vuelve a
   `pending` por el barrido, se ejecuta, `last_error` registra "lock vencido",
   `locked_by` es un proceso vivo y el cliente recibe UNA respuesta.
5. **Intentos agotados**: con `attempts = max_attempts` el barrido lo deja
   `failed`, sin respuesta; un mensaje nuevo sí crea un job nuevo.
6. **Worker**: `ROLE=worker` arranca con la misma imagen y responde
   `/api/health` en su puerto.
7. **Puente de eventos**: con el consumidor de la web pausado, el worker
   ejecuta el turno y la sesión SSE de la web recibe `message.new` con la
   respuesta (`LISTEN/NOTIFY`).
8. **Sin duplicados**: web + worker consumiendo a la vez, N conversaciones →
   N jobs `done` con 1 intento, N respuestas, N llamadas al proveedor.
9. **Camino infeliz**: muere el worker → la web sigue respondiendo sola.
