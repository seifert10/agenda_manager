import { Router } from 'express';
import { companyEndpoint } from '../middlewares/company-endpoint';
import { companyEntityId } from '../services/companyAdministration';
import { listCompanyCalendar,createCompanyOff,updateCompanyOff,deleteCompanyOff,batchCompanyOffs,saveCompanySchedule,deleteCompanySchedule } from '../services/companyScheduling';

export function companySchedulingRouter() {
  const router=Router();
  router.get('/days-off',companyEndpoint(async(req,user)=>({body:await listCompanyCalendar(user,'offs',req.query)})));
  router.post('/days-off',companyEndpoint(async(req,user)=>({status:201,body:await createCompanyOff(user,req.body)})));
  router.post('/days-off/batch',companyEndpoint(async(req,user)=>({body:await batchCompanyOffs(user,req.body)})));
  router.put('/days-off/:id',companyEndpoint(async(req,user)=>({body:await updateCompanyOff(user,companyEntityId(req.params.id),req.body)})));
  router.delete('/days-off/:id',companyEndpoint(async(req,user)=>({body:await deleteCompanyOff(user,companyEntityId(req.params.id))})));
  router.get('/schedules',companyEndpoint(async(req,user)=>({body:await listCompanyCalendar(user,'schedules',req.query)})));
  router.post('/schedules',companyEndpoint(async(req,user)=>({body:await saveCompanySchedule(user,req.body)})));
  router.delete('/schedules/:id',companyEndpoint(async(req,user)=>({body:await deleteCompanySchedule(user,companyEntityId(req.params.id))})));
  return router;
}
