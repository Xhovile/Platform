import {
  isAdminActionType,
  isAdminTargetType,
  type AdminActionType,
  type AdminTargetType,
} from "../../src/modules/admin/shared/adminAuditTypes.js";

export type LogAdminActionArgs = {
  admin_uid?: string | null;
  admin_email?: string | null;
  action_type: AdminActionType;
  target_type: AdminTargetType;
  target_id?: string | null;
  details?: unknown;
};

export function createAdminAuditLogger(db: any) {
  return function logAdminAction({
    admin_uid,
    admin_email,
    action_type,
    target_type,
    target_id,
    details,
  }: LogAdminActionArgs) {
    if (!isAdminActionType(action_type) || !isAdminTargetType(target_type)) {
      console.warn("Skipped invalid admin action log entry", {
        action_type,
        target_type,
      });
      return;
    }

    try {
      db.prepare(`
        INSERT INTO admin_actions (
          admin_uid,
          admin_email,
          action_type,
          target_type,
          target_id,
          details
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        admin_uid ?? null,
        admin_email ?? null,
        action_type,
        target_type,
        target_id ?? null,
        details ? JSON.stringify(details) : null,
      );
    } catch (error) {
      console.warn("Failed to log admin action:", error);
    }
  };
}
