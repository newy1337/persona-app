export const ROLE_LABELS = { admin: 'админ', head: 'хед', teamlead: 'тимлид', manager: 'менеджер', voice: 'войсер' };
export const MANAGER_ROLES = ['manager', 'teamlead', 'head'];
export const isManagerRole = (role) => MANAGER_ROLES.includes(role);
/** Кто может быть руководителем у роли. */
export const LEAD_ROLE_FOR = { manager: 'teamlead', teamlead: 'head' };
