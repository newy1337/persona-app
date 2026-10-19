export enum Role {
  MANAGER = 'manager',
  TEAMLEAD = 'teamlead',
  HEAD = 'head',
  VOICE = 'voice',
  ADMIN = 'admin',
}

export const ROLES: Role[] = [
  Role.MANAGER,
  Role.TEAMLEAD,
  Role.HEAD,
  Role.VOICE,
  Role.ADMIN,
];

/** Роли, которые ведут диалоги: менеджер и те, кто над ним. */
export const MANAGER_ROLES: readonly string[] = [
  Role.MANAGER,
  Role.TEAMLEAD,
  Role.HEAD,
];

export const isManagerRole = (role: string): boolean =>
  MANAGER_ROLES.includes(role);

/** Кто может быть руководителем у роли: менеджер → тимлид, тимлид → хед. */
export const LEAD_ROLE_FOR: Readonly<Record<string, Role>> = {
  [Role.MANAGER]: Role.TEAMLEAD,
  [Role.TEAMLEAD]: Role.HEAD,
};
