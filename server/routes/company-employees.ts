import { Router } from 'express';
import { companyEndpoint } from '../middlewares/company-endpoint';
import { companyEntityId } from '../services/companyAdministration';
import { listCompanyEmployees,companyEmployeeDetail,saveCompanyEmployee,deleteCompanyEmployee } from '../services/companyEmployees';

export function companyEmployeesRouter() {
  const router = Router();
  router.get('/',companyEndpoint(async(req,user)=>({body:await listCompanyEmployees(user,req.query)})));
  router.get('/:id',companyEndpoint(async(req,user)=>({body:await companyEmployeeDetail(user,companyEntityId(req.params.id))})));
  router.post('/',companyEndpoint(async(req,user)=>({status:201,body:await saveCompanyEmployee(user,req.body)})));
  router.put('/:id',companyEndpoint(async(req,user)=>({body:await saveCompanyEmployee(user,req.body,companyEntityId(req.params.id))})));
  router.delete('/:id',companyEndpoint(async(req,user)=>({body:await deleteCompanyEmployee(user,companyEntityId(req.params.id))})));
  return router;
}
