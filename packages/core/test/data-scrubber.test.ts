import { describe, expect, it } from 'bun:test';
import { DataScrubber, isValidLuhn } from '../src/sanitizer/data-scrubber';
import { CrashEventPayload } from '../src/types';

describe('DataScrubber', () => {
  const scrubber = new DataScrubber();

  describe('Luhn algorithm validator', () => {
    it('accurately identifies valid and invalid Luhn card numbers', () => {
      // 4012888888881881 is valid Luhn (sum % 10 === 0)
      expect(isValidLuhn('4012888888881881')).toBe(true);
      expect(isValidLuhn('4012 8888 8888 1881')).toBe(true);
      expect(isValidLuhn('4012-8888-8888-1881')).toBe(true);

      // 4012888888881882 is invalid Luhn (sum % 10 === 1)
      expect(isValidLuhn('4012888888881882')).toBe(false);

      // Too short (<13 digits) or too long (>19 digits)
      expect(isValidLuhn('1234567890')).toBe(false);
      expect(isValidLuhn('123456789012345678901')).toBe(false);

      // All-zero strings must be rejected
      expect(isValidLuhn('0000000000000000')).toBe(false);
      expect(isValidLuhn('0000-0000-0000-0000')).toBe(false);
    });
  });

  describe('String scrubbing', () => {
    it('redacts Bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummyToken';
      const output = scrubber.scrubString(input);
      expect(output).toBe('Authorization: Bearer [REDACTED]');
    });

    it('redacts sensitive URL query parameters', () => {
      expect(
        scrubber.scrubString('https://api.example.com/v1?token=secret123&page=1')
      ).toBe('https://api.example.com/v1?token=[REDACTED]&page=1');
      expect(
        scrubber.scrubString('https://api.example.com/oauth?apiKey=key999&clientSecret=shhh')
      ).toBe('https://api.example.com/oauth?apiKey=[REDACTED]&clientSecret=[REDACTED]');
    });

    it('redacts valid Luhn credit cards while leaving non-Luhn digit sequences intact', () => {
      // Valid Luhn 16-digit card
      const withValidCard = 'Payment processed for card 4012888888881881 successfully';
      expect(scrubber.scrubString(withValidCard)).toBe(
        'Payment processed for card [CARD_REDACTED] successfully'
      );

      // Formatted card with dashes
      const withFormattedCard = 'Card: 4012-8888-8888-1881 exp 12/28';
      expect(scrubber.scrubString(withFormattedCard)).toBe('Card: [CARD_REDACTED] exp 12/28');

      // Non-Luhn 16-digit sequence should be left untouched
      const withInvalidCard = 'Serial number 4012888888881882 registered';
      expect(scrubber.scrubString(withInvalidCard)).toBe(
        'Serial number 4012888888881882 registered'
      );

      // 10-digit phone number left intact
      const withPhone = 'Contact us at 555-123-4567';
      expect(scrubber.scrubString(withPhone)).toBe('Contact us at 555-123-4567');
    });

    it('redacts filesystem user paths on Unix and Windows including spaces and /root/', () => {
      expect(scrubber.scrubString('/Users/developer/project/secret.key')).toBe('[PATH_REDACTED]');
      expect(scrubber.scrubString('/Users/John Doe/project/secret.key')).toBe('[PATH_REDACTED]');
      expect(scrubber.scrubString('C:\\Users\\admin\\app.ts')).toBe('[PATH_REDACTED]');
      expect(scrubber.scrubString('C:\\Users\\John Doe\\app.ts')).toBe('[PATH_REDACTED]');
      expect(scrubber.scrubString('/home/deploy/server/config.json')).toBe('[PATH_REDACTED]');
      expect(scrubber.scrubString('/root/server/config.json')).toBe('[PATH_REDACTED]');
      expect(scrubber.scrubString('/root/.ssh/id_rsa')).toBe('[PATH_REDACTED]');

      const stackTrace =
        'Error: boom\n    at Object.<anonymous> (/Users/John Doe/project/app.ts:14:2)\n    at C:\\Users\\admin\\app.ts:5:1';
      const scrubbedStack = scrubber.scrubString(stackTrace);
      expect(scrubbedStack).toContain('[PATH_REDACTED]');
      expect(scrubbedStack).not.toContain('/Users/John Doe/project/app.ts');
      expect(scrubbedStack).not.toContain('C:\\Users\\admin\\app.ts');
    });
  });

  describe('Object and payload scrubbing', () => {
    it('handles Date instances by serializing to ISO string', () => {
      const date = new Date('2026-10-17T15:00:00.000Z');
      const scrubbed = scrubber.scrub<{ createdAt: unknown }>({ createdAt: date });
      expect(scrubbed.createdAt).toBe('2026-10-17T15:00:00.000Z');
    });

    it('redacts sensitive and compound keys in nested objects', () => {
      const sensitiveData = {
        username: 'alice',
        password: 'SuperSecretPassword123!',
        userPassword: 'UserSecretPassword!',
        clientSecret: 'secret_client_val',
        cvv: '123',
        ssn: '123-45-6789',
        pin: '1234',
        auth: {
          token: 'token_xyz123',
          apiKey: 'tracex_secret_999',
        },
        metadata: {
          secret: 'shhh',
          credit_card: '4012888888881881',
          normalField: 'all good',
        },
      };

      const scrubbed = scrubber.scrub(sensitiveData);
      expect(scrubbed.username).toBe('alice');
      expect(scrubbed.password).toBe('[REDACTED]');
      expect(scrubbed.userPassword).toBe('[REDACTED]');
      expect(scrubbed.clientSecret).toBe('[REDACTED]');
      expect(scrubbed.cvv).toBe('[REDACTED]');
      expect(scrubbed.ssn).toBe('[REDACTED]');
      expect(scrubbed.pin).toBe('[REDACTED]');
      expect(scrubbed.auth.token).toBe('[REDACTED]');
      expect(scrubbed.auth.apiKey).toBe('[REDACTED]');
      expect(scrubbed.metadata.secret).toBe('[REDACTED]');
      expect(scrubbed.metadata.credit_card).toBe('[REDACTED]');
      expect(scrubbed.metadata.normalField).toBe('all good');
    });

    it('handles circular references gracefully without recursion overflow', () => {
      const circularObj: Record<string, unknown> = {
        name: 'root',
      };
      circularObj.self = circularObj;

      const result = scrubber.scrub(circularObj);
      expect(result.name).toBe('root');
      expect(result.self).toBe('[Circular]');
    });

    it('scrubs a full CrashEventPayload while preserving project_key', () => {
      const payload: CrashEventPayload = {
        project_key: 'tracex_live_12345678',
        occurred_at: '2026-10-17T12:00:00.000Z',
        platform: 'javascript',
        language: 'typescript',
        exception_type: 'TypeError',
        error_message: 'Failed with Bearer eyJhbGciOi... on card 4012888888881881',
        stack_trace: 'at C:\\Users\\admin\\app.ts:12:3',
        environment: {
          app_version: '1.0.0',
          apiKey: 'secret_live_key',
          env_name: 'prod',
        },
        breadcrumbs: [
          {
            sequence_order: 1,
            timestamp: '2026-10-17T11:59:00.000Z',
            category: 'ui.tap',
            action: 'click',
            target: '/Users/developer/button',
            data: { password: 'secretpassword', normal: 'value' },
          },
        ],
      };

      const scrubbed = scrubber.scrubPayload(payload);

      // project_key is preserved for API authentication
      expect(scrubbed.project_key).toBe('tracex_live_12345678');
      expect(scrubbed.occurred_at).toBe('2026-10-17T12:00:00.000Z');

      // error message scrubbed
      expect(scrubbed.error_message).toContain('Bearer [REDACTED]');
      expect(scrubbed.error_message).toContain('[CARD_REDACTED]');

      // stack trace scrubbed
      expect(scrubbed.stack_trace).toContain('[PATH_REDACTED]');

      // environment sensitive key scrubbed
      expect(scrubbed.environment.apiKey).toBe('[REDACTED]');
      expect(scrubbed.environment.app_version).toBe('1.0.0');

      // breadcrumbs scrubbed
      expect(scrubbed.breadcrumbs[0].target).toBe('[PATH_REDACTED]');
      expect(scrubbed.breadcrumbs[0].data?.password).toBe('[REDACTED]');
      expect(scrubbed.breadcrumbs[0].data?.normal).toBe('value');
    });
  });
});
