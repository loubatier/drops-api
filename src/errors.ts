export type Fields = Record<string, string[]>;

export interface ErrorDef {
  code: string;
  message: string;
}

export const ERROR_DEFS: Record<number, ErrorDef> = {
  400: { code: 'bad_request', message: 'Requête illisible.' },
  401: { code: 'unauthorized', message: 'Authentification requise.' },
  403: { code: 'forbidden', message: "Vous n'avez pas le droit d'effectuer cette action." },
  404: { code: 'not_found', message: 'Ressource introuvable.' },
  409: { code: 'conflict', message: 'Cette ressource existe déjà.' },
  422: { code: 'validation_failed', message: 'Le formulaire contient des erreurs.' },
  429: { code: 'rate_limited', message: 'Trop de requêtes, réessayez dans quelques instants.' },
  500: { code: 'internal_error', message: 'Une erreur est survenue, réessayez plus tard.' },
  503: { code: 'service_unavailable', message: 'Service momentanément indisponible.' },
};

export const SIMULABLE_STATUSES = [400, 401, 403, 404, 409, 422, 429, 500, 503] as const;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Fields = {},
    public headers: Record<string, string> = {},
    public simulated = false,
    public meta?: Record<string, unknown>,
  ) {
    super(message);
  }

  static of(status: number, message?: string, fields: Fields = {}, code?: string) {
    const def = ERROR_DEFS[status];
    return new ApiError(status, code ?? def?.code ?? 'internal_error', message ?? def?.message ?? '', fields);
  }
}

export const notFound = (message = 'Ressource introuvable.') => ApiError.of(404, message);
export const forbidden = (message?: string) => ApiError.of(403, message);
export const tooFar = (message: string, meta: Record<string, unknown>) =>
  new ApiError(403, 'too_far', message, {}, {}, false, meta);
export const dropLocked = () => new ApiError(403, 'drop_locked', 'Ouvrez ce drop pour voir et réagir.');
export const validationFailed = (fields: Fields, message?: string) => ApiError.of(422, message, fields);

export function errorBody(err: ApiError, requestId: string) {
  return {
    error: {
      status: err.status,
      code: err.code,
      message: err.message,
      fields: err.fields,
      requestId,
      simulated: err.simulated,
      ...(err.meta ? { meta: err.meta } : {}),
    },
  };
}
