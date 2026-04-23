// tests/card-v2.test.ts
import { describe, test, expect } from 'vitest';
import { SmartCardBuilder } from '../src/bot/card';
import type { CardActionValue } from '../src/bot/card-action-types';

describe('buildConfirmCardV2', () => {
  const smart = new SmartCardBuilder();

  test('produces schema 2.0 card with three callback buttons', () => {
    const value: CardActionValue = {
      kind: 'permission',
      requestId: 'perm-abc',
      choice: 'allow',
      requesterOpenId: 'ou_1',
    };
    const card = smart.buildConfirmCardV2({
      title: '🛡️ Tool permission',
      headerTemplate: 'orange',
      bodyMarkdown: '```bash\nrm -rf /tmp/foo\n```',
      buttons: [
        { label: '✓ Allow', variant: 'primary',
          value: { ...value, choice: 'allow' } },
        { label: '✗ Deny', variant: 'danger',
          value: { ...value, choice: 'deny' } },
        { label: '✓✓ Allow Always', variant: 'default',
          value: { ...value, choice: 'allow_always' } },
      ],
    });

    expect(card).toMatchObject({
      schema: '2.0',
      config: { update_multi: true },
      header: {
        template: 'orange',
        title: { tag: 'plain_text', content: '🛡️ Tool permission' },
      },
    });
    expect(card.body.elements[0]).toMatchObject({ tag: 'markdown' });
    const actions = card.body.elements[1] as any;
    expect(actions.tag).toBe('action');
    expect(actions.actions).toHaveLength(3);
    expect(actions.actions[0]).toMatchObject({
      tag: 'button',
      text: { tag: 'plain_text', content: '✓ Allow' },
      type: 'primary',
      behaviors: [{
        type: 'callback',
        value: {
          kind: 'permission',
          requestId: 'perm-abc',
          choice: 'allow',
          requesterOpenId: 'ou_1',
        },
      }],
    });
    expect(actions.actions[1].type).toBe('danger');
    expect(actions.actions[2].type).toBe('default');
  });
});

describe('buildResolvedCardV2', () => {
  const smart = new SmartCardBuilder();
  test('produces a read-only schema 2.0 card with status note', () => {
    const card = smart.buildResolvedCardV2({
      title: '🛡️ Tool permission',
      bodyMarkdown: '```bash\nrm -rf /tmp/foo\n```',
      statusText: '✓ Allowed by @demo',
      statusColor: 'green',
    });
    expect(card).toMatchObject({
      schema: '2.0',
      config: { update_multi: true },
    });
    expect(card.body.elements.at(-1)).toMatchObject({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: '✓ Allowed by @demo' }],
    });
    expect(card.body.elements.some(e => e.tag === 'action')).toBe(false);
  });
});
