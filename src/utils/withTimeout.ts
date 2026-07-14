export class RequestTimeoutError extends Error {
  code = 'REQUEST_TIMEOUT';

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs / 1000} seconds.`);
    this.name = 'RequestTimeoutError';
  }
}

export function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new RequestTimeoutError(label, timeoutMs));
    }, timeoutMs);

    Promise.resolve(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
