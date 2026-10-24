export class ConversationChangedError extends Error {
  override readonly name = 'ConversationChangedError';
}

export class MediaInputError extends Error {
  override readonly name = 'MediaInputError';
}

export class ModelResponseError extends Error {
  override readonly name = 'ModelResponseError';
}
