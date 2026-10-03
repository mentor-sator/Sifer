import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from '../no-contract-shadow.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const contractsDir = join(here, 'fixtures', 'contracts');
const options = [{ contractsDir }];

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

ruleTester.run('no-contract-shadow', rule, {
  valid: [
    { code: 'interface LocalShape { id: string }', options },
    { code: 'type CommentedOut = number;', options },
    {
      code: 'type SessionEnvelope = number;',
      options: [{ contractsDir: join(here, 'fixtures', 'missing') }],
    },
  ],
  invalid: [
    {
      code: 'interface SessionEnvelope { id: string }',
      options,
      errors: [{ messageId: 'shadow', data: { name: 'SessionEnvelope' } }],
    },
    {
      code: 'type SessionState = string;',
      options,
      errors: [{ messageId: 'shadow', data: { name: 'SessionState' } }],
    },
    {
      code: 'class SessionEnvelope {}',
      options,
      errors: [{ messageId: 'shadow', data: { name: 'SessionEnvelope' } }],
    },
    {
      code: 'enum SessionState { Idle }',
      options,
      errors: [{ messageId: 'shadow', data: { name: 'SessionState' } }],
    },
  ],
});

describe('socket.io-client boundary', () => {
  const eslint = new ESLint({ cwd: root });
  const code = "import { io } from 'socket.io-client';\nexport const connect = io;\n";

  it('rejects the import outside packages/realtime', async () => {
    const [result] = await eslint.lintText(code, {
      filePath: join(root, 'apps', 'motion', 'src', 'socket.ts'),
    });
    assert.ok(result.messages.some((message) => message.ruleId === 'no-restricted-imports'));
  });

  it('allows the import inside packages/realtime', async () => {
    const [result] = await eslint.lintText(code, {
      filePath: join(root, 'packages', 'realtime', 'src', 'socket.ts'),
    });
    assert.equal(
      result.messages.filter((message) => message.ruleId === 'no-restricted-imports').length,
      0,
    );
  });
});
