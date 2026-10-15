import db, { requireCompanyTransaction } from './connection';
import type { CompanyUser } from '../services/companyAuth';
import { requireCompanyActor } from '../services/companyAuthorization';

/** All references and the actor must belong to the transaction's company. */
export async function companyAudit(user: CompanyUser, event: {
  action: string; entity: string; entityId?: number; departmentId?: number;
  employeeId?: number; oldValue?: string; newValue?: string; details?: string;
}) {
  const companyId = requireCompanyActor(user);
  requireCompanyTransaction();
  await db.prepare(`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,entity_id,department_id,employee_id,old_value,new_value,details)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(companyId,user.id,user.name,event.action,event.entity,event.entityId ?? null,event.departmentId ?? null,event.employeeId ?? null,event.oldValue ?? null,event.newValue ?? null,event.details ?? null);
}
