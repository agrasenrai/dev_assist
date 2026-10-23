import { db } from "../db/connection.js";
import { randomUUID } from "crypto";
import { sourceRealm } from './source-context.js';

export interface AuditEntry {
  actorType: 'NURSE' | 'AGENT' | 'MCP_SERVER' | 'SYSTEM';
  actorId: string;
  action: string;
  targetResource: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'RECOVERED';
  details?: Record<string, unknown> | string | null;
  latencyMs?: number;
}

export class AuditService {
  static log(entry: AuditEntry): string {
    const id = `aud_${randomUUID().slice(0, 8)}`;
    const details = sourceRealm()==='legacy' ? entry.details : { ...(entry.details && typeof entry.details==='object' ? entry.details : {message:entry.details}), _sourceRealm:sourceRealm() };
    const detailsStr = typeof details === "object" ? JSON.stringify(details) : details || null;

    db.prepare(`
      INSERT INTO audit_log (id, actor_type, actor_id, action, target_resource, outcome, details, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.targetResource,
      entry.outcome,
      detailsStr,
      entry.latencyMs || 0
    );

    return id;
  }

  static getRecentLogs(limit = 50): Array<{
    id: string;
    actor_type: string;
    actor_id: string;
    action: string;
    target_resource: string;
    outcome: string;
    details: string | null;
    latency_ms: number;
    timestamp: string;
  }> {
    return db.prepare(`
      SELECT id, actor_type, actor_id, action, target_resource, outcome, details, latency_ms, timestamp
      FROM audit_log
      WHERE (?='legacy' OR CASE WHEN json_valid(details) THEN json_extract(details,'$._sourceRealm') END=?)
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(sourceRealm(),sourceRealm(),limit) as Array<{
      id: string;
      actor_type: string;
      actor_id: string;
      action: string;
      target_resource: string;
      outcome: string;
      details: string | null;
      latency_ms: number;
      timestamp: string;
    }>;
  }
}
