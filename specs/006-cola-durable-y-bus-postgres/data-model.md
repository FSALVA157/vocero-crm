# Data model — 006

## agent_job (nueva)

| columna | tipo | notas |
|---|---|---|
| id | text PK | prefijo `job_` |
| organization_id | text NOT NULL FK organization (cascade) | Constitución III |
| conversation_id | text NOT NULL FK conversation (cascade) | |
| status | text NOT NULL | `pending` · `running` · `done` · `failed` |
| run_after | timestamp NOT NULL | debounce: `now() + AGENT_COALESCE_MS` |
| requeue | boolean NOT NULL default false | llegó un mensaje durante `running` |
| attempts | integer NOT NULL default 0 | |
| max_attempts | integer NOT NULL default 3 | |
| locked_at | timestamp | heartbeat del consumidor mientras `running` |
| locked_by | text | id efímero del proceso |
| last_error | text | |
| created_at / updated_at / finished_at | timestamp | |

Índices:

- `agent_job_conv_active_uq` UNIQUE (`conversation_id`) WHERE status IN
  ('pending','running') — coalescing y `ON CONFLICT`.
- `agent_job_claim_idx` (`status`, `run_after`) — la consulta de reclamo.
- `agent_job_org_idx` (`organization_id`, `created_at`).

Transiciones (todas por UPDATE condicional, idempotentes):

```
ingest  : INSERT pending(run_after=now+d)
          ON CONFLICT (conv activa) DO UPDATE
            run_after = CASE status='pending' THEN now+d ELSE run_after,
            requeue   = CASE status='running' THEN true  ELSE requeue
claim   : pending & run_after<=now  →  running (locked_at=now, attempts+1)   [SKIP LOCKED]
finish  : running →  requeue ? pending(run_after=now+d, requeue=false) : done
fail    : running →  attempts<max ? pending(run_after=now+backoff) : failed
sweep   : running & locked_at < now-TTL →  igual que fail (error="lock vencido")
```

## agent_test_run (+1 columna)

| columna | tipo | notas |
|---|---|---|
| heartbeat_at | timestamp | refrescada cada 15 s por el runner; NULL en filas viejas |

Barrido: `status='running' AND coalesce(heartbeat_at, started_at) < now() - 90s`.
