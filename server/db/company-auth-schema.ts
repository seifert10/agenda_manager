/** Authentication exceptions only. Installed by the migration owner. */
export const companyAuthSchema = `
CREATE FUNCTION public.company_login_candidate(p_code text, p_email text)
RETURNS TABLE(id integer, company_id integer, password_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT u.id,u.company_id,u.password_hash
  FROM public.users u JOIN public.companies c ON c.id=u.company_id
  WHERE c.code=p_code AND u.email=p_email AND c.active=1 AND u.active=1
$$;
CREATE FUNCTION public.company_session_candidate(p_hash text)
RETURNS TABLE(id integer, company_id integer, expires_at text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.user_id,s.company_id,s.expires_at
  FROM public.user_sessions s
  JOIN public.users u ON u.company_id=s.company_id AND u.id=s.user_id
  JOIN public.companies c ON c.id=s.company_id
  WHERE s.token_hash=p_hash AND c.active=1 AND u.active=1
$$;
REVOKE ALL ON FUNCTION public.company_login_candidate(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_session_candidate(text) FROM PUBLIC;
`;

/** Owner must explicitly choose a dedicated resolver role that can see only auth tables. */
export function companyAuthGrants(runtimeRole: string, resolverRole: string): string {
  for (const role of [runtimeRole,resolverRole]) if (!/^[a-z][a-z0-9_]{2,62}$/.test(role)) throw new Error('Nome de papel inválido.');
  if (runtimeRole === resolverRole) throw new Error('Runtime e resolvedor devem ser papéis distintos.');
  return `
    GRANT USAGE ON SCHEMA public TO ${resolverRole}, ${runtimeRole};
    GRANT SELECT ON companies,users,user_sessions TO ${resolverRole};
    CREATE POLICY auth_resolver_companies ON companies FOR SELECT TO ${resolverRole} USING(true);
    CREATE POLICY auth_resolver_users ON users FOR SELECT TO ${resolverRole} USING(true);
    CREATE POLICY auth_resolver_sessions ON user_sessions FOR SELECT TO ${resolverRole} USING(true);
    GRANT CREATE ON SCHEMA public TO ${resolverRole};
    ALTER FUNCTION public.company_login_candidate(text,text) OWNER TO ${resolverRole};
    ALTER FUNCTION public.company_session_candidate(text) OWNER TO ${resolverRole};
    REVOKE CREATE ON SCHEMA public FROM ${resolverRole};
    GRANT EXECUTE ON FUNCTION public.company_login_candidate(text,text) TO ${runtimeRole};
    GRANT EXECUTE ON FUNCTION public.company_session_candidate(text) TO ${runtimeRole};
  `;
}
