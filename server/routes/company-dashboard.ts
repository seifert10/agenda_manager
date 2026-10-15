import { Router } from 'express';
import { companyEndpoint } from '../middlewares/company-endpoint';
import { companyEntityId } from '../services/companyAdministration';
import { companyDashboard } from '../services/companyDashboard';
import { companyNotificationsFor,readCompanyNotification,readAllCompanyNotifications } from '../services/companyNotifications';

export function companyDashboardRouter() {
  const router=Router();
  router.get('/dashboard',companyEndpoint(async(req,user)=>({body:await companyDashboard(user,req.query.date)})));
  router.get('/notifications',companyEndpoint(async(_req,user)=>{const rows=await companyNotificationsFor(user);return {body:{notifications:rows.slice(0,20),unreadCount:rows.filter(row=>!row.is_read).length}};}));
  router.put('/notifications/read-all',companyEndpoint(async(_req,user)=>({body:await readAllCompanyNotifications(user)})));
  router.put('/notifications/:id/read',companyEndpoint(async(req,user)=>({body:await readCompanyNotification(user,companyEntityId(req.params.id))})));
  return router;
}
