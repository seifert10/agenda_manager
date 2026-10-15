import { Router } from 'express';
import { companyEndpoint } from '../middlewares/company-endpoint';
import { CompanyRequestError } from '../services/companyErrors';
import { companyEntityId, listCompanyUsers, createCompanyUser, updateCompanyUser, listCompanyDepartments, saveCompanyDepartment, getCompanySettings, saveCompanySettings } from '../services/companyAdministration';

/** Mounted only in the complete company application, never alongside unscoped legacy routes. */
export function companyAdministrationRouter() {
  const router = Router();
  router.get('/users',companyEndpoint(async (_req,user)=>({body:await listCompanyUsers(user)})));
  router.post('/users',companyEndpoint(async (req,user)=>({status:201,body:await createCompanyUser(user,req.body)})));
  router.put('/users/:id',companyEndpoint(async (req,user)=>({body:await updateCompanyUser(user,companyEntityId(req.params.id),req.body)})));
  router.put('/users/:id/status',companyEndpoint(async (req,user)=>{
    if (req.body.active === undefined) throw new CompanyRequestError(400,'Informe o estado do usuário.');
    return {body:await updateCompanyUser(user,companyEntityId(req.params.id),{active:req.body.active})};
  }));
  router.get('/departments',companyEndpoint(async (_req,user)=>({body:await listCompanyDepartments(user)})));
  router.post('/departments',companyEndpoint(async (req,user)=>({status:201,body:await saveCompanyDepartment(user,req.body)})));
  router.put('/departments/:id',companyEndpoint(async (req,user)=>({body:await saveCompanyDepartment(user,req.body,companyEntityId(req.params.id))})));
  router.delete('/departments/:id',companyEndpoint(async (req,user)=>({body:await saveCompanyDepartment(user,{active:0},companyEntityId(req.params.id))})));
  router.get('/settings',companyEndpoint(async (_req,user)=>({body:await getCompanySettings(user)})));
  router.put('/settings',companyEndpoint(async (req,user)=>({body:await saveCompanySettings(user,req.body)})));
  return router;
}
