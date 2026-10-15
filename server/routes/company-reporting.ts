import { Router } from 'express';
import { companyEndpoint } from '../middlewares/company-endpoint';
import { companyHolidaySummary,companyPublicHolidays,companyAuditHistory,companyReportSummary,companyCsvReport } from '../services/companyReporting';

export function companyReportingRouter() {
  const router=Router();
  router.get('/holidays',companyEndpoint(async(req,user)=>({body:companyPublicHolidays(user,req.query.startDate,req.query.endDate)})));
  router.get('/holidays/summary',companyEndpoint(async(req,user)=>({body:await companyHolidaySummary(user,req.query.date)})));
  router.get('/audit',companyEndpoint(async(req,user)=>({body:await companyAuditHistory(user,req.query)})));
  router.get('/reports/summary',companyEndpoint(async(_req,user)=>({body:await companyReportSummary(user)})));
  router.get('/reports/export-csv',companyEndpoint(async(req,user)=>companyCsvReport(user,req.query)));
  return router;
}
