import { Breadcrumb, BreadcrumbInput, CrashEventPayload } from '../types';

/**
 * Validates a number string using the standard Luhn checksum algorithm (Mod 10).
 * Rejects numbers outside 13-19 digits as well as all-zero sequences.
 */
export function isValidLuhn(numberStr: string): boolean {
  const digits = numberStr.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  if (/^0+$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Sanitizer for redacting PII, credentials, tokens, credit cards, and file system paths.
 */
export class DataScrubber {
  // Bearer tokens in headers or strings
  private static readonly BEARER_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

  // Sensitive URL query parameters: ?token=, &apiKey=, ?clientSecret=, etc.
  private static readonly QUERY_PARAM_REGEX =
    /([?&](?:[a-zA-Z0-9_.-]*(?:token|secret|password|passwd|api[_-]?key|auth|access[_-]?token)[a-zA-Z0-9_.-]*)=)([^&#\s]+)/gi;

  // Potential card number sequences: 13 to 19 digits with optional spaces or dashes, starting and ending with a digit
  private static readonly CC_CANDIDATE_REGEX = /\b\d(?:[ -]?\d){12,18}\b/g;

  // File system user directories: /Users/..., /home/..., /root/..., C:\Users\... (supporting spaces in directory names)
  private static readonly USER_PATH_REGEX =
    /(?:[a-zA-Z]:)?(?:[\\/]|\\\\)(?:Users|home|root)(?:[\\/]|\\\\)(?:[^\r\n\\/]+(?:[\\/]|\\\\))*[^\s"'`<>()\[\]{}:]+/gi;

  // Sensitive object keys (including compound keys like clientSecret, userPassword, cvv, ssn, pin)
  private static readonly SENSITIVE_KEY_REGEX =
    /^(?:.*(?:password|passwd|secret|api[_-]?key|token|auth|credential|credit[_-]?card|private[_-]?key).*|cvv\d?|cvc|ssn|pin)$/i;

  /**
   * Scrubs a string by redacting Bearer tokens, sensitive query parameters, Luhn-valid credit card numbers, and user paths.
   */
  public scrubString(input: string): string {
    if (!input || typeof input !== 'string') {
      return input;
    }

    // 1. Redact Bearer tokens
    let result = input.replace(DataScrubber.BEARER_REGEX, 'Bearer [REDACTED]');

    // 2. Redact sensitive URL query parameters
    result = result.replace(DataScrubber.QUERY_PARAM_REGEX, '$1[REDACTED]');

    // 3. Redact Luhn-valid credit card numbers
    result = result.replace(DataScrubber.CC_CANDIDATE_REGEX, (match) => {
      const digits = match.replace(/[\s-]/g, '');
      if (digits.length >= 13 && digits.length <= 19 && /^\d+$/.test(digits) && isValidLuhn(digits)) {
        return '[CARD_REDACTED]';
      }
      return match;
    });

    // 4. Redact user file system paths
    result = result.replace(DataScrubber.USER_PATH_REGEX, '[PATH_REDACTED]');

    return result;
  }

  /**
   * Deeply scrubs any data structure (objects, arrays, strings) while redacting sensitive keys and PII.
   */
  public scrub<T>(data: T, visited: WeakSet<object> = new WeakSet()): T {
    if (data === null || data === undefined) {
      return data;
    }

    if (data instanceof Date) {
      return data.toISOString() as unknown as T;
    }

    if (typeof data === 'string') {
      return this.scrubString(data) as unknown as T;
    }

    if (typeof data !== 'object') {
      return data;
    }

    if (visited.has(data as object)) {
      return '[Circular]' as unknown as T;
    }
    visited.add(data as object);

    if (Array.isArray(data)) {
      return data.map((item) => this.scrub(item, visited)) as unknown as T;
    }

    if (data instanceof Error) {
      const scrubbedError: Record<string, unknown> = {
        name: data.name,
        message: this.scrubString(data.message),
        stack: data.stack ? this.scrubString(data.stack) : undefined,
      };
      return scrubbedError as unknown as T;
    }

    const obj = data as Record<string, unknown>;
    const scrubbedObj: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (DataScrubber.SENSITIVE_KEY_REGEX.test(key)) {
        // If container object (like 'auth' or 'credentials' group), recurse to redact internal secrets
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          !(value instanceof Date) &&
          (key.toLowerCase().includes('auth') || key.toLowerCase().includes('credential'))
        ) {
          scrubbedObj[key] = this.scrub(value, visited);
        } else {
          scrubbedObj[key] = '[REDACTED]';
        }
      } else {
        scrubbedObj[key] = this.scrub(value, visited);
      }
    }

    return scrubbedObj as unknown as T;
  }

  /**
   * Scrubs a breadcrumb input or breadcrumb object.
   */
  public scrubBreadcrumb(breadcrumb: BreadcrumbInput): BreadcrumbInput {
    return {
      category: this.scrubString(breadcrumb.category),
      action: this.scrubString(breadcrumb.action),
      target: this.scrubString(breadcrumb.target),
      timestamp: breadcrumb.timestamp,
      sequence_order: breadcrumb.sequence_order,
      ...(breadcrumb.data ? { data: this.scrub(breadcrumb.data) } : {}),
    };
  }

  /**
   * Deeply sanitizes a full telemetry crash payload prior to network dispatch.
   */
  public scrubPayload(payload: CrashEventPayload): CrashEventPayload {
    return {
      event_id: payload.event_id,
      project_key: payload.project_key,
      occurred_at: payload.occurred_at,
      platform: payload.platform,
      language: payload.language,
      exception_type: this.scrubString(payload.exception_type),
      error_message: this.scrubString(payload.error_message),
      stack_trace: this.scrubString(payload.stack_trace),
      environment: this.scrub(payload.environment),
      breadcrumbs: payload.breadcrumbs.map((b) => this.scrubBreadcrumb(b) as Breadcrumb),
    };
  }
}
