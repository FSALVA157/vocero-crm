import { getDb, getSql } from "@/lib/db";
import { demoRunIds, DEMO_PHONES } from "@/server/seed/demo";

/**
 * 008 — Métricas generales de una organización, agregadas AL LEER.
 *
 * Tres reglas de higiene, aplicadas en CADA query:
 * - `organization_id = <org>` explícito (equivalente de `scoped()` en SQL
 *   crudo, patrón de agent-queue.ts).
 * - Conversaciones `is_test` fuera (sandbox del Laboratorio).
 * - Datos DEMO fuera (decisión del dueño): contactos `DEMO_PHONES` con todo
 *   lo que cuelga, y la corrida demo fuera del score del Laboratorio.
 * Además: eventos `approximate` cuentan en totales pero JAMÁS en promedios ni
 * medianas (regla del esquema).
 *
 * Sin estado persistido: volumen a velocidad humana; se materializa solo si
 * algún día duele (spec 008, fuera de alcance v1).
 */

export const METRIC_RANGES = [7, 30, 90] as const;
export type MetricDays = (typeof METRIC_RANGES)[number];

/** `days` crudo del query string → rango soportado (default 30). */
export function clampDays(raw: unknown): MetricDays {
  const n = Number(raw);
  return (METRIC_RANGES as readonly number[]).includes(n)
    ? (n as MetricDays)
    : 30;
}

/** Variación % contra el período anterior. null = no computable (prev 0). */
export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export type DailyPoint = { date: string; nuevos: number; ganados: number; perdidos: number };

/**
 * Rellena los días sin actividad con ceros (UTC): una serie con huecos hace
 * mentir a la gráfica. La ventana [from, from+days) cruza days+1 fechas de
 * calendario (el primer y el último día son parciales): se emiten days+1
 * puntos para que HOY siempre esté en la gráfica. Puro y testeable sin BD.
 */
export function fillDailySeries(
  fromISO: string,
  days: number,
  rows: { day: string; nuevos: number; ganados: number; perdidos: number }[]
): DailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
  const out: DailyPoint[] = [];
  const start = new Date(fromISO);
  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    out.push({
      date: key,
      nuevos: row?.nuevos ?? 0,
      ganados: row?.ganados ?? 0,
      perdidos: row?.perdidos ?? 0,
    });
  }
  return out;
}

export type MoneyByCurrency = { currency: string; cents: number };

export type MetricsOverview = {
  range: { days: MetricDays; from: string; to: string; prevFrom: string };
  demoExcluded: boolean;
  business: {
    newLeads: { value: number; prev: number; deltaPct: number | null };
    bySource: { source: string; count: number }[];
    won: {
      count: number;
      prev: number;
      deltaPct: number | null;
      amounts: MoneyByCurrency[];
      prevAmounts: MoneyByCurrency[];
      unknownAmountCount: number;
    };
    lost: {
      count: number;
      prev: number;
      deltaPct: number | null;
      byReason: { reason: string; count: number }[];
    };
    /** ganados / (ganados + perdidos) del período. null = nada decidido. */
    winRatePct: number | null;
    avgDaysToClose: number | null;
    pipeline: {
      openLeads: number;
      byStage: { name: string; count: number }[];
      openAmounts: MoneyByCurrency[];
      unknownAmountCount: number;
    };
    series: DailyPoint[];
  };
  bot: {
    messages: { in: number; outAi: number; outHuman: number; outTemplate: number };
    conversations: { total: number; aiOnly: number; aiOnlyPct: number | null };
    firstReply: {
      conversations: number;
      answered: number;
      medianSeconds: number | null;
      aiFirstPct: number | null;
    };
    handoffs: { total: number; byReason: { reason: string; count: number }[] };
    botStageMoves: number;
    lab: { score: number | null; finishedAt: string | null };
  };
  team: {
    handoffReply: {
      handoffs: number;
      answered: number;
      pending: number;
      medianSeconds: number | null;
    };
    leadsAtRisk: { count: number; thresholdDays: number };
    agedUnread: { count: number; thresholdHours: number };
    stageDwell: { stage: string; avgDays: number }[];
  };
};

const AT_RISK_DAYS = 3;
const AGED_UNREAD_HOURS = 24;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function getMetricsOverview(
  organizationId: string,
  days: MetricDays
): Promise<MetricsOverview> {
  const sql = getSql();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const prevFrom = new Date(to.getTime() - 2 * days * 86_400_000);
  // postgres.js no serializa Date cuando la query mezcla fragmentos (unsafe):
  // los límites viajan como ISO y Postgres los castea a timestamp.
  const toP = to.toISOString();
  const fromP = from.toISOString();
  const prevP = prevFrom.toISOString();
  const atRiskP = new Date(to.getTime() - AT_RISK_DAYS * 86_400_000).toISOString();
  const agedP = new Date(to.getTime() - AGED_UNREAD_HOURS * 3_600_000).toISOString();

  // Contactos demo de ESTA organización: todo lo que cuelga de ellos se excluye.
  const demoRows = await sql<{ id: string }[]>`
    select id from contact
    where organization_id = ${organizationId}
      and (wa_identity = any(${[...DEMO_PHONES]}) or phone = any(${[...DEMO_PHONES]}))`;
  const demoIds = demoRows.map((r) => r.id);
  const demoExcluded = demoIds.length > 0;
  // `<> all('{}')` es verdadero siempre: con lista vacía el filtro no estorba.
  const noDemo = (col: string) =>
    sql`and ${sql.unsafe(col)} <> all(${demoIds.length ? demoIds : ["-"]})`;

  // --- Embudo: nuevos / ganados / perdidos, período actual y anterior -------
  const funnel = await sql<
    { bucket: string; nuevos: string; ganados: string; perdidos: string }[]
  >`
    select case when e.occurred_at >= ${fromP} then 'cur' else 'prev' end bucket,
      count(*) filter (where e.from_stage_id is null and e.from_stage_name is null) nuevos,
      count(*) filter (where e.to_stage_kind = 'won') ganados,
      count(*) filter (where e.to_stage_kind = 'lost') perdidos
    from lead_stage_event e
    where e.organization_id = ${organizationId}
      and e.occurred_at >= ${prevP} and e.occurred_at < ${toP}
      ${noDemo("e.contact_id")}
    group by 1`;
  const cur = funnel.find((r) => r.bucket === "cur");
  const prev = funnel.find((r) => r.bucket === "prev");

  // --- Monto ganado por moneda (snapshot 008; legado cae al monto actual) ---
  const wonAmounts = await sql<
    { bucket: string; currency: string | null; cents: string | null; sin_monto: string }[]
  >`
    select case when e.occurred_at >= ${fromP} then 'cur' else 'prev' end bucket,
      coalesce(e.currency, l.currency) currency,
      sum(coalesce(e.amount_cents, l.amount_cents)) cents,
      count(*) filter (where coalesce(e.amount_cents, l.amount_cents) is null) sin_monto
    from lead_stage_event e join lead l on l.id = e.lead_id
    where e.organization_id = ${organizationId} and e.to_stage_kind = 'won'
      and e.occurred_at >= ${prevP} and e.occurred_at < ${toP}
      ${noDemo("e.contact_id")}
    group by 1, 2`;
  const money = (bucket: string): MoneyByCurrency[] =>
    wonAmounts
      .filter((r) => r.bucket === bucket && r.cents !== null)
      .map((r) => ({ currency: r.currency ?? "?", cents: num(r.cents) }))
      .sort((a, b) => b.cents - a.cents);
  const unknownAmountCount = wonAmounts
    .filter((r) => r.bucket === "cur")
    .reduce((a, r) => a + num(r.sin_monto), 0);

  // --- Fuentes de los leads nuevos del período ------------------------------
  const bySource = await sql<{ source: string; count: string }[]>`
    select coalesce(c.source, 'sin_capturar') source, count(*) count
    from lead_stage_event e join contact c on c.id = e.contact_id
    where e.organization_id = ${organizationId}
      and e.from_stage_id is null and e.from_stage_name is null
      and e.occurred_at >= ${fromP} and e.occurred_at < ${toP}
      ${noDemo("e.contact_id")}
    group by 1 order by 2 desc`;

  // --- Motivos de pérdida ---------------------------------------------------
  const byReason = await sql<{ reason: string; count: string }[]>`
    select coalesce(e.loss_reason, 'otro') reason, count(*) count
    from lead_stage_event e
    where e.organization_id = ${organizationId} and e.to_stage_kind = 'lost'
      and e.occurred_at >= ${fromP} and e.occurred_at < ${toP}
      ${noDemo("e.contact_id")}
    group by 1 order by 2 desc`;

  // --- Tiempo a cierre (solo fechas observadas, jamás approximate) ----------
  const closeTime = await sql<{ avg_days: string | null }[]>`
    select avg(extract(epoch from e.occurred_at - l.created_at)) / 86400 avg_days
    from lead_stage_event e join lead l on l.id = e.lead_id
    where e.organization_id = ${organizationId} and e.to_stage_kind = 'won'
      and e.approximate = false
      and e.occurred_at >= ${fromP} and e.occurred_at < ${toP}
      ${noDemo("e.contact_id")}`;

  // --- Serie diaria ---------------------------------------------------------
  const seriesRows = await sql<
    { day: string; nuevos: string; ganados: string; perdidos: string }[]
  >`
    select to_char(date_trunc('day', e.occurred_at at time zone 'utc'), 'YYYY-MM-DD') as day,
      count(*) filter (where e.from_stage_id is null and e.from_stage_name is null) nuevos,
      count(*) filter (where e.to_stage_kind = 'won') ganados,
      count(*) filter (where e.to_stage_kind = 'lost') perdidos
    from lead_stage_event e
    where e.organization_id = ${organizationId}
      and e.occurred_at >= ${fromP} and e.occurred_at < ${toP}
      ${noDemo("e.contact_id")}
    group by 1`;

  // --- Pipeline abierto HOY -------------------------------------------------
  const pipelineRows = await sql<
    { name: string; position: number; count: string }[]
  >`
    select s.name, s.position, count(l.id) count
    from pipeline_stage s
    left join lead l on l.stage_id = s.id and l.organization_id = ${organizationId}
      ${noDemo("l.contact_id")}
    where s.organization_id = ${organizationId} and s.kind = 'open'
    group by s.id, s.name, s.position
    order by s.position`;
  const openAmounts = await sql<
    { currency: string | null; cents: string | null; sin_monto: string }[]
  >`
    select l.currency, sum(l.amount_cents) cents,
      count(*) filter (where l.amount_cents is null) sin_monto
    from lead l join pipeline_stage s on s.id = l.stage_id
    where l.organization_id = ${organizationId} and s.kind = 'open'
      ${noDemo("l.contact_id")}
    group by 1`;

  // --- Bot: mensajes por autoría -------------------------------------------
  const msgRows = await sql<
    { direction: string; origin: string; count: string }[]
  >`
    select m.direction, m.origin, count(*) count
    from message m join conversation c on c.id = m.conversation_id
    where m.organization_id = ${organizationId} and c.is_test = false
      and m.created_at >= ${fromP} and m.created_at < ${toP}
      ${noDemo("c.contact_id")}
    group by 1, 2`;
  const msgCount = (dir: string, origins?: string[]) =>
    msgRows
      .filter(
        (r) => r.direction === dir && (!origins || origins.includes(r.origin))
      )
      .reduce((a, r) => a + num(r.count), 0);

  // --- Bot: primera respuesta (conversaciones nacidas en el período) -------
  const firstReply = await sql<
    {
      total: string;
      answered: string;
      median_s: string | null;
      ai_first: string;
    }[]
  >`
    with primera as (
      select m.conversation_id, min(m.created_at) fi
      from message m join conversation c on c.id = m.conversation_id
      where m.organization_id = ${organizationId} and m.direction = 'in'
        and c.is_test = false ${noDemo("c.contact_id")}
      group by 1
    ), con_resp as (
      select p.fi,
        (select min(m2.created_at) from message m2
          where m2.conversation_id = p.conversation_id
            and m2.direction = 'out' and m2.created_at > p.fi) fo,
        (select m3.origin from message m3
          where m3.conversation_id = p.conversation_id
            and m3.direction = 'out' and m3.created_at > p.fi
          order by m3.created_at limit 1) primer_origen
      from primera p
      where p.fi >= ${fromP} and p.fi < ${toP}
    )
    select count(*) total, count(fo) answered,
      percentile_cont(0.5) within group (order by extract(epoch from fo - fi)) median_s,
      count(*) filter (where primer_origen = 'ai') ai_first
    from con_resp`;
  const fr = firstReply[0];

  // --- Bot: conversaciones atendidas solo por IA ---------------------------
  const convRows = await sql<{ total: string; ai_only: string }[]>`
    select count(*) total,
      count(*) filter (
        where c.handoff_at is null and not exists (
          select 1 from message mo
          where mo.conversation_id = c.id and mo.direction = 'out'
            and mo.origin in ('operator', 'manual')
        )
      ) ai_only
    from conversation c
    where c.organization_id = ${organizationId} and c.is_test = false
      and c.last_inbound_at >= ${fromP} and c.last_inbound_at < ${toP}
      ${noDemo("c.contact_id")}`;
  const conv = convRows[0];

  // --- Bot: handoffs por motivo --------------------------------------------
  const handoffRows = await sql<{ reason: string; count: string }[]>`
    select coalesce(c.handoff_reason, 'otro') reason, count(*) count
    from conversation c
    where c.organization_id = ${organizationId} and c.is_test = false
      and c.handoff_at >= ${fromP} and c.handoff_at < ${toP}
      ${noDemo("c.contact_id")}
    group by 1 order by 2 desc`;
  const handoffTotal = handoffRows.reduce((a, r) => a + num(r.count), 0);

  // --- Bot: leads movidos por el bot ---------------------------------------
  const botMoves = await sql<{ count: string }[]>`
    select count(*) count from lead_stage_event e
    where e.organization_id = ${organizationId} and e.source = 'bot'
      and e.occurred_at >= ${fromP} and e.occurred_at < ${toP}
      ${noDemo("e.contact_id")}`;

  // --- Bot: score del Laboratorio (la corrida demo no cuenta) --------------
  const demoRuns = await demoRunIds(getDb(), organizationId);
  const labRows = await sql<{ score: number | null; finished_at: string | null }[]>`
    select score, finished_at from agent_test_run
    where organization_id = ${organizationId} and status = 'done'
      and id <> all(${demoRuns.length ? demoRuns : ["-"]})
    order by finished_at desc nulls last limit 1`;

  // --- Equipo: respuesta humana tras handoff -------------------------------
  // `manual_reply` queda fuera: ahí el humano YA respondió (fue la causa).
  const teamReply = await sql<
    { handoffs: string; answered: string; median_s: string | null }[]
  >`
    with h as (
      select c.id, c.handoff_at from conversation c
      where c.organization_id = ${organizationId} and c.is_test = false
        and c.handoff_at >= ${fromP} and c.handoff_at < ${toP}
        and c.handoff_reason is distinct from 'manual_reply'
        ${noDemo("c.contact_id")}
    ), r as (
      select h.handoff_at,
        (select min(m.created_at) from message m
          where m.conversation_id = h.id and m.direction = 'out'
            and m.origin in ('operator', 'manual')
            and m.created_at >= h.handoff_at) fo
      from h
    )
    select count(*) handoffs, count(fo) answered,
      percentile_cont(0.5) within group (order by extract(epoch from fo - handoff_at)) median_s
    from r`;
  const tr = teamReply[0];

  // --- Equipo: leads en riesgo (abiertos, sin actividad reciente) ----------
  const atRisk = await sql<{ count: string }[]>`
    select count(*) count
    from lead l join pipeline_stage s on s.id = l.stage_id
    where l.organization_id = ${organizationId} and s.kind = 'open'
      and coalesce(l.last_activity_at, l.created_at) < ${atRiskP}
      ${noDemo("l.contact_id")}`;

  // --- Equipo: no leídos envejecidos ---------------------------------------
  const agedUnread = await sql<{ count: string }[]>`
    select count(*) count from conversation c
    where c.organization_id = ${organizationId} and c.is_test = false
      and c.unread_count > 0
      and c.last_inbound_at < ${agedP}
      ${noDemo("c.contact_id")}`;

  // --- Equipo: permanencia media por etapa (estancias TERMINADAS en período)
  const dwell = await sql<{ stage: string; avg_days: string }[]>`
    with x as (
      select e.to_stage_name stage, e.occurred_at, e.approximate,
        lead(e.occurred_at) over (partition by e.lead_id order by e.occurred_at) nxt,
        lead(e.approximate) over (partition by e.lead_id order by e.occurred_at) nxt_approx
      from lead_stage_event e
      where e.organization_id = ${organizationId}
        ${noDemo("e.contact_id")}
    )
    select stage, avg(extract(epoch from nxt - occurred_at)) / 86400 avg_days
    from x
    where nxt is not null and nxt >= ${fromP} and nxt < ${toP}
      and approximate = false and nxt_approx = false
    group by stage order by 2 desc limit 8`;

  const wonCur = num(cur?.ganados);
  const lostCur = num(cur?.perdidos);
  const decided = wonCur + lostCur;
  const frTotal = num(fr?.total);
  const frAnswered = num(fr?.answered);
  const convTotal = num(conv?.total);

  return {
    range: {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
      prevFrom: prevFrom.toISOString(),
    },
    demoExcluded,
    business: {
      newLeads: {
        value: num(cur?.nuevos),
        prev: num(prev?.nuevos),
        deltaPct: pctDelta(num(cur?.nuevos), num(prev?.nuevos)),
      },
      bySource: bySource.map((r) => ({ source: r.source, count: num(r.count) })),
      won: {
        count: wonCur,
        prev: num(prev?.ganados),
        deltaPct: pctDelta(wonCur, num(prev?.ganados)),
        amounts: money("cur"),
        prevAmounts: money("prev"),
        unknownAmountCount,
      },
      lost: {
        count: lostCur,
        prev: num(prev?.perdidos),
        deltaPct: pctDelta(lostCur, num(prev?.perdidos)),
        byReason: byReason.map((r) => ({ reason: r.reason, count: num(r.count) })),
      },
      winRatePct: decided > 0 ? Math.round((wonCur / decided) * 1000) / 10 : null,
      avgDaysToClose:
        closeTime[0]?.avg_days === null || closeTime[0] === undefined
          ? null
          : Math.round(Number(closeTime[0].avg_days) * 10) / 10,
      pipeline: {
        openLeads: pipelineRows.reduce((a, r) => a + num(r.count), 0),
        byStage: pipelineRows.map((r) => ({ name: r.name, count: num(r.count) })),
        openAmounts: openAmounts
          .filter((r) => r.cents !== null)
          .map((r) => ({ currency: r.currency ?? "?", cents: num(r.cents) }))
          .sort((a, b) => b.cents - a.cents),
        unknownAmountCount: openAmounts.reduce((a, r) => a + num(r.sin_monto), 0),
      },
      series: fillDailySeries(
        from.toISOString(),
        days,
        seriesRows.map((r) => ({
          day: r.day,
          nuevos: num(r.nuevos),
          ganados: num(r.ganados),
          perdidos: num(r.perdidos),
        }))
      ),
    },
    bot: {
      messages: {
        in: msgCount("in"),
        outAi: msgCount("out", ["ai"]),
        outHuman: msgCount("out", ["operator", "manual"]),
        outTemplate: msgCount("out", ["template"]),
      },
      conversations: {
        total: convTotal,
        aiOnly: num(conv?.ai_only),
        aiOnlyPct:
          convTotal > 0
            ? Math.round((num(conv?.ai_only) / convTotal) * 1000) / 10
            : null,
      },
      firstReply: {
        conversations: frTotal,
        answered: frAnswered,
        medianSeconds:
          numOrNull(fr?.median_s) === null
            ? null
            : Math.round(Number(fr?.median_s)),
        aiFirstPct:
          frAnswered > 0
            ? Math.round((num(fr?.ai_first) / frAnswered) * 1000) / 10
            : null,
      },
      handoffs: {
        total: handoffTotal,
        byReason: handoffRows.map((r) => ({ reason: r.reason, count: num(r.count) })),
      },
      botStageMoves: num(botMoves[0]?.count),
      lab: {
        score: labRows[0]?.score ?? null,
        finishedAt: labRows[0]?.finished_at
          ? new Date(labRows[0].finished_at).toISOString()
          : null,
      },
    },
    team: {
      handoffReply: {
        handoffs: num(tr?.handoffs),
        answered: num(tr?.answered),
        pending: num(tr?.handoffs) - num(tr?.answered),
        medianSeconds:
          numOrNull(tr?.median_s) === null
            ? null
            : Math.round(Number(tr?.median_s)),
      },
      leadsAtRisk: { count: num(atRisk[0]?.count), thresholdDays: AT_RISK_DAYS },
      agedUnread: { count: num(agedUnread[0]?.count), thresholdHours: AGED_UNREAD_HOURS },
      stageDwell: dwell.map((r) => ({
        stage: r.stage,
        avgDays: Math.round(Number(r.avg_days) * 10) / 10,
      })),
    },
  };
}
