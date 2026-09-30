export function oneQuestionPerReply(goals: Record<string, any>): boolean {
  return goals?.acquaintance_plan?.one_question_per_reply !== false;
}

export const QUESTION_POLICY_RULE =
  'Настройка goal_plan.one_question_per_reply определяет лимит вопросов во всём ответе: true — не больше одного вопроса; false — несколько уместных вопросов допустимы, но не обязательны. В части количества вопросов эта настройка приоритетнее общих указаний об одном вопросе. Остальные запреты, доступность тем и разрешение задавать вопросы сохраняются.';
